import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { tiendaQuery } from '@/lib/tienda-db';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const LIMITE = 3000;

// Tickets de venta de una apertura (drill-down del monitor de cortes).
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
            SELECT IdVenta, FechaVenta, Total, Efectivo, Pago
            FROM tblVentas
            WHERE FechaVenta >= ? AND FechaVenta < ? + INTERVAL 1 DAY
              AND IdApertura = ? AND IdComputadora = ?
            ORDER BY FechaVenta
            LIMIT ${LIMITE}
        `, [fecha, fecha, idApertura, caja]) as Row[];

        return NextResponse.json({
            total: rows.length,
            monto: rows.reduce((acc, r) => acc + num(r.Total), 0),
            ventas: rows.map(r => ({
                idVenta: num(r.IdVenta),
                fecha: r.FechaVenta,
                total: num(r.Total),
                pago: num(r.Pago),
            })),
        });
    } catch (error) {
        console.error(`Error en ventas de apertura (tienda ${session.idTienda}):`, error);
        return NextResponse.json(
            { error: 'No fue posible consultar las ventas de la apertura.' },
            { status: 502 }
        );
    }
}
