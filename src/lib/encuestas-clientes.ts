import { portalQuery } from '@/lib/portal-db';

// Encuestas de satisfacción de CLIENTES (modelo del módulo de Foodie Solutions
// adaptado a KYK): el cliente la contesta desde su celular escaneando el QR de
// la sucursal, sin login. Cada sucursal tiene su propio UUID (la URL pública
// /encuesta/[uuid] identifica a la tienda; el cliente nunca manda IdTienda), y
// TODO vive en la base central BDKYKPortal (la de documentos). Las respuestas
// guardan un snapshot de la pregunta para que el reporte sobreviva ediciones.

export const ESCALA = 5;
export const MAX_PREGUNTAS = 20;
export const MAX_PREGUNTA_LEN = 255;
export const MAX_ETIQUETA_LEN = 60;
export const MAX_COMENTARIO_LEN = 1000;
export const MAX_CORREO_LEN = 255;
export const MAX_TELEFONO_LEN = 20;
export const MAX_TEXTO_CONFIG_LEN = 300;

export const TIPOS_PREGUNTA = ['estrellas', 'opciones'] as const;
export type TipoPregunta = typeof TIPOS_PREGUNTA[number];

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATRON_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PATRON_TELEFONO = /^\+?[\d\s\-().]+$/;

type Row = Record<string, unknown>;

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

export function sanitizarTexto(valor: unknown, maxLen: number): string | null {
    if (typeof valor !== 'string') return null;
    const limpio = valor.trim().replace(/\s+/g, ' ');
    return limpio ? limpio.slice(0, maxLen) : null;
}

/** Los comentarios conservan saltos de línea (texto multilínea del cliente). */
export function sanitizarComentario(valor: unknown): string | null {
    if (typeof valor !== 'string') return null;
    const limpio = valor.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
    return limpio ? limpio.slice(0, MAX_COMENTARIO_LEN) : null;
}

/**
 * Etiquetas de una pregunta (JSON en BD): estrellas = etiqueta por valor 1..5;
 * opciones = de mejor a peor (la primera vale 5). JSON corrupto degrada a [].
 */
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

export function sanitizarEtiquetas(etiquetas: unknown, tipo: TipoPregunta): string[] {
    if (!Array.isArray(etiquetas)) return [];
    const limpias = etiquetas
        .slice(0, ESCALA)
        .map(e => (typeof e === 'string' ? e.trim().replace(/\s+/g, ' ').slice(0, MAX_ETIQUETA_LEN) : ''));
    // Las opciones vacías no se pueden elegir: fuera
    return tipo === 'opciones' ? limpias.filter(Boolean) : limpias;
}

export function valorMaximo(tipo: TipoPregunta, etiquetas: string[]): number {
    return tipo === 'opciones' ? Math.min(etiquetas.length, ESCALA) : ESCALA;
}

/** Etiqueta del valor contestado (snapshot). En opciones el valor es descendente. */
export function etiquetaDeValor(tipo: TipoPregunta, etiquetas: string[], valor: number): string | null {
    if (tipo === 'opciones') return etiquetas[etiquetas.length - valor] ?? null;
    return etiquetas[valor - 1] || null;
}

/** Textos con los que arranca la encuesta la primera vez. */
export const CONFIG_DEFAULT = {
    Titulo: '¿Cómo fue tu experiencia de compra?',
    Subtitulo: 'Tu opinión nos ayuda a mejorar tu tienda.',
    Subtitulo2: 'Solo te tomará 30 segundos.',
    UmbralComentario: 3,
    TituloComentario: '¿Algo no salió como esperabas?',
    TextoComentario: 'Cuéntanos qué sucedió. Queremos escucharte y mejorar.',
    RegaloActivo: 1,
    TituloRegalo: 'Queremos consentirte',
    TextoRegalo: 'Déjanos tu teléfono o tu correo para enviarte promociones y sorpresas especiales de tu tienda.',
    TextoPromos: 'Quiero recibir promociones especiales.',
    TextoBotonEnviar: 'Enviar mi opinión',
    TituloGracias: '¡Gracias por ayudarnos a mejorar!',
    TextoGracias: 'Tu opinión llega directo al equipo de la tienda. ¡Te esperamos pronto!',
} as const;

/** Preguntas con las que arranca el módulo (sabor retail/abarrotes KYK). */
export const PREGUNTAS_DEFAULT: { pregunta: string; tipo: TipoPregunta; etiquetas: string[] }[] = [
    {
        pregunta: '¿Cómo calificas tu experiencia general en la tienda?',
        tipo: 'estrellas',
        etiquetas: ['Muy mala', 'Mala', 'Regular', 'Muy buena', 'Excelente'],
    },
    { pregunta: '¿Cómo calificas la atención de nuestro personal?', tipo: 'estrellas', etiquetas: [] },
    { pregunta: '¿Cómo calificas la calidad y frescura de nuestros productos?', tipo: 'estrellas', etiquetas: [] },
    { pregunta: '¿Cómo calificas la limpieza y el orden de la tienda?', tipo: 'estrellas', etiquetas: [] },
    {
        pregunta: '¿Encontraste todo lo que buscabas?',
        tipo: 'opciones',
        etiquetas: ['Sí, todo', 'Casi todo', 'Me faltaron varias cosas', 'Casi nada'],
    },
    {
        pregunta: '¿Nos recomendarías con tus amigos o familiares?',
        tipo: 'opciones',
        etiquetas: ['Definitivamente sí', 'Probablemente sí', 'Tal vez', 'Probablemente no', 'Definitivamente no'],
    },
];

