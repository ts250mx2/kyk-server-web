import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getSession } from '@/lib/session';
import { portalQuery, esOficina } from '@/lib/portal-db';
import { asegurarTexto, buscarEnTextos, obtenerPagina } from '@/lib/documentos-texto';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// A.D.iA.N — Asistente Documental con IA: responde SOLO con el contenido de
// los documentos subidos al portal (respetando la visibilidad por tienda).
// Mismo protocolo streaming NDJSON que Kesito; sus herramientas listan y leen
// documentos de BDKYKPortal, con extracción de texto local (PDF/Word/Excel).
const MODELO = 'claude-sonnet-5';
const MAX_ITERACIONES = 6;
const MAX_HISTORIAL = 12;
const MAX_LISTA = 100;
// Tope por resultado de herramienta: evita que listas/lecturas grandes acumulen
// hasta desbordar el contexto del modelo ("prompt is too long")
const MAX_RESULTADO = 15_000;
const MAX_RESUMEN_LISTA = 300;

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

const ETIQUETA_HERRAMIENTA: Record<string, string> = {
    listar_documentos: 'la lista de documentos',
    buscar_en_documentos: 'la búsqueda en los documentos',
    leer_documento: 'el contenido del documento',
    registrar_pregunta_sin_respuesta: 'el registro de la pregunta',
};

