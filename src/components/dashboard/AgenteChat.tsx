"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Mic, MicOff, RotateCcw, Send, Sparkles, Volume2, VolumeX } from "lucide-react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "@/lib/utils"

// Panel genérico de agente conversacional para los canales del chat (Kesito,
// A.D.iA.N...): cliente streaming NDJSON ({t: delta|reinicio|estado|fin|error}),
// markdown ligero en las respuestas y conversación en sessionStorage aislada
// por tienda+usuario. Cada agente lo configura con ConfigAgente.

export interface ConfigAgente {
    nombre: string
    emoji: string
    subtitulo: string
    // Etiqueta del modelo de IA que usa el agente (mantener en sintonía con
    // la constante MODELO de su API route)
    modelo: string
    endpoint: string
    prefijoStorage: string
    acento: "ambar" | "violeta"
    sugerencias: string[]
    vacio: React.ReactNode
    placeholder: string
}

interface MensajeAgente {
    rol: "user" | "assistant"
    texto: string
}

const MAX_MENSAJE = 2000
// El servidor corta a los 120 s (maxDuration); el cliente aborta un poco después
const TIEMPO_MAXIMO_MS = 125_000
// Modo voz activado/desactivado, compartido entre agentes
const CLAVE_VOZ = "agente-voz"

// ── Modo voz (Web Speech API, igual que kyk-dashboard: es-MX, sin servicios externos) ──

interface EventoReconocimiento {
    resultIndex: number
    results: { length: number; [i: number]: { isFinal: boolean; 0: { transcript: string } } }
}
interface ReconocimientoVoz {
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

function obtenerReconocimiento(): (new () => ReconocimientoVoz) | null {
    if (typeof window === "undefined") return null
    const w = window as unknown as Record<string, unknown>
    return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => ReconocimientoVoz) | null
}

