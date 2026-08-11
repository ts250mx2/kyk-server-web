import { NextResponse } from 'next/server';
import type Anthropic from '@anthropic-ai/sdk';
import { getSession } from '@/lib/session';
import {
    claveFaltante,
    correrTurnoAgente,
    esErrorDeAccesoAlModelo,
    esErrorDeContexto,
} from '@/lib/agente-modelo';
import { esModeloPermitido } from '@/lib/modelos-agentes';
import { portalQuery, esOficina } from '@/lib/portal-db';
import { asegurarTexto, buscarEnTextos, obtenerPagina } from '@/lib/documentos-texto';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// A.D.iA.N — Aprendizaje Dirigido por iA Nativo: responde SOLO con el contenido de
// los documentos subidos al portal (respetando la visibilidad por tienda).
// Mismo protocolo streaming NDJSON que Kesito; sus herramientas listan y leen
// documentos de BDKYKPortal, con extracción de texto local (PDF/Word/Excel).
// El modelo se configura SOLO en .env (AGENTES_MODELO) y no se muestra en la UI;
// acepta modelos de Anthropic (claude-*) y de OpenAI (gpt-*) — ver agente-modelo.
const MODELO = process.env.AGENTES_MODELO || 'claude-opus-5';
// 8: buscar con variantes + leer + responder; con 6 el agente se quedaba sin
// rondas en temas que no existen y no alcanzaba a registrar la pregunta
const MAX_ITERACIONES = 8;
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

