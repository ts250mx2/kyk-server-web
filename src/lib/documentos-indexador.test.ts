import { describe, expect, test, vi } from 'vitest';
import { crearIndexador } from './documentos-indexador';

// El módulo importa asegurarTexto (que abre el pool de MySQL): se sustituye
// para que la prueba no toque la base
vi.mock('./documentos-texto', () => ({ asegurarTexto: vi.fn() }));

describe('crearIndexador', () => {
    test('procesa los documentos encolados de uno en uno y en orden', async () => {
        const orden: number[] = [];
        let simultaneos = 0;
        let maximoSimultaneos = 0;
        const indexar = async (id: number) => {
            simultaneos++;
            maximoSimultaneos = Math.max(maximoSimultaneos, simultaneos);
            await new Promise(resolver => setTimeout(resolver, 1));
            orden.push(id);
            simultaneos--;
        };
        const indexador = crearIndexador(indexar, () => { });

        indexador.encolar([3, 1, 2]);
        await indexador.esperar();

        expect(orden).toEqual([3, 1, 2]);
        expect(maximoSimultaneos).toBe(1);
    });

    test('ignora repetidos e ids inválidos y reporta en proceso mientras dura', async () => {
        let liberar: () => void = () => { };
        const indexar = (id: number) => id === 5
            ? new Promise<void>(resolver => { liberar = resolver; })
            : Promise.resolve();
        const indexador = crearIndexador(indexar, () => { });

        indexador.encolar([5, 5, 0, -1, 2.5]);
        expect(indexador.estaEnProceso(5)).toBe(true);
        expect(indexador.estaEnProceso(0)).toBe(false);

        liberar();
        await indexador.esperar();
        expect(indexador.estaEnProceso(5)).toBe(false);
    });

    test('un error en un documento no detiene a los demás', async () => {
        const indexados: number[] = [];
        const errores: number[] = [];
        const indexar = async (id: number) => {
            if (id === 2) throw new Error('sin texto');
            indexados.push(id);
        };
        const indexador = crearIndexador(indexar, id => errores.push(id));

        indexador.encolar([1, 2, 3]);
        await indexador.esperar();

        expect(indexados).toEqual([1, 3]);
        expect(errores).toEqual([2]);
    });

    test('volver a encolar después de terminar arranca otra corrida', async () => {
        const indexados: number[] = [];
        const indexador = crearIndexador(async id => { indexados.push(id); }, () => { });

        indexador.encolar([1]);
        await indexador.esperar();
        indexador.encolar([2]);
        await indexador.esperar();

        expect(indexados).toEqual([1, 2]);
    });
});
