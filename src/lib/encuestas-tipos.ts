// Tipos, constantes y reglas PURAS de la encuesta de clientes (sin base de
// datos ni React): las comparten el servidor, la página pública que contesta el
// cliente y la pantalla de administración. La plantilla oficial de Kesos y
// Kosas vive aquí para que oficina pueda recargarla con un clic.

export const ESCALA = 5; // estrellas y opciones
export const ESCALA_10 = 10; // nps y escala10
export const NPS_PROMOTOR_DESDE = 9;
export const NPS_DETRACTOR_HASTA = 6;

export const MAX_PREGUNTAS = 20;
export const MAX_PREGUNTA_LEN = 255;
export const MAX_SECCION_LEN = 120;
export const MAX_ETIQUETA_LEN = 60;
export const MAX_TEXTO_RESPUESTA_LEN = 500;
export const MAX_COMENTARIO_LEN = 1000;
export const MAX_CORREO_LEN = 255;
export const MAX_TELEFONO_LEN = 20;
export const MAX_TEXTO_CONFIG_LEN = 300;

export const TIPOS_PREGUNTA = ['nps', 'escala10', 'estrellas', 'opciones', 'sino', 'texto'] as const;
export type TipoPregunta = typeof TIPOS_PREGUNTA[number];

export const NOMBRES_TIPO: Record<TipoPregunta, string> = {
    nps: 'NPS · recomendación 1-10',
    escala10: 'Escala 1-10',
    estrellas: 'Estrellas 1-5',
    opciones: 'Opciones',
    sino: 'Sí / No',
    texto: 'Respuesta abierta',
};

export const ETIQUETA_SI = 'Sí';
export const ETIQUETA_NO = 'No';

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATRON_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PATRON_TELEFONO = /^\+?[\d\s\-().]+$/;

export interface DefinicionPregunta {
    pregunta: string;
    tipo: TipoPregunta;
    /** estrellas: etiqueta por valor 1..5; opciones: de mejor a peor; nps/escala10: [extremo bajo, extremo alto] */
    etiquetas: string[];
    /** Encabezado que agrupa preguntas consecutivas en la encuesta (opcional) */
    seccion: string | null;
    /** Pregunta abierta que se muestra cuando la respuesta no fue la mejor posible (opcional) */
    seguimiento: string | null;
}

export interface PreguntaEncuesta extends DefinicionPregunta {
    idPregunta: number;
}

/** Textos y ajustes de la encuesta que oficina edita. */
export interface ConfigEncuesta {
    titulo: string;
    subtitulo: string;
    subtitulo2: string;
    /** Comentario abierto cuando una respuesta (normalizada a 1..5) cae en el umbral o debajo; 0 = nunca */
    umbralComentario: number;
    tituloComentario: string;
    textoComentario: string;
    regaloActivo: boolean;
    tituloRegalo: string;
    textoRegalo: string;
    textoPromos: string;
    textoBotonEnviar: string;
    tituloGracias: string;
    textoGracias: string;
}

export function normalizarTipo(crudo: unknown): TipoPregunta {
    return (TIPOS_PREGUNTA as readonly string[]).includes(String(crudo)) ? (crudo as TipoPregunta) : 'estrellas';
}

export function esUuidValido(uuid: unknown): uuid is string {
    return typeof uuid === 'string' && PATRON_UUID.test(uuid);
}

export function esCorreoValido(correo: string): boolean {
    return correo.length <= MAX_CORREO_LEN && PATRON_CORREO.test(correo);
}

export function esTelefonoValido(telefono: string): boolean {
    if (telefono.length > MAX_TELEFONO_LEN || !PATRON_TELEFONO.test(telefono)) return false;
    const digitos = telefono.replace(/\D/g, '');
    return digitos.length >= 8 && digitos.length <= 15;
}

/** Texto de una sola línea: colapsa espacios y recorta. Vacío → null. */
export function sanitizarTexto(valor: unknown, maxLen: number): string | null {
    if (typeof valor !== 'string') return null;
    const limpio = valor.trim().replace(/\s+/g, ' ');
    return limpio ? limpio.slice(0, maxLen) : null;
}

/** Texto multilínea del cliente: conserva saltos de línea. Vacío → null. */
export function sanitizarMultilinea(valor: unknown, maxLen: number): string | null {
    if (typeof valor !== 'string') return null;
    const limpio = valor.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
    return limpio ? limpio.slice(0, maxLen) : null;
}

