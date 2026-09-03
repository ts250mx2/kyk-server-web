import { describe, expect, test } from 'vitest';
import {
    MAX_DOCUMENTOS_RESULTADO,
    MAX_FRAGMENTOS_POR_DOCUMENTO,
    MAX_TERMINOS,
    agruparPorDocumento,
    expresionDePuntaje,
    fragmentoAlrededor,
    limpiarPalabra,
    normalizar,
    paginaDeParte,
    patronesDeBusqueda,
    raiz,
    terminosDePregunta,
    type ParteEncontrada,
} from './busqueda-texto';

describe('limpiarPalabra', () => {
    test('quita signos al inicio y al final y conserva los de adentro', () => {
        expect(limpiarPalabra('¿inventario?')).toBe('inventario');
        expect(limpiarPalabra('"3.5%",')).toBe('3.5');
        expect(limpiarPalabra('señor')).toBe('señor');
        expect(limpiarPalabra('×año÷')).toBe('año');
    });
});

describe('terminosDePregunta', () => {
    test('saca las palabras significativas de la pregunta, más largas primero y en minúsculas', () => {
        expect(terminosDePregunta('¿Cómo se hace un Ajuste de inventario?')).toEqual(['inventario', 'ajuste']);
    });

    test('no repite palabras y respeta el máximo de términos', () => {
        const pregunta = 'merma Merma mermas devolución caja báscula bodega cliente proveedor factura';
        const terminos = terminosDePregunta(pregunta);
        expect(terminos).toHaveLength(MAX_TERMINOS);
        expect(new Set(terminos.map(normalizar)).size).toBe(MAX_TERMINOS);
        expect(terminos).not.toContain('Merma');
    });

    test('una pregunta sin palabras significativas no da términos', () => {
        expect(terminosDePregunta('¿y eso?')).toEqual([]);
    });
});

describe('paginaDeParte', () => {
    test('calcula la página 1-indexada según el tamaño de página', () => {
        expect(paginaDeParte(1, 8)).toBe(1);
        expect(paginaDeParte(8, 8)).toBe(1);
        expect(paginaDeParte(9, 8)).toBe(2);
        expect(paginaDeParte(0, 8)).toBe(1);
    });
});

describe('normalizar', () => {
    test('quita acentos y pasa a minúsculas', () => {
        expect(normalizar('Devolución de MERMA')).toBe('devolucion de merma');
    });

    test('conserva la longitud del texto con letras acentuadas y eñes', () => {
        const texto = 'Señor Núñez, cañón';
        expect(normalizar(texto).length).toBe(texto.length);
    });
});

describe('raiz', () => {
    test('quita el plural en -es', () => {
        expect(raiz('devoluciones')).toBe('devolucion');
        expect(raiz('manuales')).toBe('manual');
    });

    test('quita el plural en -s', () => {
        expect(raiz('mermas')).toBe('merma');
        expect(raiz('Cajas')).toBe('caja');
    });

    test('no recorta palabras cortas', () => {
        expect(raiz('mes')).toBe('mes');
        expect(raiz('caja')).toBe('caja');
    });
});

describe('patronesDeBusqueda', () => {
    test('un término de una palabra da un patrón con su raíz y peso 2', () => {
        const patrones = patronesDeBusqueda(['devoluciones']);
        expect(patrones).toEqual([
            { texto: 'devolucion', clave: 'devolucion', peso: 2, termino: 'devoluciones' },
        ]);
    });

    test('una frase da la frase con peso 3 y cada palabra significativa con peso 1', () => {
        const patrones = patronesDeBusqueda(['ajuste de inventario']);
        expect(patrones.map(p => [p.texto, p.peso])).toEqual([
            ['ajuste de inventario', 3],
            ['ajuste', 1],
            ['inventario', 1],
        ]);
        expect(patrones.every(p => p.termino === 'ajuste de inventario')).toBe(true);
    });

    test('limpia los signos de la frase y de cada palabra', () => {
        const patrones = patronesDeBusqueda(['¿Cómo se hace un ajuste de inventario?']);
        expect(patrones.map(p => [p.texto, p.peso])).toEqual([
            ['Cómo se hace un ajuste de inventario', 3],
            ['ajuste', 1],
            ['inventario', 1],
        ]);
    });

    test('deduplica por clave normalizada conservando el peso mayor', () => {
        const patrones = patronesDeBusqueda(['Merma', 'merma de carnes']);
        const merma = patrones.filter(p => p.clave === 'merma');
        expect(merma).toHaveLength(1);
        expect(merma[0].peso).toBe(2);
    });

    test('ignora términos vacíos o de una letra y respeta el máximo de términos', () => {
        const terminos = ['', ' ', 'a', ...Array.from({ length: 10 }, (_, i) => `termino${i}`)];
        const patrones = patronesDeBusqueda(terminos);
        expect(patrones).toHaveLength(MAX_TERMINOS - 3);
    });

    test('un término de dos caracteres sí se acepta', () => {
        expect(patronesDeBusqueda(['IV'])).toEqual([
            { texto: 'IV', clave: 'iv', peso: 2, termino: 'IV' },
        ]);
    });

    test('un término hecho solo de palabras vacías se busca tal cual', () => {
        expect(patronesDeBusqueda(['de la'])).toEqual([
            { texto: 'de la', clave: 'de la', peso: 2, termino: 'de la' },
        ]);
    });
});

