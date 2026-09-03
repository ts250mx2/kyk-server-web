// Reglas PURAS de la captura que hace la tienda al levantar una encuesta con
// el cliente enfrente: número de ticket, total a dos decimales y antigüedad.
// Sin base de datos: las comparten el servidor y la página de la encuesta.

export const MAX_NOMBRE_CLIENTE_LEN = 100;
export const MAX_NUMERO_TICKET_LEN = 20;
/** Foto del cliente ya reducida en el navegador (JPEG ~640 px): base64 */
export const MAX_FOTO_BASE64_LEN = 1_200_000;
export const PREFIJO_FOTO = 'data:image/jpeg;base64,';
/** Un ticket con más de este tiempo se acepta, pero se avisa */
export const MESES_TICKET_ANTIGUO = 1;

const DIGITOS_TIENDA = 2;
const DIGITOS_COMPUTADORA = 2;
const MIN_DIGITOS_TICKET = DIGITOS_TIENDA + DIGITOS_COMPUTADORA + 1;

export interface NumeroTicket {
    /** Solo dígitos, tal como se guarda */
    numero: string;
    idTienda: number;
    idComputadora: number;
    idVenta: number;
}

/**
 * El número de ticket concatena IdTienda (2 dígitos) + IdComputadora (2
 * dígitos) + IdVenta (el resto). Se toleran espacios y guiones. null si no
 * tiene la forma esperada.
 */
export function parseNumeroTicket(crudo: unknown): NumeroTicket | null {
    if (typeof crudo !== 'string' && typeof crudo !== 'number') return null;
    const numero = String(crudo).replace(/\D/g, '');
    if (numero.length < MIN_DIGITOS_TICKET || numero.length > MAX_NUMERO_TICKET_LEN) return null;
    const idTienda = Number(numero.slice(0, DIGITOS_TIENDA));
    const idComputadora = Number(numero.slice(DIGITOS_TIENDA, DIGITOS_TIENDA + DIGITOS_COMPUTADORA));
    const idVenta = Number(numero.slice(DIGITOS_TIENDA + DIGITOS_COMPUTADORA));
    if (idTienda <= 0 || idComputadora <= 0 || idVenta <= 0) return null;
    return { numero, idTienda, idComputadora, idVenta };
}

/** Total capturado por la tienda: acepta "1,234.50" y "$ 1234.5". null si no es un monto. */
export function parseTotal(crudo: unknown): number | null {
    if (typeof crudo === 'number') return Number.isFinite(crudo) && crudo >= 0 ? crudo : null;
    if (typeof crudo !== 'string') return null;
    const limpio = crudo.replace(/[^\d.-]/g, '');
    if (!limpio || !/^-?\d*\.?\d+$/.test(limpio) && !/^-?\d+\.?\d*$/.test(limpio)) return null;
    const valor = Number(limpio);
    return Number.isFinite(valor) && valor >= 0 ? valor : null;
}

/** Redondeo comercial a dos decimales (evita 1.005 → 1.00). */
export function redondear2(valor: number): number {
    return Math.round((valor + Number.EPSILON) * 100) / 100;
}

/** Los totales de venta traen muchos decimales: se comparan a dos. */
export function totalesCoinciden(capturado: number, total: number): boolean {
    return Math.abs(redondear2(capturado) - redondear2(total)) < 0.005;
}

/** Ticket con más de un mes respecto a `ahora` (un 31 se ajusta al último día del mes anterior). */
export function esTicketAntiguo(fechaTicket: Date, ahora: Date = new Date()): boolean {
    const limite = new Date(ahora);
    const dia = limite.getDate();
    limite.setDate(1);
    limite.setMonth(limite.getMonth() - MESES_TICKET_ANTIGUO);
    const ultimoDia = new Date(limite.getFullYear(), limite.getMonth() + 1, 0).getDate();
    limite.setDate(Math.min(dia, ultimoDia));
    return fechaTicket.getTime() < limite.getTime();
}

/** Los bytes FF D8 FF con los que empieza todo JPEG, ya en base64 */
const FIRMA_JPEG_BASE64 = '/9j/';

/** Base64 de la foto sin el prefijo data-URL; null si no es un JPEG real en base64 razonable. */
export function extraerFotoBase64(crudo: unknown): string | null {
    if (typeof crudo !== 'string' || !crudo.startsWith(PREFIJO_FOTO)) return null;
    const base64 = crudo.slice(PREFIJO_FOTO.length).trim();
    if (!base64.startsWith(FIRMA_JPEG_BASE64) || base64.length > MAX_FOTO_BASE64_LEN) return null;
    return /^[A-Za-z0-9+/]+=*$/.test(base64) ? base64 : null;
}

export interface PartidaTicket {
    descripcion: string;
    codigoBarras: string;
    unidad: 'Kg' | 'Pzs';
    cantidad: number;
    precio: number;
    importe: number;
}

/** Resultado de validar un ticket contra la base de la tienda. */
export interface TicketValidado {
    numero: string;
    idComputadora: number;
    idVenta: number;
    /** ISO */
    fecha: string;
    total: number;
    totalCapturado: number | null;
    /** null cuando no se capturó total */
    coincide: boolean | null;
    antiguo: boolean;
    partidas: PartidaTicket[];
}

/** Mensajes que la página muestra según el resultado. */
export function avisosDeTicket(t: TicketValidado): { error: string | null; advertencia: string | null } {
    const error = t.coincide === false
        ? `El total capturado ($${redondear2(t.totalCapturado ?? 0).toFixed(2)}) no coincide con el del ticket ($${redondear2(t.total).toFixed(2)}).`
        : null;
    const advertencia = t.antiguo
        ? `Este ticket tiene más de ${MESES_TICKET_ANTIGUO === 1 ? 'un mes' : `${MESES_TICKET_ANTIGUO} meses`} (${t.fecha.slice(0, 10)}).`
        : null;
    return { error, advertencia };
}
