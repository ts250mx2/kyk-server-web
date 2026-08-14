"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { CheckCircle2, Loader2, Send, Star } from "lucide-react"
import { cn } from "@/lib/utils"

// Encuesta PÚBLICA de satisfacción: el cliente llega escaneando el QR de su
// sucursal (la URL identifica a la tienda por UUID, sin login). Móvil primero:
// estrellas grandes, opciones de un toque, comentario si algo salió mal y
// captura opcional de contacto para promociones.

interface Pregunta {
    idPregunta: number
    pregunta: string
    tipo: "estrellas" | "opciones"
    etiquetas: string[]
}

interface Config {
    titulo: string
    subtitulo: string
    subtitulo2: string
    umbralComentario: number
    tituloComentario: string
    textoComentario: string
    regaloActivo: boolean
    tituloRegalo: string
    textoRegalo: string
    textoPromos: string
    textoBotonEnviar: string
    tituloGracias: string
    textoGracias: string
}

export default function EncuestaPublicaPage() {
    const { uuid } = useParams<{ uuid: string }>()
    const [tienda, setTienda] = useState("")
    const [config, setConfig] = useState<Config | null>(null)
    const [preguntas, setPreguntas] = useState<Pregunta[]>([])
    const [noDisponible, setNoDisponible] = useState(false)

    const [valores, setValores] = useState<Record<number, number>>({})
    const [comentario, setComentario] = useState("")
    const [correo, setCorreo] = useState("")
    const [telefono, setTelefono] = useState("")
    const [aceptaPromos, setAceptaPromos] = useState(true)
    const [enviando, setEnviando] = useState(false)
    const [enviada, setEnviada] = useState(false)
    const [error, setError] = useState("")

    useEffect(() => {
        let activo = true
        fetch(`/api/encuesta/${uuid}`)
            .then(r => r.json().then(json => ({ ok: r.ok, json })))
            .then(({ ok, json }) => {
                if (!activo) return
                if (!ok) { setNoDisponible(true); return }
                setTienda(json.tienda ?? "")
                setConfig(json.config)
                setPreguntas(json.preguntas ?? [])
            })
            .catch(() => { if (activo) setNoDisponible(true) })
        return () => { activo = false }
    }, [uuid])

    const responder = (idPregunta: number, valor: number) => {
        setValores(prev => ({ ...prev, [idPregunta]: valor }))
    }

    // El comentario se pide cuando alguna respuesta cae en el umbral o debajo
    const hayBaja = config
        ? Object.values(valores).some(v => v <= config.umbralComentario)
        : false
    const contestadas = Object.keys(valores).length

    const enviar = async () => {
        if (enviando || contestadas === 0) return
        setEnviando(true)
        setError("")
        try {
            const res = await fetch(`/api/encuesta/${uuid}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    respuestas: Object.entries(valores).map(([id, valor]) => ({ idPregunta: Number(id), valor })),
                    comentario: comentario || undefined,
                    correo: correo || undefined,
                    telefono: telefono || undefined,
                    aceptaPromos,
                }),
            })
            const json = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(json.error || "No fue posible enviar tu respuesta")
            setEnviada(true)
            window.scrollTo({ top: 0 })
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "No fue posible enviar tu respuesta")
        } finally {
            setEnviando(false)
        }
    }

    const tarjeta = "bg-white/[0.05] border border-white/10 rounded-2xl p-4"

    if (noDisponible) {
        return (
            <main className="min-h-screen bg-[#060a12] flex items-center justify-center p-6">
                <p className="text-[14px] font-bold text-slate-400 text-center max-w-sm">
                    Esta encuesta no está disponible. Pide en la tienda el código QR más reciente.
                </p>
            </main>
        )
    }

    if (!config) {
        return (
            <main className="min-h-screen bg-[#060a12] flex items-center justify-center">
                <Loader2 className="h-8 w-8 text-emerald-400 animate-spin" />
            </main>
        )
    }

    if (enviada) {
        return (
            <main className="min-h-screen bg-[#060a12] flex items-center justify-center p-6">
                <div className="text-center max-w-md">
                    <CheckCircle2 className="h-16 w-16 text-emerald-400 mx-auto" />
                    <h1 className="text-2xl font-black text-white mt-4">{config.tituloGracias}</h1>
                    {config.textoGracias && (
                        <p className="text-[14px] font-medium text-slate-400 mt-2">{config.textoGracias}</p>
                    )}
                    <p className="text-[11px] font-black uppercase tracking-widest text-emerald-400/80 mt-6">
                        KYK · {tienda}
                    </p>
                </div>
            </main>
        )
    }

    return (
        <main className="min-h-screen bg-[#060a12] text-slate-100">
            <div className="max-w-lg mx-auto px-4 py-8 space-y-4">
                {/* Encabezado */}
                <header className="text-center mb-2">
                    <p className="text-[11px] font-black uppercase tracking-[0.3em] text-emerald-400">
                        KYK · {tienda}
                    </p>
                    <h1 className="text-2xl font-black text-white mt-2 leading-tight">{config.titulo}</h1>
                    {config.subtitulo && (
                        <p className="text-[13px] font-medium text-slate-400 mt-1.5">{config.subtitulo}</p>
                    )}
                    {config.subtitulo2 && (
                        <p className="text-[12px] font-bold text-slate-500 mt-0.5">{config.subtitulo2}</p>
                    )}
                </header>

                {/* Preguntas */}
                {preguntas.map(p => (
                    <section key={p.idPregunta} className={tarjeta}>
                        <p className="text-[14px] font-black text-white leading-snug">{p.pregunta}</p>
                        {p.tipo === "estrellas" ? (
                            <div className="mt-3">
                                <div className="flex justify-center gap-2">
                                    {[1, 2, 3, 4, 5].map(v => (
                                        <button
                                            key={v}
                                            onClick={() => responder(p.idPregunta, v)}
                                            className="p-1 transition-transform active:scale-90"
                                            aria-label={`${v} de 5`}
                                        >
                                            <Star className={cn(
                                                "h-9 w-9 transition-colors",
                                                (valores[p.idPregunta] ?? 0) >= v
                                                    ? "text-amber-400 fill-amber-400"
                                                    : "text-slate-700"
                                            )} />
                                        </button>
                                    ))}
                                </div>
                                {valores[p.idPregunta] && p.etiquetas[valores[p.idPregunta] - 1] && (
                                    <p className="text-center text-[12px] font-black text-amber-300 mt-1.5">
                                        {p.etiquetas[valores[p.idPregunta] - 1]}
                                    </p>
                                )}
                            </div>
                        ) : (
                            <div className="mt-3 space-y-1.5">
                                {p.etiquetas.map((etiqueta, i) => {
                                    const valor = p.etiquetas.length - i
                                    const activa = valores[p.idPregunta] === valor
                                    return (
                                        <button
                                            key={i}
                                            onClick={() => responder(p.idPregunta, valor)}
                                            className={cn(
                                                "w-full text-left px-4 py-2.5 rounded-xl border text-[13px] font-bold transition-all",
                                                activa
                                                    ? "bg-emerald-500/20 border-emerald-400/50 text-emerald-200"
                                                    : "bg-white/[0.03] border-white/10 text-slate-300 hover:border-white/25"
                                            )}
                                        >
                                            {etiqueta}
                                        </button>
                                    )
                                })}
                            </div>
                        )}
                    </section>
                ))}

                {/* Comentario cuando algo salió mal */}
                {hayBaja && (
                    <section className={cn(tarjeta, "border-amber-400/30")}>
                        <p className="text-[14px] font-black text-amber-300">{config.tituloComentario}</p>
                        {config.textoComentario && (
                            <p className="text-[12px] font-medium text-slate-400 mt-1">{config.textoComentario}</p>
                        )}
                        <textarea
                            value={comentario}
                            onChange={e => setComentario(e.target.value)}
                            maxLength={1000}
                            rows={3}
                            placeholder="Escríbenos aquí..."
                            className="mt-2.5 w-full px-3.5 py-2.5 bg-white/[0.04] border border-white/10 rounded-xl text-[14px] font-medium text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-400/50 resize-none"
                        />
                    </section>
                )}

                {/* Contacto para promociones */}
                {config.regaloActivo && (
                    <section className={cn(tarjeta, "border-emerald-400/25")}>
                        <p className="text-[14px] font-black text-emerald-300">{config.tituloRegalo}</p>
                        {config.textoRegalo && (
                            <p className="text-[12px] font-medium text-slate-400 mt-1">{config.textoRegalo}</p>
                        )}
                        <input
                            value={telefono}
                            onChange={e => setTelefono(e.target.value)}
                            type="tel"
                            maxLength={20}
                            placeholder="Tu teléfono (opcional)"
                            className="mt-2.5 w-full px-3.5 py-2.5 bg-white/[0.04] border border-white/10 rounded-xl text-[14px] font-medium text-slate-100 placeholder-slate-600 focus:outline-none focus:border-emerald-400/50"
                        />
                        <input
                            value={correo}
                            onChange={e => setCorreo(e.target.value)}
                            type="email"
                            maxLength={255}
                            placeholder="Tu correo (opcional)"
                            className="mt-2 w-full px-3.5 py-2.5 bg-white/[0.04] border border-white/10 rounded-xl text-[14px] font-medium text-slate-100 placeholder-slate-600 focus:outline-none focus:border-emerald-400/50"
                        />
                        <label className="mt-2.5 flex items-center gap-2 text-[12px] font-bold text-slate-400">
                            <input
                                type="checkbox"
                                checked={aceptaPromos}
                                onChange={e => setAceptaPromos(e.target.checked)}
                                className="h-4 w-4 accent-emerald-500"
                            />
                            {config.textoPromos}
                        </label>
                    </section>
                )}

                {error && (
                    <p className="text-[12px] font-black text-rose-300 text-center">{error}</p>
                )}

                <button
                    onClick={enviar}
                    disabled={enviando || contestadas === 0}
                    className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-emerald-500 text-slate-950 font-black text-[14px] uppercase tracking-widest hover:brightness-110 transition-all disabled:opacity-40"
                >
                    {enviando ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                    {config.textoBotonEnviar}
                </button>
                <p className="text-center text-[10px] font-bold text-slate-600 pb-6">
                    {contestadas === 0 ? "Contesta al menos una pregunta para enviar" : `${contestadas} de ${preguntas.length} preguntas contestadas`}
                </p>
            </div>
        </main>
    )
}