export function sanitizarComentario(valor: unknown): string | null {
    return sanitizarMultilinea(valor, MAX_COMENTARIO_LEN);
}

/** Respuesta abierta a una pregunta (tipo texto o seguimiento). */
export function sanitizarRespuestaTexto(valor: unknown): string | null {
    return sanitizarMultilinea(valor, MAX_TEXTO_RESPUESTA_LEN);
}

/** Etiquetas guardadas como JSON en BD. JSON corrupto degrada a []. */
export function parseEtiquetas(crudo: unknown): string[] {
    if (typeof crudo !== 'string' || !crudo.trim()) return [];
    try {
        const parsed = JSON.parse(crudo);
        if (!Array.isArray(parsed)) return [];
        return parsed.slice(0, ESCALA).map(e => (typeof e === 'string' ? e.trim().slice(0, MAX_ETIQUETA_LEN) : ''));
    } catch {
        return [];
    }
}

/** Deja solo las etiquetas que el tipo usa (ver DefinicionPregunta.etiquetas). */
export function sanitizarEtiquetas(etiquetas: unknown, tipo: TipoPregunta): string[] {
    if (!Array.isArray(etiquetas)) return [];
    const limpias = etiquetas
        .slice(0, ESCALA)
        .map(e => (typeof e === 'string' ? e.trim().replace(/\s+/g, ' ').slice(0, MAX_ETIQUETA_LEN) : ''));
    switch (tipo) {
        case 'opciones':
            // Las opciones vacías no se pueden elegir: fuera
            return limpias.filter(Boolean);
        case 'nps':
        case 'escala10':
            return limpias.slice(0, 2);
        case 'sino':
        case 'texto':
            return [];
        default:
            return limpias;
    }
}

/** Una pregunta de opciones necesita al menos dos para tener sentido. */
export function esDefinicionValida(tipo: TipoPregunta, etiquetas: string[]): boolean {
    return tipo !== 'opciones' || etiquetas.length >= 2;
}

export function valorMinimo(tipo: TipoPregunta): number {
    return tipo === 'sino' || tipo === 'texto' ? 0 : 1;
}

export function valorMaximo(tipo: TipoPregunta, etiquetas: string[]): number {
    switch (tipo) {
        case 'nps':
        case 'escala10':
            return ESCALA_10;
        case 'opciones':
            return Math.min(etiquetas.length, ESCALA);
        case 'sino':
            return 1;
        case 'texto':
            return 0;
        default:
            return ESCALA;
    }
}

export function esValorValido(tipo: TipoPregunta, etiquetas: string[], valor: number): boolean {
    return Number.isInteger(valor) && valor >= valorMinimo(tipo) && valor <= valorMaximo(tipo, etiquetas);
}

/** Etiqueta del valor contestado (snapshot para el reporte). En opciones el valor es descendente. */
export function etiquetaDeValor(tipo: TipoPregunta, etiquetas: string[], valor: number): string | null {
    switch (tipo) {
        case 'opciones':
            return etiquetas[etiquetas.length - valor] ?? null;
        case 'sino':
            return valor === 1 ? ETIQUETA_SI : ETIQUETA_NO;
        case 'estrellas':
            return etiquetas[valor - 1] || null;
        default:
            return null;
    }
}

/** El seguimiento abierto se pide cuando la respuesta NO fue la mejor posible. */
export function requiereSeguimiento(tipo: TipoPregunta, etiquetas: string[], valor: number): boolean {
    if (tipo === 'texto') return false;
    return valor < valorMaximo(tipo, etiquetas);
}

/**
 * Lleva cualquier respuesta a la escala 1..5 del umbral del comentario: la
 * peor respuesta posible vale 1 y la mejor vale 5. texto → null.
 */
export function puntajeNormalizado(tipo: TipoPregunta, etiquetas: string[], valor: number): number | null {
    switch (tipo) {
        case 'texto':
            return null;
        case 'nps':
        case 'escala10':
            return Math.ceil(valor / 2);
        case 'sino':
            return valor === 1 ? ESCALA : 1;
        case 'opciones': {
            const maximo = valorMaximo(tipo, etiquetas);
            if (maximo <= 1) return ESCALA;
            return Math.round(1 + ((valor - 1) * (ESCALA - 1)) / (maximo - 1));
        }
        default:
            return valor;
    }
}

