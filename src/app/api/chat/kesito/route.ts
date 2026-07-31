import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Kesito de tienda: agente del chat acotado ESTRICTAMENTE al portal. Sus
// herramientas llaman a las propias APIs del portal con la cookie de la sesión,
// así que solo ve los datos de la tienda del usuario (precios, ofertas, básculas,
// cortes, facturas, recibos, transferencias y devoluciones). Modelo fijo sonnet-5.
const MODELO = 'claude-sonnet-5';
const MAX_ITERACIONES = 6;
const MAX_HISTORIAL = 12;
const MAX_RESULTADO = 12_000;

const HOY = () => new Date().toLocaleDateString('sv-SE');

// Rate limit sencillo en memoria: cada pregunta puede disparar hasta 7 llamadas
// al modelo, así que se acota por usuario para proteger la factura.
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

// Etiquetas amigables para narrar en el chat qué está consultando el agente
const ETIQUETA_HERRAMIENTA: Record<string, string> = {
    resumen_del_dia: 'el resumen del día',
    buscar_articulo_precio: 'precios de artículos',
    detalle_articulo: 'el detalle del artículo',
    ofertas: 'las ofertas',
    precios_bascula: 'los precios de báscula',
    cortes_de_caja: 'los cortes de caja',
    recibos: 'los recibos de mercancía',
    transferencias: 'las transferencias',
    facturas: 'las facturas',
    devoluciones_venta: 'las devoluciones de venta',
    devoluciones_compra: 'las devoluciones de compra',
    existencia_articulo: 'la existencia del artículo',
    quiebres_inventario: 'los quiebres de inventario',
};

const HERRAMIENTAS: Anthropic.Tool[] = [
    {
        name: 'resumen_del_dia',
        description: 'Resumen del día actual de la tienda: ventas (total, tickets, por hora), recibos de mercancía, transferencias y facturación. Antes de las 4:00 AM regresa el día anterior.',
        input_schema: { type: 'object', properties: {} },
    },
    {
        name: 'buscar_articulo_precio',
        description: 'Busca artículos por descripción o código de barras y regresa su precio y oferta vigente. Úsala para preguntas de precios.',
        input_schema: {
            type: 'object',
            properties: {
                busqueda: { type: 'string', description: 'Descripción o código de barras del artículo' },
            },
            required: ['busqueda'],
        },
    },
    {
        name: 'detalle_articulo',
        description: 'Detalle completo de un artículo por su codigoInterno (obtenido de buscar_articulo_precio): precio, IVA, ofertas con vigencia, precios de mayoreo por escala y costos por proveedor.',
        input_schema: {
            type: 'object',
            properties: {
                codigoInterno: { type: 'number' },
            },
            required: ['codigoInterno'],
        },
    },
    {
        name: 'ofertas',
        description: 'Ofertas vigentes de la tienda: internas (sesiones de ofertas) o publicadas, con precio normal, precio de oferta, % de descuento y vigencia.',
        input_schema: {
            type: 'object',
            properties: {
                tipo: { type: 'string', enum: ['internas', 'publicadas'] },
                busqueda: { type: 'string', description: 'Filtro opcional por descripción o código' },
            },
            required: ['tipo'],
        },
    },
    {
        name: 'precios_bascula',
        description: 'Códigos y precios para básculas de los artículos a granel (código 00-, mayoreo 10-/20- con escalas, y variante rebanada 01-).',
        input_schema: {
            type: 'object',
            properties: {
                busqueda: { type: 'string', description: 'Filtro opcional por descripción o código' },
            },
        },
    },
    {
        name: 'cortes_de_caja',
        description: 'Cortes de caja de una fecha: aperturas por terminal (Z, cajero, supervisor), ventas y operaciones por caja, cancelaciones y cierres.',
        input_schema: {
            type: 'object',
            properties: {
                fecha: { type: 'string', description: 'Fecha YYYY-MM-DD; por default hoy' },
            },
        },
    },
    {
        name: 'recibos',
        description: 'Recibos de mercancía (compras recibidas de proveedores) por rango de fechas, con proveedor, totales y devoluciones.',
        input_schema: {
            type: 'object',
            properties: {
                fechaInicio: { type: 'string', description: 'YYYY-MM-DD' },
                fechaFin: { type: 'string', description: 'YYYY-MM-DD' },
                busqueda: { type: 'string', description: 'Folio, proveedor o RFC (opcional)' },
            },
            required: ['fechaInicio', 'fechaFin'],
        },
    },
    {
        name: 'transferencias',
        description: 'Transferencias de mercancía entre tiendas por rango de fechas: entradas (recibidas) o salidas (enviadas), con tienda origen/destino y montos.',
        input_schema: {
            type: 'object',
            properties: {
                tipo: { type: 'string', enum: ['entradas', 'salidas'] },
                fechaInicio: { type: 'string', description: 'YYYY-MM-DD' },
                fechaFin: { type: 'string', description: 'YYYY-MM-DD' },
            },
            required: ['tipo', 'fechaInicio', 'fechaFin'],
        },
    },
    {
        name: 'facturas',
        description: 'Facturas y documentos por rango de fechas: contado, crédito, notas de crédito, público general (facturas globales de corte) y traslados.',
        input_schema: {
            type: 'object',
            properties: {
                fechaInicio: { type: 'string', description: 'YYYY-MM-DD' },
                fechaFin: { type: 'string', description: 'YYYY-MM-DD' },
                busqueda: { type: 'string', description: 'Folio, total, receptor, RFC o UUID (opcional)' },
            },
            required: ['fechaInicio', 'fechaFin'],
        },
    },
    {
        name: 'devoluciones_venta',
        description: 'Devoluciones de venta por rango de fechas: cliente, motivo, empleado, valor y estado de canje del vale.',
        input_schema: {
            type: 'object',
            properties: {
                fechaInicio: { type: 'string', description: 'YYYY-MM-DD' },
                fechaFin: { type: 'string', description: 'YYYY-MM-DD' },
            },
            required: ['fechaInicio', 'fechaFin'],
        },
    },
    {
        name: 'existencia_articulo',
        description: 'Existencia actual estimada de UN artículo: corte nocturno de inventario + movimientos del día (recibos, ventas, transferencias, devoluciones). Regresa existencia, promedio de venta diaria (PVD) y días de cobertura. Obtén primero el codigoInterno con buscar_articulo_precio.',
        input_schema: {
            type: 'object',
            properties: {
                codigoInterno: { type: 'number' },
            },
            required: ['codigoInterno'],
        },
    },
    {
        name: 'quiebres_inventario',
        description: 'Análisis de inventario al corte nocturno: "quiebres" = artículos agotados con demanda y su venta perdida estimada; "exceso" = sobre-inventario e inventario muerto con su valor inmovilizado.',
        input_schema: {
            type: 'object',
            properties: {
                tipo: { type: 'string', enum: ['quiebres', 'exceso'] },
                dias: { type: 'number', description: 'Rango histórico en días (7-90, default 30; solo aplica a quiebres)' },
            },
            required: ['tipo'],
        },
    },
    {
        name: 'devoluciones_compra',
        description: 'Devoluciones de compra al proveedor: pendientes (mercancía apartada por devolver) o historial por rango de fechas.',
        input_schema: {
            type: 'object',
            properties: {
                tipo: { type: 'string', enum: ['pendientes', 'historial'] },
                fechaInicio: { type: 'string', description: 'YYYY-MM-DD (solo historial)' },
                fechaFin: { type: 'string', description: 'YYYY-MM-DD (solo historial)' },
            },
            required: ['tipo'],
        },
        // Marca el final del prefijo cacheable (herramientas + system) para
        // no repagar esos tokens en cada iteración del loop ni en cada pregunta
        cache_control: { type: 'ephemeral' },
    },
];

