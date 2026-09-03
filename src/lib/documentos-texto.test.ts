import { beforeEach, describe, expect, test, vi } from 'vitest';

// La base, el disco y el extractor se sustituyen: aquí se prueba la lógica de
// partes, páginas, coalescencia y armado de consultas, no MySQL
const { portalQuery, extraerTexto, leerArchivo } = vi.hoisted(() => ({
    portalQuery: vi.fn(),
    extraerTexto: vi.fn(),
    leerArchivo: vi.fn(),
}));
vi.mock('./portal-db', () => ({ portalQuery }));
vi.mock('./extraer-texto', () => ({ extraerTexto }));
vi.mock('./documentos-fs', () => ({ leerArchivo }));

import {
    PARTES_POR_PAGINA_AGENTE,
    asegurarTexto,
    buscarEnTextos,
    estadoDelCorpus,
    obtenerPagina,
    procesarTextoDocumento,
} from './documentos-texto';

type Llamada = [string, unknown[] | undefined];
const llamadas = (): Llamada[] => portalQuery.mock.calls.map(c => [String(c[0]).replace(/\s+/g, ' ').trim(), c[1]]);

beforeEach(() => {
    portalQuery.mockReset();
    extraerTexto.mockReset();
    leerArchivo.mockReset();
    portalQuery.mockResolvedValue([]);
});

describe('procesarTextoDocumento', () => {
    test('borra lo previo e inserta las partes en lotes de 20 con la numeración corrida', async () => {
        extraerTexto.mockResolvedValue('x'.repeat(3_000 * 45));

        const total = await procesarTextoDocumento(7, 'manual.pdf', 'application/pdf', Buffer.from('pdf'));

        expect(total).toBe(45);
        const [borrado, lote1, lote2, lote3] = llamadas();
        expect(borrado[0]).toContain('DELETE FROM documentos_texto');
        expect(borrado[1]).toEqual([7]);
        expect(lote1[0].match(/\(\?, \?, \?\)/g)).toHaveLength(20);
        expect(lote1[1]).toHaveLength(60);
        expect(lote1[1]?.slice(0, 2)).toEqual([7, 1]);
        expect(lote2[1]?.slice(0, 2)).toEqual([7, 21]);
        expect(lote3[0].match(/\(\?, \?, \?\)/g)).toHaveLength(5);
        expect(lote3[1]?.slice(-3)).toEqual([7, 45, 'x'.repeat(3_000)]);
        expect(llamadas()).toHaveLength(4);
    });

    test('sin texto extraíble deja el marcador Parte 0 y regresa 0', async () => {
        extraerTexto.mockResolvedValue(null);

        const total = await procesarTextoDocumento(9, 'foto.png', 'image/png', Buffer.from(''));

        expect(total).toBe(0);
        const [, marcador] = llamadas();
        expect(marcador[0]).toContain('INSERT INTO documentos_texto');
        expect(marcador[1]).toEqual([9, 0, '']);
    });
});

describe('asegurarTexto', () => {
    test('si ya hay partes regresa su total sin extraer (SUM llega como texto desde mysql2)', async () => {
        portalQuery.mockResolvedValueOnce([{ Filas: 3, N: '3' }]);

        expect(await asegurarTexto(4)).toBe(3);
        expect(extraerTexto).not.toHaveBeenCalled();
    });

    test('con solo el marcador regresa 0 sin volver a extraer', async () => {
        portalQuery.mockResolvedValueOnce([{ Filas: 1, N: '0' }]);

        expect(await asegurarTexto(4)).toBe(0);
        expect(extraerTexto).not.toHaveBeenCalled();
    });

    test('dos llamadas simultáneas al mismo documento comparten una sola extracción', async () => {
        portalQuery.mockImplementation(async (sql: string) => {
            if (sql.includes('COUNT(*)')) return [{ Filas: 0, N: null }];
            if (sql.includes('FROM documentos WHERE')) {
                return [{ NombreArchivo: 'a.txt', Archivo: '', Contenido: Buffer.from('hola'), TipoMime: 'text/plain', Nombre: 'A', Resumen: 'ya' }];
            }
            return [];
        });
        extraerTexto.mockImplementation(() => new Promise(resolver => setTimeout(() => resolver('texto de prueba'), 5)));

        const [a, b] = await Promise.all([asegurarTexto(11), asegurarTexto(11)]);

        expect(a).toBe(1);
        expect(b).toBe(1);
        expect(extraerTexto).toHaveBeenCalledTimes(1);
        expect(llamadas().filter(([sql]) => sql.includes('DELETE'))).toHaveLength(1);
    });

    test('al terminar, la siguiente llamada vuelve a consultar la base', async () => {
        portalQuery.mockResolvedValue([{ Filas: 2, N: '2' }]);

        await asegurarTexto(12);
        await asegurarTexto(12);

        expect(llamadas().filter(([sql]) => sql.includes('COUNT(*)'))).toHaveLength(2);
    });
});

