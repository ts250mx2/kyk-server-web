import { beforeEach, describe, expect, test } from 'vitest';
import {
    MAX_CARACTERES_RECORDADOS,
    MAX_PAGINAS_RECORDADAS,
    VIGENCIA_MS,
    contextoDeLectura,
    olvidarConversacion,
    paginasRecordadas,
    recordarPagina,
    type PaginaLeida,
} from './adian-memoria';

const CLAVE = '1:123456';
const AHORA = 1_000_000;

const pagina = (idDocumento: number, numero = 1, texto = `texto ${idDocumento}-${numero}`): PaginaLeida => ({
    idDocumento,
    nombre: `Documento ${idDocumento}`,
    pagina: numero,
    totalPaginas: 3,
    texto,
});

beforeEach(() => olvidarConversacion(CLAVE));

describe('recordarPagina / paginasRecordadas', () => {
    test('sin nada recordado regresa vacío', () => {
        expect(paginasRecordadas(CLAVE, AHORA)).toEqual([]);
    });

    test('recuerda la página leída', () => {
        recordarPagina(CLAVE, pagina(1), AHORA);
        expect(paginasRecordadas(CLAVE, AHORA)).toEqual([pagina(1)]);
    });

    test('la misma página se reemplaza en vez de duplicarse', () => {
        recordarPagina(CLAVE, pagina(1, 1, 'viejo'), AHORA);
        recordarPagina(CLAVE, pagina(1, 1, 'nuevo'), AHORA + 1);
        expect(paginasRecordadas(CLAVE, AHORA + 1)).toEqual([pagina(1, 1, 'nuevo')]);
    });

    test('conserva solo las más recientes', () => {
        for (let i = 1; i <= MAX_PAGINAS_RECORDADAS + 2; i++) recordarPagina(CLAVE, pagina(i), AHORA + i);
        const ids = paginasRecordadas(CLAVE, AHORA + 10).map(p => p.idDocumento);
        expect(ids).toEqual([3, 4, 5]);
    });

    test('suelta las más viejas si el texto acumulado pasa del tope', () => {
        const grande = 'x'.repeat(MAX_CARACTERES_RECORDADOS * 0.6);
        recordarPagina(CLAVE, pagina(1, 1, grande), AHORA);
        recordarPagina(CLAVE, pagina(2, 1, grande), AHORA + 1);
        expect(paginasRecordadas(CLAVE, AHORA + 1).map(p => p.idDocumento)).toEqual([2]);
    });

    test('una sola página se conserva aunque pase del tope', () => {
        recordarPagina(CLAVE, pagina(1, 1, 'x'.repeat(MAX_CARACTERES_RECORDADOS + 1)), AHORA);
        expect(paginasRecordadas(CLAVE, AHORA)).toHaveLength(1);
    });

    test('vence pasada la vigencia y cada alta la renueva', () => {
        recordarPagina(CLAVE, pagina(1), AHORA);
        expect(paginasRecordadas(CLAVE, AHORA + VIGENCIA_MS - 1)).toHaveLength(1);
        recordarPagina(CLAVE, pagina(2), AHORA + VIGENCIA_MS - 1);
        expect(paginasRecordadas(CLAVE, AHORA + VIGENCIA_MS + 1)).toHaveLength(2);
        expect(paginasRecordadas(CLAVE, AHORA + 2 * VIGENCIA_MS)).toEqual([]);
    });

    test('no mezcla conversaciones', () => {
        recordarPagina(CLAVE, pagina(1), AHORA);
        expect(paginasRecordadas('otra', AHORA)).toEqual([]);
        olvidarConversacion('otra');
    });
});

describe('olvidarConversacion', () => {
    test('borra lo recordado', () => {
        recordarPagina(CLAVE, pagina(1), AHORA);
        olvidarConversacion(CLAVE);
        expect(paginasRecordadas(CLAVE, AHORA)).toEqual([]);
    });

    test('no toca la memoria de otra conversación', () => {
        recordarPagina(CLAVE, pagina(1), AHORA);
        recordarPagina('otra', pagina(2), AHORA);
        olvidarConversacion(CLAVE);
        expect(paginasRecordadas('otra', AHORA)).toEqual([pagina(2)]);
        olvidarConversacion('otra');
    });
});

describe('contextoDeLectura', () => {
    test('sin páginas regresa cadena vacía', () => {
        expect(contextoDeLectura([])).toBe('');
    });

    test('arma un bloque por documento con id, página y texto', () => {
        const contexto = contextoDeLectura([pagina(5, 2, 'Contenido de prueba')]);
        expect(contexto).toContain('YA leíste');
        expect(contexto).toContain('### Documento: Documento 5 (idDocumento 5, página 2 de 3)');
        expect(contexto).toContain('Contenido de prueba');
    });
});
