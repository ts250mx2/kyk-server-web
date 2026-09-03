import { describe, expect, test } from 'vitest';
import {
    PREFIJO_FOTO,
    avisosDeTicket,
    esTicketAntiguo,
    extraerFotoBase64,
    parseNumeroTicket,
    parseTotal,
    redondear2,
    totalesCoinciden,
    type TicketValidado,
} from './encuestas-ticket';

describe('parseNumeroTicket', () => {
    test('separa tienda (2), computadora (2) y venta (resto)', () => {
        expect(parseNumeroTicket('0301123')).toEqual({ numero: '0301123', idTienda: 3, idComputadora: 1, idVenta: 123 });
        expect(parseNumeroTicket('12 05-98765')).toEqual({ numero: '120598765', idTienda: 12, idComputadora: 5, idVenta: 98765 });
        expect(parseNumeroTicket(1201007)).toEqual({ numero: '1201007', idTienda: 12, idComputadora: 1, idVenta: 7 });
    });

    test('rechaza tickets cortos, vacíos o con ceros en tienda/caja/venta', () => {
        expect(parseNumeroTicket('1234')).toBeNull();
        expect(parseNumeroTicket('')).toBeNull();
        expect(parseNumeroTicket(null)).toBeNull();
        expect(parseNumeroTicket('0001123')).toBeNull();
        expect(parseNumeroTicket('0300123')).toBeNull();
        expect(parseNumeroTicket('0301000')).toBeNull();
        expect(parseNumeroTicket('1'.repeat(25))).toBeNull();
    });
});

describe('parseTotal', () => {
    test('acepta montos con símbolo, comas y decimales', () => {
        expect(parseTotal('1,234.50')).toBe(1234.5);
        expect(parseTotal('$ 89.9')).toBe(89.9);
        expect(parseTotal(150)).toBe(150);
        expect(parseTotal('0.99')).toBe(0.99);
    });

    test('rechaza texto, negativos y vacío', () => {
        expect(parseTotal('abc')).toBeNull();
        expect(parseTotal('')).toBeNull();
        expect(parseTotal('-5')).toBeNull();
        expect(parseTotal(undefined)).toBeNull();
    });
});

describe('totales a dos decimales', () => {
    test('redondear2 hace redondeo comercial', () => {
        expect(redondear2(1.005)).toBe(1.01);
        expect(redondear2(123.456789)).toBe(123.46);
        expect(redondear2(10)).toBe(10);
    });

    test('totalesCoinciden ignora los decimales sobrantes del ticket', () => {
        expect(totalesCoinciden(123.46, 123.456789)).toBe(true);
        expect(totalesCoinciden(123.45, 123.456789)).toBe(false);
        expect(totalesCoinciden(89.9, 89.9000001)).toBe(true);
        expect(totalesCoinciden(100, 100.004)).toBe(true);
        expect(totalesCoinciden(100, 100.01)).toBe(false);
    });
});

describe('esTicketAntiguo', () => {
    const ahora = new Date('2026-09-03T12:00:00');

    test('más de un mes atrás es antiguo; un mes exacto o menos no', () => {
        expect(esTicketAntiguo(new Date('2026-08-02T12:00:00'), ahora)).toBe(true);
        expect(esTicketAntiguo(new Date('2026-08-03T12:00:00'), ahora)).toBe(false);
        expect(esTicketAntiguo(new Date('2026-09-01T09:00:00'), ahora)).toBe(false);
        expect(esTicketAntiguo(new Date('2025-09-03T12:00:00'), ahora)).toBe(true);
    });

    test('un 31 se compara contra el último día del mes anterior, sin desbordarse', () => {
        const finDeMarzo = new Date('2026-03-31T12:00:00');
        expect(esTicketAntiguo(new Date('2026-02-28T12:00:00'), finDeMarzo)).toBe(false);
        expect(esTicketAntiguo(new Date('2026-02-27T12:00:00'), finDeMarzo)).toBe(true);
    });
});

describe('extraerFotoBase64', () => {
    test('quita el prefijo data-URL de un JPEG y rechaza lo demás', () => {
        expect(extraerFotoBase64(`${PREFIJO_FOTO}/9j/4AAQ==`)).toBe('/9j/4AAQ==');
        expect(extraerFotoBase64('data:image/png;base64,iVBORw0KGgo=')).toBeNull();
        expect(extraerFotoBase64(`${PREFIJO_FOTO}no es base64!`)).toBeNull();
        expect(extraerFotoBase64(PREFIJO_FOTO)).toBeNull();
        expect(extraerFotoBase64(42)).toBeNull();
    });

    test('exige la firma JPEG aunque el prefijo diga image/jpeg', () => {
        // PNG disfrazado de JPEG y HTML en base64: fuera
        expect(extraerFotoBase64(`${PREFIJO_FOTO}iVBORw0KGgo=`)).toBeNull();
        expect(extraerFotoBase64(`${PREFIJO_FOTO}PHNjcmlwdD4=`)).toBeNull();
    });
});

describe('avisosDeTicket', () => {
    const base: TicketValidado = {
        numero: '0301123', idComputadora: 1, idVenta: 123, fecha: '2026-07-01T10:00:00.000Z',
        total: 123.456, totalCapturado: 123.46, coincide: true, antiguo: false, partidas: [],
    };

    test('sin problemas no hay avisos', () => {
        expect(avisosDeTicket(base)).toEqual({ error: null, advertencia: null });
    });

    test('total distinto es error y ticket viejo es advertencia', () => {
        const avisos = avisosDeTicket({ ...base, totalCapturado: 120, coincide: false, antiguo: true });
        expect(avisos.error).toContain('$120.00');
        expect(avisos.error).toContain('$123.46');
        expect(avisos.advertencia).toContain('2026-07-01');
    });
});
