import Anthropic from '@anthropic-ai/sdk';
import { portalQuery } from './portal-db';
import { leerArchivo } from './documentos-fs';
import { extraerTexto } from './extraer-texto';
import {
    agruparPorDocumento,
    expresionDePuntaje,
    paginaDeParte,
    patronesDeBusqueda,
    type DocumentoEncontrado,
} from './busqueda-texto';

// Texto extraído de los documentos, persistido en BDKYKPortal.documentos_texto
// en partes de ~3,000 caracteres: se extrae UNA sola vez (al subir, o de forma
// perezosa para los documentos previos), sobrevive reinicios y habilita la
// búsqueda por contenido y la lectura paginada de A.D.iA.N. El resumen por
// documento se genera con Haiku y se guarda en documentos.Resumen.

const TAMANO_PARTE = 3_000;
const MODELO_RESUMEN = 'claude-haiku-4-5-20251001';
// Parte 0 = marcador "sin texto extraíble" (imagen, ZIP, .doc viejo, PDF
// escaneado): deja constancia de que ya se intentó, para que la búsqueda no
// vuelva a leer y procesar ese archivo en cada consulta. Si algún día mejora
// la extracción (p. ej. OCR), basta borrar las filas con Parte = 0.
const PARTE_SIN_TEXTO = 0;
// Partes por INSERT al persistir: un documento largo son cientos de partes y
// cada fila suelta era un viaje a la base central
const PARTES_POR_INSERT = 20;

type Row = Record<string, unknown>;
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

function partirEnPartes(texto: string): string[] {
    const partes: string[] = [];
    for (let i = 0; i < texto.length; i += TAMANO_PARTE) {
        partes.push(texto.slice(i, i + TAMANO_PARTE));
    }
    return partes;
}

/** Extrae, parte y persiste el texto de un documento (idempotente). Si el
 *  archivo no tiene texto extraíble, deja el marcador para no reintentarlo. */
export async function procesarTextoDocumento(
    idDocumento: number,
    nombreArchivo: string,
    tipoMime: string,
    contenido: Buffer
): Promise<number> {
    const texto = await extraerTexto(nombreArchivo, tipoMime, contenido);
    const partes = texto && texto.trim() ? partirEnPartes(texto) : [];
    await portalQuery('DELETE FROM documentos_texto WHERE IdDocumento = ?', [idDocumento]);
    if (partes.length === 0) {
        await portalQuery(
            'INSERT INTO documentos_texto (IdDocumento, Parte, Texto) VALUES (?, ?, ?)',
            [idDocumento, PARTE_SIN_TEXTO, '']
        );
        return 0;
    }
    for (let i = 0; i < partes.length; i += PARTES_POR_INSERT) {
        const lote = partes.slice(i, i + PARTES_POR_INSERT);
        await portalQuery(
            `INSERT INTO documentos_texto (IdDocumento, Parte, Texto) VALUES ${lote.map(() => '(?, ?, ?)').join(', ')}`,
            lote.flatMap((texto, j) => [idDocumento, i + j + 1, texto])
        );
    }
    return partes.length;
}

/** Resumen de 2-3 líneas con Haiku, guardado en documentos.Resumen (best-effort). */
export async function generarResumenDocumento(idDocumento: number, nombre: string, texto: string): Promise<void> {
    if (!process.env.ANTHROPIC_API_KEY || !texto.trim()) return;
    try {
        const anthropic = new Anthropic();
        const resultado = await anthropic.messages.create({
            model: MODELO_RESUMEN,
            max_tokens: 200,
            messages: [{
                role: 'user',
                content: `Resume en 2 o 3 líneas, en español y sin preámbulos, el propósito y contenido de este documento llamado "${nombre}". El resumen sirve para que un agente decida si el documento es relevante a una pregunta.\n\n${texto.slice(0, 8_000)}`,
            }],
        });
        const resumen = resultado.content
            .filter((b): b is Anthropic.TextBlock => b.type === 'text')
            .map(b => b.text)
            .join(' ')
            .trim()
            .slice(0, 1_000);
        if (resumen) {
            await portalQuery('UPDATE documentos SET Resumen = ? WHERE IdDocumento = ?', [resumen, idDocumento]);
        }
    } catch (error) {
        console.warn(`No se generó el resumen del documento ${idDocumento}:`, error);
    }
}

// Llamadas simultáneas sobre el mismo documento (dos búsquedas en paralelo, la
// subida y una lectura, el indexador de fondo) comparten UNA extracción: sin
// esto, dos DELETE+INSERT entrelazados podían dejar partes incompletas que
// después se daban por buenas.
const extraccionesEnCurso = new Map<number, Promise<number>>();

/** Garantiza que el texto del documento esté en la base (backfill perezoso
 *  para los subidos antes de esta mejora). Regresa el total de partes. */
export function asegurarTexto(idDocumento: number): Promise<number> {
    const enCurso = extraccionesEnCurso.get(idDocumento);
    if (enCurso) return enCurso;
    const promesa = asegurarTextoSinCoalescer(idDocumento)
        .finally(() => { extraccionesEnCurso.delete(idDocumento); });
    extraccionesEnCurso.set(idDocumento, promesa);
    return promesa;
}

