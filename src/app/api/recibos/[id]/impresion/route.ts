import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { tiendaQuery } from '@/lib/tienda-db';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

// Descuento combinado en cascada (fe.DescuentoTotal del webservice Java).
const descuentoTotal = (...ds: number[]) =>
    1 - ds.reduce((acc, d) => acc * (1 - (d || 0)), 1);

// Datos de impresión del recibo, replicando el webservice Java ImprimirReciboMovil:
// encabezado de empresa (tblTiendas + tblRazonesSociales), recibo con condiciones de
// pago/orden de compra, partidas con descuentos 1-5 + mayoreo (V), IEPS/IVA por partida,
// devoluciones, destares y temperaturas, y pedidos pendientes del proveedor.
// A diferencia del Java, aquí NO se ejecuta ningún UPDATE: todo es solo lectura.
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

    const idTienda = session.idTienda;

    try {
        const [empresas, encabezados, partidasRows, devolucionesRows, destaresRows] = await Promise.all([
            tiendaQuery(idTienda, `
                SELECT A.Tienda, B.RazonSocial, B.RFC, B.Direccion, B.Colonia, B.Municipio, B.CP, A.Tel1, A.Tel2
                FROM tblTiendas A
                INNER JOIN tblRazonesSociales B ON A.IdRazonSocial = B.IdRazonSocial
                WHERE A.IdTienda = ?
            `, [idTienda]) as Promise<Row[]>,
            tiendaQuery(idTienda, `
                SELECT A.IdReciboMovil, A.FolioReciboMovil, C.Tienda, A.IdProveedor, B.Proveedor, B.RFC,
                       A.Numero, A.Total, A.CanastillasEntregadas, A.CanastillasRecibidas, A.FechaRecibo,
                       D.Usuario, A.PlazoPtoPago, A.DescuentoPtoPago, B.DiaSemana,
                       E.IdOrdenCompra, E.TotalPedido, A.UUID, A.Status
                FROM tblReciboMovil A
                INNER JOIN tblProveedores B ON A.IdProveedor = B.IdProveedor
                INNER JOIN tblTiendas C ON A.IdTienda = C.IdTienda
                LEFT JOIN tblUsuarios D ON A.IdUsuarioRecibo = D.IdUsuario
                LEFT JOIN tblOrdenesCompra E ON A.IdReciboMovil = E.IdReciboMovil
                WHERE A.IdReciboMovil = ?
            `, [idRecibo]) as Promise<Row[]>,
            tiendaQuery(idTienda, `
                SELECT A.CodigoInterno, B.CodigoBarras, B.DescripcionCompra, A.Rec, A.RecGranel, A.Costo, A.Iva,
                       A.Desc0, A.Desc1, A.Desc2, A.Desc3, A.Desc4, 1 - A.Factor AS DescMayoreo,
                       A.FechaCaducidad, B.MedidaCompra, B.IdTipo, A.Pedido, B.IEPS, B.IEPSCantidad,
                       CASE WHEN A.RecGranel > 0 AND A.PiezasRecibo = 0 THEN A.RecGranel
                            ELSE CASE WHEN A.PiezasRecibo > 0 THEN A.PiezasRecibo ELSE 0 END END AS RecGranelPiezas,
                       CASE WHEN A.PiezasRecibo > 0 THEN A.Rec / A.PiezasRecibo ELSE 0 END AS KilosPiezas
                FROM tblDetalleReciboMovil A
                INNER JOIN tblArticulos B ON A.CodigoInterno = B.CodigoInterno
                WHERE A.IdReciboMovil = ? AND A.Devolucion = 0
                ORDER BY B.Descripcion
            `, [idRecibo]) as Promise<Row[]>,
            tiendaQuery(idTienda, `
                SELECT A.CodigoInterno, B.CodigoBarras, B.Descripcion, A.Rec, A.Costo, A.Iva,
                       A.Desc0, A.Desc1, A.Desc2, A.Desc3, A.Desc4, 1 - A.Factor AS DescMayoreo,
                       B.MedidaVenta, B.IEPS, B.IEPSCantidad
                FROM tblDetalleReciboMovil A
                INNER JOIN tblArticulos B ON A.CodigoInterno = B.CodigoInterno
                WHERE A.IdReciboMovil = ? AND A.Devolucion = 1
                ORDER BY B.Descripcion
            `, [idRecibo]) as Promise<Row[]>,
            tiendaQuery(idTienda, `
                SELECT B.CodigoBarras, B.DescripcionCompra, A.RecGranel,
                       A.CajasTara, A.Tara, A.PesoTotal,
                       A.CajasTara2, A.Tara2, A.PesoTotal2,
                       A.CajasTara3, A.Tara3, A.PesoTotal3,
                       A.CajasTara4, A.Tara4, A.PesoTotal4,
                       A.Temperatura
                FROM tblDetalleReciboMovil A
                INNER JOIN tblArticulos B ON A.CodigoInterno = B.CodigoInterno
                WHERE A.IdReciboMovil = ? AND ((A.RecGranel > 0 AND A.Devolucion = 0) OR A.Temperatura > 0)
                ORDER BY B.DescripcionCompra
            `, [idRecibo]) as Promise<Row[]>,
        ]);

        const enc = encabezados[0];
        if (!enc) {
            return NextResponse.json({ error: 'Recibo no encontrado' }, { status: 404 });
        }

        // UUID: el sistema guarda a veces la URL completa del SAT; se extrae el id como en
        // el Java, y si solo viene la URL sin id se deja vacío para no ensuciar el impreso.
        let uuid = str(enc.UUID);
        const idMatch = uuid.match(/id=([0-9a-fA-F-]{30,40})/);
        if (idMatch) {
            uuid = idMatch[1];
        } else if (uuid.startsWith('http')) {
            uuid = '';
        } else {
            uuid = uuid.split('&')[0];
        }

        const plazoPtoPago = num(enc.PlazoPtoPago);
        const descuentoPtoPago = num(enc.DescuentoPtoPago);
        const diaSemana = num(enc.DiaSemana);
        const idProveedor = num(enc.IdProveedor);

        // ===== Partidas del recibo (cálculos idénticos al webservice) =====
        let subtotal = 0, totalDescuentos = 0, totalIeps = 0, totalIva = 0, sumRec = 0, sumPed = 0;
        const partidas = partidasRows.map(r => {
            const rec = num(r.Rec);
            const recGranel = num(r.RecGranel);
            const costo = num(r.Costo);
            const total = (num(r.IdTipo) === 2 && recGranel > 0) ? recGranel * costo : rec * costo;
            const descs = [num(r.Desc0), num(r.Desc1), num(r.Desc2), num(r.Desc3), num(r.Desc4)];
            const descMayoreo = num(r.DescMayoreo);
            const totalDesc = descuentoTotal(...descs, descMayoreo) * total;
            const ieps = num(r.IEPS);
            const iepsCantidad = num(r.IEPSCantidad);
            const iepsAplicado = iepsCantidad > 0 ? rec * iepsCantidad : (total - totalDesc) * ieps;
            const iva = (total - totalDesc + iepsAplicado) * num(r.Iva);

            subtotal += total;
            totalDescuentos += totalDesc;
            totalIeps += iepsAplicado;
            totalIva += iva;
            sumRec += rec;
            sumPed += num(r.Pedido);

            return {
                pedido: num(r.Pedido),
                rec,
                medida: str(r.MedidaCompra),
                recGranelPiezas: num(r.RecGranelPiezas),
                kilosPiezas: num(r.KilosPiezas),
                codigoBarras: str(r.CodigoBarras),
                descripcion: str(r.DescripcionCompra),
                llevaIva: num(r.Iva) > 0,
                caducidad: r.FechaCaducidad && str(r.FechaCaducidad) !== 'null' ? str(r.FechaCaducidad) : '',
                costo,
                ieps,
                iepsCantidad,
                descuentos: [...descs, descMayoreo],
                total,
            };
        });

        // ===== Devoluciones a proveedor =====
        let subtotalDev = 0, descuentosDev = 0, iepsDev = 0, ivaDev = 0;
        const devoluciones = devolucionesRows.map(r => {
            const rec = num(r.Rec);
            const costo = num(r.Costo);
            const total = rec * costo;
            const descs = [num(r.Desc0), num(r.Desc1), num(r.Desc2), num(r.Desc3), num(r.Desc4)];
            const descMayoreo = num(r.DescMayoreo);
            const totalDesc = descuentoTotal(...descs, descMayoreo) * total;
            const ieps = num(r.IEPS);
            const iepsCantidad = num(r.IEPSCantidad);
            const iepsAplicado = iepsCantidad > 0 ? rec * iepsCantidad : (total - totalDesc) * ieps;
            const iva = (total - totalDesc + iepsAplicado) * num(r.Iva);

            subtotalDev += total;
            descuentosDev += totalDesc;
            iepsDev += iepsAplicado;
            ivaDev += iva;

            return {
                rec,
                medida: str(r.MedidaVenta),
                codigoBarras: str(r.CodigoBarras),
                descripcion: str(r.Descripcion),
                llevaIva: num(r.Iva) > 0,
                costo,
                ieps,
                iepsCantidad,
                descuentos: [...descs, descMayoreo],
                total,
            };
        });

        // ===== Totales (misma aritmética del webservice) =====
        const totalEntradas = subtotal - totalDescuentos + totalIeps + totalIva;
        const totalSalidas = subtotalDev - descuentosDev + iepsDev + ivaDev;
        let granTotal = totalEntradas - totalSalidas;
        const dctoFinanciero = granTotal * descuentoPtoPago / 100;
        granTotal -= dctoFinanciero;

        const totalOrdenCompra = num(enc.TotalPedido);
        const totalFactura = num(enc.Total);

        // ===== Pedidos pendientes del proveedor (tolerante si el esquema difiere) =====
        let pendientes: Array<Record<string, unknown>> = [];
        try {
            const filtroDia = diaSemana === 1 ? 'DAYOFWEEK(NOW())' : '0';
            const pendientesRows = await tiendaQuery(idTienda, `
                SELECT B.CodigoBarras, B.DescripcionCompra, B.MedidaCompra, A.Pedido, A.Costo,
                       A.Desc0, A.Desc1, A.Desc2, A.Desc3, A.Desc4, 1 - A.Factor AS DescMayoreo, B.Iva
                FROM tblDetallePedidos A
                INNER JOIN tblArticulos B ON A.CodigoInterno = B.CodigoInterno
                WHERE A.IdProveedor = ? AND A.IdTienda = ? AND A.Pedido > 1 AND B.Status = 0
                  AND A.UltimoPedido > ADDDATE(NOW(), INTERVAL -15 DAY)
                  AND A.IdDiaSemana = ${filtroDia}
                ORDER BY B.DescripcionCompra
            `, [idProveedor, idTienda]) as Row[];

            pendientes = pendientesRows.map(r => {
                const costo = num(r.Costo);
                const pedido = num(r.Pedido);
                const descs = [num(r.Desc0), num(r.Desc1), num(r.Desc2), num(r.Desc3), num(r.Desc4)];
                return {
                    pedido,
                    medida: str(r.MedidaCompra),
                    codigoBarras: str(r.CodigoBarras),
                    descripcion: str(r.DescripcionCompra),
                    llevaIva: num(r.Iva) > 0,
                    costo,
                    descuentos: [...descs, num(r.DescMayoreo)],
                    total: pedido * costo,
                };
            });
        } catch {
            pendientes = [];
        }

        const emp = empresas[0] ?? {};

        return NextResponse.json({
            empresa: {
                razonSocial: str(emp.RazonSocial),
                rfc: str(emp.RFC),
                direccion: str(emp.Direccion),
                coloniaMunicipio: [str(emp.Colonia), str(emp.Municipio)].filter(Boolean).join(', '),
                cp: str(emp.CP),
                telefonos: [str(emp.Tel1), str(emp.Tel2)].filter(Boolean).join(' '),
            },
            recibo: {
                idReciboMovil: idRecibo,
                folio: str(enc.FolioReciboMovil),
                fecha: enc.FechaRecibo,
                tienda: str(enc.Tienda),
                idProveedor,
                proveedor: str(enc.Proveedor),
                rfc: str(enc.RFC),
                numero: str(enc.Numero),
                usuario: str(enc.Usuario),
                condicionesPago: plazoPtoPago === 0 ? 'Contado' : `${plazoPtoPago} días`,
                canastillasEntregadas: num(enc.CanastillasEntregadas),
                canastillasRecibidas: num(enc.CanastillasRecibidas),
                uuid,
                cancelado: num(enc.Status) !== 0,
            },
            partidas,
            devoluciones,
            destares: destaresRows.map(r => ({
                codigoBarras: str(r.CodigoBarras),
                descripcion: str(r.DescripcionCompra),
                pesos: [1, 2, 3, 4].map(n => ({
                    pesoTotal: num(r[`PesoTotal${n === 1 ? '' : n}`]),
                    cajas: num(r[`CajasTara${n === 1 ? '' : n}`]),
                    tara: num(r[`Tara${n === 1 ? '' : n}`]),
                })),
                pesoNeto: num(r.RecGranel),
                temperatura: num(r.Temperatura),
            })),
            pendientes,
            totales: {
                sumPed,
                sumRec,
                subtotal,
                descuentos: totalDescuentos,
                ieps: totalIeps,
                iva: totalIva,
                totalEntradas,
                subtotalDev,
                descuentosDev,
                iepsDev,
                ivaDev,
                totalSalidas,
                totalOrdenCompra,
                difTotalPedido: totalEntradas - totalOrdenCompra,
                totalFactura,
                difTotalFactura: totalEntradas - totalFactura,
                descuentoPtoPago,
                dctoFinanciero,
                totalPagar: granTotal,
            },
        });
    } catch (error) {
        console.error(`Error en impresión de recibo ${idRecibo} (tienda ${idTienda}):`, error);
        return NextResponse.json(
            { error: 'No fue posible obtener los datos de impresión del recibo.' },
            { status: 502 }
        );
    }
}
