import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getSession } from '@/lib/session';
import { portalQuery, esOficina } from '@/lib/portal-db';
import { leerArchivo } from '@/lib/documentos-fs';
import { extraerTexto } from '@/lib/extraer-texto';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// A.D.iA.N — Asistente Documental con IA: responde SOLO con el contenido de
// los documentos subidos al portal (respetando la visibilidad por tienda).
// Mismo protocolo streaming NDJSON que Kesito; sus herramientas listan y leen
// documentos de BDKYKPortal, con extracción de texto local (PDF/Word/Excel).
const MODELO = 'claude-sonnet-5';
const MAX_ITERACIONES = 6;
const MAX_HISTORIAL = 12;
const MAX_TEXTO = 18_000;
const MAX_LISTA = 100;

type Row = Record<string, unknown>;
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

// Rate limit sencillo en memoria, como el de Kesito
const LIMITE_VENTANA_MS = 60_000;
const LIMITE_PREGUNTAS_POR_MINUTO = 10;
const ventanasDeUso = new Map<string, number[]>();

function excedeLimite(clave: string): boolean {
    const ahora = Date.now();
    const recientes = (ventanasDeUso.get(clave) ?? []).filter(t => ahora - t < LIMITE_VENTANA_MS);
    const excede = recientes.length >= LIMITE_PREGUNTAS_POR_MINUTO;
    ventanasDeUso.set(clave, excede ? recientes : [...recientes, ahora]);
    return excede;
}

// Cache de texto extraído (los documentos son inmutables una vez subidos)
const cacheTexto = new Map<number, string | null>();

const ETIQUETA_HERRAMIENTA: Record<string, string> = {
    listar_documentos: 'la lista de documentos',
    leer_documento: 'el contenido del documento',
};

const HERRAMIENTAS: Anthropic.Tool[] = [
    {
        name: 'listar_documentos',
        description: 'Lista los documentos del portal visibles para la tienda (nombre, carpeta, tipo, tamaño, fecha e idDocumento). Úsala primero para saber qué hay; el filtro busca en nombre, archivo y carpeta.',
        input_schema: {
            type: 'object',
            properties: {
                busqueda: { type: 'string', description: 'Filtro opcional por nombre, archivo o carpeta' },
            },
        },
    },
    {
        name: 'leer_documento',
        description: 'Extrae y regresa el TEXTO de un documento por su idDocumento (de listar_documentos). Soporta PDF, Word (.docx), Excel/CSV y texto plano; imágenes, ZIP y similares no tienen texto extraíble.',
        input_schema: {
            type: 'object',
            properties: {
                idDocumento: { type: 'number' },
            },
            required: ['idDocumento'],
        },
        // Marca el final del prefijo cacheable (herramientas + system)
        cache_control: { type: 'ephemeral' },
    },
];

