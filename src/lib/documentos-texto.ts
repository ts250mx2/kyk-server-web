import Anthropic from '@anthropic-ai/sdk';
import { portalQuery } from './portal-db';
import { leerArchivo } from './documentos-fs';
import { extraerTexto } from './extraer-texto';

// Texto extraído de los documentos, persistido en BDKYKPortal.documentos_texto
// en partes de ~3,000 caracteres: se extrae UNA sola vez (al subir, o de forma
// perezosa para los documentos previos), sobrevive reinicios y habilita la
// búsqueda por contenido y la lectura paginada de A.D.iA.N. El resumen por
// documento se genera con Haiku y se guarda en documentos.Resumen.

const TAMANO_PARTE = 3_000;
const MODELO_RESUMEN = 'claude-haiku-4-5-20251001';

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

/** Extrae, parte y persiste el texto de un documento (idempotente). */
export async function procesarTextoDocumento(
    idDocumento: number,
    nombreArchivo: string,
    tipoMime: string,
    contenido: Buffer
): Promise<number> {
    const texto = await extraerTexto(nombreArchivo, tipoMime, contenido);
    if (!texto || !texto.trim()) return 0;

    const partes = partirEnPartes(texto);
    await portalQuery('DELETE FROM documentos_texto WHERE IdDocumento = ?', [idDocumento]);
    for (let i = 0; i < partes.length; i++) {
        await portalQuery(
            'INSERT INTO documentos_texto (IdDocumento, Parte, Texto) VALUES (?, ?, ?)',
            [idDocumento, i + 1, partes[i]]
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

/** Garantiza que el texto del documento esté en la base (backfill perezoso
 *  para los subidos antes de esta mejora). Regresa el total de partes. */
export async function asegurarTexto(idDocumento: number): Promise<number> {
    const existentes = (await portalQuery(
        'SELECT COUNT(*) AS N FROM documentos_texto WHERE IdDocumento = ?',
        [idDocumento]
    )) as Row[];
    const n = num(existentes?.[0]?.N);
    if (n > 0) return n;

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

// Una "página" de lectura para el agente = 4 partes (~12,000 caracteres)
const PARTES_POR_PAGINA = 4;

/** Página de texto del documento (1-indexada) con el total de páginas. */
export async function obtenerPagina(idDocumento: number, pagina: number): Promise<{
    texto: string;
    pagina: number;
    totalPaginas: number;
} | null> {
    const totalPartes = await asegurarTexto(idDocumento);
    if (totalPartes === 0) return null;

    const totalPaginas = Math.ceil(totalPartes / PARTES_POR_PAGINA);
    const paginaValida = Math.min(Math.max(pagina, 1), totalPaginas);
    const desde = (paginaValida - 1) * PARTES_POR_PAGINA + 1;
    const hasta = desde + PARTES_POR_PAGINA - 1;

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

/** Búsqueda por contenido sobre los chunks (LIKE, suficiente a esta escala):
 *  regresa por documento las partes donde apareció el término, con fragmento. */
export async function buscarEnTextos(
    termino: string,
    idsVisibles: number[]
): Promise<{ idDocumento: number; fragmentos: string[] }[]> {
    const limpio = termino.trim();
    if (!limpio || idsVisibles.length === 0) return [];

    const marcas = idsVisibles.map(() => '?').join(',');
    const filas = (await portalQuery(`
        SELECT IdDocumento, Parte, Texto
        FROM documentos_texto
        WHERE IdDocumento IN (${marcas}) AND Texto LIKE ?
        ORDER BY IdDocumento, Parte
        LIMIT 60
    `, [...idsVisibles, `%${limpio}%`])) as Row[];

    const porDocumento = new Map<number, string[]>();
    const enMinusculas = limpio.toLowerCase();
    for (const f of filas) {
        const id = num(f.IdDocumento);
        const fragmentos = porDocumento.get(id) ?? [];
        if (fragmentos.length >= 3) continue;
        const texto = str(f.Texto);
        const posicion = texto.toLowerCase().indexOf(enMinusculas);
        const inicio = Math.max(0, posicion - 120);
        const fragmento = texto.slice(inicio, posicion + limpio.length + 200).replace(/\s+/g, ' ').trim();
        porDocumento.set(id, [...fragmentos, `...${fragmento}...`]);
    }
    return [...porDocumento.entries()].map(([idDocumento, fragmentos]) => ({ idDocumento, fragmentos }));
}