function errorVoz(codigo: string): string {
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

// Voz en español para las respuestas, prefiriendo las naturales/neuronales
const RE_VOZ_NATURAL = /google|natural|neural|online|premium|enhanced|wavenet|siri|eloquence/i
function elegirVoz(voces: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
    const espanol = voces.filter(v => /^es([-_]|$)/i.test(v.lang))
    const naturales = espanol.filter(v => RE_VOZ_NATURAL.test(v.name) || RE_VOZ_NATURAL.test(v.voiceURI))
    const porIdioma = (lista: SpeechSynthesisVoice[]) =>
        lista.find(v => /es[-_]MX/i.test(v.lang))
        ?? lista.find(v => /es[-_](419|US)/i.test(v.lang))
        ?? lista[0]
    return (naturales.length ? porIdioma(naturales) : undefined) ?? porIdioma(espanol) ?? null
}

// Markdown → texto hablable (mismo recorte que kyk-dashboard)
function textoHablable(crudo: string): string {
    return crudo
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/`[^`]*`/g, " ")
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/[*_#>|]/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim()
}

// Clases por acento (literales completas para el JIT de Tailwind)
const ACENTOS = {
    ambar: {
        cabecera: "bg-amber-500/[0.06]",
        icono: "bg-amber-400/15 border-amber-400/30",
        chispa: "text-amber-400",
        sub: "text-amber-400/70",
        hoverBoton: "hover:text-amber-300 hover:border-amber-500/30",
        sugerencia: "hover:bg-amber-500/10 hover:border-amber-500/30 hover:text-amber-200",
        foco: "focus:ring-amber-400/25 focus:border-amber-400/60",
        enviar: "bg-amber-400",
        punto: "bg-amber-400",
        estado: "text-amber-200/80",
        etiqueta: "text-amber-400/80",
        vozActiva: "bg-amber-500/15 border-amber-500/30 text-amber-300",
    },
    violeta: {
        cabecera: "bg-violet-500/[0.06]",
        icono: "bg-violet-400/15 border-violet-400/30",
        chispa: "text-violet-400",
        sub: "text-violet-400/70",
        hoverBoton: "hover:text-violet-300 hover:border-violet-500/30",
        sugerencia: "hover:bg-violet-500/10 hover:border-violet-500/30 hover:text-violet-200",
        foco: "focus:ring-violet-400/25 focus:border-violet-400/60",
        enviar: "bg-violet-400",
        punto: "bg-violet-400",
        estado: "text-violet-200/80",
        etiqueta: "text-violet-400/80",
        vozActiva: "bg-violet-500/15 border-violet-500/30 text-violet-300",
    },
} as const

// La conversación previa vive en sessionStorage: sobrevive recargas y se
// pierde al cerrar la pestaña. En SSR no hay sessionStorage: inicia vacía.
function conversacionGuardada(clave: string): MensajeAgente[] {
    if (typeof window === "undefined") return []
    try {
        const guardado = sessionStorage.getItem(clave)
        const lista = guardado ? JSON.parse(guardado) : null
        return Array.isArray(lista) ? lista : []
    } catch {
        return []
    }
}

// Las respuestas del agente traen markdown ligero (negritas, listas, tablas).
// react-markdown no interpreta HTML crudo, así que no hay riesgo de XSS.
function crearComponentesMarkdown(acento: "ambar" | "violeta"): Components {
    const esVioleta = acento === "violeta"
    return {
        p: ({ children }) => <p className="text-[13px] font-medium text-slate-100 break-words">{children}</p>,
        strong: ({ children }) => <strong className="font-black text-white">{children}</strong>,
        em: ({ children }) => <em className="italic text-slate-200">{children}</em>,
        ul: ({ children }) => <ul className="list-disc pl-4 space-y-0.5 text-[13px] font-medium text-slate-100">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-4 space-y-0.5 text-[13px] font-medium text-slate-100">{children}</ol>,
        li: ({ children }) => <li className="break-words">{children}</li>,
        code: ({ children }) => (
            <code className={cn("px-1 py-0.5 rounded bg-white/[0.08] text-[12px]", esVioleta ? "text-violet-200" : "text-amber-200")}>
                {children}
            </code>
        ),
        a: ({ href, children }) => (
            <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className={cn("underline", esVioleta ? "text-violet-300" : "text-amber-300")}
            >
                {children}
            </a>
        ),
        h1: ({ children }) => <p className="text-[13px] font-black text-white uppercase tracking-wide">{children}</p>,
        h2: ({ children }) => <p className="text-[13px] font-black text-white uppercase tracking-wide">{children}</p>,
        h3: ({ children }) => <p className="text-[13px] font-black text-white">{children}</p>,
        hr: () => <hr className="border-white/10" />,
        blockquote: ({ children }) => (
            <blockquote className={cn("border-l-2 pl-2 text-slate-300", esVioleta ? "border-violet-400/40" : "border-amber-400/40")}>
                {children}
            </blockquote>
        ),
        table: ({ children }) => (
            <div className="overflow-x-auto">
                <table className="text-[12px] border-collapse">{children}</table>
            </div>
        ),
        th: ({ children }) => (
            <th className={cn(
                "text-left font-black uppercase tracking-wider text-[10px] px-2 py-1 border-b border-white/15 whitespace-nowrap",
                esVioleta ? "text-violet-300/80" : "text-amber-300/80"
            )}>
                {children}
            </th>
        ),
        td: ({ children }) => <td className="px-2 py-1 border-b border-white/[0.06] text-slate-200">{children}</td>,
    }
}

function BurbujaAgente({ texto, nombre, acento, componentes }: {
    texto: string
    nombre: string
    acento: "ambar" | "violeta"
    componentes: Components
}) {
    return (
        <div className="max-w-[78%]">
            <p className={cn("text-[10px] font-black tracking-wider mb-0.5 px-1", ACENTOS[acento].etiqueta)}>
                {nombre}
            </p>
            <div className="rounded-2xl rounded-bl-md px-3.5 py-2.5 border bg-white/[0.05] border-white/10 space-y-1.5">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={componentes}>
                    {texto}
                </ReactMarkdown>
            </div>
        </div>
    )
}

export function AgenteChat({ claveSesion, config }: { claveSesion: string; config: ConfigAgente }) {
    const router = useRouter()
    const acento = ACENTOS[config.acento]
    const componentesMarkdown = crearComponentesMarkdown(config.acento)
    const claveStorage = `${config.prefijoStorage}-${claveSesion}`
    const [mensajes, setMensajes] = useState<MensajeAgente[]>(() => conversacionGuardada(claveStorage))
    const [texto, setTexto] = useState("")
    const [cargando, setCargando] = useState(false)
    const [borrador, setBorrador] = useState("")
    const [estadoAgente, setEstadoAgente] = useState("")
    const [error, setError] = useState("")

    // Modo voz: dictado (STT) + respuestas habladas (TTS). El toggle persiste
    // en localStorage; el panel solo se monta en el cliente, sin riesgo de SSR.
    const [vozActiva, setVozActiva] = useState(() => {
        if (typeof window === "undefined") return false
        try { return localStorage.getItem(CLAVE_VOZ) === "1" } catch { return false }
    })
    const [escuchando, setEscuchando] = useState(false)
    const [soporteVoz] = useState(() => Boolean(obtenerReconocimiento()))

    const contenedorRef = useRef<HTMLDivElement>(null)
    const entradaRef = useRef<HTMLTextAreaElement>(null)
    const abortRef = useRef<AbortController | null>(null)
    const reconocimientoRef = useRef<ReconocimientoVoz | null>(null)
    const escuchandoRef = useRef(false)
    const finalVozRef = useRef("")
    const vozActivaRef = useRef(vozActiva)
    const vozRespuestaRef = useRef<SpeechSynthesisVoice | null>(null)
    // Si la última pregunta llegó dictada, al terminar de hablar vuelve a escuchar
    const porVozRef = useRef(false)
    // Refs a las versiones más recientes (evita cierres obsoletos en onend/onresult)
    const enviarRef = useRef<(sugerencia?: string, porVoz?: boolean) => void>(() => { })
    const escucharRef = useRef<() => void>(() => { })

    useEffect(() => { vozActivaRef.current = vozActiva }, [vozActiva])

    // Voz en español para leer respuestas (Chrome dispara la lista vacía primero)
    useEffect(() => {
        if (typeof window === "undefined" || !("speechSynthesis" in window)) return
        const cargar = () => {
            const voces = window.speechSynthesis.getVoices()
            if (voces.length) vozRespuestaRef.current = elegirVoz(voces)
        }
        cargar()
        window.speechSynthesis.onvoiceschanged = cargar
        return () => {
            try { window.speechSynthesis.onvoiceschanged = null } catch { /* limpieza opcional */ }
        }
    }, [])

    useEffect(() => {
        try {
            sessionStorage.setItem(claveStorage, JSON.stringify(mensajes))
        } catch { /* sin persistencia el chat sigue funcionando */ }
    }, [claveStorage, mensajes])

    // Limpia conversaciones de otras sesiones que hayan quedado en esta pestaña
    useEffect(() => {
        try {
            for (const k of Object.keys(sessionStorage)) {
                if (k.startsWith(config.prefijoStorage) && k !== claveStorage) sessionStorage.removeItem(k)
            }
        } catch { /* limpieza opcional */ }
    }, [config.prefijoStorage, claveStorage])

    // Auto-scroll al fondo con cada mensaje y mientras el agente responde
    useEffect(() => {
        const el = contenedorRef.current
        if (el) el.scrollTop = el.scrollHeight
    }, [mensajes, cargando, borrador, estadoAgente])

    // Foco al entrar al canal; al salir se aborta todo (consulta, micrófono, voz)
    useEffect(() => {
        entradaRef.current?.focus()
        return () => {
            abortRef.current?.abort()
            try { reconocimientoRef.current?.stop() } catch { /* ya detenido */ }
            try { window.speechSynthesis?.cancel() } catch { /* sin síntesis */ }
        }
    }, [])

    // ── Dictado por voz (es-MX): con el modo voz activo, el silencio envía solo ──
    const iniciarEscucha = () => {
        const SR = obtenerReconocimiento()
        if (!SR) {
            setError("Este navegador no soporta el reconocimiento de voz — usa Chrome o Edge.")
            return
        }
        if (!window.isSecureContext) {
            setError("El micrófono necesita HTTPS o localhost.")
            return
        }
        if (escuchandoRef.current) return
        try { window.speechSynthesis?.cancel() } catch { /* barge-in */ }
        setError("")

        const rec = new SR()
        rec.lang = "es-MX"
        rec.interimResults = true
        rec.continuous = false
        rec.maxAlternatives = 1
        finalVozRef.current = ""

        rec.onstart = () => setEscuchando(true)
        rec.onresult = e => {
            let parcial = ""
            let final = ""
            for (let i = e.resultIndex; i < e.results.length; i++) {
                const t = e.results[i][0].transcript
                if (e.results[i].isFinal) final += t
                else parcial += t
            }
            if (final) finalVozRef.current += final
            setTexto(finalVozRef.current + parcial)
        }
        rec.onerror = e => {
            const mensaje = errorVoz(String(e.error ?? ""))
            if (mensaje) setError(mensaje)
        }
        rec.onend = () => {
            escuchandoRef.current = false
            reconocimientoRef.current = null
            setEscuchando(false)
            const dicho = finalVozRef.current.trim()
            // Con el modo voz activo, la pausa envía la pregunta sola
            if (dicho && vozActivaRef.current) enviarRef.current(dicho, true)
        }

        reconocimientoRef.current = rec
        escuchandoRef.current = true
        try {
            rec.start()
        } catch {
            escuchandoRef.current = false
            setEscuchando(false)
        }
    }

    const detenerEscucha = () => {
        try { reconocimientoRef.current?.stop() } catch { /* ya detenido */ }
    }

    // Lee la respuesta en voz alta (voz natural en español, hasta 4k caracteres)
    const hablar = (textoRespuesta: string) => {
        if (typeof window === "undefined" || !("speechSynthesis" in window)) return
        const limpio = textoHablable(textoRespuesta)
        if (!limpio) return
        try {
            window.speechSynthesis.cancel()
            const locucion = new SpeechSynthesisUtterance(limpio.slice(0, 4000))
            const voz = vozRespuestaRef.current
            if (voz) { locucion.voice = voz; locucion.lang = voz.lang } else { locucion.lang = "es-MX" }
            locucion.rate = 1
            locucion.pitch = 1
            // Conversación continua manos libres: si la pregunta llegó dictada,
            // al terminar la locución el micrófono se abre otra vez solo
            locucion.onend = () => {
                if (vozActivaRef.current && porVozRef.current) escucharRef.current()
            }
            window.speechSynthesis.speak(locucion)
        } catch { /* sin voz, el texto ya está en pantalla */ }
    }

    const alternarVoz = () => {
        setVozActiva(previo => {
            const nuevo = !previo
            try { localStorage.setItem(CLAVE_VOZ, nuevo ? "1" : "0") } catch { /* sin persistencia */ }
            if (!nuevo) {
                try { window.speechSynthesis?.cancel() } catch { /* sin síntesis */ }
                try { reconocimientoRef.current?.stop() } catch { /* ya detenido */ }
            }
            return nuevo
        })
    }

    const enviar = async (sugerencia?: string, porVoz = false) => {
        const pregunta = (sugerencia ?? texto).trim().slice(0, MAX_MENSAJE)
        if (!pregunta || cargando) return
        porVozRef.current = porVoz

        const historial = mensajes
        setMensajes(prev => [...prev, { rol: "user", texto: pregunta }])
        setTexto("")
        setCargando(true)
        setError("")

        const controlador = new AbortController()
        abortRef.current = controlador
        const limite = setTimeout(() => controlador.abort(), TIEMPO_MAXIMO_MS)

        let acumulado = ""
        let completo = false
        let fallo = ""
        try {
            const res = await fetch(config.endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mensaje: pregunta, historial }),
                signal: controlador.signal,
            })
            if (res.status === 401) { router.push("/login"); return }
            if (!res.ok || !res.body) {
                const json = await res.json().catch(() => null)
                throw new Error(json?.error || "El agente no pudo responder")
            }

            const procesar = (linea: string) => {
                if (!linea.trim()) return
                let evento: { t?: string; texto?: string; error?: string }
                try { evento = JSON.parse(linea) } catch { return }
                if (evento.t === "delta") {
                    acumulado += evento.texto ?? ""
                    setBorrador(acumulado)
                    setEstadoAgente("")
                } else if (evento.t === "reinicio") {
                    acumulado = ""
                    setBorrador("")
                } else if (evento.t === "estado") {
                    setEstadoAgente(evento.texto ?? "")
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
            const textoFinal = respuesta || "No pude completar la consulta, intenta preguntarlo de otra forma."
            setMensajes(prev => [...prev, { rol: "assistant", texto: textoFinal }])
            if (vozActivaRef.current) hablar(textoFinal)
        } catch (err: unknown) {
            if (controlador.signal.aborted) {
                setError("El agente tardó demasiado en responder, intenta de nuevo.")
            } else {
                setError(err instanceof Error ? err.message : "El agente no pudo responder, intenta de nuevo.")
            }
        } finally {
            clearTimeout(limite)
            abortRef.current = null
            setBorrador("")
            setEstadoAgente("")
            setCargando(false)
            entradaRef.current?.focus()
        }
    }

    const reiniciar = () => {
        setMensajes([])
        setError("")
        try { sessionStorage.removeItem(claveStorage) } catch { /* sin persistencia */ }
        entradaRef.current?.focus()
    }

    // Mantiene los refs apuntando a las versiones de este render (los callbacks
    // de voz viven más que el render donde se crearon)
    useEffect(() => {
        enviarRef.current = enviar
        escucharRef.current = iniciarEscucha
    })

    return (
        <div className="flex-1 min-w-0 bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl flex flex-col overflow-hidden">
            {/* Encabezado */}
            <div className={cn("px-5 py-3 border-b border-white/[0.06] flex items-center gap-3", acento.cabecera)}>
                <div className={cn("h-8 w-8 rounded-xl border flex items-center justify-center text-base shrink-0", acento.icono)}>
                    <span aria-hidden>{config.emoji}</span>
                </div>
                <div className="flex-1 min-w-0">
                    {/* Sin `uppercase` CSS: nombres como A.D.iA.N conservan su i minúscula */}
                    <h2 className="text-[13px] font-black text-white tracking-widest leading-none flex items-center gap-1.5">
                        {config.nombre} <Sparkles className={cn("h-3 w-3", acento.chispa)} />
                        <span
                            className="text-[8px] font-black text-slate-400 bg-white/[0.06] border border-white/10 rounded-md px-1.5 py-0.5 tracking-wider normal-case"
                            title="Modelo de IA que responde en este canal"
                        >
                            {config.modelo}
                        </span>
                    </h2>
                    <p className={cn("text-[9px] font-bold uppercase tracking-widest mt-1", acento.sub)}>
                        {config.subtitulo}
                    </p>
                </div>
                <button
                    onClick={alternarVoz}
                    className={cn(
                        "p-2 rounded-xl border transition-all",
                        vozActiva
                            ? acento.vozActiva
                            : cn("bg-white/[0.05] border-white/10 text-slate-400", acento.hoverBoton)
                    )}
                    title={vozActiva
                        ? "Modo voz activo: te respondo hablando y el dictado envía solo (clic para apagar)"
                        : "Activar modo voz: dicta con el micrófono y te respondo hablando"}
                    aria-label="Modo voz"
                >
                    {vozActiva ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
                </button>
                {mensajes.length > 0 && (
                    <button
                        onClick={reiniciar}
                        className={cn("p-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-400 transition-all", acento.hoverBoton)}
                        title="Nueva conversación"
                        aria-label="Nueva conversación"
                    >
                        <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                )}
            </div>

            {/* Conversación */}
            <div ref={contenedorRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                {mensajes.length === 0 && !cargando ? (
                    <div className="h-full flex flex-col items-center justify-center gap-4 px-4 text-center">
                        <span className="text-4xl" aria-hidden>{config.emoji}</span>
                        <p className="text-[12px] font-bold text-slate-500 max-w-md">{config.vacio}</p>
                        <div className="flex flex-wrap justify-center gap-1.5">
                            {config.sugerencias.map(s => (
                                <button
                                    key={s}
                                    onClick={() => enviar(s)}
                                    className={cn(
                                        "px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/10 text-[11px] font-bold text-slate-300 transition-all",
                                        acento.sugerencia
                                    )}
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    mensajes.map((m, i) => (
                        <div key={i} className={cn("flex", m.rol === "user" ? "justify-end" : "justify-start")}>
                            {m.rol === "assistant" ? (
                                <BurbujaAgente texto={m.texto} nombre={config.nombre} acento={config.acento} componentes={componentesMarkdown} />
                            ) : (
                                <div className="max-w-[78%] rounded-2xl rounded-br-md px-3.5 py-2.5 border bg-emerald-500/15 border-emerald-500/25">
                                    <p className="text-[13px] font-medium text-slate-100 whitespace-pre-wrap break-words">
                                        {m.texto}
                                    </p>
                                </div>
                            )}
                        </div>
                    ))
                )}

                {/* Respuesta en curso: texto en vivo o estado de la consulta */}
                {cargando && (
                    borrador ? (
                        <div className="flex justify-start">
                            <BurbujaAgente texto={borrador} nombre={config.nombre} acento={config.acento} componentes={componentesMarkdown} />
                        </div>
                    ) : (
                        <div className="flex justify-start">
                            <div className="rounded-2xl rounded-bl-md px-4 py-3 bg-white/[0.05] border border-white/10 flex items-center gap-2">
                                <span className="flex items-center gap-1.5">
                                    <span className={cn("h-1.5 w-1.5 rounded-full animate-bounce", acento.punto)} />
                                    <span className={cn("h-1.5 w-1.5 rounded-full animate-bounce [animation-delay:150ms]", acento.punto)} />
                                    <span className={cn("h-1.5 w-1.5 rounded-full animate-bounce [animation-delay:300ms]", acento.punto)} />
                                </span>
                                {estadoAgente && (
                                    <span className={cn("text-[11px] font-bold", acento.estado)}>{estadoAgente}</span>
                                )}
                            </div>
                        </div>
                    )
                )}
            </div>

            {error && (
                <p className="px-4 pb-1 text-[10px] font-black text-rose-300 uppercase tracking-wider">{error}</p>
            )}

            {/* Composer */}
            <div className="px-4 py-3 border-t border-white/[0.06] flex items-end gap-2">
                <textarea
                    ref={entradaRef}
                    rows={1}
                    maxLength={MAX_MENSAJE}
                    placeholder={config.placeholder}
                    className={cn(
                        "flex-1 resize-none px-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-medium text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 transition-all max-h-28",
                        acento.foco
                    )}
                    value={texto}
                    onChange={e => setTexto(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault()
                            enviar()
                        }
                    }}
                />
                {soporteVoz && (
                    <button
                        onClick={() => (escuchando ? detenerEscucha() : iniciarEscucha())}
                        disabled={cargando}
                        className={cn(
                            "p-2.5 rounded-xl border transition-all shrink-0 disabled:opacity-40",
                            escuchando
                                ? "bg-rose-500/20 border-rose-400/40 text-rose-300 animate-pulse"
                                : cn("bg-white/[0.03] border-white/10 text-slate-400", acento.hoverBoton)
                        )}
                        title={escuchando ? "Escuchando… (clic para detener)" : "Dictar por voz"}
                        aria-label={escuchando ? "Detener dictado" : "Dictar por voz"}
                    >
                        {escuchando ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                    </button>
                )}
                <button
                    onClick={() => enviar()}
                    disabled={cargando || !texto.trim()}
                    className={cn("p-2.5 rounded-xl text-slate-950 hover:brightness-110 transition-all disabled:opacity-40 shrink-0", acento.enviar)}
                    title="Enviar"
                    aria-label="Enviar mensaje"
                >
                    {cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
            </div>
        </div>
    )
}