export async function POST(request: Request) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    if (!process.env.ANTHROPIC_API_KEY) {
        return NextResponse.json({ error: 'El agente no está configurado (falta ANTHROPIC_API_KEY)' }, { status: 503 });
    }
    if (excedeLimite(`${session.idTienda}:${session.codigobarras}`)) {
        return NextResponse.json(
            { error: 'Muy rápido: espera un momento antes de volver a preguntar.' },
            { status: 429 }
        );
    }

    let pregunta = '';
    let historial: unknown = null;
    try {
        const cuerpo = await request.json();
        pregunta = String(cuerpo?.mensaje ?? '').trim().slice(0, 2000);
        historial = cuerpo?.historial;
    } catch {
        return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
    }
    if (!pregunta) {
        return NextResponse.json({ error: 'Mensaje vacío' }, { status: 400 });
    }

    const oficina = await esOficina(session.codigobarras);
    const filtroTienda = oficina
        ? ''
        : `AND (D.TodasTiendas = 1 OR EXISTS (
               SELECT 1 FROM documentos_tiendas T
               WHERE T.IdDocumento = D.IdDocumento AND T.IdTienda = ${session.idTienda}
           ))`;

    const rutaCarpetas = async (): Promise<Map<number, string>> => {
        const carpetas = (await portalQuery(
            'SELECT IdCarpeta, Nombre, IdCarpetaPadre FROM documentos_carpetas WHERE Status = 0'
        )) as Row[];
        const porId = new Map(carpetas.map(c => [num(c.IdCarpeta), c]));
        const rutas = new Map<number, string>();
        for (const c of carpetas) {
            const partes: string[] = [];
            let actual: Row | undefined = c;
            for (let i = 0; i < 10 && actual; i++) {
                partes.unshift(str(actual.Nombre));
                actual = porId.get(num(actual.IdCarpetaPadre));
            }
            rutas.set(num(c.IdCarpeta), partes.join(' / '));
        }
        return rutas;
    };

    const listarDocumentos = async (busqueda: string): Promise<string> => {
        const [docs, rutas] = await Promise.all([
            portalQuery(`
                SELECT D.IdDocumento, D.IdCarpeta, D.Nombre, D.NombreArchivo, D.Tamano, D.FechaSubida
                FROM documentos D
                WHERE D.Status = 0 ${filtroTienda}
                ORDER BY D.FechaSubida DESC
                LIMIT ${MAX_LISTA}
            `) as Promise<Row[]>,
            rutaCarpetas(),
        ]);
        const filtro = busqueda.trim().toLowerCase();
        const lista = docs
            .map(d => ({
                idDocumento: num(d.IdDocumento),
                nombre: str(d.Nombre),
                archivo: str(d.NombreArchivo),
                carpeta: rutas.get(num(d.IdCarpeta)) || 'Sin carpeta',
                tamano: num(d.Tamano),
                fecha: str(d.FechaSubida).slice(0, 19),
            }))
            .filter(d => !filtro || `${d.nombre} ${d.archivo} ${d.carpeta}`.toLowerCase().includes(filtro));
        if (lista.length === 0) {
            return JSON.stringify({ mensaje: filtro ? `Sin documentos que coincidan con "${filtro}"` : 'No hay documentos en el portal' });
        }
        return JSON.stringify({ total: lista.length, documentos: lista });
    };

    const leerDocumento = async (idDocumento: number): Promise<string> => {
        if (!Number.isInteger(idDocumento) || idDocumento <= 0) {
            return JSON.stringify({ error: 'idDocumento inválido' });
        }
        const docs = (await portalQuery(`
            SELECT D.IdDocumento, D.Nombre, D.NombreArchivo, D.Archivo, D.Contenido, D.TipoMime
            FROM documentos D
            WHERE D.IdDocumento = ? AND D.Status = 0 ${filtroTienda}
        `, [idDocumento])) as Row[];
        const doc = docs[0];
        if (!doc) {
            return JSON.stringify({ error: 'Documento no encontrado o no disponible para tu tienda' });
        }

        let texto = cacheTexto.get(idDocumento);
        if (texto === undefined) {
            const contenido = Buffer.isBuffer(doc.Contenido) && doc.Contenido.length > 0
                ? doc.Contenido
                : await leerArchivo(str(doc.Archivo)).catch(() => null);
            texto = contenido ? await extraerTexto(str(doc.NombreArchivo), str(doc.TipoMime), contenido) : null;
            if (cacheTexto.size > 50) cacheTexto.clear();
            cacheTexto.set(idDocumento, texto);
        }

        if (!texto || !texto.trim()) {
            return JSON.stringify({
                nombre: str(doc.Nombre),
                error: `El archivo "${str(doc.NombreArchivo)}" no tiene texto extraíble (imagen, ZIP, .doc viejo o similar)`,
            });
        }
        const recortado = texto.length > MAX_TEXTO;
        return JSON.stringify({
            nombre: str(doc.Nombre),
            archivo: str(doc.NombreArchivo),
            texto: recortado ? `${texto.slice(0, MAX_TEXTO)}\n\n[TEXTO RECORTADO: el documento es más largo]` : texto,
        });
    };

    const ejecutarHerramienta = async (nombre: string, entrada: Record<string, unknown>): Promise<string> => {
        try {
            if (nombre === 'listar_documentos') return await listarDocumentos(String(entrada.busqueda ?? ''));
            if (nombre === 'leer_documento') return await leerDocumento(Number(entrada.idDocumento));
            return JSON.stringify({ error: 'Herramienta desconocida' });
        } catch (error) {
            console.error(`Error en herramienta ${nombre} de A.D.iA.N:`, error);
            return JSON.stringify({ error: 'No fue posible consultar los documentos' });
        }
    };

    const sistema = `Eres A.D.iA.N (Asistente Documental con IA) del portal KYK Server Web, atendiendo a la tienda ${session.tienda}.

SOLO respondes con información contenida en los DOCUMENTOS subidos al portal. Tu flujo:
1. Usa listar_documentos para ver qué hay (con busqueda cuando ayude).
2. Lee con leer_documento el o los documentos relevantes.
3. Responde citando SIEMPRE el documento fuente por su nombre en **negritas**.

Reglas:
- NUNCA inventes contenido: si ningún documento visible contiene la respuesta, dilo claramente y sugiere qué documento haría falta.
- Si te preguntan por datos operativos de la tienda (precios, ventas, inventario) o temas generales, aclara amablemente que tú solo manejas los documentos del portal y que para datos de la tienda está el agente Kesito.
- Responde en español, breve y directo, con markdown ligero.`;

    const mensajes: Anthropic.MessageParam[] = [];
    if (Array.isArray(historial)) {
        for (const h of historial.slice(-MAX_HISTORIAL)) {
            const rol = h?.rol === 'assistant' ? 'assistant' : 'user';
            const texto = String(h?.texto ?? '').slice(0, 2000);
            if (texto) mensajes.push({ role: rol, content: texto });
        }
    }
    mensajes.push({ role: 'user', content: pregunta });

    const anthropic = new Anthropic();
    const codificador = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            let conexionViva = true;
            const emitir = (evento: Record<string, unknown>) => {
                if (!conexionViva) return;
                try {
                    controller.enqueue(codificador.encode(JSON.stringify(evento) + '\n'));
                } catch {
                    conexionViva = false;
                }
            };

            try {
                let terminado = false;
                for (let i = 0; i < MAX_ITERACIONES && conexionViva; i++) {
                    const streamModelo = anthropic.messages.stream({
                        model: MODELO,
                        max_tokens: 1500,
                        system: [{ type: 'text', text: sistema, cache_control: { type: 'ephemeral' } }],
                        tools: HERRAMIENTAS,
                        messages: mensajes,
                    });
                    streamModelo.on('text', delta => emitir({ t: 'delta', texto: delta }));
                    const resultado = await streamModelo.finalMessage();

                    const usosDeHerramienta = resultado.content.filter(
                        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
                    );
                    if (resultado.stop_reason !== 'tool_use' || usosDeHerramienta.length === 0) {
                        terminado = true;
                        break;
                    }

                    emitir({ t: 'reinicio' });
                    mensajes.push({ role: 'assistant', content: resultado.content });
                    const resultados: Anthropic.ToolResultBlockParam[] = [];
                    for (const uso of usosDeHerramienta) {
                        emitir({
                            t: 'estado',
                            texto: `Consultando ${ETIQUETA_HERRAMIENTA[uso.name] ?? 'los documentos'}...`,
                        });
                        resultados.push({
                            type: 'tool_result',
                            tool_use_id: uso.id,
                            content: await ejecutarHerramienta(uso.name, uso.input as Record<string, unknown>),
                        });
                    }
                    mensajes.push({ role: 'user', content: resultados });
                }

                if (!terminado) {
                    emitir({ t: 'reinicio' });
                    emitir({ t: 'delta', texto: 'No pude completar la consulta, intenta preguntarlo de otra forma.' });
                }
                emitir({ t: 'fin' });
            } catch (error) {
                console.error('Error en A.D.iA.N:', error);
                emitir({ t: 'error', error: 'El agente no pudo responder, intenta de nuevo.' });
            } finally {
                try { controller.close(); } catch { /* ya cerrado por el cliente */ }
            }
        },
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'application/x-ndjson; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'X-Accel-Buffering': 'no',
        },
    });
}
