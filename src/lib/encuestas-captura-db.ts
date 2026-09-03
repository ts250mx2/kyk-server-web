import { portalQuery } from '@/lib/portal-db';
import type { SessionPayload } from '@/lib/session';
import { sanitizarTexto } from '@/lib/encuestas-tipos';
import {
    MAX_NOMBRE_CLIENTE_LEN,
    MAX_NUMERO_TICKET_LEN,
    extraerFotoBase64,
    parseNumeroTicket,
    parseTotal,
    redondear2,
    type TicketValidado,
} from '@/lib/encuestas-ticket';
import { ErrorTicket, validarTicket } from '@/lib/encuestas-ticket-db';

// Captura que hace la tienda al levantar una encuesta con el cliente enfrente
// (nombre, foto, ticket validado). Solo existe cuando la encuesta se contesta
// con sesión de la misma sucursal; se guarda como historial junto a la
// respuesta, con el ticket RE-validado en el servidor (nunca lo que diga el
// navegador).

const MAX_PARTIDAS_SNAPSHOT = 200;

export interface Captura {
    nombre: string | null;
    /** Base64 del JPEG, sin prefijo */
    foto: string | null;
    numeroTicket: string | null;
    totalCapturado: number | null;
    ticket: TicketValidado | null;
    errorTicket: string | null;
}

/** Limpia lo capturado y valida el ticket contra la tienda; null si no capturaron nada. */
export async function armarCaptura(cruda: unknown, sesion: SessionPayload): Promise<Captura | null> {
    const c = (cruda && typeof cruda === 'object' ? cruda : {}) as Record<string, unknown>;
    const nombre = sanitizarTexto(c.nombre, MAX_NOMBRE_CLIENTE_LEN);
    const foto = extraerFotoBase64(c.foto);
    const numeroCrudo = sanitizarTexto(c.numeroTicket, MAX_NUMERO_TICKET_LEN);
    const totalCapturado = parseTotal(c.total);
    if (!nombre && !foto && !numeroCrudo && totalCapturado === null) return null;

    const base = { nombre, foto, numeroTicket: numeroCrudo, totalCapturado };
    if (!numeroCrudo) return { ...base, ticket: null, errorTicket: null };
    if (!parseNumeroTicket(numeroCrudo)) {
        return { ...base, ticket: null, errorTicket: 'Número de ticket con formato inválido' };
    }
    try {
        return { ...base, ticket: await validarTicket(sesion, numeroCrudo, totalCapturado), errorTicket: null };
    } catch (error) {
        if (!(error instanceof ErrorTicket)) console.error(`Error validando ticket ${numeroCrudo}:`, error);
        const errorTicket = error instanceof ErrorTicket ? error.message : 'No fue posible consultar el ticket en la tienda';
        return { ...base, ticket: null, errorTicket };
    }
}

export async function guardarCaptura(idRespuesta: number, idTienda: number, captura: Captura, sesion: SessionPayload): Promise<void> {
    const t = captura.ticket;
    await portalQuery(
        `INSERT INTO encuestas_clientes_captura
            (IdRespuesta, IdTienda, NombreCliente, FotoCliente, NumeroTicket, IdComputadora, IdVenta,
             TotalCapturado, TotalTicket, FechaTicket, TicketValido, TicketAntiguo, DetalleTicket, ErrorTicket,
             CapturadoPor, CapturadoPorNombre, Fecha)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
            idRespuesta,
            idTienda,
            captura.nombre,
            captura.foto,
            t?.numero ?? captura.numeroTicket,
            t?.idComputadora ?? null,
            t?.idVenta ?? null,
            captura.totalCapturado === null ? null : redondear2(captura.totalCapturado),
            t ? redondear2(t.total) : null,
            t ? new Date(t.fecha) : null,
            t?.coincide === null || t?.coincide === undefined ? null : (t.coincide ? 1 : 0),
            t?.antiguo ? 1 : 0,
            t ? JSON.stringify(t.partidas.slice(0, MAX_PARTIDAS_SNAPSHOT)) : null,
            captura.errorTicket,
            sesion.codigobarras,
            sesion.name,
        ]
    );
}
