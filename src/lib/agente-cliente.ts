// Cliente streaming de los agentes del portal (Kesito, A.D.iA.N): consume el
// protocolo NDJSON de sus rutas ({t: delta|reinicio|estado|fin|error}) y
// regresa el texto final. Lo comparten el panel de chat y la consola Jarvis.

export interface MensajeAgente {
    rol: "user" | "assistant"
    texto: string
}

export interface EventosAgente {
    /** Texto acumulado de la respuesta en curso (ya con el delta aplicado) */
    onDelta?: (acumulado: string) => void
    /** Descartar el borrador: viene una ronda de herramientas */
    onReinicio?: () => void
    /** Qué está consultando el agente en este momento */
    onEstado?: (texto: string) => void
}

/** La sesión venció: el que llama decide cómo mandar al login. */
export class SesionExpiradaError extends Error {
    constructor() { super("Sesión expirada") }
}

export async function consultarAgente(
    endpoint: string,
    pregunta: string,
    historial: MensajeAgente[],
    eventos: EventosAgente,
    signal: AbortSignal,
    modelo?: string
): Promise<string> {
    const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mensaje: pregunta, historial, ...(modelo ? { modelo } : {}) }),
        signal,
    })
    if (res.status === 401) throw new SesionExpiradaError()
    if (!res.ok || !res.body) {
        const json = await res.json().catch(() => null)
        throw new Error(json?.error || "El agente no pudo responder")
    }

    let acumulado = ""
    let completo = false
    let fallo = ""

    const procesar = (linea: string) => {
        if (!linea.trim()) return
        let evento: { t?: string; texto?: string; error?: string }
        try { evento = JSON.parse(linea) } catch { return }
        if (evento.t === "delta") {
            acumulado += evento.texto ?? ""
            eventos.onDelta?.(acumulado)
        } else if (evento.t === "reinicio") {
            acumulado = ""
            eventos.onReinicio?.()
        } else if (evento.t === "estado") {
            eventos.onEstado?.(evento.texto ?? "")
        } else if (evento.t === "fin") {
            completo = true
        } else if (evento.t === "error") {
            fallo = evento.error || "El agente no pudo responder, intenta de nuevo."
        }
    }

    // NDJSON: los eventos llegan como líneas JSON conforme el agente avanza
    const lector = res.body.getReader()
    const decodificador = new TextDecoder()
    let pendiente = ""
    for (;;) {
        const { done, value } = await lector.read()
        if (done) break
        pendiente += decodificador.decode(value, { stream: true })
        const lineas = pendiente.split("\n")
        pendiente = lineas.pop() ?? ""
        lineas.forEach(procesar)
    }
    procesar(pendiente)

    if (fallo) throw new Error(fallo)
    const respuesta = acumulado.trim()
    if (!completo && !respuesta) throw new Error("Se cortó la conexión con el agente, intenta de nuevo.")
    return respuesta
}
