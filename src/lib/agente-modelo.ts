import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

// Adaptador de proveedor para los agentes del chat (KESITO y A.D.iA.N).
// El loop de los agentes trabaja SIEMPRE en formato Anthropic (mensajes con
// bloques tool_use/tool_result); aquí se enruta cada turno al proveedor del
// modelo configurado en AGENTES_MODELO: claude-* → Anthropic, gpt-*/o* → OpenAI.
// Para OpenAI se traduce el historial y las herramientas al formato de
// chat.completions (function calling) y la respuesta se regresa de vuelta en
// bloques Anthropic, así que los routes no cambian según el proveedor.

export interface UsoDeHerramienta {
    id: string;
    name: string;
    input: Record<string, unknown>;
}

/** Profundidad de razonamiento (output_config.effort de Anthropic) */
export type EsfuerzoAgente = 'low' | 'medium' | 'high';

export interface TurnoAgente {
    modelo: string;
    maxTokens: number;
    /** Profundidad de razonamiento; si se omite aplica el default del proveedor */
    esfuerzo?: EsfuerzoAgente;
    sistema: string;
    herramientas: Anthropic.Tool[];
    mensajes: Anthropic.MessageParam[];
    /** Recibe cada fragmento de texto conforme el modelo lo va generando */
    alTexto: (delta: string) => void;
    /** Prohíbe usar herramientas en este turno (el cierre cuando se agotan las
     * rondas): las tools siguen DEFINIDAS (Anthropic las exige si el historial
     * trae tool_use y así el prefijo cacheado no cambia) pero tool_choice none
     * obliga a responder con texto. */
    sinHerramientas?: boolean;
}

/** Tokens consumidos en un turno (para la bitácora de consultas) */
export interface UsoTokens {
    entrada: number;
    salida: number;
    cacheLeida: number;
    cacheCreada: number;
}

export interface ResultadoTurno {
    /** Contenido para agregar al historial como mensaje assistant */
    contenido: Anthropic.ContentBlockParam[];
    /** Herramientas que el modelo pidió ejecutar (vacío = respuesta final) */
    usos: UsoDeHerramienta[];
    /** El modelo agotó max_tokens: la respuesta salió cortada */
    truncado: boolean;
    uso: UsoTokens;
    /** Motivo de paro tal como lo reporta el proveedor (end_turn, tool_use, stop, length…) */
    stopReason: string;
}

export function esModeloOpenAI(modelo: string): boolean {
    return /^(gpt-|o\d)/i.test(modelo.trim());
}

/** Nombre de la variable de entorno que falta para usar el modelo, o null si está lista */
export function claveFaltante(modelo: string): string | null {
    if (esModeloOpenAI(modelo)) return process.env.OPENAI_API_KEY ? null : 'OPENAI_API_KEY';
    return process.env.ANTHROPIC_API_KEY ? null : 'ANTHROPIC_API_KEY';
}

/** ¿La conversación desbordó la ventana de contexto del modelo? */
export function esErrorDeContexto(error: unknown): boolean {
    if (error instanceof Anthropic.APIError) return /prompt is too long/i.test(String(error.message));
    if (error instanceof OpenAI.APIError) {
        return error.code === 'context_length_exceeded' || /maximum context length/i.test(String(error.message));
    }
    return false;
}

/** ¿El modelo configurado no existe o la cuenta no tiene acceso a él? */
export function esErrorDeAccesoAlModelo(error: unknown): boolean {
    if (error instanceof OpenAI.APIError) {
        return /does not have access to model|model_not_found/i.test(String(error.message))
            || error.code === 'model_not_found';
    }
    if (error instanceof Anthropic.APIError) {
        return error.status === 404 && /model/i.test(String(error.message));
    }
    return false;
}

export async function correrTurnoAgente(turno: TurnoAgente): Promise<ResultadoTurno> {
    return esModeloOpenAI(turno.modelo) ? turnoOpenAI(turno) : turnoAnthropic(turno);
}

