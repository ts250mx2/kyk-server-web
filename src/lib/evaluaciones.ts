import Anthropic from '@anthropic-ai/sdk';
import { obtenerPagina } from './documentos-texto';

// Generación de cuestionarios de evaluación por documento (opción múltiple):
// Sonnet lee el texto extraído del documento (documentos_texto) y produce
// preguntas con 4 opciones, una correcta y su explicación. Las respuestas
// correctas viven SOLO en el servidor (tabla evaluaciones); al cliente se le
// mandan únicamente preguntas y opciones, y la calificación se hace aquí.

const MODELO = 'claude-sonnet-5';
const MAX_PAGINAS_FUENTE = 3; // ~36k caracteres del documento
const MAX_TEXTO = 36_000;

export interface PreguntaEvaluacion {
    pregunta: string;
    opciones: string[];   // exactamente 4
    correcta: number;     // índice 0-3 — nunca sale al cliente antes de calificar
    explicacion: string;
}

export interface EvaluacionGenerada {
    titulo: string;
    preguntas: PreguntaEvaluacion[];
}

export async function generarEvaluacion(
    idDocumento: number,
    nombreDocumento: string
): Promise<EvaluacionGenerada | null> {
    if (!process.env.ANTHROPIC_API_KEY) return null;

    let texto = '';
    for (let p = 1; p <= MAX_PAGINAS_FUENTE; p++) {
        const pagina = await obtenerPagina(idDocumento, p);
        if (!pagina) break;
        texto += pagina.texto;
        if (pagina.pagina >= pagina.totalPaginas) break;
    }
    if (!texto.trim()) return null;

    const prompt = `Eres un capacitador de una cadena de tiendas de abarrotes. A partir del siguiente documento llamado "${nombreDocumento}", crea un cuestionario de evaluación de 5 preguntas de opción múltiple para verificar que el personal lo leyó y lo entendió.

REGLAS:
- TODO en español.
- Cada pregunta con EXACTAMENTE 4 opciones y UNA sola correcta.
- Pregunta sobre el contenido real del documento (procedimientos, responsabilidades, criterios, cifras); nada del formato del archivo.
- Opciones incorrectas plausibles, no obvias.
- "explicacion": breve, por qué la correcta es la correcta según el documento.
- Varía la posición de la respuesta correcta entre preguntas.

RESPONDE SOLO JSON ESTRICTO (sin markdown) con esta forma exacta:
{"titulo":"...","preguntas":[{"pregunta":"...","opciones":["...","...","...","..."],"correcta":0,"explicacion":"..."}]}

DOCUMENTO:
${texto.slice(0, MAX_TEXTO)}`;

    const anthropic = new Anthropic();
    const resultado = await anthropic.messages.create({
        model: MODELO,
        max_tokens: 3000,
        messages: [{ role: 'user', content: prompt }],
    });
    const salida = resultado.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map(b => b.text)
        .join('\n');

    const inicio = salida.indexOf('{');
    const fin = salida.lastIndexOf('}');
    if (inicio < 0 || fin <= inicio) return null;

    let json: { titulo?: unknown; preguntas?: unknown };
    try {
        json = JSON.parse(salida.slice(inicio, fin + 1));
    } catch {
        return null;
    }

    // Validación estricta: se descarta cualquier pregunta malformada
    const crudas = Array.isArray(json.preguntas) ? json.preguntas : [];
    const preguntas: PreguntaEvaluacion[] = [];
    for (const p of crudas as Record<string, unknown>[]) {
        const textoPregunta = typeof p?.pregunta === 'string' ? p.pregunta.trim() : '';
        const opciones = Array.isArray(p?.opciones)
            ? (p.opciones as unknown[]).map(o => String(o ?? '').trim()).filter(Boolean)
            : [];
        const correcta = Number(p?.correcta);
        if (!textoPregunta || opciones.length !== 4) continue;
        if (!Number.isInteger(correcta) || correcta < 0 || correcta > 3) continue;
        preguntas.push({
            pregunta: textoPregunta.slice(0, 500),
            opciones: opciones.map(o => o.slice(0, 300)),
            correcta,
            explicacion: String(p?.explicacion ?? '').trim().slice(0, 600),
        });
    }
    if (preguntas.length < 3) return null;

    return {
        titulo: String(json.titulo || `Evaluación: ${nombreDocumento}`).slice(0, 200),
        preguntas: preguntas.slice(0, 10),
    };
}