describe('obtenerPagina', () => {
    test('con el tamaño del agente arma páginas de 8 partes', async () => {
        portalQuery
            .mockResolvedValueOnce([{ Filas: 9, N: '9' }])
            .mockResolvedValueOnce([{ Texto: 'parte 9' }]);

        const pagina = await obtenerPagina(5, 2, PARTES_POR_PAGINA_AGENTE);

        expect(pagina).toEqual({ texto: 'parte 9', pagina: 2, totalPaginas: 2 });
        const [, partes] = llamadas();
        expect(partes[0]).toContain('Parte BETWEEN ? AND ?');
        expect(partes[1]).toEqual([5, 9, 16]);
    });

    test('sin tamaño usa 4 partes por página (evaluaciones) y acota la página pedida', async () => {
        portalQuery
            .mockResolvedValueOnce([{ Filas: 9, N: '9' }])
            .mockResolvedValueOnce([{ Texto: 'a' }, { Texto: 'b' }]);

        const pagina = await obtenerPagina(5, 99);

        expect(pagina).toEqual({ texto: 'ab', pagina: 3, totalPaginas: 3 });
        expect(llamadas()[1][1]).toEqual([5, 9, 12]);
    });

    test('documento sin texto regresa null', async () => {
        portalQuery.mockResolvedValueOnce([{ Filas: 1, N: '0' }]);
        expect(await obtenerPagina(5, 1)).toBeNull();
    });
});

describe('estadoDelCorpus', () => {
    test('separa documentos con texto, sin texto (marcador) y pendientes', async () => {
        portalQuery.mockImplementation(async (sql: string) => {
            if (sql.includes('FROM documentos WHERE Status = 0')) return [{ N: 10 }];
            return [
                { IdDocumento: 1, MaxParte: 5 },
                { IdDocumento: 2, MaxParte: '0' },
                { IdDocumento: 3, MaxParte: 12 },
            ];
        });

        expect(await estadoDelCorpus()).toEqual({ documentos: 10, conTexto: 2, sinTexto: 1, pendientes: 7 });
    });

    test('con el corpus vacío regresa ceros', async () => {
        portalQuery.mockImplementation(async (sql: string) =>
            sql.includes('FROM documentos WHERE Status = 0') ? [{ N: 0 }] : []
        );

        expect(await estadoDelCorpus()).toEqual({ documentos: 0, conTexto: 0, sinTexto: 0, pendientes: 0 });
    });
});

describe('buscarEnTextos', () => {
    test('manda los patrones dos veces alrededor de los ids y el marcador, y sugiere la página', async () => {
        portalQuery.mockResolvedValueOnce([
            { IdDocumento: 3, Parte: 9, Texto: 'Aquí se habla de merma', Puntaje: '2' },
        ]);

        const resultados = await buscarEnTextos(['mermas'], [3, 4]);

        const [sql, params] = llamadas()[0];
        expect(sql).toContain('IdDocumento IN (?,?) AND Parte > ?');
        expect(params).toEqual(['%merma%', 3, 4, 0, '%merma%']);
        expect(resultados).toHaveLength(1);
        expect(resultados[0].idDocumento).toBe(3);
        expect(resultados[0].mejorParte).toBe(9);
        expect(resultados[0].paginaSugerida).toBe(2);
    });

    test('sin términos útiles o sin documentos visibles no consulta la base', async () => {
        expect(await buscarEnTextos(['a'], [1])).toEqual([]);
        expect(await buscarEnTextos(['merma'], [])).toEqual([]);
        expect(portalQuery).not.toHaveBeenCalled();
    });
});
