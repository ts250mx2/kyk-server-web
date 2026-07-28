"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, RotateCcw, Send, Sparkles, X } from "lucide-react"
import { cn } from "@/lib/utils"

interface MensajeKesito {
    rol: "user" | "assistant"
    texto: string
}

const CLAVE_STORAGE = "kesito-conversacion"
const MAX_MENSAJE = 2000

const SUGERENCIAS = [
    "¿Cómo van las ventas de hoy?",
    "¿Qué ofertas están vigentes?",
    "¿Qué recibos de mercancía llegaron hoy?",
    "¿Hay devoluciones de compra pendientes?",
]

// La conversación previa vive en sessionStorage: sobrevive recargas y se
// pierde al cerrar la pestaña. En SSR no hay sessionStorage: inicia vacía.
function conversacionGuardada(): MensajeKesito[] {
    if (typeof window === "undefined") return []
    try {
        const guardado = sessionStorage.getItem(CLAVE_STORAGE)
        const lista = guardado ? JSON.parse(guardado) : null
        return Array.isArray(lista) ? lista : []
    } catch {
        return []
    }
}

// Burbuja flotante con el agente Kesito: consulta /api/chat/kesito, que solo ve
// los datos de la tienda de la sesión.
export function KesitoChat() {
    const router = useRouter()
    const [abierto, setAbierto] = useState(false)
    const [mensajes, setMensajes] = useState<MensajeKesito[]>(conversacionGuardada)
    const [texto, setTexto] = useState("")
    const [cargando, setCargando] = useState(false)
    const [error, setError] = useState("")

    const contenedorRef = useRef<HTMLDivElement>(null)
    const entradaRef = useRef<HTMLTextAreaElement>(null)

    useEffect(() => {
        try {
            sessionStorage.setItem(CLAVE_STORAGE, JSON.stringify(mensajes))
        } catch { /* sin persistencia el chat sigue funcionando */ }
    }, [mensajes])

    // Auto-scroll al fondo con cada mensaje o mientras Kesito responde
    useEffect(() => {
        const el = contenedorRef.current
        if (el) el.scrollTop = el.scrollHeight
    }, [mensajes, cargando, abierto])

    // Foco al abrir y cierre con Escape
    useEffect(() => {
        if (!abierto) return
        entradaRef.current?.focus()
        const alTeclear = (e: KeyboardEvent) => {
            if (e.key === "Escape") setAbierto(false)
        }
        window.addEventListener("keydown", alTeclear)
        return () => window.removeEventListener("keydown", alTeclear)
    }, [abierto])

    const enviar = async (sugerencia?: string) => {
        const pregunta = (sugerencia ?? texto).trim().slice(0, MAX_MENSAJE)
        if (!pregunta || cargando) return

        const historial = mensajes
        setMensajes(prev => [...prev, { rol: "user", texto: pregunta }])
        setTexto("")
        setCargando(true)
        setError("")
        try {
            const res = await fetch("/api/chat/kesito", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mensaje: pregunta, historial }),
            })
            if (res.status === 401) { router.push("/login"); return }
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "El agente no pudo responder")
            setMensajes(prev => [...prev, { rol: "assistant", texto: String(json.respuesta ?? "") }])
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "El agente no pudo responder, intenta de nuevo.")
        } finally {
            setCargando(false)
            entradaRef.current?.focus()
        }
    }

    const reiniciar = () => {
        setMensajes([])
        setError("")
        try { sessionStorage.removeItem(CLAVE_STORAGE) } catch { /* sin persistencia */ }
        entradaRef.current?.focus()
    }

    if (!abierto) {
        return (
            <button
                onClick={() => setAbierto(true)}
                className="fixed bottom-5 right-5 z-50 h-14 w-14 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 text-slate-950 shadow-lg shadow-amber-500/25 border border-amber-300/50 flex items-center justify-center text-2xl hover:scale-105 hover:brightness-105 transition-all"
                title="Pregúntale a Kesito"
                aria-label="Abrir el chat de Kesito"
            >
                <span aria-hidden>🧀</span>
            </button>
        )
    }

    return (
        <div
            className="fixed bottom-5 right-5 z-50 w-[min(26rem,calc(100vw-2.5rem))] h-[min(38rem,calc(100dvh-6.5rem))] flex flex-col rounded-2xl bg-[#0a101c]/95 backdrop-blur-xl border border-white/10 shadow-2xl shadow-black/50 overflow-hidden"
            role="dialog"
            aria-label="Chat con Kesito"
        >
            {/* Encabezado */}
            <div className="px-4 py-3 border-b border-white/[0.06] bg-amber-500/[0.06] flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-amber-400/15 border border-amber-400/30 flex items-center justify-center text-lg shrink-0">
                    <span aria-hidden>🧀</span>
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-black text-white leading-none flex items-center gap-1.5">
                        Kesito <Sparkles className="h-3 w-3 text-amber-400" />
                    </p>
                    <p className="text-[9px] font-bold text-amber-400/70 uppercase tracking-widest mt-1">
                        Agente de tu tienda
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
                <button
                    onClick={() => setAbierto(false)}
                    className="p-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-400 hover:text-rose-300 hover:border-rose-500/30 transition-all"
                    title="Cerrar (Esc)"
                    aria-label="Cerrar el chat"
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>

            {/* Conversación */}
            <div ref={contenedorRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                {mensajes.length === 0 && !cargando ? (
                    <div className="h-full flex flex-col items-center justify-center gap-4 px-2 text-center">
                        <span className="text-4xl" aria-hidden>🧀</span>
                        <p className="text-[12px] font-bold text-slate-500">
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
                            <div className={cn(
                                "max-w-[85%] rounded-2xl px-3.5 py-2.5 border",
                                m.rol === "user"
                                    ? "bg-emerald-500/15 border-emerald-500/25 rounded-br-md"
                                    : "bg-white/[0.05] border-white/10 rounded-bl-md"
                            )}>
                                <p className="text-[13px] font-medium text-slate-100 whitespace-pre-wrap break-words">
                                    {m.texto}
                                </p>
                            </div>
                        </div>
                    ))
                )}

                {cargando && (
                    <div className="flex justify-start">
                        <div className="rounded-2xl rounded-bl-md px-4 py-3 bg-white/[0.05] border border-white/10 flex items-center gap-1.5">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-bounce" />
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-bounce [animation-delay:150ms]" />
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-bounce [animation-delay:300ms]" />
                        </div>
                    </div>
                )}
            </div>

            {error && (
                <p className="px-4 pb-1 text-[10px] font-black text-rose-300 uppercase tracking-wider">{error}</p>
            )}

            {/* Composer */}
            <div className="px-3 py-3 border-t border-white/[0.06] flex items-end gap-2">
                <textarea
                    ref={entradaRef}
                    rows={1}
                    maxLength={MAX_MENSAJE}
                    placeholder="Pregúntale a Kesito..."
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