describe('expresionDePuntaje', () => {
    test('arma la suma de LIKE con peso y los parámetros en el mismo orden', () => {
        const { sql, params } = expresionDePuntaje(patronesDeBusqueda(['ajuste de inventario']));
        expect(sql).toBe('(Texto LIKE ?) * 3 + (Texto LIKE ?) * 1 + (Texto LIKE ?) * 1');
        expect(params).toEqual(['%ajuste de inventario%', '%ajuste%', '%inventario%']);
    });

    test('sin patrones regresa 0 sin parámetros', () => {
        expect(expresionDePuntaje([])).toEqual({ sql: '0', params: [] });
    });
});

describe('fragmentoAlrededor', () => {
    test('recorta alrededor de la coincidencia ignorando acentos y mayúsculas', () => {
        const texto = `${'x'.repeat(500)} La DEVOLUCIÓN se autoriza en caja ${'y'.repeat(500)}`;
        const fragmento = fragmentoAlrededor(texto, 'devolucion');
        expect(fragmento).toContain('DEVOLUCIÓN se autoriza en caja');
        expect(fragmento.startsWith('...')).toBe(true);
        expect(fragmento.endsWith('...')).toBe(true);
        expect(fragmento.length).toBeLessThan(400);
    });

    test('si no ubica la clave regresa el inicio del texto', () => {
        expect(fragmentoAlrededor('Texto  con   espacios', 'nada')).toBe('...Texto con espacios...');
    });
});

describe('agruparPorDocumento', () => {
    const patrones = patronesDeBusqueda(['devolución', 'merma']);
    const parte = (idDocumento: number, parte: number, texto: string, puntaje: number): ParteEncontrada =>
        ({ idDocumento, parte, texto, puntaje });

    test('suma el puntaje por documento, lista los términos hallados y ordena de mayor a menor', () => {
        const docs = agruparPorDocumento([
            parte(1, 1, 'Proceso de devolución en caja', 2),
            parte(2, 1, 'Control de merma y devolución', 4),
            parte(1, 2, 'Otra devolución más', 2),
        ], patrones);
        expect(docs.map(d => [d.idDocumento, d.puntaje])).toEqual([[1, 4], [2, 4]]);
        expect(docs[1].terminos).toEqual(['devolución', 'merma']);
        expect(docs[0].terminos).toEqual(['devolución']);
    });

    test('la mejor parte es la de mayor puntaje del documento', () => {
        const [doc] = agruparPorDocumento([
            parte(3, 1, 'merma', 1),
            parte(3, 5, 'merma y devolución', 4),
            parte(3, 6, 'merma', 1),
        ], patrones);
        expect(doc.mejorParte).toBe(5);
        expect(doc).not.toHaveProperty('mejorPuntaje');
    });

    test('junta como máximo 3 fragmentos por documento', () => {
        const partes = Array.from({ length: 6 }, (_, i) => parte(7, i + 1, `Parte ${i} habla de merma`, 1));
        const [doc] = agruparPorDocumento(partes, patrones);
        expect(doc.fragmentos).toHaveLength(MAX_FRAGMENTOS_POR_DOCUMENTO);
        expect(doc.puntaje).toBe(6);
    });

    test('regresa como máximo 8 documentos', () => {
        const partes = Array.from({ length: 12 }, (_, i) => parte(i + 1, 1, 'merma', 1));
        expect(agruparPorDocumento(partes, patrones)).toHaveLength(MAX_DOCUMENTOS_RESULTADO);
    });

    test('sin partes regresa vacío', () => {
        expect(agruparPorDocumento([], patrones)).toEqual([]);
    });
});
