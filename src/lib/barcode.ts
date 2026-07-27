// Código de barras Code 128 dibujado directo en jsPDF (sin librerías externas).
// Se usa para el folio del recibo en la impresión, como el CodigoBarrasRecibo.png
// del webservice Java original.
import type jsPDF from 'jspdf';

// Tabla estándar Code 128: anchos de barras/espacios por símbolo (valores 0-105)
// y patrón de paro en el índice 106.
const PATTERNS = [
    '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
    '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
    '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
    '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
    '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
    '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
    '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
    '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
    '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
    '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
    '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const START_B = 104;
const START_C = 105;
const STOP = 106;

/** Codifica un texto en símbolos Code 128 (subset C para dígitos pares, B en otro caso). */
function codificar(texto: string): number[] | null {
    if (!texto) return null;

    let simbolos: number[];
    if (/^\d+$/.test(texto) && texto.length % 2 === 0) {
        // Subset C: cada par de dígitos es un símbolo (más compacto)
        simbolos = [START_C];
        for (let i = 0; i < texto.length; i += 2) {
            simbolos.push(Number(texto.slice(i, i + 2)));
        }
    } else {
        // Subset B: un símbolo por carácter ASCII 32-127
        simbolos = [START_B];
        for (const ch of texto) {
            const valor = ch.charCodeAt(0) - 32;
            if (valor < 0 || valor > 95) return null;
            simbolos.push(valor);
        }
    }

    // Dígito verificador: (start + Σ valor × posición) mod 103
    let suma = simbolos[0];
    for (let i = 1; i < simbolos.length; i++) {
        suma += simbolos[i] * i;
    }
    simbolos.push(suma % 103);
    simbolos.push(STOP);
    return simbolos;
}

/** Dibuja el código de barras centrado en el rectángulo indicado (puntos). */
export function dibujarCodigoBarras(
    doc: jsPDF,
    texto: string,
    x: number,
    y: number,
    ancho: number,
    alto: number
) {
    const simbolos = codificar(texto);
    if (!simbolos) return;

    const anchos: number[] = [];
    for (const s of simbolos) {
        for (const d of PATTERNS[s]) {
            anchos.push(Number(d));
        }
    }

    const totalModulos = anchos.reduce((a, b) => a + b, 0);
    const modulo = ancho / totalModulos;

    doc.setFillColor(0, 0, 0);
    let cursor = x;
    for (let i = 0; i < anchos.length; i++) {
        const w = anchos[i] * modulo;
        if (i % 2 === 0) {
            // Índices pares son barras; impares, espacios
            doc.rect(cursor, y, w, alto, 'F');
        }
        cursor += w;
    }
}
