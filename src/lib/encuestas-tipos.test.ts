import { describe, expect, test } from 'vitest';
import {
    ESCALA,
    ESCALA_10,
    ETIQUETA_NO,
    ETIQUETA_SI,
    MAX_PREGUNTAS,
    MAX_PREGUNTA_LEN,
    MAX_TEXTO_RESPUESTA_LEN,
    PLANTILLA_KYK,
    TIPOS_PREGUNTA,
    calcularNps,
    claseNps,
    esDefinicionValida,
    esRespuestaBaja,
    esValorValido,
    etiquetaDeValor,
    normalizarTipo,
    parseEtiquetas,
    puntajeNormalizado,
    requiereSeguimiento,
    sanitizarEtiquetas,
    sanitizarRespuestaTexto,
    sanitizarTexto,
    valorMaximo,
    valorMinimo,
} from './encuestas-tipos';

describe('normalizarTipo', () => {
    test('acepta los tipos conocidos y degrada lo demás a estrellas', () => {
        for (const tipo of TIPOS_PREGUNTA) expect(normalizarTipo(tipo)).toBe(tipo);
        expect(normalizarTipo('otro')).toBe('estrellas');
        expect(normalizarTipo(undefined)).toBe('estrellas');
    });
});

describe('rango de valores por tipo', () => {
    test('nps y escala10 van de 1 a 10', () => {
        expect([valorMinimo('nps'), valorMaximo('nps', [])]).toEqual([1, ESCALA_10]);
        expect([valorMinimo('escala10'), valorMaximo('escala10', [])]).toEqual([1, ESCALA_10]);
    });

    test('estrellas 1..5, sino 0..1, texto sin valor', () => {
        expect([valorMinimo('estrellas'), valorMaximo('estrellas', [])]).toEqual([1, ESCALA]);
        expect([valorMinimo('sino'), valorMaximo('sino', [])]).toEqual([0, 1]);
        expect([valorMinimo('texto'), valorMaximo('texto', [])]).toEqual([0, 0]);
    });

    test('opciones llega hasta el número de opciones', () => {
        expect(valorMaximo('opciones', ['Rápido', 'Aceptable', 'Lento'])).toBe(3);
    });

    test('esValorValido rechaza decimales y fuera de rango', () => {
        expect(esValorValido('nps', [], 10)).toBe(true);
        expect(esValorValido('nps', [], 11)).toBe(false);
        expect(esValorValido('nps', [], 0)).toBe(false);
        expect(esValorValido('sino', [], 0)).toBe(true);
        expect(esValorValido('estrellas', [], 2.5)).toBe(false);
        expect(esValorValido('opciones', ['a', 'b'], 3)).toBe(false);
    });
});

describe('etiquetas', () => {
    test('parseEtiquetas tolera JSON corrupto y recorta', () => {
        expect(parseEtiquetas('["a","b"]')).toEqual(['a', 'b']);
        expect(parseEtiquetas('{')).toEqual([]);
        expect(parseEtiquetas(null)).toEqual([]);
        expect(parseEtiquetas('["1","2","3","4","5","6"]')).toHaveLength(ESCALA);
    });

    test('sanitizarEtiquetas deja solo lo que usa cada tipo', () => {
        expect(sanitizarEtiquetas(['Rápido', '', ' Lento '], 'opciones')).toEqual(['Rápido', 'Lento']);
        expect(sanitizarEtiquetas(['Nada', 'Mucho', 'extra'], 'nps')).toEqual(['Nada', 'Mucho']);
        expect(sanitizarEtiquetas(['x'], 'sino')).toEqual([]);
        expect(sanitizarEtiquetas(['x'], 'texto')).toEqual([]);
        expect(sanitizarEtiquetas(['Mala', '', 'Regular'], 'estrellas')).toEqual(['Mala', '', 'Regular']);
    });

    test('etiquetaDeValor: opciones descendente, sino fijo, escalas sin etiqueta', () => {
        const opciones = ['Rápido', 'Aceptable', 'Lento'];
        expect(etiquetaDeValor('opciones', opciones, 3)).toBe('Rápido');
        expect(etiquetaDeValor('opciones', opciones, 1)).toBe('Lento');
        expect(etiquetaDeValor('sino', [], 1)).toBe(ETIQUETA_SI);
        expect(etiquetaDeValor('sino', [], 0)).toBe(ETIQUETA_NO);
        expect(etiquetaDeValor('estrellas', ['Mala'], 1)).toBe('Mala');
        expect(etiquetaDeValor('estrellas', [], 1)).toBeNull();
        expect(etiquetaDeValor('nps', ['Nada', 'Mucho'], 10)).toBeNull();
    });

    test('una pregunta de opciones necesita al menos dos', () => {
        expect(esDefinicionValida('opciones', ['una'])).toBe(false);
        expect(esDefinicionValida('opciones', ['una', 'dos'])).toBe(true);
        expect(esDefinicionValida('sino', [])).toBe(true);
    });
});

describe('requiereSeguimiento', () => {
    test('se pide cuando la respuesta no fue la mejor posible', () => {
        expect(requiereSeguimiento('nps', [], 10)).toBe(false);
        expect(requiereSeguimiento('nps', [], 9)).toBe(true);
        expect(requiereSeguimiento('sino', [], 0)).toBe(true);
        expect(requiereSeguimiento('sino', [], 1)).toBe(false);
        expect(requiereSeguimiento('opciones', ['a', 'b', 'c'], 3)).toBe(false);
        expect(requiereSeguimiento('opciones', ['a', 'b', 'c'], 2)).toBe(true);
        expect(requiereSeguimiento('texto', [], 0)).toBe(false);
    });
});

