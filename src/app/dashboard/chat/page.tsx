"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, Send, ImagePlus, X, Hash, Store, MessageSquare, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { fmtInt } from "@/lib/format"
import { KesitoPanel } from "@/components/dashboard/KesitoPanel"

interface Canal { canal: string; nombre: string; noLeidos: number }
interface Mensaje {
    idMensaje: number
    idTienda: number
    codigoBarras: string
    nombre: string
    mensaje: string
    imagen: string | null
    fecha: string
}
interface TiendaOption { IdTienda: number; Tienda: string }

const POLL_MENSAJES_MS = 5_000
const POLL_CANALES_MS = 15_000

// Canal fijo del agente Kesito: no existe en BDKYKPortal, se atiende localmente
const CANAL_KESITO = "kesito"

const hora = (v: string) => {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })
}

const fechaCorta = (v: string) => {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" })
}

export default function ChatPage() {
    const [canales, setCanales] = useState<Canal[]>([])
    const [canalSel, setCanalSel] = useState("")
    const [mensajes, setMensajes] = useState<Mensaje[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState("")
    const [miCodigo, setMiCodigo] = useState("")
    // Clave tienda+usuario para aislar la conversación con Kesito en la pestaña
    const [claveKesito, setClaveKesito] = useState("")
    const [tiendas, setTiendas] = useState<Map<number, string>>(new Map())

    // Composer
    const [texto, setTexto] = useState("")
    const [imagen, setImagen] = useState<File | null>(null)
    const [imagenPreview, setImagenPreview] = useState<string | null>(null)
    const [enviando, setEnviando] = useState(false)

    const contenedorRef = useRef<HTMLDivElement>(null)
    const ultimoIdRef = useRef(0)
    const canalRef = useRef("")
    const archivoRef = useRef<HTMLInputElement>(null)

    const irAlFondo = () => {
        const el = contenedorRef.current
        if (el) el.scrollTop = el.scrollHeight
    }

    // Identidad y catálogo de tiendas (para mostrar la tienda del emisor)
    useEffect(() => {
        fetch("/api/auth/me")
            .then(r => r.json())
            .then(d => {
                setMiCodigo(d.user?.codigobarras ?? "")
                setClaveKesito(`${d.user?.idTienda ?? 0}-${d.user?.codigobarras ?? "anon"}`)
            })
            // Sin identidad los mensajes salen a la izquierda y Kesito usa clave genérica
            .catch(() => setClaveKesito("anon"))
        fetch("/api/auth/tiendas")
            .then(r => r.json())
            .then(d => setTiendas(new Map((d.tiendas ?? []).map((t: TiendaOption) => [t.IdTienda, t.Tienda]))))
            .catch(() => { /* nombres de tienda opcionales */ })
    }, [])

    const cargarCanales = useCallback(async () => {
        try {
            const res = await fetch("/api/chat/canales")
            if (res.status === 401) { window.location.href = "/login"; return }
            const json = await res.json()
            if (res.ok) {
                setCanales(json.canales)
                // Deep link: /dashboard/chat?canal=kesito (o cualquier canal propio)
                const deseado = new URLSearchParams(window.location.search).get("canal")
                const inicial = deseado && (deseado === CANAL_KESITO || json.canales.some((c: Canal) => c.canal === deseado))
                    ? deseado
                    : ""
                setCanalSel(prev => prev || inicial || json.canales[0]?.canal || "")
            }
        } catch { /* reintenta en el siguiente poll */ }
    }, [])

    // Carga inicial + badges de canales cada 15 s
    useEffect(() => {
        cargarCanales()
        const intervalo = setInterval(cargarCanales, POLL_CANALES_MS)
        return () => clearInterval(intervalo)
    }, [cargarCanales])

    // Cambio de canal: carga inicial y polling incremental cada 5 s
    useEffect(() => {
        if (!canalSel || canalSel === CANAL_KESITO) return
        canalRef.current = canalSel
        ultimoIdRef.current = 0
        setMensajes([])
        setLoading(true)

        let activo = true
        const consultar = async (inicial: boolean) => {
            try {
                const desde = inicial ? 0 : ultimoIdRef.current
                const res = await fetch(`/api/chat/mensajes?canal=${canalSel}&desde=${desde}`)
                const json = await res.json()
                if (!activo || canalRef.current !== canalSel) return
                if (res.ok) {
                    const nuevos: Mensaje[] = json.mensajes
                    if (nuevos.length > 0) {
                        ultimoIdRef.current = nuevos[nuevos.length - 1].idMensaje
                        setMensajes(prev => inicial ? nuevos : [...prev, ...nuevos])
                        setTimeout(irAlFondo, 50)
                        // Al leer, se limpia el badge local del canal
                        setCanales(prev => prev.map(c => c.canal === canalSel ? { ...c, noLeidos: 0 } : c))
                    }
                } else {
                    setError(json.error || "Error al consultar mensajes")
                }
            } catch { /* siguiente poll */ } finally {
                if (activo && canalRef.current === canalSel) setLoading(false)
            }
        }

        consultar(true)
        const intervalo = setInterval(() => consultar(false), POLL_MENSAJES_MS)
        return () => { activo = false; clearInterval(intervalo) }
    }, [canalSel])

    const adjuntar = (f: File | null) => {
        if (imagenPreview) URL.revokeObjectURL(imagenPreview)
        setImagen(f)
        setImagenPreview(f ? URL.createObjectURL(f) : null)
    }

    const enviar = async () => {
        if (enviando || (!texto.trim() && !imagen)) return
        setEnviando(true)
        setError("")
        try {
            const form = new FormData()
            form.set("canal", canalSel)
            form.set("mensaje", texto.trim())
            if (imagen) form.set("imagen", imagen)

            const res = await fetch("/api/chat/mensajes", { method: "POST", body: form })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "Error al enviar")

            setTexto("")
            adjuntar(null)
            if (archivoRef.current) archivoRef.current.value = ""

            // Trae de inmediato lo nuevo (incluido el propio mensaje)
            const resM = await fetch(`/api/chat/mensajes?canal=${canalSel}&desde=${ultimoIdRef.current}`)
            const jsonM = await resM.json()
            if (resM.ok && jsonM.mensajes.length > 0) {
                ultimoIdRef.current = jsonM.mensajes[jsonM.mensajes.length - 1].idMensaje
                setMensajes(prev => [...prev, ...jsonM.mensajes])
                setTimeout(irAlFondo, 50)
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Error al enviar el mensaje")
        } finally {
            setEnviando(false)
        }
    }

    const canalActivo = canales.find(c => c.canal === canalSel)

    return (
        <div className="flex flex-col lg:flex-row gap-4 h-[calc(100vh-9.5rem)]">
            {/* Canales */}
            <div className="lg:w-64 shrink-0 bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl overflow-auto">
                <div className="px-4 py-3 border-b border-white/[0.06]">
                    <h2 className="text-[12px] font-black text-slate-300 uppercase tracking-widest flex items-center gap-2">
                        <MessageSquare className="h-4 w-4 text-emerald-400" /> Canales
                    </h2>
                </div>
                <div className="p-2 flex lg:flex-col gap-1 overflow-x-auto lg:overflow-x-hidden">
                    <button
                        onClick={() => setCanalSel(CANAL_KESITO)}
                        className={cn(
                            "flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-left transition-all shrink-0 lg:shrink lg:w-full",
                            canalSel === CANAL_KESITO
                                ? "bg-amber-500/15 border border-amber-500/30 text-amber-300"
                                : "text-slate-400 hover:bg-white/[0.05] hover:text-white border border-transparent"
                        )}
                    >
                        <span className="flex items-center gap-2 min-w-0">
                            <span className="text-sm leading-none" aria-hidden>🧀</span>
                            <span className="text-[12px] font-black truncate">Kesito</span>
                        </span>
                        <Sparkles className="h-3.5 w-3.5 shrink-0 text-amber-400/70" />
                    </button>
                    {canales.map(c => (
                        <button
                            key={c.canal}
                            onClick={() => setCanalSel(c.canal)}
                            className={cn(
                                "flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-left transition-all shrink-0 lg:shrink lg:w-full",
                                canalSel === c.canal
                                    ? "bg-emerald-500/15 border border-emerald-500/30 text-emerald-300"
                                    : "text-slate-400 hover:bg-white/[0.05] hover:text-white border border-transparent"
                            )}
                        >
                            <span className="flex items-center gap-2 min-w-0">
                                {c.canal === "general"
                                    ? <Hash className="h-4 w-4 shrink-0" />
                                    : <Store className="h-4 w-4 shrink-0" />}
                                <span className="text-[12px] font-black truncate">{c.nombre}</span>
                            </span>
                            {c.noLeidos > 0 && (
                                <span className="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-emerald-500 text-slate-950 text-[10px] font-black flex items-center justify-center">
                                    {c.noLeidos > 99 ? "99+" : fmtInt(c.noLeidos)}
                                </span>
                            )}
                        </button>
                    ))}
                </div>
            </div>

            {/* Conversación: el canal Kesito se atiende con el agente, el resto con BDKYKPortal */}
            {canalSel === CANAL_KESITO ? (
                claveKesito ? (
                    <KesitoPanel key={claveKesito} claveSesion={claveKesito} />
                ) : (
                    <div className="flex-1 min-w-0 bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl flex items-center justify-center">
                        <Loader2 className="h-7 w-7 text-amber-400 animate-spin" />
                    </div>
                )
            ) : (
            <div className="flex-1 min-w-0 bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl flex flex-col overflow-hidden">
                <div className="px-5 py-3 border-b border-white/[0.06] flex items-center gap-2">
                    {canalActivo?.canal === "general"
                        ? <Hash className="h-4 w-4 text-emerald-400" />
                        : <Store className="h-4 w-4 text-emerald-400" />}
                    <h2 className="text-[13px] font-black text-white uppercase tracking-widest">
                        {canalActivo?.nombre ?? "Chat"}
                    </h2>
                </div>

                {/* Mensajes */}
                <div ref={contenedorRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                    {loading ? (
                        <div className="flex items-center justify-center h-full">
                            <Loader2 className="h-7 w-7 text-emerald-400 animate-spin" />
                        </div>
                    ) : mensajes.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full gap-3">
                            <MessageSquare className="h-8 w-8 text-slate-700" />
                            <p className="text-[12px] font-bold text-slate-600 uppercase tracking-widest">
                                Sin mensajes — escribe el primero
                            </p>
                        </div>
                    ) : (
                        mensajes.map(m => {
                            const mio = m.codigoBarras === miCodigo
                            return (
                                <div key={m.idMensaje} className={cn("flex", mio ? "justify-end" : "justify-start")}>
                                    <div className={cn("max-w-[78%]", mio ? "items-end" : "items-start")}>
                                        {!mio && (
                                            <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-0.5 px-1">
                                                {m.nombre}
                                                {tiendas.get(m.idTienda) ? ` · ${tiendas.get(m.idTienda)}` : ""}
                                            </p>
                                        )}
                                        <div className={cn(
                                            "rounded-2xl px-3.5 py-2.5 border",
                                            mio
                                                ? "bg-emerald-500/15 border-emerald-500/25 rounded-br-md"
                                                : "bg-white/[0.05] border-white/10 rounded-bl-md"
                                        )}>
                                            {m.imagen && (
                                                <a
                                                    href={`/api/chat/imagen/${encodeURIComponent(m.imagen)}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                >
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img
                                                        src={`/api/chat/imagen/${encodeURIComponent(m.imagen)}`}
                                                        alt="Foto adjunta"
                                                        className="max-h-64 max-w-full rounded-lg mb-1.5 border border-white/10"
                                                    />
                                                </a>
                                            )}
                                            {m.mensaje && (
                                                <p className="text-[13px] font-medium text-slate-100 whitespace-pre-wrap break-words">
                                                    {m.mensaje}
                                                </p>
                                            )}
                                            <p className={cn(
                                                "text-[9px] font-bold mt-1",
                                                mio ? "text-emerald-400/60 text-right" : "text-slate-600"
                                            )}>
                                                {fechaCorta(m.fecha)} {hora(m.fecha)}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )
                        })
                    )}
                </div>

                {error && (
                    <p className="px-4 pb-1 text-[10px] font-black text-rose-300 uppercase tracking-wider">{error}</p>
                )}

                {/* Adjunto pendiente */}
                {imagenPreview && (
                    <div className="px-4 pb-2 flex items-center gap-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={imagenPreview} alt="Adjunto" className="h-14 rounded-lg border border-white/10" />
                        <button
                            onClick={() => { adjuntar(null); if (archivoRef.current) archivoRef.current.value = "" }}
                            className="p-1.5 rounded-lg bg-white/[0.05] border border-white/10 text-slate-400 hover:text-rose-300 transition-all"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </div>
                )}

                {/* Composer */}
                <div className="px-4 py-3 border-t border-white/[0.06] flex items-end gap-2">
                    <input
                        ref={archivoRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={e => adjuntar(e.target.files?.[0] ?? null)}
                    />
                    <button
                        onClick={() => archivoRef.current?.click()}
                        className="p-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-slate-400 hover:text-cyan-300 hover:border-cyan-500/30 transition-all shrink-0"
                        title="Adjuntar foto"
                    >
                        <ImagePlus className="h-4 w-4" />
                    </button>
                    <textarea
                        rows={1}
                        placeholder="Escribe un mensaje... (Enter para enviar)"
                        className="flex-1 resize-none px-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-medium text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-400/25 focus:border-emerald-400/60 transition-all max-h-28"
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
                        onClick={enviar}
                        disabled={enviando || (!texto.trim() && !imagen)}
                        className="p-2.5 rounded-xl bg-emerald-500 text-slate-950 hover:brightness-110 transition-all disabled:opacity-40 shrink-0"
                        title="Enviar"
                    >
                        {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </button>
                </div>
            </div>
            )}
        </div>
    )
}
