import Anthropic from '@anthropic-ai/sdk';
import { portalQuery } from './portal-db';
import { tiendaQuery } from './tienda-db';
import { getTiendaById } from './tiendas';
import { calcularExistencia } from './existencias';

// Bot de existencias del chat: en los canales de sucursal (tienda-<id>),
// cuando un mensaje pide existencias, KESITO responde en el mismo canal con
// la existencia del producto EN LA TIENDA DEL CANAL (no la del que pregunta).
// El producto se extrae del mensaje con Haiku (con respaldo heurístico) y la
// cifra sale de calcularExistencia (corte nocturno + movimientos del día).

type Row = Record<string, unknown>;
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

const BOT_CODIGO = 'KESITO';
const BOT_NOMBRE = 'KESITO 🧀';
const MAX_ARTICULOS = 3;
const MODELO_EXTRACCION = 'claude-haiku-4-5-20251001';

const RE_EXISTENCIAS = /\bexistencias?\b|\bstock\b|cu[aá]nt[oa]s?\s+(?:hay|queda|quedan|tenemos|tienen?)\b/i;

/** ¿El mensaje pregunta por existencias? (dispara al bot en canales tienda-N) */
export const preguntaExistencias = (mensaje: string): boolean => RE_EXISTENCIAS.test(mensaje);

const fmtCant = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 });

