import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { tiendaQuery } from '@/lib/tienda-db';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const LIMITE = 1000;

// Detalle de cancelaciones de una apertura (drill-down del monitor de cortes).
export async function GET(request: Request) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const hoy = new Date().toLocaleDateString('sv-SE');
    const fecha = ES_FECHA.test(searchParams.get('fecha') ?? '') ? searchParams.get('fecha')! : hoy;
    const idApertura = num(searchParams.get('idApertura'));
    const caja = num(searchParams.get('caja'));
    if (idApertura <= 0 || caja <= 0) {
        return NextResponse.json({ error: 'Apertura inválida' }, { status: 400 });
    }

    try {
        const rows = await tiendaQuery(session.idTienda, `
            SELECT A.IdCancelacion, A.FechaCancelacion, S.Usuario AS Supervisor,
                   B.Cantidad, B.PrecioVenta,
                   Art.CodigoBarras, Art.Descripcion
            FROM tblCancelaciones A
            INNER JOIN tblDetalleCancelaciones B
                ON A.IdComputadora = B.IdComputadora AND A.IdCancelacion = B.IdCancelacion
            LEFT JOIN tblUsuarios S ON A.IdSupervisor = S.IdUsuario
            LEFT JOIN tblArticulos Art ON Art.CodigoInterno = B.CodigoInterno
            WHERE A.FechaCancelacion >= ? AND A.FechaCancelacion < ? + INTERVAL 1 DAY
              AND A.IdApertura = ? AND A.IdComputadora = ?
            ORDER BY A.FechaCancelacion
            LIMIT ${LIMITE}
        `, [fecha, fecha, idApertura, caja]) as Row[];

        return NextResponse.json({
            total: rows.length,
            monto: rows.reduce((acc, r) => acc + num(r.PrecioVenta) * num(r.Cantidad), 0),
            cancelaciones: rows.map(r => ({
                idCancelacion: num(r.IdCancelacion),
                fecha: r.FechaCancelacion,
                supervisor: str(r.Supervisor) || '—',
                codigoBarras: str(r.CodigoBarras),
                descripcion: str(r.Descripcion) || '(artículo)',
                cantidad: num(r.Cantidad),
                precio: num(r.PrecioVenta),
                importe: num(r.PrecioVenta) * num(r.Cantidad),
            })),
        });
    } catch (error) {
        console.error(`Error en cancelaciones de apertura (tienda ${session.idTienda}):`, error);
        return NextResponse.json(
            { error: 'No fue posible consultar las cancelaciones de la apertura.' },
            { status: 502 }
        );
    }
}
