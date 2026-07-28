import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { tiendaQuery } from '@/lib/tienda-db';
import { mysqlQuery } from '@/lib/mysql';
import { cargarKits, familiaDetallada, resolverMaestro } from '@/lib/kits';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Row = Record<string, unknown>;
const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

const MAX_FILAS = 1500;
const DIAS_HISTORICO = 30;

// Quiebre de Stock — port de la pantalla de kyk-dashboard, con los datos del
// corte nocturno central: un quiebre es un SKU con Exi <= umbral Y demanda
// reciente (PVD > 0 en el corte; los SKUs muertos en cero no cuentan).
//   venta/día = PVD × Precio · venta perdida = venta/día × horizonte
//   utilidad perdida = PVD × (Precio − UltimoCosto) × horizonte
//   severidad por venta/día: >= $1,000 crítico, >= $200 alto, resto medio
// Se agrega lo que el dashboard no tenía: días en quiebre de los últimos 30
// días (histórico central) y la utilidad perdida con tblArticulos.UltimoCosto.
export async function GET(request: Request) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const umbral = Math.min(Math.max(num(searchParams.get('umbral')), 0), 100);
    const horizonte = Math.min(Math.max(num(searchParams.get('horizonte')) || 7, 1), 90);
    const idTienda = session.idTienda;

    try {
        const [snapshotRows, historicoRows] = await Promise.all([
            mysqlQuery(`
                SELECT CodigoInterno, Exi, PVD, Fecha
                FROM tblInventariosCostosActual WHERE IdTienda = ?
            `, [idTienda]) as Promise<Row[]>,
            mysqlQuery(`
                SELECT CodigoInterno, SUM(Exi <= 0) AS DiasQuiebre
                FROM tblInventariosCostos
                WHERE IdTienda = ? AND Fecha >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                GROUP BY CodigoInterno
            `, [idTienda, DIAS_HISTORICO]).catch(() => []) as Promise<Row[]>,
        ]);

        if (!snapshotRows || snapshotRows.length === 0) {
            return NextResponse.json(
                { error: 'La tienda no tiene corte de inventario en el central (KYKInvServices)' },
                { status: 503 }
            );
        }

        const corteFecha = String(snapshotRows[0].Fecha ?? '').slice(0, 10);
        const diasQuiebrePorCodigo = new Map<number, number>();
        for (const h of historicoRows ?? []) {
            diasQuiebrePorCodigo.set(num(h.CodigoInterno), num(h.DiasQuiebre));
        }

        // Consolidación de kits con la regla recursiva del webservice (lib/kits):
        // el hijo vende con su código pero el inventario vive en el maestro raíz
        // (factores multiplicados, sin atravesar intermedios TipoOperacion 4).
        // El corte Fast ya consolida, pero si trae filas de variantes (ligas de
        // kit dadas de alta después de generar historial, o faltantes) el hijo
        // solo acumula salidas y se ve "roto" para siempre: aquí se pliega al
        // maestro en vez de listarse.
        const kits = await cargarKits(idTienda);
        const consolidado = new Map<number, { exi: number; pvd: number; variantes: number }>();
        for (const r of snapshotRows) {
            const codigo = num(r.CodigoInterno);
            const { maestro, factor } = resolverMaestro(codigo, kits);
            const acumulado = consolidado.get(maestro) ?? { exi: 0, pvd: 0, variantes: 0 };
            consolidado.set(maestro, {
                exi: acumulado.exi + num(r.Exi) / factor,
                pvd: acumulado.pvd + num(r.PVD) / factor,
                variantes: acumulado.variantes + (maestro !== codigo ? 1 : 0),
            });
        }

        // Denominador del KPI: SKUs (ya consolidados) con demanda reciente
        const conVenta = [...consolidado.entries()].filter(([, v]) => v.pvd > 0);
        let candidatos = conVenta
            .map(([codigo, v]) => ({ codigo, exi: v.exi, pvd: v.pvd, variantes: v.variantes }))
            .filter(c => c.exi <= umbral)
            .sort((a, b) => b.pvd - a.pvd);
        const truncado = candidatos.length > MAX_FILAS;
        candidatos = candidatos.slice(0, MAX_FILAS);

        // Familia recursiva de cada candidato: para mostrar QUÉ variantes
        // incluye, con su nivel en la cadena (variante de variante)
        const familias = new Map<number, Map<number, { factor: number; nivel: number }>>();
        const codigosFicha = new Set<number>();
        for (const c of candidatos) {
            const familia = familiaDetallada(c.codigo, kits);
            familias.set(c.codigo, familia);
            for (const codigo of familia.keys()) codigosFicha.add(codigo);
        }

        // Nombre, depto, precio y costo del MySQL de tienda (maestros y variantes)
        const fichas = new Map<number, Row>();
        if (codigosFicha.size > 0) {
            const lista = [...codigosFicha];
            const marcas = lista.map(() => '?').join(',');
            const articulos = (await tiendaQuery(idTienda, `
                SELECT A.CodigoInterno, A.CodigoBarras, A.Descripcion, A.MedidaVenta,
                       A.Precio, A.UltimoCosto, A.Status, D.Depto
                FROM tblArticulos A
                LEFT JOIN tblDeptos D ON A.IdDepto = D.IdDepto
                WHERE A.CodigoInterno IN (${marcas})
            `, lista)) as Row[];
            for (const a of articulos ?? []) {
                fichas.set(num(a.CodigoInterno), a);
            }
        }

        const items = candidatos
            // El maestro se lista solo si es un artículo activo de la tienda
            .filter(c => {
                const ficha = fichas.get(c.codigo);
                return Boolean(ficha) && num(ficha!.Status) === 0;
            })
            .map(c => {
                const a = fichas.get(c.codigo)!;
                const variantesDetalle = [...(familias.get(c.codigo) ?? new Map<number, { factor: number; nivel: number }>()).entries()]
                    .filter(([codigo]) => codigo !== c.codigo)
                    .map(([codigo, v]) => {
                        const ficha = fichas.get(codigo);
                        return {
                            codigoInterno: codigo,
                            codigoBarras: String(ficha?.CodigoBarras ?? '').trim(),
                            descripcion: String(ficha?.Descripcion ?? `Código ${codigo}`).trim(),
                            nivel: v.nivel,
                        };
                    })
                    .sort((x, y) => x.nivel - y.nivel || x.descripcion.localeCompare(y.descripcion));
                const precio = num(a.Precio);
                const margen = Math.max(0, precio - num(a.UltimoCosto));
                const ventaDiaria = c.pvd * precio;
                const severidad = ventaDiaria >= 1000 ? 'critico' : ventaDiaria >= 200 ? 'alto' : 'medio';
                return {
                    codigoInterno: c.codigo,
                    codigoBarras: String(a.CodigoBarras ?? '').trim(),
                    descripcion: String(a.Descripcion ?? '').trim(),
                    depto: String(a.Depto ?? '').trim(),
                    medidaVenta: String(a.MedidaVenta ?? '').trim(),
                    stock: c.exi,
                    pvd: c.pvd,
                    variantes: variantesDetalle.length,
                    variantesDetalle,
                    precio,
                    diasQuiebre: diasQuiebrePorCodigo.get(c.codigo) ?? 0,
                    ventaDiaria,
                    ventaPerdida: ventaDiaria * horizonte,
                    unidadesPerdidas: c.pvd * horizonte,
                    utilidadPerdida: c.pvd * margen * horizonte,
                    severidad,
                };
            })
            .sort((a, b) => b.ventaPerdida - a.ventaPerdida);

        // Desglose por departamento
        const porDeptoMapa = new Map<string, { skus: number; ventaPerdida: number }>();
        for (const it of items) {
            const clave = it.depto || '(sin depto)';
            const acumulado = porDeptoMapa.get(clave) ?? { skus: 0, ventaPerdida: 0 };
            porDeptoMapa.set(clave, {
                skus: acumulado.skus + 1,
                ventaPerdida: acumulado.ventaPerdida + it.ventaPerdida,
            });
        }
        const porDepto = [...porDeptoMapa.entries()]
            .map(([depto, v]) => ({ depto, ...v }))
            .sort((a, b) => b.ventaPerdida - a.ventaPerdida);

        return NextResponse.json({
            corteFecha,
            umbral,
            horizonte,
            truncado,
            items,
            porDepto,
            kpis: {
                skusEnQuiebre: items.length,
                skusConVenta: conVenta.length,
                ventaPerdida: items.reduce((t, i) => t + i.ventaPerdida, 0),
                ventaPerdidaDiaria: items.reduce((t, i) => t + i.ventaDiaria, 0),
                unidadesPerdidas: items.reduce((t, i) => t + i.unidadesPerdidas, 0),
                utilidadPerdida: items.reduce((t, i) => t + i.utilidadPerdida, 0),
                deptosAfectados: porDepto.length,
            },
        });
    } catch (error) {
        console.error('Error en quiebre de stock:', error);
        return NextResponse.json(
            { error: 'Error al consultar el quiebre de stock' },
            { status: 500 }
        );
    }
}
