import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { tiendaQuery } from '@/lib/tienda-db';

export const dynamic = 'force-dynamic';

const HORA_CORTE_DIA = 4; // Antes de las 4:00 AM se muestra el día anterior (cierre en curso).

// Rango de la fecha de negocio: [fecha 00:00, fecha + 1 día). Recibe la fecha como parámetro.
const rango = (col: string) => `${col} >= ? AND ${col} < ? + INTERVAL 1 DAY`;

type Row = Record<string, unknown>;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

export async function GET() {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const idTienda = session.idTienda;

    try {
        // Fecha de negocio según el reloj del servidor MySQL de la tienda:
        // entre 00:00 y 03:59 se considera todavía el día anterior.
        const infoRows = await tiendaQuery(idTienda, `
            SELECT NOW() AS ahora,
                   (HOUR(NOW()) < ${HORA_CORTE_DIA}) AS esDiaAnterior,
                   DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL (HOUR(NOW()) < ${HORA_CORTE_DIA}) DAY), '%Y-%m-%d') AS fechaNegocio
        `) as Row[];
        const info = infoRows[0] ?? {};
        const fecha = String(info.fechaNegocio);
        const esDiaAnterior = num(info.esDiaAnterior) === 1;

        const [
            ventasResumen,
            ventasPorHora,
            recibosResumen,
            recibosDetalle,
            entradasResumen,
            entradasDetalle,
            salidasResumen,
            salidasDetalle,
            facturasResumen,
            facturasDetalle,
        ] = await Promise.all([
            tiendaQuery(idTienda, `
                SELECT COUNT(*) AS tickets, COALESCE(SUM(Total), 0) AS total
                FROM tblVentas
                WHERE ${rango('FechaVenta')}
            `, [fecha, fecha]),
            tiendaQuery(idTienda, `
                SELECT HOUR(FechaVenta) AS hora, COUNT(*) AS tickets, COALESCE(SUM(Total), 0) AS total
                FROM tblVentas
                WHERE ${rango('FechaVenta')}
                GROUP BY HOUR(FechaVenta)
                ORDER BY hora
            `, [fecha, fecha]),
            tiendaQuery(idTienda, `
                SELECT COUNT(*) AS recibos,
                       COALESCE(SUM(TotalRecibo), 0) AS total,
                       COALESCE(SUM(TotalDevoluciones), 0) AS devoluciones
                FROM tblReciboMovil
                WHERE Status = 0 AND ${rango('FechaRecibo')}
            `, [fecha, fecha]),
            tiendaQuery(idTienda, `
                SELECT R.FolioReciboMovil, R.Numero, R.FechaRecibo, R.TotalRecibo, P.Proveedor
                FROM tblReciboMovil R
                LEFT JOIN tblProveedores P ON R.IdProveedor = P.IdProveedor
                WHERE R.Status = 0 AND ${rango('R.FechaRecibo')}
                ORDER BY R.FechaRecibo DESC
                LIMIT 20
            `, [fecha, fecha]),
            tiendaQuery(idTienda, `
                SELECT COUNT(*) AS n
                FROM tblTransferenciasEntradas
                WHERE Status = 0 AND ${rango('FechaEntrada')}
            `, [fecha, fecha]),
            tiendaQuery(idTienda, `
                SELECT E.FolioEntrada, E.FechaEntrada, S.TransferenciaSalida, S.Total, T.Tienda AS TiendaOrigen
                FROM tblTransferenciasEntradas E
                LEFT JOIN tblTransferenciasSalidas S ON S.FolioEntrada = E.FolioEntrada AND S.Status = 0
                LEFT JOIN tblTiendas T ON S.IdTienda = T.IdTienda
                WHERE E.Status = 0 AND ${rango('E.FechaEntrada')}
                ORDER BY E.FechaEntrada DESC
                LIMIT 20
            `, [fecha, fecha]),
            tiendaQuery(idTienda, `
                SELECT COUNT(*) AS n
                FROM tblTransferenciasSalidas
                WHERE Status = 0 AND IdTienda = ? AND ${rango('FechaSalida')}
            `, [idTienda, fecha, fecha]),
            tiendaQuery(idTienda, `
                SELECT S.FolioSalida, S.FechaSalida, S.TransferenciaSalida, S.Total, T.Tienda AS TiendaDestino
                FROM tblTransferenciasSalidas S
                LEFT JOIN tblTiendas T ON S.IdTiendaDestino = T.IdTienda
                WHERE S.Status = 0 AND S.IdTienda = ? AND ${rango('S.FechaSalida')}
                ORDER BY S.FechaSalida DESC
                LIMIT 20
            `, [idTienda, fecha, fecha]),
            tiendaQuery(idTienda, `
                SELECT COUNT(*) AS facturas,
                       COALESCE(SUM(Total), 0) AS total,
                       COALESCE(SUM(Iva), 0) AS iva
                FROM tblFacturas
                WHERE ${rango('FechaFactura')}
            `, [fecha, fecha]),
            tiendaQuery(idTienda, `
                SELECT Factura, Serie, FechaFactura, ClienteConcepto, RFC, Total, MetodoPago, \`Global\`, Status
                FROM tblFacturas
                WHERE ${rango('FechaFactura')}
                ORDER BY FechaFactura DESC
                LIMIT 20
            `, [fecha, fecha]),
        ]) as Row[][];

        const vr = (ventasResumen as Row[])[0] ?? {};
        const rr = (recibosResumen as Row[])[0] ?? {};
        const er = (entradasResumen as Row[])[0] ?? {};
        const sr = (salidasResumen as Row[])[0] ?? {};
        const fr = (facturasResumen as Row[])[0] ?? {};

        const totalVentas = num(vr.total);
        const tickets = num(vr.tickets);

        return NextResponse.json({
            tienda: { idTienda, nombre: session.tienda },
            ahora: info.ahora ?? null,
            fechaNegocio: fecha,
            esDiaAnterior,
            ventas: {
                total: totalVentas,
                tickets,
                ticketPromedio: tickets > 0 ? totalVentas / tickets : 0,
                porHora: (ventasPorHora as Row[]).map(r => ({
                    hora: num(r.hora),
                    tickets: num(r.tickets),
                    total: num(r.total),
                })),
            },
            recibos: {
                recibos: num(rr.recibos),
                total: num(rr.total),
                devoluciones: num(rr.devoluciones),
                detalle: (recibosDetalle as Row[]).map(r => ({
                    folio: r.FolioReciboMovil,
                    numero: r.Numero,
                    fecha: r.FechaRecibo,
                    total: num(r.TotalRecibo),
                    proveedor: r.Proveedor ?? 'Sin proveedor',
                })),
            },
            transferencias: {
                entradas: num(er.n),
                salidas: num(sr.n),
                detalleEntradas: (entradasDetalle as Row[]).map(r => ({
                    folio: r.FolioEntrada,
                    fecha: r.FechaEntrada,
                    descripcion: r.TransferenciaSalida ?? null,
                    origen: r.TiendaOrigen ?? null,
                    total: num(r.Total),
                })),
                detalleSalidas: (salidasDetalle as Row[]).map(r => ({
                    folio: r.FolioSalida,
                    fecha: r.FechaSalida,
                    descripcion: r.TransferenciaSalida ?? null,
                    destino: r.TiendaDestino ?? null,
                    total: num(r.Total),
                })),
            },
            facturas: {
                facturas: num(fr.facturas),
                total: num(fr.total),
                iva: num(fr.iva),
                detalle: (facturasDetalle as Row[]).map(r => ({
                    factura: r.Factura,
                    serie: r.Serie ?? '',
                    fecha: r.FechaFactura,
                    cliente: r.ClienteConcepto ?? 'Sin concepto',
                    rfc: r.RFC ?? '',
                    total: num(r.Total),
                    metodoPago: r.MetodoPago ?? '',
                    esGlobal: num(r.Global) === 1,
                    status: num(r.Status),
                })),
            },
        });
    } catch (error) {
        console.error(`Error en panel principal (tienda ${idTienda}):`, error);
        return NextResponse.json(
            { error: 'No fue posible consultar el servidor de la tienda. Verifica la conexión e intenta de nuevo.' },
            { status: 502 }
        );
    }
}
