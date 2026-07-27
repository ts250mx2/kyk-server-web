import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { tiendaQuery } from '@/lib/tienda-db';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

// Detalle de un recibo (equivalente a frmProcDetalleReciboMovil, abierto con
// doble clic en frmProcRecibos): encabezado + partidas de tblDetalleReciboMovil.
// Importe por partida = Rec × Costo con descuentos en cascada (validado contra
// TotalRecibo del encabezado en datos reales de tienda).
export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { id } = await params;
    const idRecibo = Number(id);
    if (!Number.isInteger(idRecibo) || idRecibo <= 0) {
        return NextResponse.json({ error: 'Recibo inválido' }, { status: 400 });
    }

    try {
        const [recibos, partidas] = await Promise.all([
            tiendaQuery(session.idTienda, `
                SELECT A.*, B.Proveedor, B.RFC
                FROM tblReciboMovil A
                INNER JOIN tblProveedores B ON A.IdProveedor = B.IdProveedor
                WHERE A.IdReciboMovil = ?
            `, [idRecibo]) as Promise<Row[]>,
            tiendaQuery(session.idTienda, `
                SELECT D.CodigoInterno, D.Rec, D.RecGranel, D.Costo, D.Iva, D.IEPS,
                       D.Desc0, D.Desc1, D.Desc2, D.Desc3, D.Desc4,
                       D.Devolucion, D.Pedido, D.FechaCaducidad,
                       A.CodigoBarras, A.Descripcion, A.MedidaCompra
                FROM tblDetalleReciboMovil D
                LEFT JOIN tblArticulos A ON A.CodigoInterno = D.CodigoInterno
                WHERE D.IdReciboMovil = ?
                ORDER BY D.Devolucion, A.Descripcion
            `, [idRecibo]) as Promise<Row[]>,
        ]);

        const recibo = recibos[0];
        if (!recibo) {
            return NextResponse.json({ error: 'Recibo no encontrado' }, { status: 404 });
        }

        // El total de devoluciones del encabezado puede venir en 0 si el recibo nunca se
        // reprocesó por el webservice; se calcula del detalle como respaldo.
        const devolucionesDetalle = partidas
            .filter(p => num(p.Devolucion) === 1)
            .reduce((acc, p) => acc + num(p.Rec) * num(p.Costo), 0);
        const totalDevoluciones = num(recibo.TotalDevoluciones) > 0
            ? num(recibo.TotalDevoluciones)
            : devolucionesDetalle;

        return NextResponse.json({
            recibo: {
                idReciboMovil: idRecibo,
                folio: recibo.FolioReciboMovil ?? '',
                fecha: recibo.FechaRecibo,
                proveedor: recibo.Proveedor ?? '',
                rfc: recibo.RFC ?? '',
                numero: recibo.Numero ?? '',
                subtotal: num(recibo.SubtotalRecibo),
                descuentos: num(recibo.DescuentosRecibo),
                iva: num(recibo.IVARecibo),
                ieps: num(recibo.TotalIEPS),
                totalRecibo: num(recibo.TotalRecibo),
                devoluciones: totalDevoluciones,
                descuentosFinancieros: num(recibo.DescuentosFinancieros),
                totalPagar: num(recibo.TotalPagar),
                cancelado: num(recibo.Status) !== 0,
            },
            partidas: partidas.map(p => {
                const rec = num(p.Rec);
                const costo = num(p.Costo);
                const descuentos = [0, 1, 2, 3, 4].map(n => num(p[`Desc${n}`]));
                let costoNeto = costo;
                for (const d of descuentos) costoNeto *= (1 - d);
                const descuentoTotal = costo > 0 ? 1 - costoNeto / costo : 0;
                return {
                    codigoInterno: num(p.CodigoInterno),
                    codigoBarras: p.CodigoBarras ?? '',
                    descripcion: p.Descripcion ?? `(código ${num(p.CodigoInterno)})`,
                    medida: p.MedidaCompra ?? '',
                    pedido: num(p.Pedido),
                    recibido: rec,
                    granel: num(p.RecGranel),
                    costo,
                    descuento: descuentoTotal,
                    iva: num(p.Iva),
                    esDevolucion: num(p.Devolucion) === 1,
                    importe: rec * costoNeto,
                };
            }),
        });
    } catch (error) {
        console.error(`Error en detalle de recibo ${idRecibo} (tienda ${session.idTienda}):`, error);
        return NextResponse.json(
            { error: 'No fue posible consultar el detalle del recibo.' },
            { status: 502 }
        );
    }
}