async function asegurarTextoSinCoalescer(idDocumento: number): Promise<number> {
    // Filas = ya se procesó (con partes o con el marcador de "sin texto");
    // N = partes reales de texto (el marcador Parte 0 no cuenta)
    const existentes = (await portalQuery(
        'SELECT COUNT(*) AS Filas, SUM(Parte > ?) AS N FROM documentos_texto WHERE IdDocumento = ?',
        [PARTE_SIN_TEXTO, idDocumento]
    )) as Row[];
    if (num(existentes?.[0]?.Filas) > 0) return num(existentes?.[0]?.N);

    const docs = (await portalQuery(
        'SELECT NombreArchivo, Archivo, Contenido, TipoMime, Nombre, Resumen FROM documentos WHERE IdDocumento = ? AND Status = 0',
        [idDocumento]
    )) as Row[];
    const doc = docs?.[0];
    if (!doc) return 0;

    const contenido = Buffer.isBuffer(doc.Contenido) && doc.Contenido.length > 0
        ? doc.Contenido
        : await leerArchivo(str(doc.Archivo)).catch(() => null);
    if (!contenido) return 0;

    const partes = await procesarTextoDocumento(idDocumento, str(doc.NombreArchivo), str(doc.TipoMime), contenido);

    // Backfill del resumen si el documento aún no lo tiene
    if (partes > 0 && !str(doc.Resumen)) {
        const primeras = (await portalQuery(
            'SELECT Texto FROM documentos_texto WHERE IdDocumento = ? AND Parte <= 3 ORDER BY Parte',
            [idDocumento]
        )) as Row[];
        await generarResumenDocumento(idDocumento, str(doc.Nombre), primeras.map(p => str(p.Texto)).join(''));
    }
    return partes;
}

// Una "página" de lectura = 4 partes (~12,000 caracteres); es el default que
// usan las evaluaciones
const PARTES_POR_PAGINA = 4;
// El agente lee páginas del doble (~24,000 caracteres): cada página es una
// ronda de modelo, y a los modelos actuales les sobra ventana de contexto
export const PARTES_POR_PAGINA_AGENTE = 8;
// Partes que se traen por búsqueda antes de agrupar por documento
const MAX_PARTES_BUSQUEDA = 80;

/** Página de texto del documento (1-indexada) con el total de páginas. */
export async function obtenerPagina(
    idDocumento: number,
    pagina: number,
    partesPorPagina: number = PARTES_POR_PAGINA
): Promise<{
    texto: string;
    pagina: number;
    totalPaginas: number;
} | null> {
    const totalPartes = await asegurarTexto(idDocumento);
    if (totalPartes === 0) return null;

    const totalPaginas = Math.ceil(totalPartes / partesPorPagina);
    const paginaValida = Math.min(Math.max(pagina, 1), totalPaginas);
    const desde = (paginaValida - 1) * partesPorPagina + 1;
    const hasta = desde + partesPorPagina - 1;

    const partes = (await portalQuery(
        'SELECT Texto FROM documentos_texto WHERE IdDocumento = ? AND Parte BETWEEN ? AND ? ORDER BY Parte',
        [idDocumento, desde, hasta]
    )) as Row[];

    return {
        texto: partes.map(p => str(p.Texto)).join(''),
        pagina: paginaValida,
        totalPaginas,
    };
}

/** Búsqueda multi-término por contenido: cada parte se puntúa con la suma de
 *  los patrones que contiene (LIKE con peso, ver busqueda-texto) y se regresan
 *  los documentos mejor puntuados con hasta 3 fragmentos cada uno. Una sola
 *  llamada cubre la palabra clave, sus sinónimos y variantes. */
export interface ResultadoBusqueda extends DocumentoEncontrado {
    /** Página (tamaño del agente) donde está la parte con mayor puntaje */
    paginaSugerida: number;
}

export async function buscarEnTextos(
    terminos: string[],
    idsVisibles: number[]
): Promise<ResultadoBusqueda[]> {
    const patrones = patronesDeBusqueda(terminos);
    if (patrones.length === 0 || idsVisibles.length === 0) return [];

    const marcas = idsVisibles.map(() => '?').join(',');
    const puntaje = expresionDePuntaje(patrones);
    // La expresión va dos veces (SELECT y WHERE), así que sus parámetros también
    const filas = (await portalQuery(`
        SELECT IdDocumento, Parte, Texto, (${puntaje.sql}) AS Puntaje
        FROM documentos_texto
        WHERE IdDocumento IN (${marcas}) AND Parte > ? AND (${puntaje.sql}) > 0
        ORDER BY Puntaje DESC, IdDocumento, Parte
        LIMIT ${MAX_PARTES_BUSQUEDA}
    `, [...puntaje.params, ...idsVisibles, PARTE_SIN_TEXTO, ...puntaje.params])) as Row[];

    return agruparPorDocumento(
        filas.map(f => ({
            idDocumento: num(f.IdDocumento),
            parte: num(f.Parte),
            texto: str(f.Texto),
            puntaje: num(f.Puntaje),
        })),
        patrones
    ).map(r => ({ ...r, paginaSugerida: paginaDeParte(r.mejorParte, PARTES_POR_PAGINA_AGENTE) }));
}

/** Documentos visibles que todavía no se han procesado (ni texto ni marcador) */
export async function documentosSinIndexar(idsVisibles: number[]): Promise<number[]> {
    if (idsVisibles.length === 0) return [];
    const indexados = (await portalQuery(
        'SELECT DISTINCT IdDocumento FROM documentos_texto'
    )) as Row[];
    const conTexto = new Set(indexados.map(r => num(r.IdDocumento)));
    return idsVisibles.filter(id => !conTexto.has(id));
}
