import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { tiendaQuery } from '@/lib/tienda-db';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

// Detalle de una devolución de venta: partidas de tblDetalleDevolucionesVenta.
// CantidadAnterior = cantidad original del ticket; Cantidad = cantidad devuelta
// (las filas con Cantidad = 0 son líneas del ticket que no se devolvieron).
// Importe devuelto = Cantidad × PrecioVenta (cuadra con Valor del encabezado).
export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { id } = await params;
    const idDevolucion = Number(id);
    if (!Number.isInteger(idDevolucion) || idDevolucion <= 0) {
        return NextResponse.json({ error: 'Devolución inválida' }, { status: 400 });
    }

    try {
        const [encabezados, partidasRows] = await Promise.all([
            tiendaQuery(session.idTienda, `
                SELECT D.*, U.Usuario
                FROM tblDevolucionesVenta D
                LEFT JOIN tblUsuarios U ON U.IdUsuario = D.IdUsuario
                WHERE D.IdDevolucionVenta = ?
            `, [idDevolucion]) as Promise<Row[]>,
            tiendaQuery(session.idTienda, `
                SELECT D.CodigoInterno, D.CantidadAnterior, D.Cantidad, D.PrecioVenta, D.Iva,
                       D.IdVenta, D.IdComputadora,
                       A.CodigoBarras, A.Descripcion, A.IdTipo
                FROM tblDetalleDevolucionesVenta D
                LEFT JOIN tblArticulos A ON A.CodigoInterno = D.CodigoInterno
                WHERE D.IdDevolucionVenta = ?
                ORDER BY D.Cantidad DESC, A.Descripcion
            `, [idDevolucion]) as Promise<Row[]>,
        ]);

        const enc = encabezados[0];
        if (!enc) {
            return NextResponse.json({ error: 'Devolución no encontrada' }, { status: 404 });
        }

        const partidas = partidasRows.map(p => {
            const cantidad = num(p.Cantidad);
            const precio = num(p.PrecioVenta);
            return {
                codigoBarras: str(p.CodigoBarras),
                descripcion: str(p.Descripcion) || `(código ${num(p.CodigoInterno)})`,
                unidad: num(p.IdTipo) === 2 ? 'Kg' : 'Pzs',
                cantidadOriginal: num(p.CantidadAnterior),
                cantidadDevuelta: cantidad,
                precio,
                importe: cantidad * precio,
                ticket: num(p.IdVenta) > 0 ? `${num(p.IdComputadora)}-${num(p.IdVenta)}` : '',
            };
        });

        return NextResponse.json({
            devolucion: {
                idDevolucionVenta: idDevolucion,
                clave: str(enc.ClaveDevolucion),
                fecha: enc.FechaDevolucionVenta,
                cliente: str(enc.Cliente),
                dirTel: str(enc.DirTel),
                concepto: str(enc.Concepto),
                empleado: str(enc.Empleado) || str(enc.Usuario) || '—',
                usuario: str(enc.Usuario) || '—',
                valor: num(enc.Valor),
                canjeada: num(enc.IdComputadoraCanje) > 0,
                fechaCanje: num(enc.IdComputadoraCanje) > 0 ? enc.FechaCanje : null,
                cajaCanje: num(enc.IdComputadoraCanje),
                notaCredito: num(enc.IdFactura) > 0 ? num(enc.IdFactura) : null,
                cancelada: num(enc.Status) !== 0,
            },
            partidas,
        });
    } catch (error) {
        console.error(`Error en detalle de devolución ${idDevolucion} (tienda ${session.idTienda}):`, error);
        return NextResponse.json(
            { error: 'No fue posible consultar el detalle de la devolución.' },
            { status: 502 }
        );
    }
}