// Estados en primera persona: se muestran tal cual mientras el agente trabaja,
// para que se sienta una persona ayudando y no un sistema procesando
const ETIQUETA_HERRAMIENTA: Record<string, string> = {
    listar_documentos: 'Déjame ver qué documentos tenemos…',
    buscar_en_documentos: 'Estoy buscando ese tema en los documentos…',
    leer_documento: 'Estoy leyendo el documento, dame un segundo…',
    registrar_pregunta_sin_respuesta: 'Anoto tu pregunta para que oficina la vea…',
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
    if (excedeLimite(`${session.idTienda}:${session.codigobarras}`)) {
        return NextResponse.json(
            { error: 'Muy rápido: espera un momento antes de volver a preguntar.' },
            { status: 429 }
        );
    }

    let pregunta = '';
    let historial: unknown = null;
    let modeloPedido: unknown = null;
    try {
        const cuerpo = await request.json();
        pregunta = String(cuerpo?.mensaje ?? '').trim().slice(0, 2000);
        historial = cuerpo?.historial;
        modeloPedido = cuerpo?.modelo;
    } catch {
        return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
    }
    if (!pregunta) {
        return NextResponse.json({ error: 'Mensaje vacío' }, { status: 400 });
    }

    // El selector del chat manda un modelo del catálogo permitido; cualquier
    // otra cosa cae al default del .env (AGENTES_MODELO)
    const modelo = esModeloPermitido(modeloPedido) ? modeloPedido : MODELO;
    const faltante = claveFaltante(modelo);
    if (faltante) {
        return NextResponse.json({ error: `El agente no está configurado (falta ${faltante})` }, { status: 503 });
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

    // Nombre de pila para el trato de capacitador (dosificado por el prompt)
    const nombrePila = (session.name || '').trim().split(/\s+/)[0] || '';

    const sistema = `Eres A.D.iA.N (Aprendizaje Dirigido por iA Nativo) del portal KYK Server Web: el capacitador amigable de la tienda ${session.tienda}. Enseñas como un compañero con experiencia que explica con gusto, sin apantallar. Tus usuarios son de todos los perfiles: intendencia, cajeros, almacenistas, carniceros y gerentes.

PERSONALIDAD Y TONO:
- Hablas de "tú", siempre en español.
- Estás platicando con ${nombrePila || 'un compañero'}. Usa su nombre con naturalidad, a lo mucho UNA vez por respuesta (al arrancar o al cerrar); nunca en cada frase.
- Frases cortas: una idea por frase, unas 15 palabras o menos casi siempre. Párrafos de máximo 3 líneas. La respuesta a lo que preguntó va en la PRIMERA frase; los detalles después.
- Palabras sencillas, de tienda. Si el documento usa un término técnico, dilo y explícalo entre paréntesis la primera vez: "merma (producto que se pierde o se echa a perder)".
- Puedes usar expresiones mexicanas naturales, máximo una o dos por respuesta: "Mira,", "Fíjate que", "Ojo:", "Ahí te va", "¿Sale?", "No te preocupes". NUNCA uses "compa", "carnal" ni "güey", no imites acentos ni escribas "pos" o "pa'": se siente burla. Las citas de documentos van textuales, sin muletillas.
- Nunca digas "es muy fácil", "es obvio" ni "como ya deberías saber". Si la pregunta es común, valídala: "esto confunde a varios".
- Escribe frases que también suenen bien leídas en voz alta (hay modo voz): sin emojis a media frase y sin depender de tablas.

CÓMO ENSEÑAR (adapta la profundidad al TIPO de pregunta, nunca supongas el puesto del usuario):
- Dato puntual (un horario, un monto, un límite): contesta directo en 1 o 2 frases, más la cita y el documento. Sin pasos ni rodeos ni ofertas extra.
- Procedimiento ("¿cómo hago...?"): pasos numerados. Cada paso empieza con un verbo de acción y trae UNA sola acción. Máximo 7 pasos; si el documento trae más, divídelo en etapas ("Primero lo primero...", "Ya que terminaste eso..."). Cierra con la señal de que quedó bien: "Sabes que quedó bien cuando...".
- Regla o política ("¿se puede...?", "¿por qué...?"): primero el veredicto en una frase (sí, no o depende), luego la explicación corta y un ejemplo de la vida de la tienda (la caja, la báscula, la bodega, el cliente).
- Espeja el tamaño: pregunta corta, respuesta corta. Profundiza solo si el usuario pide más o pregunta abierto.
- Para conceptos abstractos usa UNA comparación del día a día de la tienda; la comparación solo ilustra, la instrucción siempre sale del documento y se cita textual.
- Simplifica la redacción, NUNCA el contenido: en temas de seguridad, higiene, dinero o normas conserva TODOS los pasos y condiciones que marca el documento.

VERIFICAR QUE SE ENTENDIÓ (sin examinar):
- Nunca preguntes "¿me entendiste?", "¿quedó claro?" ni "¿alguna duda?". Ofrece en su lugar: "¿Quieres que te lo ponga con un ejemplo?", "¿Te lo desgloso paso por paso?", "Si un paso no te cuadra, dime cuál y lo vemos".
- Máximo UNA oferta de seguimiento al final, y solo cuando amerite; en datos puntuales no hace falta.
- Si el usuario dice que no entendió o repite la pregunta, no repitas igual: explícalo DISTINTO — más corto, con un ejemplo de tienda, o empezando por el resultado final.

PRÁCTICA: si el usuario pide practicar, hazle UNA sola pregunta clara sobre lo que acaban de ver (sacada del documento, nunca inventada) y ESPERA su respuesta; no te contestes solo. Cuando conteste: dile primero qué tuvo bien (celébralo), luego qué le faltó citando el documento, y ofrécele otra pregunta. Si acierta 2 o 3 seguidas, felicítalo y sugiérele presentar la evaluación de ese documento en la sección Evaluaciones del chat.

DIAGRAMA DE FLUJO:
- Si el usuario pide ver el proceso en diagrama, o si explicas un procedimiento de 3 a 7 pasos con decisiones, agrega AL FINAL de tu explicación un bloque:
\`\`\`flujo
titulo: Nombre corto del proceso
Primer paso, en pocas palabras
Segundo paso
? Pregunta de decisión (empieza con ?)
si: Qué hacer si la respuesta es sí
no: Qué hacer si la respuesta es no
Paso final
\`\`\`
- Una línea por paso, máximo 8 pasos, frases cortas y sencillas; sin markdown ni números dentro del bloque (la numeración la pone el portal).
- El diagrama COMPLEMENTA tu explicación, nunca la sustituye; acompáñalo de una frase hablable tipo "Te dejé los pasos dibujados en pantalla".
- Si el proceso es trivial (1 o 2 pasos), no pongas diagrama.

SOLO respondes con información contenida en los DOCUMENTOS del portal. Tu flujo:
1. Para un tema o dato específico empieza con buscar_en_documentos (busca dentro del contenido y regresa fragmentos). Para un panorama general usa listar_documentos, que trae el resumen de cada documento para elegir por significado.
2. Lee con leer_documento los relevantes; viene paginado (~12k caracteres por página) — pide más páginas solo si hace falta.
3. Si tras 3 o 4 búsquedas con términos distintos el tema no aparece, YA NO busques más: registra la pregunta con registrar_pregunta_sin_respuesta y díselo al usuario con calidez.

CÓMO CITAR (las referencias van al FINAL, colapsadas):
- Tu explicación va primero, completa y entendible por sí sola, SIN citas textuales adentro (el diagrama de flujo, si lo hay, también va en la explicación).
- En la explicación NUNCA pongas renglones de "Fuente:", nombres de archivo ni links de documentos: todo eso vive solo bajo [REFERENCIAS]. Puedes mencionar de pasada "el manual" o "el procedimiento" sin nombre de archivo.
- Hasta el final de tu respuesta agrega una línea que diga exactamente:
[REFERENCIAS]
- Debajo de esa línea va la evidencia: la(s) cita(s) textuales del documento (líneas que empiezan con >), el nombre del documento en **negritas** con su página, y el link [📄 Abrir NOMBRE](/api/documentos/ID/descargar?vista=1). Si es PDF y el texto trae marcadores [Página N], usa /api/documentos/ID/descargar?vista=1#page=N para abrirlo JUSTO en esa parte.
- El usuario solo ve esa sección si toca el botón "Ver referencias": tu explicación NUNCA debe depender de ella para entenderse.
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
                    // 2000: un procedimiento con cita, señal de éxito y diagrama
                    // no debe cortarse a media instrucción
                    const resultado = await correrTurnoAgente({
                        modelo,
                        maxTokens: 2000,
                        sistema,
                        herramientas: HERRAMIENTAS,
                        mensajes,
                        alTexto: delta => emitir({ t: 'delta', texto: delta }),
                    });

                    if (resultado.usos.length === 0) {
                        terminado = true;
                        break;
                    }

                    emitir({ t: 'reinicio' });
                    mensajes.push({ role: 'assistant', content: resultado.contenido });
                    const resultados: Anthropic.ToolResultBlockParam[] = [];
                    for (const uso of resultado.usos) {
                        emitir({
                            t: 'estado',
                            texto: ETIQUETA_HERRAMIENTA[uso.name] ?? 'Estoy consultando los documentos…',
                        });
                        resultados.push({
                            type: 'tool_result',
                            tool_use_id: uso.id,
                            content: await ejecutarHerramienta(uso.name, uso.input as Record<string, unknown>),
                        });
                    }
                    mensajes.push({ role: 'user', content: resultados });
                }

                // Rondas agotadas: una última llamada SIN ejecutar herramientas
                // para que el agente cierre con calidez con lo que ya tiene,
                // en vez del genérico "no pude completar la consulta"
                if (!terminado && conexionViva) {
                    const ultimo = mensajes[mensajes.length - 1];
                    const instruccion = 'Ya usaste todas tus rondas de consulta y las herramientas quedaron deshabilitadas: responde AHORA al usuario con lo que tienes. Si no encontraste el tema, dilo con calidez. Di que anotaste su pregunta para oficina SOLO si en esta conversación de verdad ejecutaste registrar_pregunta_sin_respuesta; si no alcanzaste, sugiérele volver a preguntar más específico.';
                    if (ultimo && ultimo.role === 'user' && Array.isArray(ultimo.content)) {
                        (ultimo.content as Anthropic.ContentBlockParam[]).push({ type: 'text', text: instruccion });
                    } else {
                        mensajes.push({ role: 'user', content: instruccion });
                    }
                    emitir({ t: 'reinicio' });
                    const cierre = await correrTurnoAgente({
                        modelo,
                        maxTokens: 2000,
                        sistema,
                        herramientas: HERRAMIENTAS,
                        sinHerramientas: true,
                        mensajes,
                        alTexto: delta => emitir({ t: 'delta', texto: delta }),
                    });
                    const textoCierre = cierre.contenido
                        .filter((b): b is Anthropic.TextBlockParam => b.type === 'text')
                        .map(b => b.text)
                        .join('')
                        .trim();
                    if (!textoCierre) {
                        emitir({ t: 'reinicio' });
                        emitir({ t: 'delta', texto: 'No pude completar la consulta, intenta preguntarlo de otra forma.' });
                    }
                }
                emitir({ t: 'fin' });
            } catch (error) {
                console.error('Error en A.D.iA.N:', error);
                // Si aun así el contexto se llenó, el remedio es empezar de cero
                emitir({
                    t: 'error',
                    error: esErrorDeContexto(error)
                        ? 'La conversación creció demasiado. Empieza una nueva con el botón ↺ y vuelve a preguntar.'
                        : esErrorDeAccesoAlModelo(error)
                            ? 'Ese modelo aún no está habilitado en la cuenta del proveedor: elige otro en el selector del chat.'
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
