import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { tiendaQuery } from '@/lib/tienda-db';
import { mysqlQuery } from '@/lib/mysql';
import { cargarKits, resolverMaestro } from '@/lib/kits';
import { deltasDesdeCorte, fechaTexto } from '@/lib/existencias';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Row = Record<string, unknown>;
const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

const MAX_FILAS = 1000;

// Quiebres y sobre-inventario desde el corte nocturno consolidado en el MySQL
// central (tblInventariosCostosActual / tblInventariosCostos, pobladas por
// KYKInvServices con IdTienda). Del central solo se usan Exi y PVD — las
// columnas Entradas/Salidas llegan volteadas por un bug de transmisión del
// servicio y no se tocan aquí. Nombres, precios y el COSTO salen del MySQL de
// tienda: el costo autorizado es tblArticulos.UltimoCosto (el Costo del
// central solo se usa como proxy para ordenar antes del recorte de filas).
//   - quiebres: agotados con demanda (Exi<=0, PVD>0) hoy o con días en quiebre
//     en el rango; venta perdida estimada = días en quiebre × PVD × Precio.
//   - exceso: sobre-inventario (cobertura Exi/PVD >= umbral) e inventario
//     muerto (Exi>0 sin venta); valor inmovilizado = Exi × Costo.
export async function GET(request: Request) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const tipo = searchParams.get('tipo') === 'exceso' ? 'exceso' : 'quiebres';
    const dias = Math.min(Math.max(num(searchParams.get('dias')) || 30, 7), 90);
    const umbral = Math.min(Math.max(num(searchParams.get('umbral')) || 30, 7), 365);
    const idTienda = session.idTienda;

    try {
        const snapshotRows = (await mysqlQuery(`
            SELECT CodigoInterno, Exi, PVD, Costo, Fecha
            FROM tblInventariosCostosActual WHERE IdTienda = ?
        `, [idTienda])) as Row[];

        if (!snapshotRows || snapshotRows.length === 0) {
            return NextResponse.json(
                { error: 'La tienda no tiene corte de inventario en el central (KYKInvServices)' },
                { status: 503 }
            );
        }

        const corteFecha = fechaTexto(snapshotRows[0].Fecha).slice(0, 10);

        // Kits (regla recursiva del webservice, lib/kits): el corte Fast YA
        // consolida — la fila del maestro incluye a toda su familia. Las filas
        // de variantes que llegan al corte son un artefacto duplicado (puras
        // salidas, negativas) y se DESCARTAN: sumarlas al maestro le restaría
        // ventas ya descontadas y generaría quiebres/excesos falsos.
        const kits = await cargarKits(idTienda);

        // Movimientos del día del corte en adelante (recibos, ventas,
        // transferencias...): sin esto, un artículo recibido HOY seguiría
        // apareciendo en quiebre aunque ya haya mercancía en piso
        const deltas = await deltasDesdeCorte(idTienda, `${corteFecha} 00:00:00`, kits)
            .catch(() => new Map<number, number>());

        const baseConsolidada: { codigo: number; exi: number; pvd: number; costo: number }[] = [];
        for (const r of snapshotRows) {
            const codigo = num(r.CodigoInterno);
            const { maestro } = resolverMaestro(codigo, kits);
            if (maestro !== codigo) continue;
            baseConsolidada.push({
                codigo,
                exi: num(r.Exi) + (deltas.get(codigo) ?? 0),
                pvd: num(r.PVD),
                costo: num(r.Costo),
            });
        }

        // Preselección y orden con datos del central; nombres/estatus al final
        interface Candidato {
            codigo: number; exi: number; pvd: number; costo: number;
            diasQuiebre: number; diasTotal: number;
        }
        let candidatos: Candidato[] = [];

        if (tipo === 'quiebres') {
            const historico = (await mysqlQuery(`
                SELECT CodigoInterno, SUM(Exi <= 0) AS DiasQuiebre, COUNT(*) AS DiasTotal
                FROM tblInventariosCostos
                WHERE IdTienda = ? AND Fecha >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                GROUP BY CodigoInterno
            `, [idTienda, dias]).catch(() => [])) as Row[];
            const porCodigo = new Map<number, { quiebre: number; total: number }>();
            for (const h of historico ?? []) {
                porCodigo.set(num(h.CodigoInterno), { quiebre: num(h.DiasQuiebre), total: num(h.DiasTotal) });
            }
            candidatos = baseConsolidada
                .map(c => {
                    const hist = porCodigo.get(c.codigo);
                    return { ...c, diasQuiebre: hist?.quiebre ?? 0, diasTotal: hist?.total ?? 0 };
                })
                .filter(c => c.pvd > 0 && (c.exi <= 0 || c.diasQuiebre > 0))
                // Proxy de impacto sin precio: unidades de venta perdidas en el rango
                .sort((a, b) => (b.diasQuiebre * b.pvd) - (a.diasQuiebre * a.pvd) || (b.pvd - a.pvd));
        } else {
            candidatos = baseConsolidada
                .map(c => ({ ...c, diasQuiebre: 0, diasTotal: 0 }))
                .filter(c => c.exi > 0 && (c.pvd <= 0 || c.exi / c.pvd >= umbral))
                .sort((a, b) => (b.exi * b.costo) - (a.exi * a.costo));
        }

        const truncado = candidatos.length > MAX_FILAS;
        candidatos = candidatos.slice(0, MAX_FILAS);

        // Nombres, precio y estatus del MySQL de la tienda (solo artículos activos)
        const info = new Map<number, Row>();
        if (candidatos.length > 0) {
            const marcas = candidatos.map(() => '?').join(',');
            const articulos = (await tiendaQuery(idTienda, `
                SELECT CodigoInterno, CodigoBarras, Descripcion, MedidaVenta, Precio, UltimoCosto, Status
                FROM tblArticulos WHERE CodigoInterno IN (${marcas})
            `, candidatos.map(c => c.codigo))) as Row[];
            for (const a of articulos ?? []) {
                if (num(a.Status) === 0) info.set(num(a.CodigoInterno), a);
            }
        }

        if (tipo === 'quiebres') {
            const filas = candidatos
                .filter(c => info.has(c.codigo))
                .map(c => {
                    const a = info.get(c.codigo)!;
                    const precio = num(a.Precio);
                    return {
                        codigoInterno: c.codigo,
                        codigoBarras: String(a.CodigoBarras ?? '').trim(),
                        descripcion: String(a.Descripcion ?? '').trim(),
                        medidaVenta: String(a.MedidaVenta ?? '').trim(),
                        exi: c.exi,
                        pvd: c.pvd,
                        precio,
                        enQuiebreHoy: c.exi <= 0,
                        diasQuiebre: c.diasQuiebre,
                        diasTotal: c.diasTotal,
                        ventaPerdidaDiaria: c.pvd * precio,
                        ventaPerdidaPeriodo: c.diasQuiebre * c.pvd * precio,
                    };
                })
                .sort((a, b) => b.ventaPerdidaPeriodo - a.ventaPerdidaPeriodo || b.ventaPerdidaDiaria - a.ventaPerdidaDiaria);

            const enQuiebreHoy = filas.filter(f => f.enQuiebreHoy);
            return NextResponse.json({
                tipo, corteFecha, dias, truncado,
                articulos: filas,
                resumen: {
                    enQuiebreHoy: enQuiebreHoy.length,
                    afectadosPeriodo: filas.filter(f => f.diasQuiebre > 0).length,
                    ventaPerdidaDiaria: enQuiebreHoy.reduce((t, f) => t + f.ventaPerdidaDiaria, 0),
                    ventaPerdidaPeriodo: filas.reduce((t, f) => t + f.ventaPerdidaPeriodo, 0),
                },
            });
        }

        const filas = candidatos
            .filter(c => info.has(c.codigo))
            .map(c => {
                const a = info.get(c.codigo)!;
                const costo = num(a.UltimoCosto);
                return {
                    codigoInterno: c.codigo,
                    codigoBarras: String(a.CodigoBarras ?? '').trim(),
                    descripcion: String(a.Descripcion ?? '').trim(),
                    medidaVenta: String(a.MedidaVenta ?? '').trim(),
                    exi: c.exi,
                    pvd: c.pvd,
                    cobertura: c.pvd > 0 ? c.exi / c.pvd : null,
                    costo,
                    valorInventario: c.exi * costo,
                    sinVenta: c.pvd <= 0,
                };
            })
            .sort((a, b) => b.valorInventario - a.valorInventario);

        const sinVenta = filas.filter(f => f.sinVenta);
        return NextResponse.json({
            tipo, corteFecha, umbral, truncado,
            articulos: filas,
            resumen: {
                articulos: filas.length,
                valorInmovilizado: filas.reduce((t, f) => t + f.valorInventario, 0),
                sinVenta: sinVenta.length,
                valorSinVenta: sinVenta.reduce((t, f) => t + f.valorInventario, 0),
            },
        });
    } catch (error) {
        console.error('Error al consultar quiebres de inventario:', error);
        return NextResponse.json(
            { error: 'Error al consultar los quiebres de inventario' },
            { status: 500 }
        );
    }
}
