// Utilerías de voz compartidas por el chat de agentes y la consola Jarvis:
// reconocimiento (Web Speech API, es-MX) y síntesis con voces en español,
// prefiriendo las naturales/neuronales. Nada sale a servicios externos.

export interface EventoReconocimiento {
    resultIndex: number
    results: { length: number; [i: number]: { isFinal: boolean; 0: { transcript: string } } }
}

export interface ReconocimientoVoz {
    lang: string
    continuous: boolean
    interimResults: boolean
    maxAlternatives: number
    onstart: (() => void) | null
    onresult: ((e: EventoReconocimiento) => void) | null
    onerror: ((e: { error?: string }) => void) | null
    onend: (() => void) | null
    start: () => void
    stop: () => void
}

export function obtenerReconocimiento(): (new () => ReconocimientoVoz) | null {
    if (typeof window === "undefined") return null
    const w = window as unknown as Record<string, unknown>
    return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => ReconocimientoVoz) | null
}

export function errorVoz(codigo: string): string {
    switch (codigo) {
        case "not-allowed":
        case "service-not-allowed":
            return "Micrófono bloqueado. Toca el candado 🔒 junto a la URL → Micrófono → Permitir, y recarga."
        case "no-speech": return "No te escuché. Acércate al micrófono e intenta de nuevo."
        case "audio-capture": return "No detecté ningún micrófono conectado."
        case "network": return "Sin conexión para el reconocimiento de voz."
        case "aborted": return ""
        default: return `Reconocimiento de voz interrumpido (${codigo || "desconocido"}).`
    }
}

// La voz elegida y la velocidad persisten y se comparten entre agentes
export const CLAVE_VOZ_URI = "jarvis-voz-uri"
export const CLAVE_VOZ_RATE = "jarvis-voz-rate"

// Voces "naturales" (neuronales/de red): Google, Microsoft Natural/Online,
// Apple premium/enhanced, WaveNet… Se descartan las robóticas (SAPI, eSpeak).
const RE_VOZ_NATURAL = /google|natural|neural|online|premium|enhanced|wavenet|siri|eloquence/i

export const esVozEspanol = (v: SpeechSynthesisVoice) => /^es([-_]|$)/i.test(v.lang)
export const esVozNatural = (v: SpeechSynthesisVoice) =>
    RE_VOZ_NATURAL.test(v.name) || RE_VOZ_NATURAL.test(v.voiceURI)

// Nombre legible (quita prefijos largos del fabricante)
export const nombreVoz = (v: SpeechSynthesisVoice) =>
    v.name.replace(/^Microsoft\s+/i, "").replace(/\s*Online\s*\(Natural\)\s*/i, " (Natural)").trim()

/** Mejor voz disponible: la guardada por el usuario si sigue instalada;
 *  si no, natural de México → LatAm/US → cualquiera en español. */
export function elegirVoz(voces: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
    const espanol = voces.filter(esVozEspanol)
    if (espanol.length === 0) return null

    let guardada: string | null = null
    try { guardada = localStorage.getItem(CLAVE_VOZ_URI) } catch { /* sin persistencia */ }
    const elegidaPorUsuario = guardada ? espanol.find(v => v.voiceURI === guardada) : undefined
    if (elegidaPorUsuario) return elegidaPorUsuario

    const naturales = espanol.filter(esVozNatural)
    const porIdioma = (lista: SpeechSynthesisVoice[]) =>
        lista.find(v => /es[-_]MX/i.test(v.lang))
        ?? lista.find(v => /es[-_](419|US)/i.test(v.lang))
        ?? lista[0]
    return (naturales.length ? porIdioma(naturales) : undefined) ?? porIdioma(espanol) ?? null
}

/** Velocidad de locución guardada (1 si no hay o es inválida). */
export function rateGuardado(): number {
    try {
        const r = parseFloat(localStorage.getItem(CLAVE_VOZ_RATE) || "")
        if (!Number.isNaN(r) && r >= 0.6 && r <= 1.6) return r
    } catch { /* sin persistencia */ }
    return 1
}

// Markdown → texto hablable (mismo recorte que kyk-dashboard)
export function textoHablable(crudo: string): string {
    return crudo
        // La sección de referencias (citas y links, colapsada en pantalla) no se lee
        .replace(/^\s*\[REFERENCIAS\][\s\S]*$/m, " ")
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/`[^`]*`/g, " ")
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/[*_#>|]/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim()
}