export function esRespuestaBaja(tipo: TipoPregunta, etiquetas: string[], valor: number, umbral: number): boolean {
    if (umbral <= 0) return false;
    const puntaje = puntajeNormalizado(tipo, etiquetas, valor);
    return puntaje !== null && puntaje <= umbral;
}

export type ClaseNps = 'promotor' | 'pasivo' | 'detractor';

export function claseNps(valor: number): ClaseNps {
    if (valor >= NPS_PROMOTOR_DESDE) return 'promotor';
    if (valor <= NPS_DETRACTOR_HASTA) return 'detractor';
    return 'pasivo';
}

export interface ResumenNps {
    total: number;
    promotores: number;
    pasivos: number;
    detractores: number;
    /** % promotores − % detractores (−100..100); null sin respuestas */
    nps: number | null;
}

export function calcularNps(promotores: number, pasivos: number, detractores: number): ResumenNps {
    const total = promotores + pasivos + detractores;
    const nps = total === 0 ? null : Math.round(((promotores - detractores) / total) * 100);
    return { total, promotores, pasivos, detractores, nps };
}

const SECCION_TRATO = '¿Qué tan buen trato tuvimos contigo en tu visita?';

/**
 * Plantilla oficial de la encuesta a clientes de Kesos y Kosas. La pregunta
 * NPS va SIEMPRE primero: de ella sale el NPS del reporte. El punto 2 de la
 * plantilla ("¿qué pudimos haber hecho mejor?") es el seguimiento de la NPS y
 * el "¿qué te faltó?" es el seguimiento de "¿Encontraste todo?".
 */
export const PLANTILLA_KYK: DefinicionPregunta[] = [
    {
        pregunta: 'En una escala del 1 al 10, siendo 1 totalmente improbable y 10 100% probable, ¿qué tanto estarías dispuesto a recomendar a un familiar o amigo los servicios de Kesos y Kosas?',
        tipo: 'nps',
        etiquetas: ['Nada probable', 'Muy probable'],
        seccion: null,
        seguimiento: 'Si tu respuesta no fue 10, ¿qué pudimos haber hecho mejor para que fuera 10?',
    },
    {
        pregunta: 'Menciona una sola cosa de lo que MÁS te gustó de nuestro producto o servicio.',
        tipo: 'texto',
        etiquetas: [],
        seccion: null,
        seguimiento: null,
    },
    {
        pregunta: 'Menciona una sola cosa de lo que MENOS te gustó de nuestro producto o servicio.',
        tipo: 'texto',
        etiquetas: [],
        seccion: null,
        seguimiento: null,
    },
    { pregunta: '¿Te recibimos con un saludo cordial?', tipo: 'sino', etiquetas: [], seccion: SECCION_TRATO, seguimiento: null },
    { pregunta: '¿El trato fue amable?', tipo: 'sino', etiquetas: [], seccion: SECCION_TRATO, seguimiento: null },
    {
        pregunta: '¿Hubo contacto visual al atenderte y al hablar contigo?',
        tipo: 'sino',
        etiquetas: [],
        seccion: SECCION_TRATO,
        seguimiento: null,
    },
    {
        pregunta: '¿Hubo disponibilidad amable para atenderte en cualquier momento?',
        tipo: 'sino',
        etiquetas: [],
        seccion: SECCION_TRATO,
        seguimiento: null,
    },
    {
        pregunta: '¿Cómo calificarías el tiempo de espera?',
        tipo: 'opciones',
        etiquetas: ['Rápido', 'Aceptable', 'Algo tardado', 'Muy tardado'],
        seccion: null,
        seguimiento: null,
    },
    {
        pregunta: '¿Encontraste todo lo que buscabas?',
        tipo: 'sino',
        etiquetas: [],
        seccion: null,
        seguimiento: 'Si te faltó algo, ¿qué te faltó?',
    },
    {
        pregunta: '¿Recuerdas el nombre de la persona que mejor te atendió?',
        tipo: 'texto',
        etiquetas: [],
        seccion: null,
        seguimiento: null,
    },
    {
        pregunta: '¿Cómo calificas la calidad y frescura de nuestros productos del 1 al 10?',
        tipo: 'escala10',
        etiquetas: ['Mala', 'Excelente'],
        seccion: null,
        seguimiento: null,
    },
    {
        pregunta: 'Del 1 al 10, ¿qué tan ordenada y limpia te pareció nuestra sucursal?',
        tipo: 'escala10',
        etiquetas: ['Nada', 'Impecable'],
        seccion: null,
        seguimiento: null,
    },
];