/**
 * Siembra inicial. El renglón de config vive SIEMPRE con IdConfig = 1: el
 * INSERT IGNORE sobre esa PK fija hace de candado — dos requests simultáneos
 * no duplican nada y las preguntas que oficina borre no reaparecen.
 */
export async function asegurarSemilla(): Promise<void> {
    const c = CONFIG_DEFAULT;
    const resultado = (await portalQuery(
        `INSERT IGNORE INTO encuestas_clientes_config
            (IdConfig, Titulo, Subtitulo, Subtitulo2, UmbralComentario, TituloComentario, TextoComentario,
             RegaloActivo, TituloRegalo, TextoRegalo, TextoPromos, TextoBotonEnviar, TituloGracias, TextoGracias, FechaAct)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [c.Titulo, c.Subtitulo, c.Subtitulo2, c.UmbralComentario, c.TituloComentario, c.TextoComentario,
         c.RegaloActivo, c.TituloRegalo, c.TextoRegalo, c.TextoPromos, c.TextoBotonEnviar, c.TituloGracias, c.TextoGracias]
    )) as unknown as { affectedRows?: number };

    if ((resultado?.affectedRows ?? 0) > 0) {
        for (const [orden, p] of PREGUNTAS_DEFAULT.entries()) {
            await portalQuery(
                `INSERT INTO encuestas_clientes_preguntas (Pregunta, TipoPregunta, Etiquetas, Orden, Activa, FechaAct)
                 VALUES (?, ?, ?, ?, 1, NOW())`,
                [p.pregunta, p.tipo, JSON.stringify(p.etiquetas), orden]
            );
        }
    }
}

export interface ConfigEncuesta {
    titulo: string;
    subtitulo: string;
    subtitulo2: string;
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

export async function obtenerConfig(): Promise<ConfigEncuesta> {
    await asegurarSemilla();
    const filas = (await portalQuery('SELECT * FROM encuestas_clientes_config WHERE IdConfig = 1')) as Row[];
    const f = filas[0] ?? {};
    const s = (v: unknown, def: string) => (typeof v === 'string' && v ? v : def);
    return {
        titulo: s(f.Titulo, CONFIG_DEFAULT.Titulo),
        subtitulo: s(f.Subtitulo, ''),
        subtitulo2: s(f.Subtitulo2, ''),
        umbralComentario: Math.min(ESCALA, Math.max(0, Number(f.UmbralComentario ?? CONFIG_DEFAULT.UmbralComentario))),
        tituloComentario: s(f.TituloComentario, CONFIG_DEFAULT.TituloComentario),
        textoComentario: s(f.TextoComentario, ''),
        regaloActivo: Number(f.RegaloActivo ?? 1) === 1,
        tituloRegalo: s(f.TituloRegalo, CONFIG_DEFAULT.TituloRegalo),
        textoRegalo: s(f.TextoRegalo, ''),
        textoPromos: s(f.TextoPromos, CONFIG_DEFAULT.TextoPromos),
        textoBotonEnviar: s(f.TextoBotonEnviar, CONFIG_DEFAULT.TextoBotonEnviar),
        tituloGracias: s(f.TituloGracias, CONFIG_DEFAULT.TituloGracias),
        textoGracias: s(f.TextoGracias, ''),
    };
}

export interface PreguntaEncuesta {
    idPregunta: number;
    pregunta: string;
    tipo: TipoPregunta;
    etiquetas: string[];
}

export async function obtenerPreguntasActivas(): Promise<PreguntaEncuesta[]> {
    const filas = (await portalQuery(
        'SELECT IdPregunta, Pregunta, TipoPregunta, Etiquetas FROM encuestas_clientes_preguntas WHERE Activa = 1 ORDER BY Orden, IdPregunta'
    )) as Row[];
    return filas.slice(0, MAX_PREGUNTAS).map(f => {
        const tipo: TipoPregunta = f.TipoPregunta === 'opciones' ? 'opciones' : 'estrellas';
        return {
            idPregunta: Number(f.IdPregunta),
            pregunta: String(f.Pregunta),
            tipo,
            etiquetas: parseEtiquetas(f.Etiquetas),
        };
    });
}

/**
 * Traduce el UUID de la URL pública a la sucursal. Es la ÚNICA identificación
 * que viaja en la liga; un QR desactivado resuelve a null (indistinguible de
 * una liga inexistente).
 */
export async function resolverUuidTienda(uuid: string): Promise<{ idTienda: number; tienda: string } | null> {
    if (!esUuidValido(uuid)) return null;
    const filas = (await portalQuery(
        'SELECT IdTienda, Tienda FROM encuestas_clientes_qr WHERE Uuid = ? AND Activa = 1 LIMIT 1',
        [uuid]
    )) as Row[];
    if (filas.length === 0) return null;
    return { idTienda: Number(filas[0].IdTienda), tienda: String(filas[0].Tienda) };
}
