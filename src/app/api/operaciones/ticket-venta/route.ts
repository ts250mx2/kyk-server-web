import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { tiendaQuery } from '@/lib/tienda-db';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

// Detalle de un ticket de venta: partidas de tblDetalleVentas con su artículo,
// marcando devoluciones por renglón (tblDetalleDevolucionesVenta).
export async function GET(request: Request) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const idVenta = num(searchParams.get('idVenta'));
    const caja = num(searchParams.get('caja'));
    if (idVenta <= 0 || caja <= 0) {
        return NextResponse.json({ error: 'Venta inválida' }, { status: 400 });
    }

    try {
        const [ventas, partidas] = await Promise.all([
            tiendaQuery(session.idTienda, `
                SELECT IdVenta, FechaVenta, Total, Pago, Efectivo
                FROM tblVentas
                WHERE IdVenta = ? AND IdComputadora = ?
            `, [idVenta, caja]) as Promise<Row[]>,
            tiendaQuery(session.idTienda, `
                SELECT D.CodigoInterno, D.Cantidad, D.PrecioVenta,
                       A.CodigoBarras, A.Descripcion, A.IdTipo,
                       COALESCE(V.CantidadDev, 0) AS CantidadDev
                FROM tblDetalleVentas D
                LEFT JOIN tblArticulos A ON A.CodigoInterno = D.CodigoInterno
                LEFT JOIN (
                    SELECT IdVenta, IdComputadora, CodigoInterno, SUM(Cantidad) AS CantidadDev
                    FROM tblDetalleDevolucionesVenta
                    WHERE IdVenta = ? AND IdComputadora = ?
                    GROUP BY IdVenta, IdComputadora, CodigoInterno
                ) V ON V.CodigoInterno = D.CodigoInterno
                WHERE D.IdVenta = ? AND D.IdComputadora = ?
                ORDER BY A.Descripcion
            `, [idVenta, caja, idVenta, caja]) as Promise<Row[]>,
        ]);

        const venta = ventas[0];
        if (!venta) {
            return NextResponse.json({ error: 'Ticket no encontrado' }, { status: 404 });
        }

        const total = num(venta.Total);
        const pago = num(venta.Pago);

        return NextResponse.json({
            venta: {
                idVenta,
                caja,
                fecha: venta.FechaVenta,
                total,
                pago,
                cambio: pago > total ? pago - total : 0,
            },
            partidas: partidas.map(p => {
                const cantidad = num(p.Cantidad);
                const precio = num(p.PrecioVenta);
                return {
                    codigoBarras: str(p.CodigoBarras),
                    descripcion: str(p.Descripcion) || `(código ${num(p.CodigoInterno)})`,
                    unidad: num(p.IdTipo) === 2 ? 'Kg' : 'Pzs',
                    cantidad,
                    precio,
                    importe: cantidad * precio,
                    cantidadDevuelta: num(p.CantidadDev),
                };
            }),
        });
    } catch (error) {
        console.error(`Error en ticket de venta ${idVenta} (tienda ${session.idTienda}):`, error);
        return NextResponse.json(
            { error: 'No fue posible consultar el detalle del ticket.' },
            { status: 502 }
        );
    }
}
