"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, RotateCcw, Send, Sparkles } from "lucide-react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "@/lib/utils"

interface MensajeKesito {
    rol: "user" | "assistant"
    texto: string
}

interface KesitoPanelProps {
    // Identifica tienda+usuario: aísla la conversación guardada en la pestaña
    claveSesion: string
}

const PREFIJO_STORAGE = "kesito-conversacion"
const MAX_MENSAJE = 2000
// El servidor corta a los 120 s (maxDuration); el cliente aborta un poco después
const TIEMPO_MAXIMO_MS = 125_000

const SUGERENCIAS = [
    "¿Cómo van las ventas de hoy?",
    "¿Qué ofertas están vigentes?",
    "¿Qué recibos de mercancía llegaron hoy?",
    "¿Hay devoluciones de compra pendientes?",
]

// La conversación previa vive en sessionStorage: sobrevive recargas y se
// pierde al cerrar la pestaña. En SSR no hay sessionStorage: inicia vacía.
function conversacionGuardada(clave: string): MensajeKesito[] {
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
const componentesMarkdown: Components = {
    p: ({ children }) => <p className="text-[13px] font-medium text-slate-100 break-words">{children}</p>,
    strong: ({ children }) => <strong className="font-black text-white">{children}</strong>,
    em: ({ children }) => <em className="italic text-slate-200">{children}</em>,
    ul: ({ children }) => <ul className="list-disc pl-4 space-y-0.5 text-[13px] font-medium text-slate-100">{children}</ul>,
    ol: ({ children }) => <ol className="list-decimal pl-4 space-y-0.5 text-[13px] font-medium text-slate-100">{children}</ol>,
    li: ({ children }) => <li className="break-words">{children}</li>,
    code: ({ children }) => <code className="px-1 py-0.5 rounded bg-white/[0.08] text-amber-200 text-[12px]">{children}</code>,
    a: ({ href, children }) => (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-amber-300 underline">{children}</a>
    ),
    h1: ({ children }) => <p className="text-[13px] font-black text-white uppercase tracking-wide">{children}</p>,
    h2: ({ children }) => <p className="text-[13px] font-black text-white uppercase tracking-wide">{children}</p>,
    h3: ({ children }) => <p className="text-[13px] font-black text-white">{children}</p>,
    hr: () => <hr className="border-white/10" />,
    blockquote: ({ children }) => (
        <blockquote className="border-l-2 border-amber-400/40 pl-2 text-slate-300">{children}</blockquote>
    ),
    table: ({ children }) => (
        <div className="overflow-x-auto">
            <table className="text-[12px] border-collapse">{children}</table>
        </div>
    ),
    th: ({ children }) => (
        <th className="text-left font-black text-amber-300/80 uppercase tracking-wider text-[10px] px-2 py-1 border-b border-white/15 whitespace-nowrap">
            {children}
        </th>
    ),
    td: ({ children }) => <td className="px-2 py-1 border-b border-white/[0.06] text-slate-200">{children}</td>,
}

function BurbujaKesito({ texto }: { texto: string }) {
    return (
        <div className="max-w-[78%]">
            <p className="text-[10px] font-black text-amber-400/80 uppercase tracking-wider mb-0.5 px-1">
                Kesito
            </p>
            <div className="rounded-2xl rounded-bl-md px-3.5 py-2.5 border bg-white/[0.05] border-white/10 space-y-1.5">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={componentesMarkdown}>
                    {texto}
                </ReactMarkdown>
            </div>
        </div>
    )
}

// Panel de conversación del canal "Kesito" del chat: consulta /api/chat/kesito
// (streaming NDJSON), que solo ve los datos de la tienda de la sesión. La
// conversación es local al navegador, no se guarda en BDKYKPortal.
export function KesitoPanel({ claveSesion }: KesitoPanelProps) {
    const router = useRouter()
    const claveStorage = `${PREFIJO_STORAGE}-${claveSesion}`
    const [mensajes, setMensajes] = useState<MensajeKesito[]>(() => conversacionGuardada(claveStorage))
    const [texto, setTexto] = useState("")
    const [cargando, setCargando] = useState(false)
    const [borrador, setBorrador] = useState("")
    const [estadoAgente, setEstadoAgente] = useState("")
    const [error, setError] = useState("")

    const contenedorRef = useRef<HTMLDivElement>(null)
    const entradaRef = useRef<HTMLTextAreaElement>(null)
    const abortRef = useRef<AbortController | null>(null)

    useEffect(() => {
        try {
            sessionStorage.setItem(claveStorage, JSON.stringify(mensajes))
        } catch { /* sin persistencia el chat sigue funcionando */ }
    }, [claveStorage, mensajes])

    // Limpia conversaciones de otras sesiones que hayan quedado en esta pestaña
    useEffect(() => {
        try {
            for (const k of Object.keys(sessionStorage)) {
                if (k.startsWith(PREFIJO_STORAGE) && k !== claveStorage) sessionStorage.removeItem(k)
            }
        } catch { /* limpieza opcional */ }
    }, [claveStorage])

    // Auto-scroll al fondo con cada mensaje y mientras Kesito responde
    useEffect(() => {
        const el = contenedorRef.current
        if (el) el.scrollTop = el.scrollHeight
    }, [mensajes, cargando, borrador, estadoAgente])

    // Foco al entrar al canal; al salir se aborta la consulta en curso
    useEffect(() => {
        entradaRef.current?.focus()
        return () => abortRef.current?.abort()
    }, [])

    const enviar = async (sugerencia?: string) => {
        const pregunta = (sugerencia ?? texto).trim().slice(0, MAX_MENSAJE)
        if (!pregunta || cargando) return

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
            const res = await fetch("/api/chat/kesito", {
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
            setMensajes(prev => [...prev, {
                rol: "assistant",
                texto: respuesta || "No pude completar la consulta, intenta preguntarlo de otra forma.",
            }])
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

    return (
        <div className="flex-1 min-w-0 bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl flex flex-col overflow-hidden">
            {/* Encabezado */}
            <div className="px-5 py-3 border-b border-white/[0.06] bg-amber-500/[0.06] flex items-center gap-3">
                <div className="h-8 w-8 rounded-xl bg-amber-400/15 border border-amber-400/30 flex items-center justify-center text-base shrink-0">
                    <span aria-hidden>🧀</span>
                </div>
                <div className="flex-1 min-w-0">
                    <h2 className="text-[13px] font-black text-white uppercase tracking-widest leading-none flex items-center gap-1.5">
                        Kesito <Sparkles className="h-3 w-3 text-amber-400" />
                    </h2>
                    <p className="text-[9px] font-bold text-amber-400/70 uppercase tracking-widest mt-1">
                        Agente de tu tienda · conversación privada
                    </p>
                </div>
                {mensajes.length > 0 && (
                    <button
                        onClick={reiniciar}
                        className="p-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-400 hover:text-amber-300 hover:border-amber-500/30 transition-all"
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
                        <span className="text-4xl" aria-hidden>🧀</span>
                        <p className="text-[12px] font-bold text-slate-500 max-w-md">
                            Pregúntame por precios, ofertas, ventas del día, cortes, recibos,
                            transferencias, facturas o devoluciones de <span className="text-amber-300">tu tienda</span>.
                        </p>
                        <div className="flex flex-wrap justify-center gap-1.5">
                            {SUGERENCIAS.map(s => (
                                <button
                                    key={s}
                                    onClick={() => enviar(s)}
                                    className="px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/10 text-[11px] font-bold text-slate-300 hover:bg-amber-500/10 hover:border-amber-500/30 hover:text-amber-200 transition-all"
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
                                <BurbujaKesito texto={m.texto} />
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
                            <BurbujaKesito texto={borrador} />
                        </div>
                    ) : (
                        <div className="flex justify-start">
                            <div className="rounded-2xl rounded-bl-md px-4 py-3 bg-white/[0.05] border border-white/10 flex items-center gap-2">
                                <span className="flex items-center gap-1.5">
                                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-bounce" />
                                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-bounce [animation-delay:150ms]" />
                                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-bounce [animation-delay:300ms]" />
                                </span>
                                {estadoAgente && (
                                    <span className="text-[11px] font-bold text-amber-200/80">{estadoAgente}</span>
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
                    placeholder="Pregúntale a Kesito... (Enter para enviar)"
                    className="flex-1 resize-none px-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-medium text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-400/25 focus:border-amber-400/60 transition-all max-h-28"
                    value={texto}
                    onChange={e => setTexto(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault()
                            enviar()
                        }
                    }}
                />
                <button
                    onClick={() => enviar()}
                    disabled={cargando || !texto.trim()}
                    className="p-2.5 rounded-xl bg-amber-400 text-slate-950 hover:brightness-110 transition-all disabled:opacity-40 shrink-0"
                    title="Enviar"
                    aria-label="Enviar mensaje"
                >
                    {cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
            </div>
        </div>
    )
}