type Entrada = Record<string, unknown>;
const s = (v: unknown) => encodeURIComponent(String(v ?? ''));

// Cada herramienta es una URL del propio portal (la cookie de sesión acota la tienda)
function urlDeHerramienta(nombre: string, entrada: Entrada): string | null {
    switch (nombre) {
        case 'resumen_del_dia':
            return '/api/dashboard/principal';
        case 'buscar_articulo_precio': {
            const b = String(entrada.busqueda ?? '').trim();
            if (/^\d{6,}$/.test(b)) return `/api/articulos?codigoBarras=${s(b)}&pageSize=10`;
            return `/api/articulos?busqueda=${s(b)}&pageSize=10&estado=activos`;
        }
        case 'detalle_articulo':
            return `/api/articulos/${Number(entrada.codigoInterno) || 0}`;
        case 'ofertas':
            return `/api/ofertas?tipo=${s(entrada.tipo)}${entrada.busqueda ? `&busqueda=${s(entrada.busqueda)}` : ''}`;
        case 'precios_bascula':
            return `/api/articulos/basculas${entrada.busqueda ? `?busqueda=${s(entrada.busqueda)}` : ''}`;
        case 'cortes_de_caja':
            return `/api/operaciones?fecha=${s(entrada.fecha || HOY())}`;
        case 'recibos':
            return `/api/recibos?fechaInicio=${s(entrada.fechaInicio)}&fechaFin=${s(entrada.fechaFin)}${entrada.busqueda ? `&busqueda=${s(entrada.busqueda)}` : ''}`;
        case 'transferencias':
            return `/api/transferencias?tipo=${s(entrada.tipo)}&fechaInicio=${s(entrada.fechaInicio)}&fechaFin=${s(entrada.fechaFin)}`;
        case 'facturas':
            return `/api/facturas?fechaInicio=${s(entrada.fechaInicio)}&fechaFin=${s(entrada.fechaFin)}${entrada.busqueda ? `&busqueda=${s(entrada.busqueda)}` : ''}`;
        case 'devoluciones_venta':
            return `/api/devoluciones?fechaInicio=${s(entrada.fechaInicio)}&fechaFin=${s(entrada.fechaFin)}`;
        case 'devoluciones_compra':
            return `/api/devoluciones-compra?tipo=${s(entrada.tipo)}${entrada.fechaInicio ? `&fechaInicio=${s(entrada.fechaInicio)}&fechaFin=${s(entrada.fechaFin)}` : ''}`;
        case 'existencia_articulo':
            return `/api/inventarios/existencia?codigoInterno=${Number(entrada.codigoInterno) || 0}`;
        case 'quiebres_inventario':
            return `/api/inventarios/quiebres?tipo=${s(entrada.tipo)}${entrada.dias ? `&dias=${Number(entrada.dias) || 30}` : ''}`;
        default:
            return null;
    }
}

