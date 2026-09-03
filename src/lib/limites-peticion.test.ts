import { describe, expect, test } from 'vitest';
import { crearLimitador, leerJsonLimitado } from './limites-peticion';

const peticion = (cuerpo: string, cabeceras: Record<string, string> = {}) =>
    new Request('http://local/api', { method: 'POST', body: cuerpo, headers: cabeceras });

describe('crearLimitador', () => {
    test('deja pasar hasta el máximo por clave y bloquea el siguiente', () => {
        const limitador = crearLimitador(2, 60_000);
        expect(limitador.excede('a')).toBe(false);
        expect(limitador.excede('a')).toBe(false);
        expect(limitador.excede('a')).toBe(true);
        expect(limitador.excede('b')).toBe(false);
    });

    test('la ventana vencida libera la cuota', () => {
        const limitador = crearLimitador(1, 1);
        expect(limitador.excede('a')).toBe(false);
        const inicio = Date.now();
        while (Date.now() - inicio < 3) { /* deja pasar la ventana de 1 ms */ }
        expect(limitador.excede('a')).toBe(false);
    });
});

describe('leerJsonLimitado', () => {
    test('regresa el objeto cuando cabe', async () => {
        const lectura = await leerJsonLimitado(peticion('{"a":1}'), 1024);
        expect(lectura).toEqual({ ok: true, cuerpo: { a: 1 } });
    });

    test('rechaza con 413 por Content-Length declarado y por bytes reales', async () => {
        const declarado = await leerJsonLimitado(peticion('{}', { 'content-length': '999999' }), 10);
        expect(declarado).toMatchObject({ ok: false, status: 413 });
        const real = await leerJsonLimitado(peticion(`{"x":"${'y'.repeat(50)}"}`), 10);
        expect(real).toMatchObject({ ok: false, status: 413 });
    });

    test('rechaza con 400 lo que no sea un objeto JSON', async () => {
        expect(await leerJsonLimitado(peticion('no json'), 1024)).toMatchObject({ ok: false, status: 400 });
        expect(await leerJsonLimitado(peticion('[1,2]'), 1024)).toMatchObject({ ok: false, status: 400 });
        expect(await leerJsonLimitado(peticion('null'), 1024)).toMatchObject({ ok: false, status: 400 });
    });
});
