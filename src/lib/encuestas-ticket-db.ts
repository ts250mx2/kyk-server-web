import { tiendaQuery } from '@/lib/tienda-db';
import {
    esTicketAntiguo,
    parseNumeroTicket,
    totalesCoinciden,
    type PartidaTicket,
    type TicketValidado,
} from '@/lib/encuestas-ticket';

// Validación de un ticket contra el MySQL de la tienda en sesión: el número
// trae la tienda (debe ser la de la sesión), la caja y la venta; se compara el
// total a dos decimales y se arma el detalle (tblDetalleVentas + tblArticulos)
// para mostrarlo y guardarlo como snapshot en el historial.

type Row = Record<string, unknown>;
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

export class ErrorTicket extends Error {
    constructor(mensaje: string, readonly status: number) {
        super(mensaje);
    }
}

function fechaDeVenta(cruda: unknown): Date {
    const fecha = cruda instanceof Date ? cruda : new Date(String(cruda));
    return Number.isNaN(fecha.getTime()) ? new Date(0) : fecha;
}

function partidaDeFila(p: Row): PartidaTicket {
    const cantidad = num(p.Cantidad);
    const precio = num(p.PrecioVenta);
    return {
        descripcion: str(p.Descripcion) || `(código ${num(p.CodigoInterno)})`,
        codigoBarras: str(p.CodigoBarras),
        unidad: num(p.IdTipo) === 2 ? 'Kg' : 'Pzs',
        cantidad,
        precio,
        importe: cantidad * precio,
    };
}

/**
 * Busca el ticket en la tienda de la sesión. Lanza ErrorTicket con el mensaje
 * para el usuario cuando el número no tiene forma, es de otra tienda o no
 * existe; un total que no coincide NO es error: se regresa `coincide = false`.
 */
export async function validarTicket(
    sesion: { idTienda: number; tienda: string },
    numeroCrudo: unknown,
    totalCapturado: number | null,
): Promise<TicketValidado> {
    const ticket = parseNumeroTicket(numeroCrudo);
    if (!ticket) {
        throw new ErrorTicket('El número de ticket debe traer tienda (2 dígitos), caja (2 dígitos) y folio.', 400);
    }
    if (ticket.idTienda !== sesion.idTienda) {
        throw new ErrorTicket(`El ticket es de la tienda ${ticket.idTienda}, no de ${sesion.tienda} (${sesion.idTienda}).`, 400);
    }

    const [ventas, partidas] = await Promise.all([
        tiendaQuery(sesion.idTienda, `
            SELECT IdVenta, IdComputadora, FechaVenta, Total
            FROM tblVentas
            WHERE IdVenta = ? AND IdComputadora = ?
            LIMIT 1
        `, [ticket.idVenta, ticket.idComputadora]) as Promise<Row[]>,
        tiendaQuery(sesion.idTienda, `
            SELECT D.CodigoInterno, D.Cantidad, D.PrecioVenta, A.CodigoBarras, A.Descripcion, A.IdTipo
            FROM tblDetalleVentas D
            LEFT JOIN tblArticulos A ON A.CodigoInterno = D.CodigoInterno
            WHERE D.IdVenta = ? AND D.IdComputadora = ?
            ORDER BY A.Descripcion
        `, [ticket.idVenta, ticket.idComputadora]) as Promise<Row[]>,
    ]);

    const venta = ventas[0];
    if (!venta) {
        throw new ErrorTicket(`No existe el ticket ${ticket.numero} (caja ${ticket.idComputadora}, folio ${ticket.idVenta}) en ${sesion.tienda}.`, 404);
    }

    const total = num(venta.Total);
    const fecha = fechaDeVenta(venta.FechaVenta);
    return {
        numero: ticket.numero,
        idComputadora: ticket.idComputadora,
        idVenta: ticket.idVenta,
        fecha: fecha.toISOString(),
        total,
        totalCapturado,
        coincide: totalCapturado === null ? null : totalesCoinciden(totalCapturado, total),
        antiguo: esTicketAntiguo(fecha),
        partidas: partidas.map(partidaDeFila),
    };
}