// Compacta el resultado para el modelo: recorta listas largas y limita el tamaño
function compactar(valor: unknown, limiteLista = 25): unknown {
    if (Array.isArray(valor)) {
        const recortado = valor.slice(0, limiteLista).map(v => compactar(v, limiteLista));
        if (valor.length > limiteLista) {
            recortado.push({ _nota: `...${valor.length - limiteLista} elementos más omitidos` } as never);
        }
        return recortado;
    }
    if (valor && typeof valor === 'object') {
        const salida: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(valor)) {
            salida[k] = compactar(v, limiteLista);
        }
        return salida;
    }
    return valor;
}

// Respuesta en streaming NDJSON (una línea JSON por evento):
//   {t:'delta', texto}  — fragmento de texto de la respuesta en curso
//   {t:'reinicio'}      — descartar el borrador: viene una ronda de herramientas
//   {t:'estado', texto} — qué está consultando el agente en este momento
//   {t:'fin'}           — respuesta completa
//   {t:'error', error}  — falla a media respuesta
// Los errores previos al stream (401/400/429/503) salen como JSON normal.
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

    const origen = new URL(request.url).origin;
    const cookie = request.headers.get('cookie') ?? '';

    const ejecutarHerramienta = async (nombre: string, entrada: Entrada): Promise<string> => {
        const ruta = urlDeHerramienta(nombre, entrada);
        if (!ruta) return JSON.stringify({ error: 'Herramienta desconocida' });
        try {
            const res = await fetch(`${origen}${ruta}`, { headers: { cookie } });
            const json = await res.json();
            if (!res.ok) return JSON.stringify({ error: json.error ?? `HTTP ${res.status}` });
            return JSON.stringify(compactar(json)).slice(0, MAX_RESULTADO);
        } catch {
            return JSON.stringify({ error: 'No fue posible consultar los datos de la tienda' });
        }
    };

    const sistema = `Eres Kesito, el agente inteligente del portal KYK Server Web de la tienda ${session.tienda}.
Hoy es ${HOY()}.

SOLO respondes con la información disponible en este portal, consultándola con tus herramientas: precios y ofertas de artículos, precios de báscula, resumen del día, cortes de caja, facturas, recibos de mercancía, transferencias, devoluciones de venta y de compra, existencias de artículos y análisis de inventario (quiebres y sobre-inventario) — siempre de la tienda ${session.tienda}.

Sobre existencias: la cifra es estimada (corte nocturno + movimientos del día); si la pregunta es de existencia, menciona los días de cobertura cuando ayude ("alcanza para ~N días").

Reglas:
- Usa las herramientas para obtener datos reales; NUNCA inventes cifras ni respondas de memoria.
- Si la pregunta está fuera de ese alcance (temas generales, otras tiendas, consultas SQL libres, opiniones, tareas ajenas al portal), responde amablemente que solo puedes ayudar con la información de este portal.
- Responde en español, breve y directo. Montos con formato $#,##0.00.
- En listas muestra máximo 10 renglones y ofrece afinar la búsqueda si hay más.`;

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
            // Si el cliente corta la conexión se deja de emitir y el loop se corta
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
                        // system como bloque para que el prefijo herramientas+system se cachee
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

                    // El texto emitido antes de las herramientas era preámbulo: se descarta
                    emitir({ t: 'reinicio' });
                    mensajes.push({ role: 'assistant', content: resultado.content });
                    const resultados: Anthropic.ToolResultBlockParam[] = [];
                    for (const uso of usosDeHerramienta) {
                        emitir({
                            t: 'estado',
                            texto: `Consultando ${ETIQUETA_HERRAMIENTA[uso.name] ?? 'datos de la tienda'}...`,
                        });
                        resultados.push({
                            type: 'tool_result',
                            tool_use_id: uso.id,
                            content: await ejecutarHerramienta(uso.name, uso.input as Entrada),
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
                console.error('Error en Kesito del portal:', error);
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