describe('umbral del comentario', () => {
    test('puntajeNormalizado lleva todo a 1..5', () => {
        expect(puntajeNormalizado('nps', [], 10)).toBe(5);
        expect(puntajeNormalizado('nps', [], 6)).toBe(3);
        expect(puntajeNormalizado('escala10', [], 1)).toBe(1);
        expect(puntajeNormalizado('sino', [], 1)).toBe(5);
        expect(puntajeNormalizado('sino', [], 0)).toBe(1);
        expect(puntajeNormalizado('estrellas', [], 4)).toBe(4);
        expect(puntajeNormalizado('texto', [], 0)).toBeNull();
    });

    test('opciones: la mejor vale 5 y la peor 1 aunque haya menos de cinco', () => {
        const cuatro = ['Rápido', 'Aceptable', 'Algo tardado', 'Muy tardado'];
        expect(puntajeNormalizado('opciones', cuatro, 4)).toBe(5);
        expect(puntajeNormalizado('opciones', cuatro, 3)).toBe(4);
        expect(puntajeNormalizado('opciones', cuatro, 2)).toBe(2);
        expect(puntajeNormalizado('opciones', cuatro, 1)).toBe(1);
        expect(puntajeNormalizado('opciones', ['Sí', 'No'], 2)).toBe(5);
        expect(puntajeNormalizado('opciones', ['Sí', 'No'], 1)).toBe(1);
    });

    test('esRespuestaBaja respeta umbral 0 = nunca', () => {
        expect(esRespuestaBaja('nps', [], 1, 0)).toBe(false);
        expect(esRespuestaBaja('nps', [], 6, 3)).toBe(true);
        expect(esRespuestaBaja('nps', [], 7, 3)).toBe(false);
        expect(esRespuestaBaja('texto', [], 0, 5)).toBe(false);
        // "Aceptable" (segunda de cuatro) no es una respuesta mala con umbral 3
        expect(esRespuestaBaja('opciones', ['Rápido', 'Aceptable', 'Algo tardado', 'Muy tardado'], 3, 3)).toBe(false);
    });
});

describe('NPS', () => {
    test('clasifica promotores 9-10, pasivos 7-8 y detractores 1-6', () => {
        expect(claseNps(10)).toBe('promotor');
        expect(claseNps(9)).toBe('promotor');
        expect(claseNps(8)).toBe('pasivo');
        expect(claseNps(7)).toBe('pasivo');
        expect(claseNps(6)).toBe('detractor');
        expect(claseNps(1)).toBe('detractor');
    });

    test('calcularNps = %promotores − %detractores redondeado', () => {
        expect(calcularNps(7, 2, 1)).toEqual({ total: 10, promotores: 7, pasivos: 2, detractores: 1, nps: 60 });
        expect(calcularNps(1, 1, 1).nps).toBe(0);
        expect(calcularNps(0, 0, 3).nps).toBe(-100);
        expect(calcularNps(0, 0, 0).nps).toBeNull();
    });
});

describe('sanitizado de textos', () => {
    test('sanitizarTexto colapsa espacios y vacío da null', () => {
        expect(sanitizarTexto('  hola \n mundo ', 50)).toBe('hola mundo');
        expect(sanitizarTexto('   ', 50)).toBeNull();
        expect(sanitizarTexto(5, 50)).toBeNull();
    });

    test('sanitizarRespuestaTexto conserva saltos de línea y recorta al máximo', () => {
        expect(sanitizarRespuestaTexto('uno\r\ndos')).toBe('uno\ndos');
        expect(sanitizarRespuestaTexto('x'.repeat(MAX_TEXTO_RESPUESTA_LEN + 10))).toHaveLength(MAX_TEXTO_RESPUESTA_LEN);
        expect(sanitizarRespuestaTexto('')).toBeNull();
    });
});

describe('PLANTILLA_KYK', () => {
    test('empieza con la pregunta NPS con su seguimiento y cabe en el módulo', () => {
        expect(PLANTILLA_KYK[0].tipo).toBe('nps');
        expect(PLANTILLA_KYK[0].seguimiento).toBeTruthy();
        expect(PLANTILLA_KYK.filter(p => p.tipo === 'nps')).toHaveLength(1);
        expect(PLANTILLA_KYK.length).toBeLessThanOrEqual(MAX_PREGUNTAS);
    });

    test('todas las preguntas son válidas y caben en la base', () => {
        for (const p of PLANTILLA_KYK) {
            expect(p.pregunta.length).toBeLessThanOrEqual(MAX_PREGUNTA_LEN);
            expect(esDefinicionValida(p.tipo, p.etiquetas)).toBe(true);
            expect(sanitizarEtiquetas(p.etiquetas, p.tipo)).toEqual(p.etiquetas);
        }
    });

    test('cubre los diez puntos de la plantilla', () => {
        const tipos = PLANTILLA_KYK.map(p => p.tipo);
        expect(tipos.filter(t => t === 'texto')).toHaveLength(3);
        expect(tipos.filter(t => t === 'sino')).toHaveLength(5);
        expect(tipos.filter(t => t === 'opciones')).toHaveLength(1);
        expect(tipos.filter(t => t === 'escala10')).toHaveLength(2);
        expect(PLANTILLA_KYK.find(p => p.pregunta.startsWith('¿Encontraste todo'))?.seguimiento).toBeTruthy();
    });
});
