import { portalQuery } from './portal-db';

// Imágenes de productos, guardadas EN LA BASE (articulos_imagenes, base64):
//  1) caché por código de barras (positiva y negativa con reintento)
//  2) Open Food Facts por código de barras (base abierta, match exacto)
//  3) subida manual / sugerencias por descripción (elige oficina)
// Nada se guarda en disco; el binario viaja como base64 en MEDIUMTEXT.

type Row = Record<string, unknown>;
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

// Si Open Food Facts no la tuvo, se reintenta pasada una semana
const REINTENTO_DIAS = 7;
const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const UA = 'KYKServerWeb/1.0 (portal interno de tiendas KYK)';

export interface ImagenProducto {
    tipoMime: string;
    datos: Buffer;
}

export interface SugerenciaImagen {
    codigo: string;
    nombre: string;
    marca: string;
    url: string;
}

// Los códigos internos (báscula, granel, marca propia) no existen en bases
// externas: solo se consulta afuera lo que parece EAN/UPC real
const esEanExterno = (codigo: string) => /^\d{8,14}$/.test(codigo);

export const codigoImagenValido = (codigo: string) => /^[A-Za-z0-9]{1,45}$/.test(codigo);

/** Descarga una imagen SOLO de Open Food Facts (anti-SSRF) y la valida. */
export async function descargarImagenExterna(
    url: string
): Promise<{ tipoMime: string; base64: string } | null> {
    let destino: URL;
    try {
        destino = new URL(url);
    } catch {
        return null;
    }
    if (destino.protocol !== 'https:' || !/(^|\.)openfoodfacts\.org$/.test(destino.hostname)) {
        return null;
    }
    const res = await fetch(destino, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const tipoMime = (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim();
    if (!tipoMime.startsWith('image/')) return null;
    const datos = Buffer.from(await res.arrayBuffer());
    if (datos.length === 0 || datos.length > MAX_BYTES) return null;
    return { tipoMime, base64: datos.toString('base64') };
}

export async function guardarImagenProducto(
    codigoBarras: string,
    tipoMime: string,
    base64: string,
    origen: 'off' | 'manual'
): Promise<void> {
    await portalQuery(`
        INSERT INTO articulos_imagenes (CodigoBarras, TipoMime, ImagenBase64, Origen, Estado, FechaAct)
        VALUES (?, ?, ?, ?, 0, NOW())
        ON DUPLICATE KEY UPDATE
            TipoMime = VALUES(TipoMime), ImagenBase64 = VALUES(ImagenBase64),
            Origen = VALUES(Origen), Estado = 0, FechaAct = NOW()
    `, [codigoBarras, tipoMime.slice(0, 50), base64, origen]);
}

async function marcarNoEncontrada(codigoBarras: string): Promise<void> {
    await portalQuery(`
        INSERT INTO articulos_imagenes (CodigoBarras, TipoMime, ImagenBase64, Origen, Estado, FechaAct)
        VALUES (?, '', NULL, 'off', 1, NOW())
        ON DUPLICATE KEY UPDATE Estado = 1, ImagenBase64 = NULL, FechaAct = NOW()
    `, [codigoBarras]);
}

export async function eliminarImagenProducto(codigoBarras: string): Promise<void> {
    await portalQuery('DELETE FROM articulos_imagenes WHERE CodigoBarras = ?', [codigoBarras]);
}

/** Imagen del producto: caché en base → Open Food Facts (lazy) → null.
 *  Los fallos de red NO cachean negativo (se reintenta en la siguiente). */
export async function obtenerImagenProducto(codigoBarras: string): Promise<ImagenProducto | null> {
    const filas = (await portalQuery(
        'SELECT TipoMime, ImagenBase64, Estado, FechaAct FROM articulos_imagenes WHERE CodigoBarras = ?',
        [codigoBarras]
    )) as Row[];
    const fila = filas[0];

    if (fila && num(fila.Estado) === 0 && str(fila.ImagenBase64)) {
        return {
            tipoMime: str(fila.TipoMime) || 'image/jpeg',
            datos: Buffer.from(str(fila.ImagenBase64), 'base64'),
        };
    }
    if (fila && num(fila.Estado) === 1) {
        const edadMs = Date.now() - new Date(str(fila.FechaAct)).getTime();
        if (edadMs < REINTENTO_DIAS * 24 * 60 * 60 * 1000) return null;
    }

    if (!esEanExterno(codigoBarras)) {
        await marcarNoEncontrada(codigoBarras).catch(() => { /* sin caché negativa */ });
        return null;
    }

    try {
        const res = await fetch(
            `https://world.openfoodfacts.org/api/v2/product/${codigoBarras}.json?fields=image_front_url,image_url`,
            { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) }
        );
        if (!res.ok && res.status !== 404) return null; // error del servicio: reintentar luego
        const json = res.ok ? await res.json().catch(() => null) : null;
        const url = str(json?.product?.image_front_url) || str(json?.product?.image_url);
        if (url) {
            const imagen = await descargarImagenExterna(url);
            if (imagen) {
                await guardarImagenProducto(codigoBarras, imagen.tipoMime, imagen.base64, 'off');
                return { tipoMime: imagen.tipoMime, datos: Buffer.from(imagen.base64, 'base64') };
            }
        }
        await marcarNoEncontrada(codigoBarras);
        return null;
    } catch {
        // Red caída o timeout: no se cachea negativo para reintentar pronto
        return null;
    }
}

/** Candidatas por descripción (búsqueda de texto de Open Food Facts): para
 *  que OFICINA elija la correcta — nunca se asigna sola una imagen por texto. */
export async function sugerenciasPorDescripcion(busqueda: string): Promise<SugerenciaImagen[]> {
    const termino = busqueda.trim().slice(0, 120);
    if (!termino) return [];
    const url = 'https://world.openfoodfacts.org/cgi/search.pl'
        + `?search_terms=${encodeURIComponent(termino)}`
        + '&search_simple=1&action=process&json=1&page_size=8'
        + '&fields=code,product_name,brands,image_front_url';
    const res = await fetch(url, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
        console.warn(`Open Food Facts search respondió ${res.status} para "${termino}"`);
        return [];
    }
    const crudo = await res.text();
    let json: { products?: Row[] } | null = null;
    try {
        json = JSON.parse(crudo);
    } catch {
        console.warn(`Open Food Facts search regresó una respuesta ilegible para "${termino}" (${crudo.length} bytes): ${crudo.slice(0, 200)}`);
        return [];
    }
    return (json?.products ?? [])
        .filter(p => str(p.image_front_url))
        .map(p => ({
            codigo: str(p.code),
            nombre: str(p.product_name) || '(sin nombre)',
            marca: str(p.brands),
            url: str(p.image_front_url),
        }));
}