const HERRAMIENTAS: Anthropic.Tool[] = [
    {
        name: 'listar_documentos',
        description: 'Lista los documentos del portal visibles para la tienda, cada uno con su RESUMEN de contenido (además de nombre, carpeta, tamaño, fecha e idDocumento). Úsala para el panorama general y elegir por significado qué leer; el filtro busca en nombre, archivo y carpeta.',
        input_schema: {
            type: 'object',
            properties: {
                busqueda: { type: 'string', description: 'Filtro opcional por nombre, archivo o carpeta' },
            },
        },
    },
    {
        name: 'buscar_en_documentos',
        description: 'Busca un término DENTRO del contenido de todos los documentos visibles y regresa los documentos donde aparece, con fragmentos del texto alrededor de cada coincidencia. Ideal cuando el usuario pregunta por un tema y no sabes en qué documento está.',
        input_schema: {
            type: 'object',
            properties: {
                termino: { type: 'string', description: 'Palabra o frase a buscar en el contenido' },
            },
            required: ['termino'],
        },
    },
    {
        name: 'leer_documento',
        description: 'Regresa el TEXTO de un documento por su idDocumento, en páginas de ~12,000 caracteres (parámetro pagina, default 1; la respuesta indica totalPaginas para pedir las siguientes). Soporta PDF, Word (.docx), Excel/CSV y texto plano.',
        input_schema: {
            type: 'object',
            properties: {
                idDocumento: { type: 'number' },
                pagina: { type: 'number', description: 'Página de texto a leer (1-indexada, default 1)' },
            },
            required: ['idDocumento'],
        },
    },
    {
        name: 'registrar_pregunta_sin_respuesta',
        description: 'Registra en la bitácora de oficina una pregunta que NINGÚN documento del portal pudo responder, para que sepan qué documento falta subir. Úsala solo después de haber buscado y concluido que no hay respuesta.',
        input_schema: {
            type: 'object',
            properties: {
                pregunta: { type: 'string', description: 'La pregunta del usuario, tal como la planteó' },
            },
            required: ['pregunta'],
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

    const documentosVisibles = async (): Promise<Row[]> =>
        (await portalQuery(`
            SELECT D.IdDocumento, D.IdCarpeta, D.Nombre, D.NombreArchivo, D.Tamano, D.FechaSubida, D.Resumen
            FROM documentos D
            WHERE D.Status = 0 ${filtroTienda}
            ORDER BY D.FechaSubida DESC
            LIMIT ${MAX_LISTA}
        `)) as Row[];

    const listarDocumentos = async (busqueda: string): Promise<string> => {
        const [docs, rutas] = await Promise.all([documentosVisibles(), rutaCarpetas()]);
        const filtro = busqueda.trim().toLowerCase();
        const lista = docs
            .map(d => ({
                idDocumento: num(d.IdDocumento),
                nombre: str(d.Nombre),
                archivo: str(d.NombreArchivo),
                carpeta: rutas.get(num(d.IdCarpeta)) || 'Sin carpeta',
                resumen: (str(d.Resumen) || '(sin resumen aún)').slice(0, MAX_RESUMEN_LISTA),
                tamano: num(d.Tamano),
                fecha: str(d.FechaSubida).slice(0, 19),
            }))
            .filter(d => !filtro || `${d.nombre} ${d.archivo} ${d.carpeta}`.toLowerCase().includes(filtro));
        if (lista.length === 0) {
            return JSON.stringify({ mensaje: filtro ? `Sin documentos que coincidan con "${filtro}"` : 'No hay documentos en el portal' });
        }
        return JSON.stringify({ total: lista.length, documentos: lista }).slice(0, MAX_RESULTADO);
    };

    const buscarDocumentos = async (termino: string): Promise<string> => {
        const limpio = termino.trim();
        if (!limpio) return JSON.stringify({ error: 'Término de búsqueda vacío' });

        const docs = await documentosVisibles();
        if (docs.length === 0) return JSON.stringify({ mensaje: 'No hay documentos en el portal' });
        const porId = new Map(docs.map(d => [num(d.IdDocumento), d]));

        // Backfill perezoso: indexa hasta 10 documentos que aún no tengan texto
        // (los recién subidos se indexan al subir; esto cubre los históricos)
        const conTexto = (await portalQuery(
            'SELECT DISTINCT IdDocumento FROM documentos_texto'
        )) as Row[];
        const indexados = new Set(conTexto.map(r => num(r.IdDocumento)));
        const pendientes = docs.filter(d => !indexados.has(num(d.IdDocumento))).slice(0, 10);
        for (const p of pendientes) {
            await asegurarTexto(num(p.IdDocumento)).catch(() => { /* sin texto extraíble */ });
        }

        const resultados = await buscarEnTextos(limpio, docs.map(d => num(d.IdDocumento)));
        if (resultados.length === 0) {
            return JSON.stringify({ mensaje: `Ningún documento visible contiene "${limpio}"` });
        }
        return JSON.stringify({
            termino: limpio,
            documentos: resultados.slice(0, 8).map(r => ({
                idDocumento: r.idDocumento,
                nombre: str(porId.get(r.idDocumento)?.Nombre),
                fragmentos: r.fragmentos,
            })),
        }).slice(0, MAX_RESULTADO);
    };

    const leerDocumento = async (idDocumento: number, pagina: number): Promise<string> => {
        if (!Number.isInteger(idDocumento) || idDocumento <= 0) {
            return JSON.stringify({ error: 'idDocumento inválido' });
        }
        const docs = (await portalQuery(`
            SELECT D.IdDocumento, D.Nombre, D.NombreArchivo
            FROM documentos D
            WHERE D.IdDocumento = ? AND D.Status = 0 ${filtroTienda}
        `, [idDocumento])) as Row[];
        const doc = docs[0];
        if (!doc) {
            return JSON.stringify({ error: 'Documento no encontrado o no disponible para tu tienda' });
        }

        const resultado = await obtenerPagina(idDocumento, pagina);
        if (!resultado) {
            return JSON.stringify({
                nombre: str(doc.Nombre),
                error: `El archivo "${str(doc.NombreArchivo)}" no tiene texto extraíble (imagen, ZIP, .doc viejo o similar)`,
            });
        }
        return JSON.stringify({
            nombre: str(doc.Nombre),
            archivo: str(doc.NombreArchivo),
            pagina: resultado.pagina,
            totalPaginas: resultado.totalPaginas,
            texto: resultado.texto,
            ...(resultado.pagina < resultado.totalPaginas
                ? { nota: `Hay ${resultado.totalPaginas - resultado.pagina} página(s) más: pide la siguiente con pagina=${resultado.pagina + 1}` }
                : {}),
        });
    };

    const registrarPregunta = async (textoPregunta: string): Promise<string> => {
        const limpio = textoPregunta.trim().slice(0, 1_000);
        if (!limpio) return JSON.stringify({ error: 'Pregunta vacía' });
        await portalQuery(`
            INSERT INTO adian_preguntas (IdTienda, Tienda, CodigoBarras, Nombre, Pregunta, Fecha, Status)
            VALUES (?, ?, ?, ?, ?, NOW(), 0)
        `, [session.idTienda, session.tienda, session.codigobarras, session.name, limpio]);
        return JSON.stringify({ registrada: true, mensaje: 'La pregunta quedó en la bitácora de oficina' });
    };

    const ejecutarHerramienta = async (nombre: string, entrada: Record<string, unknown>): Promise<string> => {
        try {
            if (nombre === 'listar_documentos') return await listarDocumentos(String(entrada.busqueda ?? ''));
            if (nombre === 'buscar_en_documentos') return await buscarDocumentos(String(entrada.termino ?? ''));
            if (nombre === 'leer_documento') return await leerDocumento(Number(entrada.idDocumento), Number(entrada.pagina) || 1);
            if (nombre === 'registrar_pregunta_sin_respuesta') return await registrarPregunta(String(entrada.pregunta ?? ''));
            return JSON.stringify({ error: 'Herramienta desconocida' });
        } catch (error) {
            console.error(`Error en herramienta ${nombre} de A.D.iA.N:`, error);
            return JSON.stringify({ error: 'No fue posible consultar los documentos' });
        }
    };

    const sistema = `Eres A.D.iA.N (Asistente Documental con IA) del portal KYK Server Web, atendiendo a la tienda ${session.tienda}.

PERSONALIDAD: hablas como un capacitador amable y cercano. Explicas con tus propias palabras, en tono natural y conversacional, como quien le enseña a un compañero de trabajo — nada de respuestas acartonadas ni puros bullets. Contextualiza ("Mira, según el manual..."), y cuando ayude, cierra ofreciendo profundizar ("¿Quieres que te muestre también cómo...?").

SOLO respondes con información contenida en los DOCUMENTOS del portal. Tu flujo:
1. Para un tema o dato específico empieza con buscar_en_documentos (busca dentro del contenido y regresa fragmentos). Para un panorama general usa listar_documentos, que trae el resumen de cada documento para elegir por significado.
2. Lee con leer_documento los relevantes; viene paginado (~12k caracteres por página) — pide más páginas solo si hace falta.

CÓMO RESPONDER:
- Explica primero con tus palabras, como capacitador.
- Muestra la parte textual relevante en una cita markdown (línea que empieza con >) para que el usuario VEA exactamente qué dice el documento.
- Menciona el documento fuente por su nombre en **negritas**.
- Cierra ofreciendo abrirlo con un link markdown: [📄 Abrir NOMBRE](/api/documentos/ID/descargar?vista=1). Si es PDF y el texto trae marcadores [Página N], usa /api/documentos/ID/descargar?vista=1#page=N para abrirlo JUSTO en esa parte y di en qué página está.
- Los marcadores [Página N] del texto son solo para ubicar: no los incluyas dentro de las citas.

Reglas:
- NUNCA inventes contenido: si después de buscar concluyes que ningún documento visible contiene la respuesta, regístrala con registrar_pregunta_sin_respuesta y dile al usuario con calidez que la anotaste para que oficina sepa qué documento falta subir.
- Si preguntan por datos operativos de la tienda (precios, ventas, inventario) o temas generales, aclara amablemente que tú solo manejas los documentos del portal y que para datos de la tienda está el agente Kesito.
- Español siempre, con markdown ligero.`;

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
                // Si aun así el contexto se llenó, el remedio es empezar de cero
                const contextoLleno = error instanceof Anthropic.APIError
                    && /prompt is too long/i.test(String(error.message));
                emitir({
                    t: 'error',
                    error: contextoLleno
                        ? 'La conversación creció demasiado. Empieza una nueva con el botón ↺ y vuelve a preguntar.'
                        : 'El agente no pudo responder, intenta de nuevo.',
                });
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