// ---------- Anthropic ----------

// Haiku 4.5 rechaza output_config.effort (400); los demás modelos actuales lo aceptan
function soportaEsfuerzo(modelo: string): boolean {
    return !/haiku/i.test(modelo);
}

async function turnoAnthropic(turno: TurnoAgente): Promise<ResultadoTurno> {
    const anthropic = new Anthropic();
    const streamModelo = anthropic.messages.stream({
        model: turno.modelo,
        max_tokens: turno.maxTokens,
        // system como bloque para que el prefijo herramientas+system se cachee
        system: [{ type: 'text', text: turno.sistema, cache_control: { type: 'ephemeral' } }],
        tools: turno.herramientas,
        ...(turno.sinHerramientas ? { tool_choice: { type: 'none' as const } } : {}),
        ...(turno.esfuerzo && soportaEsfuerzo(turno.modelo)
            ? { output_config: { effort: turno.esfuerzo } }
            : {}),
        messages: turno.mensajes,
    });
    streamModelo.on('text', turno.alTexto);
    const resultado = await streamModelo.finalMessage();

    const usos = resultado.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
        .map(b => ({ id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> }));
    const pidioHerramientas = resultado.stop_reason === 'tool_use' && usos.length > 0;
    return {
        contenido: resultado.content,
        usos: pidioHerramientas ? usos : [],
        truncado: resultado.stop_reason === 'max_tokens',
        uso: {
            entrada: resultado.usage.input_tokens,
            salida: resultado.usage.output_tokens,
            cacheLeida: resultado.usage.cache_read_input_tokens ?? 0,
            cacheCreada: resultado.usage.cache_creation_input_tokens ?? 0,
        },
        stopReason: resultado.stop_reason ?? '',
    };
}

// ---------- OpenAI ----------

// Los gpt-5*/o* son modelos razonadores: gastan tokens "pensando" antes de
// responder, así que se les da margen para que la respuesta no salga truncada.
const MARGEN_RAZONAMIENTO = 4_000;

function esRazonador(modelo: string): boolean {
    return /^(gpt-5|o\d)/i.test(modelo.trim());
}

