import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { tiendaQuery } from '@/lib/tienda-db';
import { mysqlQuery } from '@/lib/mysql';

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

        // Denominador del KPI: SKUs con demanda reciente en el corte
        const conVenta = snapshotRows.filter(r => num(r.PVD) > 0);
        let candidatos = conVenta
            .map(r => ({ codigo: num(r.CodigoInterno), exi: num(r.Exi), pvd: num(r.PVD) }))
            .filter(c => c.exi <= umbral)
            .sort((a, b) => b.pvd - a.pvd);
        const truncado = candidatos.length > MAX_FILAS;
        candidatos = candidatos.slice(0, MAX_FILAS);

        // Nombre, depto, precio y costo del MySQL de tienda (solo activos)
        const info = new Map<number, Row>();
        if (candidatos.length > 0) {
            const marcas = candidatos.map(() => '?').join(',');
            const articulos = (await tiendaQuery(idTienda, `
                SELECT A.CodigoInterno, A.CodigoBarras, A.Descripcion, A.MedidaVenta,
                       A.Precio, A.UltimoCosto, A.Status, D.Depto
                FROM tblArticulos A
                LEFT JOIN tblDeptos D ON A.IdDepto = D.IdDepto
                WHERE A.CodigoInterno IN (${marcas})
            `, candidatos.map(c => c.codigo))) as Row[];
            for (const a of articulos ?? []) {
                if (num(a.Status) === 0) info.set(num(a.CodigoInterno), a);
            }
        }

        const items = candidatos
            .filter(c => info.has(c.codigo))
            .map(c => {
                const a = info.get(c.codigo)!;
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
