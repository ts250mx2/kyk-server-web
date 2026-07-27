import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { tiendaQuery } from '@/lib/tienda-db';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

const LIMITE = 3000;

// Detalle de una factura, según los formularios del VB6:
// - frmProcDetalleFacturas (contado/crédito/nota de crédito): datos fiscales del cliente
//   (tblClientes por RFC), conceptos agrupados por artículo (tblDetalleVentas de las
//   ventas amparadas) y tickets ligados (tblDetalleFacturas).
// - frmProcCorteFacturaServer (público general, IdApertura > 0): además, datos de la
//   apertura (cajero/supervisor) y desglose de formas de pago de los tickets
//   (tblVentasTarjeta/Cheques/Transferencias/Vales/Devoluciones).
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

    const idTienda = session.idTienda;

    try {
        const facturas = await tiendaQuery(idTienda, `
            SELECT IdFactura, AlfaNumerico, Credito, IdApertura, IdComputadora, MetodoPago,
                   FormaPago, UsoCFDI, RegimenFiscal, RFC, ClienteConcepto, UUID,
                   FechaFactura, Total, Iva, TotalIEPS, Status
            FROM tblFacturas
            WHERE IdFactura = ?
        `, [idFactura]) as Row[];

        const fac = facturas[0];
        if (!fac) {
            return NextResponse.json({ error: 'Factura no encontrada' }, { status: 404 });
        }

        const idApertura = num(fac.IdApertura);
        const caja = num(fac.IdComputadora);

        const [ventas, conceptos] = await Promise.all([
            tiendaQuery(idTienda, `
                SELECT D.IdVenta, D.IdComputadora, V.FechaVenta, V.Total
                FROM tblDetalleFacturas D
                LEFT JOIN tblVentas V ON V.IdVenta = D.IdVenta AND V.IdComputadora = D.IdComputadora
                WHERE D.IdFactura = ?
                ORDER BY V.FechaVenta
                LIMIT ${LIMITE}
            `, [idFactura]) as Promise<Row[]>,
            tiendaQuery(idTienda, `
                SELECT DV.CodigoInterno, A.CodigoBarras, A.Descripcion, A.Iva,
                       SUM(DV.Cantidad) AS Cantidad,
                       SUM(DV.PrecioVenta * DV.Cantidad) AS Importe
                FROM tblDetalleFacturas DF
                INNER JOIN tblDetalleVentas DV
                    ON DV.IdVenta = DF.IdVenta AND DV.IdComputadora = DF.IdComputadora
                LEFT JOIN tblArticulos A ON A.CodigoInterno = DV.CodigoInterno
                WHERE DF.IdFactura = ?
                GROUP BY DV.CodigoInterno
                ORDER BY A.Descripcion
                LIMIT ${LIMITE}
            `, [idFactura]).catch(() => []) as Promise<Row[]>,
        ]);

        // Datos fiscales del cliente (frmProcDetalleFacturas junta tblFacturas con tblClientes por RFC)
        let cliente: Row | null = null;
        if (str(fac.RFC) && idApertura === 0) {
            try {
                const clientes = await tiendaQuery(idTienda, `
                    SELECT * FROM tblClientes WHERE RFC = ? LIMIT 1
                `, [str(fac.RFC)]) as Row[];
                cliente = clientes[0] ?? null;
            } catch {
                cliente = null;
            }
        }

        // Público general: apertura + desglose de formas de pago (frmProcCorteFacturaServer),
        // más marcado de tickets con devolución y tickets facturados en otra factura.
        let apertura: Row | null = null;
        let pagos: Record<string, number> | null = null;
        const devolucionesSet = new Set<string>();
        const facturadosMap = new Map<string, Array<{ folio: string; fecha: unknown; receptor: string }>>();
        if (idApertura > 0) {
            // Tickets con devolución (tblDetalleDevolucionesVenta, como SumCantidadDev > 0 del VB6)
            try {
                const devs = await tiendaQuery(idTienda, `
                    SELECT DISTINCT DV.IdVenta, DV.IdComputadora
                    FROM tblDetalleFacturas DF
                    INNER JOIN tblDetalleDevolucionesVenta DV
                        ON DV.IdVenta = DF.IdVenta AND DV.IdComputadora = DF.IdComputadora
                    WHERE DF.IdFactura = ? AND DV.Cantidad > 0
                `, [idFactura]) as Row[];
                for (const d of devs) {
                    devolucionesSet.add(`${num(d.IdVenta)}|${num(d.IdComputadora)}`);
                }
            } catch { /* sin marcado de devoluciones */ }

            // Tickets facturados en otra factura (anterior, no cancelada, no nota de crédito)
            try {
                const facs = await tiendaQuery(idTienda, `
                    SELECT DF.IdVenta, DF.IdComputadora, C.IdFactura, C.FechaFactura, C.ClienteConcepto,
                           CONCAT(COALESCE(C.AlfaNumerico, ''), '-', C.IdFactura) AS FolioFactura
                    FROM tblDetalleFacturas DF
                    INNER JOIN tblDetalleFacturas B
                        ON B.IdVenta = DF.IdVenta AND B.IdComputadora = DF.IdComputadora
                       AND B.IdFactura <> DF.IdFactura
                    INNER JOIN tblFacturas C ON C.IdFactura = B.IdFactura
                    WHERE DF.IdFactura = ? AND C.IdFactura < ? AND C.Status <> 2 AND C.Credito <> 2
                    ORDER BY C.IdFactura
                `, [idFactura, idFactura]) as Row[];
                for (const f of facs) {
                    const clave = `${num(f.IdVenta)}|${num(f.IdComputadora)}`;
                    const lista = facturadosMap.get(clave) ?? [];
                    lista.push({
                        folio: str(f.FolioFactura),
                        fecha: f.FechaFactura,
                        receptor: str(f.ClienteConcepto),
                    });
                    facturadosMap.set(clave, lista);
                }
            } catch { /* sin marcado de facturados */ }
            const sumaPago = async (tabla: string, expr: string): Promise<number> => {
                try {
                    const rows = await tiendaQuery(idTienda, `
                        SELECT COALESCE(SUM(${expr}), 0) AS Monto
                        FROM tblDetalleFacturas D
                        INNER JOIN ${tabla} T ON T.IdVenta = D.IdVenta AND T.IdComputadora = D.IdComputadora
                        WHERE D.IdFactura = ?
                    `, [idFactura]) as Row[];
                    return num(rows[0]?.Monto);
                } catch {
                    return 0;
                }
            };

            const [aperturas, tarjeta, cheques, transferencia, vales, devoluciones] = await Promise.all([
                tiendaQuery(idTienda, `
                    SELECT A.FechaApertura, A.FechaCierre, B.Usuario AS Cajero, D.Usuario AS SupervisorCierre
                    FROM tblAperturasCierres A
                    LEFT JOIN tblUsuarios B ON A.IdCajero = B.IdUsuario
                    LEFT JOIN tblUsuarios D ON A.IdSupervisorCierre = D.IdUsuario
                    WHERE A.IdApertura = ? AND A.IdComputadora = ?
                `, [idApertura, caja]) as Promise<Row[]>,
                sumaPago('tblVentasTarjeta', 'T.Tarjeta'),
                sumaPago('tblVentasCheques', 'T.Cheques'),
                sumaPago('tblVentasTransferencias', 'T.Transferencia'),
                sumaPago('tblVentasVales', 'T.Vales + T.ValesTarjeta'),
                sumaPago('tblVentasDevoluciones', 'T.Devoluciones'),
            ]);
            apertura = aperturas[0] ?? null;

            const sumaTickets = ventas.reduce((acc, v) => acc + num(v.Total), 0);
            pagos = {
                efectivo: sumaTickets - tarjeta - cheques - transferencia - vales,
                tarjeta,
                cheques,
                transferencia,
                vales,
                devoluciones,
            };
        }

        return NextResponse.json({
            factura: {
                idFactura,
                folio: `${str(fac.AlfaNumerico)}-${idFactura}`,
                fecha: fac.FechaFactura,
                receptor: str(fac.ClienteConcepto),
                rfc: str(fac.RFC),
                metodoPago: str(fac.MetodoPago),
                formaPago: str(fac.FormaPago),
                usoCfdi: str(fac.UsoCFDI),
                regimenFiscal: str(fac.RegimenFiscal),
                total: num(fac.Total),
                iva: num(fac.Iva),
                ieps: num(fac.TotalIEPS),
                cancelada: num(fac.Status) === 2,
                z: idApertura > 0 ? `${caja}-${idApertura}` : null,
            },
            cliente: cliente ? {
                direccion: [str(cliente.Calle), str(cliente.NumExterior), str(cliente.NumInterior)].filter(Boolean).join(' '),
                colonia: str(cliente.Colonia),
                municipio: [str(cliente.Municipio), str(cliente.Estado)].filter(Boolean).join(', '),
                cp: str(cliente.CP),
                correo: str(cliente.CorreoElectronico),
                regimenFiscal: str(cliente.RegimenFiscal),
            } : null,
            apertura: apertura ? {
                cajero: str(apertura.Cajero) || '—',
                supervisorCierre: str(apertura.SupervisorCierre) || null,
                fechaApertura: apertura.FechaApertura,
                fechaCierre: apertura.FechaCierre ?? null,
            } : null,
            pagos,
            conceptos: conceptos.map(c => {
                const cantidad = num(c.Cantidad);
                const importe = num(c.Importe);
                return {
                    codigoBarras: str(c.CodigoBarras),
                    descripcion: str(c.Descripcion) || `(código ${num(c.CodigoInterno)})`,
                    cantidad,
                    precio: cantidad > 0 ? importe / cantidad : 0,
                    iva: num(c.Iva),
                    importe,
                };
            }),
            ventas: ventas.map(r => {
                const clave = `${num(r.IdVenta)}|${num(r.IdComputadora)}`;
                const facturadoEn = facturadosMap.get(clave) ?? null;
                return {
                    idVenta: num(r.IdVenta),
                    caja: num(r.IdComputadora),
                    fecha: r.FechaVenta ?? null,
                    total: num(r.Total),
                    tieneDevolucion: devolucionesSet.has(clave),
                    facturadoEn,
                };
            }),
            resumenTickets: idApertura > 0 ? {
                conDevolucion: [...devolucionesSet].length,
                facturados: facturadosMap.size,
                totalFacturados: ventas.reduce((acc, r) => {
                    const clave = `${num(r.IdVenta)}|${num(r.IdComputadora)}`;
                    return acc + (facturadosMap.has(clave) ? num(r.Total) : 0);
                }, 0),
            } : null,
        });
    } catch (error) {
        console.error(`Error en detalle de factura ${idFactura} (tienda ${idTienda}):`, error);
        return NextResponse.json(
            { error: 'No fue posible consultar el detalle de la factura.' },
            { status: 502 }
        );
    }
}
