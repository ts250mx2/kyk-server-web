import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { tiendaQuery } from '@/lib/tienda-db';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

const LIMITE = 3000;

// Tickets de venta amparados por una factura (frmProcDetalleFacturas):
// tblDetalleFacturas liga la factura con sus ventas (IdVenta + IdComputadora).
export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { id } = await params;
    const idFactura = Number(id);
    if (!Number.isInteger(idFactura) || idFactura <= 0) {
        return NextResponse.json({ error: 'Factura inválida' }, { status: 400 });
    }

    try {
        const rows = await tiendaQuery(session.idTienda, `
            SELECT D.IdVenta, D.IdComputadora, V.FechaVenta, V.Total
            FROM tblDetalleFacturas D
            LEFT JOIN tblVentas V ON V.IdVenta = D.IdVenta AND V.IdComputadora = D.IdComputadora
            WHERE D.IdFactura = ?
            ORDER BY V.FechaVenta
            LIMIT ${LIMITE}
        `, [idFactura]) as Row[];

        return NextResponse.json({
            total: rows.length,
            monto: rows.reduce((acc, r) => acc + num(r.Total), 0),
            ventas: rows.map(r => ({
                idVenta: num(r.IdVenta),
                caja: num(r.IdComputadora),
                fecha: r.FechaVenta ?? null,
                total: num(r.Total),
            })),
        });
    } catch (error) {
        console.error(`Error en ventas de factura ${idFactura} (tienda ${session.idTienda}):`, error);
        return NextResponse.json(
            { error: 'No fue posible consultar los tickets de la factura.' },
            { status: 502 }
        );
    }
}
