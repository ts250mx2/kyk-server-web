import { NextResponse } from 'next/server';
import type Anthropic from '@anthropic-ai/sdk';
import { getSession } from '@/lib/session';
import {
    claveFaltante,
    correrTurnoAgente,
    esErrorDeAccesoAlModelo,
    esErrorDeContexto,
    type EsfuerzoAgente,
    type ResultadoTurno,
} from '@/lib/agente-modelo';
import { esModeloPermitido } from '@/lib/modelos-agentes';
import { portalQuery, esOficina } from '@/lib/portal-db';
import {
    PARTES_POR_PAGINA_AGENTE,
    asegurarTexto,
    buscarEnTextos,
    documentosSinIndexar,
    obtenerPagina,
} from '@/lib/documentos-texto';
import { MAX_TERMINOS, terminosDePregunta } from '@/lib/busqueda-texto';
import { indexadorDocumentos } from '@/lib/documentos-indexador';
import {
    contextoDeLectura,
    olvidarConversacion,
    paginasRecordadas,
    recordarPagina,
    type PaginaLeida,
} from '@/lib/adian-memoria';
import { registrarConsulta, type ResultadoConsulta } from '@/lib/adian-bitacora';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// A.D.iA.N — Aprendizaje Dirigido por iA Nativo: responde SOLO con el contenido de
// los documentos subidos al portal (respetando la visibilidad por tienda).
// Mismo protocolo streaming NDJSON que Kesito; sus herramientas listan y leen
// documentos de BDKYKPortal, con extracción de texto local (PDF/Word/Excel).
// El modelo default se configura en .env (AGENTES_MODELO) y el selector del chat
// puede cambiarlo por otro del catálogo; acepta modelos de Anthropic (claude-*)
// y de OpenAI (gpt-*) — ver agente-modelo.
const MODELO = process.env.AGENTES_MODELO || 'claude-opus-5';
// 8: buscar con variantes + leer + responder; con 6 el agente se quedaba sin
// rondas en temas que no existen y no alcanzaba a registrar la pregunta
const MAX_ITERACIONES = 8;
// max_tokens acota razonamiento + texto: Opus 5 y Sonnet 5 piensan por default,
// así que con 2000 la respuesta podía salir cortada a media instrucción
const MAX_TOKENS_RESPUESTA = 8_000;
// Chat sobre documentos: 'medium' conserva la calidad con menos latencia y
// costo que el default 'high' de la API. Se puede probar otro sin tocar
// código con AGENTES_ESFUERZO=low|medium|high en .env (y reiniciar)
const ESFUERZOS: EsfuerzoAgente[] = ['low', 'medium', 'high'];
const ESFUERZO: EsfuerzoAgente = ESFUERZOS.find(e => e === process.env.AGENTES_ESFUERZO) ?? 'medium';
// Si aun así se agota max_tokens, se avisa en vez de dejar la instrucción a medias
const AVISO_TRUNCADO = '\n\n_Me quedé sin espacio para terminar. Pídeme que continúe y sigo desde donde me quedé._';
const MAX_HISTORIAL = 12;
const MAX_LISTA = 100;
// Tope por resultado de herramienta: evita que listas/lecturas grandes acumulen
// hasta desbordar el contexto del modelo ("prompt is too long")
const MAX_RESULTADO = 15_000;
// La búsqueda trae además la mejor página (~24k) para ahorrar la ronda de lectura
const MAX_RESULTADO_BUSQUEDA = 40_000;
const MAX_RESUMEN_LISTA = 300;
// Documentos históricos sin indexar: la búsqueda espera solo a estos y el resto
// se indexa en segundo plano
const MAX_BACKFILL_INLINE = 2;
// Documentos que la búsqueda automática con la pregunta mete al contexto
const MAX_DOCS_PREBUSQUEDA = 3;
// Cada término lo manda el modelo (y un documento leído podría influirlo):
// se acota como cualquier otra entrada
const MAX_LARGO_TERMINO = 80;
const HERRAMIENTA_SIN_RESPUESTA = 'registrar_pregunta_sin_respuesta';
const AVISO_PAGINA_RECORTADA = '… [texto recortado: pide esta página con leer_documento]';
// Margen para los escapes que agrega JSON (comillas, saltos de línea)
const MARGEN_JSON = 50;