// Respaldo sin IA: quita las palabras de la pregunta y deja el producto
function extraerHeuristico(mensaje: string): string {
    return mensaje
        .replace(/[¿?¡!.,;]/g, ' ')
        .replace(/\b(existencias?|stock|cu[aá]nt[oa]s?|hay|queda[n]?|ten(?:emos|go|ienes|iene|ien)|dame|dime|me|das|puedes|decir|de|del|la|el|los|las|un|una|en|tienda|sucursal|por|favor|kesito|producto|art[ií]culo)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

async function extraerProducto(mensaje: string): Promise<string> {
    if (!process.env.ANTHROPIC_API_KEY) return extraerHeuristico(mensaje);
    try {
        const anthropic = new Anthropic();
        const resultado = await anthropic.messages.create({
            model: MODELO_EXTRACCION,
            max_tokens: 60,
            messages: [{
                role: 'user',
                content: `Del siguiente mensaje de un chat de tienda extrae SOLO el producto (nombre o código de barras) del que piden existencias. Responde únicamente con el producto, sin comillas ni texto extra. Si no mencionan ningún producto, responde exactamente NADA.\n\nMensaje: ${mensaje.slice(0, 500)}`,
            }],
        });
        const texto = resultado.content
            .filter((b): b is Anthropic.TextBlock => b.type === 'text')
            .map(b => b.text)
            .join(' ')
            .trim();
        if (!texto || /^NADA[.!]?$/i.test(texto)) return '';
        return texto.slice(0, 80);
    } catch {
        return extraerHeuristico(mensaje);
    }
}

async function buscarArticulos(idTienda: number, producto: string): Promise<Row[]> {
    const limpio = producto.trim();
    if (/^\d{5,}$/.test(limpio)) {
        return (await tiendaQuery(idTienda, `
            SELECT CodigoInterno, Descripcion, Status
            FROM tblArticulos
            WHERE CodigoBarras = ? OR CodigoInterno = ?
            ORDER BY Status LIMIT ${MAX_ARTICULOS + 1}
        `, [limpio, Number(limpio)])) as Row[];
    }
    const palabras = limpio.toLowerCase().split(/\s+/).filter(p => p.length >= 2).slice(0, 6);
    if (palabras.length === 0) return [];

    // Conteo individual por palabra: descarta las que no existen en el catálogo
    // (piden "leche lala entera 1 litro" y la descripción real es "Leche Lala 1.8Lt")
    const conteos = await Promise.all(palabras.map(async palabra => {
        const rows = (await tiendaQuery(idTienda,
            'SELECT COUNT(*) AS N FROM tblArticulos WHERE Descripcion LIKE ?', [`%${palabra}%`]
        ).catch(() => [])) as Row[];
        return { palabra, n: num(rows?.[0]?.N) };
    }));
    // De menos a más coincidencias: la primera es la más restrictiva
    let candidatas = conteos.filter(c => c.n > 0).sort((a, b) => a.n - b.n);

    // AND de todas; si no hay resultados, suelta la más restrictiva y reintenta
    while (candidatas.length > 0) {
        const condiciones = candidatas.map(() => 'Descripcion LIKE ?').join(' AND ');
        // Activos primero y descripción más corta primero (coincidencia más directa)
        const rows = (await tiendaQuery(idTienda, `
            SELECT CodigoInterno, Descripcion, Status
            FROM tblArticulos
            WHERE ${condiciones}
            ORDER BY Status, LENGTH(Descripcion) LIMIT ${MAX_ARTICULOS + 1}
        `, candidatas.map(c => `%${c.palabra}%`))) as Row[];
        if (rows.length > 0) return rows;
        candidatas = candidatas.slice(1);
    }
    return [];
}

async function publicarEnCanal(canal: string, texto: string): Promise<void> {
    await portalQuery(`
        INSERT INTO chat_mensajes (Canal, IdTienda, CodigoBarras, Nombre, Mensaje, Imagen, FechaEnvio)
        VALUES (?, 0, ?, ?, ?, '', NOW())
    `, [canal, BOT_CODIGO, BOT_NOMBRE, texto.slice(0, 2000)]);
}

/** Responde en el canal con la existencia del producto pedido, calculada
 *  sobre la tienda del canal, dirigiéndose a quien preguntó (en un canal con
 *  varias personas queda claro qué pregunta responde). Corre sin await. */
export async function responderExistenciasEnCanal(
    canal: string,
    mensaje: string,
    preguntadoPor = ''
): Promise<void> {
    const idTienda = Number(canal.slice('tienda-'.length));
    if (!Number.isInteger(idTienda) || idTienda <= 0) return;

    // Solo el primer nombre para dirigirse con naturalidad
    const nombre = preguntadoPor.trim().split(/\s+/)[0] ?? '';
    const para = nombre ? `${nombre}, ` : '';

    try {
        const producto = await extraerProducto(mensaje);
        if (!producto) {
            await publicarEnCanal(canal, `📦 ${para}¿de qué producto quieres la existencia? Dime el nombre o el código de barras, p. ej. "existencias de coca cola 600".`);
            return;
        }

        const articulos = await buscarArticulos(idTienda, producto);
        if (articulos.length === 0) {
            await publicarEnCanal(canal, `📦 ${para}no encontré "${producto}" en el catálogo de esta tienda. Intenta con otro nombre o con el código de barras.`);
            return;
        }

        const tienda = await getTiendaById(idTienda).catch(() => null);
        const lineas: string[] = [];
        // Secuencial a propósito: cada cálculo lanza ~13 consultas a la tienda
        for (const articulo of articulos.slice(0, MAX_ARTICULOS)) {
            const codigo = num(articulo.CodigoInterno);
            const resultado = await calcularExistencia(idTienda, codigo).catch(() => null);
            if (!resultado) continue;
            const medida = resultado.articulo.medidaVenta || 'PZA';
            const dias = resultado.diasCobertura !== null && resultado.diasCobertura >= 0
                ? ` (~${fmtCant.format(resultado.diasCobertura)} días de venta)`
                : '';
            const notaMaestro = resultado.varianteConsultada
                ? ` — existencia del maestro ${resultado.articulo.descripcion}`
                : '';
            const descripcion = resultado.varianteConsultada?.descripcion ?? resultado.articulo.descripcion;
            lineas.push(`• ${descripcion}: ${fmtCant.format(resultado.existencia)} ${medida}${dias}${notaMaestro}`);
        }

        if (lineas.length === 0) {
            await publicarEnCanal(canal, `📦 ${para}encontré "${producto}" pero no pude calcular su existencia ahorita, intenta de nuevo.`);
            return;
        }

        const quien = preguntadoPor.trim() ? ` — pregunta de ${preguntadoPor.trim()}` : '';
        const encabezado = `📦 Existencia en ${tienda?.Tienda ?? 'esta tienda'}${quien}:`;
        const extra = articulos.length > MAX_ARTICULOS
            ? '\n…hay más coincidencias: sé más específico o dame el código de barras.'
            : '';
        await publicarEnCanal(canal, `${encabezado}\n${lineas.join('\n')}${extra}\n\nCifra estimada: corte nocturno + movimientos de hoy.`);
    } catch (error) {
        console.error(`Error del bot de existencias en ${canal}:`, error);
        await publicarEnCanal(canal, `📦 ${para}no pude consultar la existencia en este momento (¿la tienda está en línea?). Intenta de nuevo en un rato.`)
            .catch(() => { /* sin red ni al portal: no hay más que hacer */ });
    }
}
