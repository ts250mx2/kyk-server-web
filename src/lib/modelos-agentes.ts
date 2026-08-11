// Catálogo de modelos seleccionables en los chats de los agentes (KESITO y
// A.D.iA.N). Archivo puro (sin SDKs): lo importan el selector del cliente y
// las rutas del servidor, que validan contra esta misma lista. Si el modelo
// pedido no está permitido, el servidor cae al default del .env (AGENTES_MODELO).

export interface ModeloAgente {
    id: string
    etiqueta: string
}

export const MODELOS_AGENTES: ModeloAgente[] = [
    { id: "claude-opus-5", etiqueta: "Opus 5" },
    { id: "claude-sonnet-5", etiqueta: "Sonnet 5" },
    { id: "gpt-5.6-sol", etiqueta: "GPT-5.6 Sol" },
    { id: "gpt-5.6-terra", etiqueta: "GPT-5.6 Terra" },
]

export function esModeloPermitido(id: unknown): id is string {
    return typeof id === "string" && MODELOS_AGENTES.some(m => m.id === id)
}

// La elección persiste por navegador y la comparten ambos agentes (panel y
// consola Jarvis); se lee al momento de enviar cada pregunta.
export const CLAVE_MODELO_AGENTE = "agente-modelo"

export function modeloElegido(): string {
    if (typeof window === "undefined") return MODELOS_AGENTES[0].id
    try {
        const guardado = localStorage.getItem(CLAVE_MODELO_AGENTE)
        return guardado && MODELOS_AGENTES.some(m => m.id === guardado)
            ? guardado
            : MODELOS_AGENTES[0].id
    } catch {
        return MODELOS_AGENTES[0].id
    }
}

export function guardarModelo(id: string) {
    try { localStorage.setItem(CLAVE_MODELO_AGENTE, id) } catch { /* sin persistencia */ }
}