// Si el resultado con la página completa pasa del tope, se recorta el TEXTO de
// la página (con aviso) en vez de cortar el JSON a la mitad. Quitar N
// caracteres del texto quita al menos N del JSON, así que el recorte alcanza.
function jsonConPaginaAcotada(
    armar: (texto: string | null) => Record<string, unknown>,
    texto: string | null,
    tope: number
): string {
    const completo = JSON.stringify(armar(texto));
    if (completo.length <= tope || texto === null) return completo.slice(0, tope);
    const exceso = completo.length - tope + AVISO_PAGINA_RECORTADA.length + MARGEN_JSON;
    const recortado = texto.slice(0, Math.max(0, texto.length - exceso)) + AVISO_PAGINA_RECORTADA;
    return JSON.stringify(armar(recortado)).slice(0, tope);
}

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
const ESTADO_PENSANDO = 'Estoy pensando en tu pregunta…';
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
        description: `Busca DENTRO del contenido de todos los documentos visibles y regresa los documentos donde aparecen los términos, ordenados por relevancia, cada uno con fragmentos y su paginaSugerida (la página donde más coincide), además del TEXTO completo de la mejor página del documento más relevante (mejorDocumento): si ahí está la respuesta, contesta sin leer más. Manda en UNA sola llamada de 2 a ${MAX_TERMINOS} términos: la palabra clave tal como la dijo el usuario, sinónimos, singular y plural, y el nombre del proceso o formato relacionado (por ejemplo ["devolución", "devoluciones", "cambio de producto", "nota de crédito"]).`,
        input_schema: {
            type: 'object',
            properties: {
                terminos: {
                    type: 'array',
                    items: { type: 'string' },
                    minItems: 1,
                    maxItems: MAX_TERMINOS,
                    description: 'Palabras o frases a buscar: la clave, sinónimos y variantes',
                },
            },
            required: ['terminos'],
        },
    },
    {
        name: 'leer_documento',
        description: 'Regresa el TEXTO de un documento por su idDocumento, en páginas de ~24,000 caracteres (parámetro pagina, default 1; la respuesta indica totalPaginas para pedir las siguientes). Empieza por la paginaSugerida de la búsqueda. Soporta PDF, Word (.docx), Excel/CSV y texto plano.',
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

// Prompt de sistema IDÉNTICO para todos los usuarios: la tienda, el nombre y
// lo ya leído viajan en el bloque [Contexto] del mensaje, así el prefijo
// cacheado (herramientas + system) se comparte en toda la empresa en vez de
// crearse por usuario.
const SISTEMA = `Eres A.D.iA.N (Aprendizaje Dirigido por iA Nativo), el capacitador del portal KYK Server Web para las tiendas KYK. Ayudas a compañeros de todos los perfiles (intendencia, cajeros, almacenistas, carniceros, gerentes) a entender los documentos y manuales del portal.

Al inicio de cada mensaje del usuario viene un bloque [Contexto] con su tienda, su nombre, los documentos que ya leíste en esta conversación y, en la primera pregunta, el resultado de una búsqueda automática con las palabras de la pregunta. Úsalo sin repetirlo ni mencionarlo como bloque.

TONO: hablas de "tú", en español, claro y cercano, como un compañero con experiencia. Palabras sencillas; si el documento usa un término técnico, explícalo la primera vez. Nada de "es muy fácil" ni "es obvio", y nunca supongas el puesto de quien pregunta. Usa el nombre del usuario a lo mucho una vez por respuesta. Respuestas enfocadas y breves: la respuesta primero, el detalle después; profundiza cuando el usuario lo pida. Un procedimiento va en pasos numerados; una regla o política empieza con el veredicto (sí, no o depende). Simplifica la redacción, nunca el contenido: en seguridad, higiene, dinero o normas conserva todos los pasos y condiciones del documento. Las respuestas también se leen en voz alta: sin emojis y sin depender de tablas. La latencia importa: en cuanto tengas la información, empieza tu respuesta visible de inmediato.

SOLO respondes con información contenida en los DOCUMENTOS del portal. Tu flujo:
1. Si el bloque [Contexto] ya trae el texto que responde la pregunta (un documento leído antes o la página que trajo la búsqueda automática), responde con él directamente, sin volver a buscar ni releer.
2. Si no, usa buscar_en_documentos mandando varios términos a la vez (la palabra clave, sinónimos, singular y plural, el nombre del proceso). Regresa los documentos por relevancia, la paginaSugerida de cada uno y el TEXTO de la mejor página del más relevante: si ahí está la respuesta, contesta ya. Para un panorama general usa listar_documentos, que trae el resumen de cada documento.
3. Lee con leer_documento solo lo que la búsqueda no trajo, empezando por la paginaSugerida; viene paginado (~24k caracteres por página): pide más páginas solo si hace falta.
4. Si la búsqueda no encuentra nada, haz UNA segunda búsqueda con términos distintos (otra forma de decirlo, el nombre del formato o del proceso). Solo cuando ya buscaste con términos distintos y revisaste los documentos candidatos sin encontrarlo, registra la pregunta con registrar_pregunta_sin_respuesta y díselo al usuario con calidez: así oficina sabe qué documento falta subir.

CÓMO CITAR:
- En la explicación di de qué documento sale la información y en qué página, con el nombre en **negritas**: "Según el **Manual de devoluciones** (página 3), ...". El usuario debe ver la fuente sin abrir nada.
- Un dato exacto (monto, plazo, límite, horario) dilo tal cual lo escribe el documento, dentro de tu propia frase. Las citas con > van solo bajo [REFERENCIAS].
- Al final de tu respuesta agrega una línea que diga exactamente:
[REFERENCIAS]
- Debajo van las citas textuales completas (líneas que empiezan con >), el nombre del documento en **negritas** con su página y el link [📄 Abrir NOMBRE](/api/documentos/ID/descargar?vista=1). Si es PDF y el texto trae marcadores [Página N], usa /api/documentos/ID/descargar?vista=1#page=N para abrirlo justo en esa parte. Esa sección va colapsada tras el botón "Ver referencias": la explicación debe entenderse sin ella.
- Los marcadores [Página N] del texto son solo para ubicar: no los incluyas dentro de las citas.

DIAGRAMA DE FLUJO: solo cuando el usuario pida ver el proceso en diagrama, agrega al final de la explicación (antes de [REFERENCIAS]) un bloque:
\`\`\`flujo
titulo: Nombre corto del proceso
Primer paso, en pocas palabras
Segundo paso
? Pregunta de decisión (empieza con ?)
si: Qué hacer si la respuesta es sí
no: Qué hacer si la respuesta es no
Paso final
\`\`\`
Una línea por paso, máximo 8, sin markdown ni números dentro del bloque (la numeración la pone el portal).

PRÁCTICA: si el usuario pide practicar, hazle UNA pregunta sacada del documento y espera su respuesta; cuando conteste, dile qué tuvo bien y qué le faltó citando el documento, y ofrécele otra.

Reglas:
- NUNCA inventes contenido: todo lo que afirmes debe venir de un documento que leíste en esta conversación.
- Si preguntan por datos operativos de la tienda (precios, ventas, inventario) o temas generales, aclara amablemente que tú solo manejas los documentos del portal y que para datos de la tienda está el agente Kesito.
- Español siempre, con markdown ligero.`;

// Lo que se acumula durante el turno para la bitácora de consultas
interface EstadoBitacora {
    rondas: number;
    herramientas: string[];
    tokensEntrada: number;
    tokensSalida: number;
    tokensCache: number;
    stopReason: string;
    truncada: boolean;
    resultado: ResultadoConsulta;
    error: string;
}

const BITACORA_INICIAL: EstadoBitacora = {
    rondas: 0,
    herramientas: [],
    tokensEntrada: 0,
    tokensSalida: 0,
    tokensCache: 0,
    stopReason: '',
    truncada: false,
    resultado: 'ok',
    error: '',
};

function conTurno(bitacora: EstadoBitacora, resultado: ResultadoTurno): EstadoBitacora {
    return {
        ...bitacora,
        rondas: bitacora.rondas + 1,
        herramientas: [...bitacora.herramientas, ...resultado.usos.map(u => u.name)],
        tokensEntrada: bitacora.tokensEntrada + resultado.uso.entrada,
        tokensSalida: bitacora.tokensSalida + resultado.uso.salida,
        tokensCache: bitacora.tokensCache + resultado.uso.cacheLeida,
        stopReason: resultado.stopReason,
        truncada: bitacora.truncada || resultado.truncado,
    };
}

export async function POST(request: Request) {
    const inicio = Date.now();
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    const claveConversacion = `${session.idTienda}:${session.codigobarras}`;
    if (excedeLimite(claveConversacion)) {
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

    // Conversación nueva (primera pregunta o botón ↺): se olvida lo leído antes
    const historialLista: unknown[] = Array.isArray(historial) ? historial : [];
    if (historialLista.length === 0) olvidarConversacion(claveConversacion);

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

    // La lista de visibles se consulta una vez por petición (la usan la
    // búsqueda automática, la búsqueda del modelo y el listado)
    let visiblesPromesa: Promise<Row[]> | null = null;
    const documentosVisibles = (): Promise<Row[]> => {
        if (!visiblesPromesa) {
            visiblesPromesa = portalQuery(`
                SELECT D.IdDocumento, D.IdCarpeta, D.Nombre, D.NombreArchivo, D.Tamano, D.FechaSubida, D.Resumen
                FROM documentos D
                WHERE D.Status = 0 ${filtroTienda}
                ORDER BY D.FechaSubida DESC
                LIMIT ${MAX_LISTA}
            `) as Promise<Row[]>;
        }
        return visiblesPromesa;
    };

    // Página del tamaño del agente (~24k caracteres), anotada en la memoria de
    // la conversación para los turnos siguientes
    const leerPaginaAgente = async (idDocumento: number, nombre: string, pagina: number) => {
        const resultado = await obtenerPagina(idDocumento, pagina, PARTES_POR_PAGINA_AGENTE);
        if (!resultado) return null;
        recordarPagina(claveConversacion, {
            idDocumento,
            nombre,
            pagina: resultado.pagina,
            totalPaginas: resultado.totalPaginas,
            texto: resultado.texto,
        });
        return resultado;
    };

    const yaLeida = (idDocumento: number, pagina: number): boolean =>
        paginasRecordadas(claveConversacion).some(p => p.idDocumento === idDocumento && p.pagina === pagina);

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

    const buscarDocumentos = async (terminos: string[]): Promise<string> => {
        const limpios = terminos
            .map(t => String(t ?? '').trim().slice(0, MAX_LARGO_TERMINO))
            .filter(Boolean)
            .slice(0, MAX_TERMINOS);
        if (limpios.length === 0) return JSON.stringify({ error: 'Manda al menos un término de búsqueda' });

        const docs = await documentosVisibles();
        if (docs.length === 0) return JSON.stringify({ mensaje: 'No hay documentos en el portal' });
        const ids = docs.map(d => num(d.IdDocumento));
        const porId = new Map(docs.map(d => [num(d.IdDocumento), d]));

        // Backfill de históricos sin indexar: la búsqueda espera solo a dos (en
        // paralelo) y el resto se indexa en segundo plano para las siguientes.
        // Los que no tienen texto extraíble quedan marcados y no se reintentan.
        const pendientes = (await documentosSinIndexar(ids)).filter(id => !indexadorDocumentos.estaEnProceso(id));
        await Promise.all(
            pendientes.slice(0, MAX_BACKFILL_INLINE).map(id => asegurarTexto(id).catch(() => 0))
        );
        indexadorDocumentos.encolar(pendientes.slice(MAX_BACKFILL_INLINE));

        const resultados = await buscarEnTextos(limpios, ids);
        if (resultados.length === 0) {
            return JSON.stringify({
                terminos: limpios,
                mensaje: 'Ningún documento visible contiene esos términos; prueba otra forma de decirlo o el nombre del proceso',
            });
        }

        // La mejor página del documento más relevante viaja en el mismo
        // resultado: en la mayoría de los casos ahorra la ronda de lectura
        const mejor = resultados[0];
        const nombreMejor = str(porId.get(mejor.idDocumento)?.Nombre);
        const paginaMejor = yaLeida(mejor.idDocumento, mejor.paginaSugerida)
            ? null
            : await leerPaginaAgente(mejor.idDocumento, nombreMejor, mejor.paginaSugerida);

        const armar = (texto: string | null): Record<string, unknown> => ({
            terminos: limpios,
            documentos: resultados.map(r => ({
                idDocumento: r.idDocumento,
                nombre: str(porId.get(r.idDocumento)?.Nombre),
                relevancia: r.puntaje,
                paginaSugerida: r.paginaSugerida,
                terminosEncontrados: r.terminos,
                fragmentos: r.fragmentos,
            })),
            mejorDocumento: paginaMejor && texto !== null
                ? {
                    idDocumento: mejor.idDocumento,
                    nombre: nombreMejor,
                    pagina: paginaMejor.pagina,
                    totalPaginas: paginaMejor.totalPaginas,
                    texto,
                    nota: 'Texto de la página más relevante del documento más relevante; si responde la pregunta, úsalo sin leer más',
                }
                : { idDocumento: mejor.idDocumento, nombre: nombreMejor, nota: 'Su mejor página ya está en tu contexto' },
        });
        return jsonConPaginaAcotada(armar, paginaMejor?.texto ?? null, MAX_RESULTADO_BUSQUEDA);
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

        const resultado = await leerPaginaAgente(idDocumento, str(doc.Nombre), pagina);
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
            if (nombre === 'buscar_en_documentos') {
                // Acepta también el viejo `termino` suelto por si el modelo lo manda así
                const terminos = Array.isArray(entrada.terminos)
                    ? entrada.terminos.map(t => String(t ?? ''))
                    : [String(entrada.termino ?? '')];
                return await buscarDocumentos(terminos);
            }
            if (nombre === 'leer_documento') return await leerDocumento(Number(entrada.idDocumento), Number(entrada.pagina) || 1);
            if (nombre === 'registrar_pregunta_sin_respuesta') return await registrarPregunta(String(entrada.pregunta ?? ''));
            return JSON.stringify({ error: 'Herramienta desconocida' });
        } catch (error) {
            console.error(`Error en herramienta ${nombre} de A.D.iA.N:`, error);
            return JSON.stringify({ error: 'No fue posible consultar los documentos' });
        }
    };

    // Búsqueda automática con las palabras de la pregunta, antes de llamar al
    // modelo: si acierta, la respuesta sale en UNA ronda en vez de tres
    // (buscar, leer, responder). Solo cuando la conversación aún no tiene
    // documentos leídos; los seguimientos ya viven de la memoria. Nunca espera
    // a indexar ni tumba la consulta si falla. La página NO se anota todavía en
    // la memoria: es una corazonada, y solo queda si el modelo respondió con
    // ella sin pedir herramientas.
    const SIN_PREBUSQUEDA = { texto: '', pagina: null as PaginaLeida | null };
    const prebusqueda = async (): Promise<{ texto: string; pagina: PaginaLeida | null }> => {
        try {
            const terminos = terminosDePregunta(pregunta);
            if (terminos.length === 0) return SIN_PREBUSQUEDA;
            const docs = await documentosVisibles();
            if (docs.length === 0) return SIN_PREBUSQUEDA;
            const ids = docs.map(d => num(d.IdDocumento));
            indexadorDocumentos.encolar(await documentosSinIndexar(ids));

            const resultados = (await buscarEnTextos(terminos, ids)).slice(0, MAX_DOCS_PREBUSQUEDA);
            if (resultados.length === 0) return SIN_PREBUSQUEDA;
            const porId = new Map(docs.map(d => [num(d.IdDocumento), d]));
            const lineas = resultados.map(r =>
                `- **${str(porId.get(r.idDocumento)?.Nombre)}** (idDocumento ${r.idDocumento}, página sugerida ${r.paginaSugerida}): ${r.fragmentos[0] ?? ''}`
            );
            const mejor = resultados[0];
            const nombreMejor = str(porId.get(mejor.idDocumento)?.Nombre);
            const paginaMejor = await obtenerPagina(mejor.idDocumento, mejor.paginaSugerida, PARTES_POR_PAGINA_AGENTE);
            const pagina: PaginaLeida | null = paginaMejor
                ? {
                    idDocumento: mejor.idDocumento,
                    nombre: nombreMejor,
                    pagina: paginaMejor.pagina,
                    totalPaginas: paginaMejor.totalPaginas,
                    texto: paginaMejor.texto,
                }
                : null;
            const textoMejor = pagina
                ? `\n\nTexto de la página ${pagina.pagina} de ${pagina.totalPaginas} de **${nombreMejor}** (idDocumento ${mejor.idDocumento}):\n${pagina.texto}`
                : '';
            return {
                texto: `Búsqueda automática con las palabras de la pregunta (orientativa: si no es el tema, busca con tus propios términos):\n${lineas.join('\n')}${textoMejor}`,
                pagina,
            };
        } catch (error) {
            console.warn('Falló la búsqueda automática de A.D.iA.N:', error);
            return SIN_PREBUSQUEDA;
        }
    };

    // Contexto del turno en el mensaje del usuario (no en el system, para que
    // el prefijo cacheado sea el mismo para todos): tienda, nombre, lo ya
    // leído y, si aún no hay nada leído, la búsqueda automática
    const nombrePila = (session.name || '').trim().split(/\s+/)[0] || '';
    const paginasPrevias = paginasRecordadas(claveConversacion);
    const previa = paginasPrevias.length === 0 ? await prebusqueda() : SIN_PREBUSQUEDA;
    const contexto = [
        `[Contexto] Tienda: ${session.tienda}. Usuario: ${session.name || 'un compañero'}${nombrePila ? ` (dile ${nombrePila})` : ''}.`,
        contextoDeLectura(paginasPrevias),
        previa.texto,
    ].filter(Boolean).join('\n\n');

    const mensajes: Anthropic.MessageParam[] = [];
    for (const h of historialLista.slice(-MAX_HISTORIAL)) {
        const item = h as { rol?: unknown; texto?: unknown } | null;
        const rol = item?.rol === 'assistant' ? 'assistant' : 'user';
        const texto = String(item?.texto ?? '').slice(0, 2000);
        if (texto) mensajes.push({ role: rol, content: texto });
    }
    mensajes.push({
        role: 'user',
        content: [
            { type: 'text', text: contexto },
            { type: 'text', text: pregunta },
        ],
    });

    const codificador = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            let conexionViva = true;
            let bitacora = BITACORA_INICIAL;
            const emitir = (evento: Record<string, unknown>) => {
                if (!conexionViva) return;
                try {
                    controller.enqueue(codificador.encode(JSON.stringify(evento) + '\n'));
                } catch {
                    conexionViva = false;
                }
            };

            const avisarSiTruncado = (resultado: ResultadoTurno) => {
                if (!resultado.truncado) return;
                console.warn(`A.D.iA.N: respuesta cortada por max_tokens con ${modelo}`);
                emitir({ t: 'delta', texto: AVISO_TRUNCADO });
            };

            try {
                // Desde el primer segundo se ve que algo pasa (el modelo razona
                // antes de escribir o de pedir herramientas)
                emitir({ t: 'estado', texto: ESTADO_PENSANDO });
                let terminado = false;
                for (let i = 0; i < MAX_ITERACIONES && conexionViva; i++) {
                    const resultado = await correrTurnoAgente({
                        modelo,
                        maxTokens: MAX_TOKENS_RESPUESTA,
                        esfuerzo: ESFUERZO,
                        sistema: SISTEMA,
                        herramientas: HERRAMIENTAS,
                        mensajes,
                        alTexto: delta => emitir({ t: 'delta', texto: delta }),
                    });
                    bitacora = conTurno(bitacora, resultado);

                    if (resultado.usos.length === 0) {
                        // Respondió a la primera sin herramientas: la página de la
                        // búsqueda automática sí era el tema y queda en la memoria
                        // para los seguimientos
                        if (i === 0 && previa.pagina) recordarPagina(claveConversacion, previa.pagina);
                        avisarSiTruncado(resultado);
                        terminado = true;
                        break;
                    }

                    emitir({ t: 'reinicio' });
                    mensajes.push({ role: 'assistant', content: resultado.contenido });
                    // Evento informativo (el panel ignora los tipos que no conoce):
                    // el script de evaluación cuenta rondas y detecta cuándo el
                    // agente registró la pregunta como sin respuesta
                    for (const uso of resultado.usos) emitir({ t: 'herramienta', nombre: uso.name });
                    emitir({
                        t: 'estado',
                        texto: resultado.usos.length > 1
                            ? 'Estoy consultando varios documentos a la vez…'
                            : ETIQUETA_HERRAMIENTA[resultado.usos[0].name] ?? 'Estoy consultando los documentos…',
                    });
                    // Varias herramientas en un turno (p. ej. dos lecturas) corren
                    // en paralelo; los resultados van todos en un solo mensaje
                    const resultados: Anthropic.ToolResultBlockParam[] = await Promise.all(
                        resultado.usos.map(async uso => ({
                            type: 'tool_result' as const,
                            tool_use_id: uso.id,
                            content: await ejecutarHerramienta(uso.name, uso.input as Record<string, unknown>),
                        }))
                    );
                    mensajes.push({ role: 'user', content: resultados });
                    emitir({ t: 'estado', texto: ESTADO_PENSANDO });
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
                        maxTokens: MAX_TOKENS_RESPUESTA,
                        esfuerzo: ESFUERZO,
                        sistema: SISTEMA,
                        herramientas: HERRAMIENTAS,
                        sinHerramientas: true,
                        mensajes,
                        alTexto: delta => emitir({ t: 'delta', texto: delta }),
                    });
                    bitacora = conTurno(bitacora, cierre);
                    const textoCierre = cierre.contenido
                        .filter((b): b is Anthropic.TextBlockParam => b.type === 'text')
                        .map(b => b.text)
                        .join('')
                        .trim();
                    if (!textoCierre) {
                        emitir({ t: 'reinicio' });
                        emitir({ t: 'delta', texto: 'No pude completar la consulta, intenta preguntarlo de otra forma.' });
                    } else {
                        // Después del texto: un 'reinicio' posterior lo borraría
                        avisarSiTruncado(cierre);
                    }
                }
                if (!conexionViva) bitacora = { ...bitacora, resultado: 'cancelado' };
                emitir({ t: 'fin' });
            } catch (error) {
                console.error('Error en A.D.iA.N:', error);
                bitacora = {
                    ...bitacora,
                    resultado: 'error',
                    error: error instanceof Error ? error.message : String(error),
                };
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
                // La bitácora se registra pase lo que pase; nunca tumba la respuesta
                registrarConsulta({
                    idTienda: num(session.idTienda),
                    tienda: str(session.tienda),
                    codigoBarras: str(session.codigobarras),
                    nombre: str(session.name),
                    modelo,
                    pregunta,
                    duracionMs: Date.now() - inicio,
                    ...bitacora,
                    // Columna propia: la lista de herramientas se recorta a 255
                    // caracteres y esta herramienta suele ser la última
                    sinRespuesta: bitacora.herramientas.includes(HERRAMIENTA_SIN_RESPUESTA),
                }).catch(err => console.warn('No se registró la consulta de A.D.iA.N en la bitácora:', err));
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