function entradaJson(texto: string): Record<string, unknown> {
    try {
        const valor = JSON.parse(texto || '{}');
        return valor && typeof valor === 'object' ? (valor as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

function textoDeResultado(contenido: Anthropic.ToolResultBlockParam['content']): string {
    if (typeof contenido === 'string') return contenido;
    if (Array.isArray(contenido)) {
        return contenido.map(b => (b.type === 'text' ? b.text : '')).join('');
    }
    return '';
}

// Traduce el historial en formato Anthropic al formato de chat.completions:
// tool_use → assistant.tool_calls y tool_result → mensajes con rol "tool"
function aMensajesOpenAI(
    sistema: string,
    mensajes: Anthropic.MessageParam[]
): OpenAI.Chat.ChatCompletionMessageParam[] {
    const salida: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: 'system', content: sistema }];
    for (const mensaje of mensajes) {
        if (typeof mensaje.content === 'string') {
            salida.push({ role: mensaje.role, content: mensaje.content });
            continue;
        }
        if (mensaje.role === 'assistant') {
            const texto = mensaje.content
                .map(b => (b.type === 'text' ? b.text : ''))
                .join('');
            const llamadas = mensaje.content
                .filter((b): b is Anthropic.ToolUseBlockParam => b.type === 'tool_use')
                .map(b => ({
                    id: b.id,
                    type: 'function' as const,
                    function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
                }));
            salida.push({
                role: 'assistant',
                content: texto || null,
                ...(llamadas.length > 0 ? { tool_calls: llamadas } : {}),
            });
            continue;
        }
        for (const bloque of mensaje.content) {
            if (bloque.type === 'tool_result') {
                salida.push({
                    role: 'tool',
                    tool_call_id: bloque.tool_use_id,
                    content: textoDeResultado(bloque.content),
                });
            } else if (bloque.type === 'text') {
                salida.push({ role: 'user', content: bloque.text });
            }
        }
    }
    return salida;
}

async function turnoOpenAI(turno: TurnoAgente): Promise<ResultadoTurno> {
    const openai = new OpenAI();
    // cache_control es de Anthropic: aquí solo viajan nombre/descripción/schema
    const herramientas: OpenAI.Chat.ChatCompletionTool[] = turno.herramientas.map(h => ({
        type: 'function',
        function: {
            name: h.name,
            description: h.description ?? '',
            parameters: h.input_schema as Record<string, unknown>,
        },
    }));

    const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
        model: turno.modelo,
        max_completion_tokens: turno.maxTokens + (esRazonador(turno.modelo) ? MARGEN_RAZONAMIENTO : 0),
        messages: aMensajesOpenAI(turno.sistema, turno.mensajes),
        ...(herramientas.length > 0 ? { tools: herramientas } : {}),
        ...(turno.sinHerramientas && herramientas.length > 0 ? { tool_choice: 'none' as const } : {}),
        stream: true,
        // El último pedazo trae el consumo de tokens (para la bitácora)
        stream_options: { include_usage: true },
    };
    // Los gpt-5.6* en chat.completions no aceptan function tools con el
    // razonamiento activo: la API exige reasoning_effort 'none' (400 si no).
    // La alternativa sería migrar a /v1/responses; por ahora se sacrifica el
    // razonamiento cuando hay herramientas.
    if (/^gpt-5\.6/i.test(turno.modelo.trim()) && herramientas.length > 0) {
        (params as unknown as Record<string, unknown>).reasoning_effort = 'none';
    }
    const stream = await openai.chat.completions.create(params);

    let texto = '';
    let truncado = false;
    let stopReason = '';
    let uso: UsoTokens = { entrada: 0, salida: 0, cacheLeida: 0, cacheCreada: 0 };
    const llamadas = new Map<number, { id: string; nombre: string; argumentos: string }>();
    for await (const pedazo of stream) {
        if (pedazo.usage) {
            uso = {
                entrada: pedazo.usage.prompt_tokens,
                salida: pedazo.usage.completion_tokens,
                cacheLeida: pedazo.usage.prompt_tokens_details?.cached_tokens ?? 0,
                cacheCreada: 0,
            };
        }
        const eleccion = pedazo.choices[0];
        if (eleccion?.finish_reason) stopReason = eleccion.finish_reason;
        if (eleccion?.finish_reason === 'length') truncado = true;
        const delta = eleccion?.delta;
        if (!delta) continue;
        if (delta.content) {
            texto += delta.content;
            turno.alTexto(delta.content);
        }
        for (const tc of delta.tool_calls ?? []) {
            const acumulado = llamadas.get(tc.index) ?? { id: '', nombre: '', argumentos: '' };
            if (tc.id) acumulado.id = tc.id;
            if (tc.function?.name) acumulado.nombre = tc.function.name;
            if (tc.function?.arguments) acumulado.argumentos += tc.function.arguments;
            llamadas.set(tc.index, acumulado);
        }
    }

    const usos: UsoDeHerramienta[] = [...llamadas.values()]
        .filter(l => l.id && l.nombre)
        .map(l => ({ id: l.id, name: l.nombre, input: entradaJson(l.argumentos) }));

    const contenido: Anthropic.ContentBlockParam[] = [];
    if (texto) contenido.push({ type: 'text', text: texto });
    for (const uso of usos) {
        contenido.push({ type: 'tool_use', id: uso.id, name: uso.name, input: uso.input });
    }
    // Sin texto ni herramientas (p. ej. todo se fue en razonamiento): bloque
    // vacío para que el historial siga siendo válido si el loop continúa
    if (contenido.length === 0) contenido.push({ type: 'text', text: '' });
    return { contenido, usos, truncado, uso, stopReason };
}
