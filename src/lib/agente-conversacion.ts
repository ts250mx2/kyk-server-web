// Store de conversaciones de los agentes a nivel módulo (cliente). La consulta
// en streaming vive AQUÍ y no en el componente: si el usuario cambia de canal o
// de pantalla a media pregunta, el panel se desmonta pero la respuesta sigue
// llegando en segundo plano; al regresar, el panel se resuscribe y la encuentra
// terminada (o todavía en curso, con su borrador en vivo). Los mensajes también
// se respaldan en sessionStorage para sobrevivir recargas de la pestaña.

import { consultarAgente, SesionExpiradaError, type MensajeAgente } from "./agente-cliente"

export interface EstadoConversacion {
    mensajes: MensajeAgente[]
    /** Hay una pregunta en curso (aunque el panel no esté montado) */
    cargando: boolean
    /** Texto en vivo de la respuesta en curso */
    borrador: string
    /** Qué está consultando el agente ("Consultando precios...") */
    fase: string
    error: string
    /** La sesión venció a media consulta: el panel redirige al login */
    sesionExpirada: boolean
}

export interface ResultadoPregunta {
    texto: string
    ok: boolean
    sesionExpirada?: boolean
}

// El servidor corta a los 120 s (maxDuration); el cliente aborta un poco después
const TIEMPO_MAXIMO_MS = 125_000
const RAZON_CANCELADO = "cancelado"

export const ESTADO_CONVERSACION_VACIO: EstadoConversacion = {
    mensajes: [],
    cargando: false,
    borrador: "",
    fase: "",
    error: "",
    sesionExpirada: false,
}

const estados = new Map<string, EstadoConversacion>()
const suscriptores = new Map<string, Set<() => void>>()
const controladores = new Map<string, AbortController>()

function mensajesGuardados(clave: string): MensajeAgente[] {
    if (typeof window === "undefined") return []
    try {
        const guardado = sessionStorage.getItem(clave)
        const lista = guardado ? JSON.parse(guardado) : null
        return Array.isArray(lista) ? lista : []
    } catch {
        return []
    }
}

/** Snapshot estable para useSyncExternalStore (se rehidrata de sessionStorage) */
export function estadoConversacion(clave: string): EstadoConversacion {
    let estado = estados.get(clave)
    if (!estado) {
        estado = { ...ESTADO_CONVERSACION_VACIO, mensajes: mensajesGuardados(clave) }
        estados.set(clave, estado)
    }
    return estado
}

export function suscribirConversacion(clave: string, avisar: () => void): () => void {
    let lista = suscriptores.get(clave)
    if (!lista) {
        lista = new Set()
        suscriptores.set(clave, lista)
    }
    lista.add(avisar)
    return () => { lista.delete(avisar) }
}

function actualizar(clave: string, cambios: Partial<EstadoConversacion>) {
    const nuevo = { ...estadoConversacion(clave), ...cambios }
    estados.set(clave, nuevo)
    if (cambios.mensajes) {
        try { sessionStorage.setItem(clave, JSON.stringify(nuevo.mensajes)) } catch { /* sin persistencia */ }
    }
    for (const avisar of suscriptores.get(clave) ?? []) avisar()
}

/** Suma un mensaje a la conversación (lo usan las burbujas de los paneles) */
export function agregarMensaje(clave: string, mensaje: MensajeAgente) {
    actualizar(clave, { mensajes: [...estadoConversacion(clave).mensajes, mensaje] })
}

/** Corta la pregunta en curso sin marcar error (botón Detener de la consola) */
export function cancelarPregunta(clave: string) {
    controladores.get(clave)?.abort(RAZON_CANCELADO)
}

export function reiniciarConversacion(clave: string) {
    cancelarPregunta(clave)
    estados.set(clave, { ...ESTADO_CONVERSACION_VACIO })
    try { sessionStorage.removeItem(clave) } catch { /* sin persistencia */ }
    for (const avisar of suscriptores.get(clave) ?? []) avisar()
}

/**
 * Lanza la pregunta al agente y actualiza el store conforme llega la respuesta.
 * Regresa el texto final (o null si fue cancelada / ya había una en curso);
 * quien la inició decide si además la lee en voz alta.
 */
export async function preguntarAgente(
    clave: string,
    endpoint: string,
    pregunta: string,
    modelo?: string
): Promise<ResultadoPregunta | null> {
    const actual = estadoConversacion(clave)
    if (actual.cargando) return null

    const historial = actual.mensajes
    actualizar(clave, {
        mensajes: [...historial, { rol: "user", texto: pregunta }],
        cargando: true,
        borrador: "",
        fase: "",
        error: "",
        sesionExpirada: false,
    })

    const controlador = new AbortController()
    controladores.set(clave, controlador)
    const limite = setTimeout(() => controlador.abort(), TIEMPO_MAXIMO_MS)

    try {
        const respuesta = await consultarAgente(endpoint, pregunta, historial, {
            onDelta: acumulado => actualizar(clave, { borrador: acumulado, fase: "" }),
            onReinicio: () => actualizar(clave, { borrador: "" }),
            onEstado: texto => actualizar(clave, { fase: texto }),
        }, controlador.signal, modelo)

        const textoFinal = respuesta || "No pude completar la consulta, intenta preguntarlo de otra forma."
        actualizar(clave, { mensajes: [...estadoConversacion(clave).mensajes, { rol: "assistant", texto: textoFinal }] })
        return { texto: textoFinal, ok: true }
    } catch (err: unknown) {
        if (err instanceof SesionExpiradaError) {
            actualizar(clave, { sesionExpirada: true })
            return { texto: "", ok: false, sesionExpirada: true }
        }
        // Cancelación explícita (Detener / nueva conversación): sin error
        if (controlador.signal.aborted && String(controlador.signal.reason ?? "") === RAZON_CANCELADO) {
            return null
        }
        const mensaje = controlador.signal.aborted
            ? "El agente tardó demasiado en responder, intenta de nuevo."
            : err instanceof Error ? err.message : "El agente no pudo responder, intenta de nuevo."
        actualizar(clave, { error: mensaje })
        return { texto: mensaje, ok: false }
    } finally {
        clearTimeout(limite)
        if (controladores.get(clave) === controlador) controladores.delete(clave)
        actualizar(clave, { cargando: false, borrador: "", fase: "" })
    }
}
