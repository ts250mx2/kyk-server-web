"use client"

import { useEffect, useRef, useState } from "react"
import { ImageOff, Loader2, Search, Trash2, Upload, X } from "lucide-react"
import { cn } from "@/lib/utils"

// Foto del producto (detalle de Precios): la sirve /api/articulos/imagen — que
// resuelve caché en base → Open Food Facts por código de barras. Oficina puede
// subir una foto propia, elegir una sugerencia por descripción o quitarla.

interface Sugerencia {
    codigo: string
    nombre: string
    marca: string
    url: string
}

export function FotoProducto({ codigoBarras, descripcion, esOficina }: {
    codigoBarras: string
    descripcion: string
    esOficina: boolean
}) {
    // v rompe el caché del navegador al reemplazar/quitar la imagen
    const [version, setVersion] = useState(0)
    const [sinImagen, setSinImagen] = useState(false)
    const [ocupado, setOcupado] = useState(false)
    const [error, setError] = useState("")
    const [ampliada, setAmpliada] = useState(false)

    const [modalAbierto, setModalAbierto] = useState(false)
    const [sugerencias, setSugerencias] = useState<Sugerencia[]>([])
    const [buscando, setBuscando] = useState(false)
    const [busqueda, setBusqueda] = useState("")

    const archivoRef = useRef<HTMLInputElement>(null)

    // Al cambiar de artículo se reinicia el estado de "sin imagen"
    useEffect(() => {
        setSinImagen(false)
        setError("")
        setAmpliada(false)
    }, [codigoBarras])

    // Esc cierra la imagen ampliada
    useEffect(() => {
        if (!ampliada) return
        const alTeclear = (e: KeyboardEvent) => { if (e.key === "Escape") setAmpliada(false) }
        window.addEventListener("keydown", alTeclear)
        return () => window.removeEventListener("keydown", alTeclear)
    }, [ampliada])

    const recargar = () => {
        setSinImagen(false)
        setVersion(v => v + 1)
    }

    const subir = async (archivo: File | null) => {
        if (!archivo || ocupado) return
        setOcupado(true)
        setError("")
        try {
            const form = new FormData()
            form.set("imagen", archivo)
            const res = await fetch(`/api/articulos/imagen/${encodeURIComponent(codigoBarras)}`, {
                method: "POST",
                body: form,
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "No fue posible subir la imagen")
            recargar()
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "No fue posible subir la imagen")
        } finally {
            setOcupado(false)
            if (archivoRef.current) archivoRef.current.value = ""
        }
    }

    const quitar = async () => {
        if (ocupado) return
        setOcupado(true)
        setError("")
        try {
            await fetch(`/api/articulos/imagen/${encodeURIComponent(codigoBarras)}`, { method: "DELETE" })
            recargar()
        } finally {
            setOcupado(false)
        }
    }

    const buscarSugerencias = async (termino: string) => {
        setBuscando(true)
        setError("")
        try {
            const res = await fetch(`/api/articulos/imagen-sugerencias?busqueda=${encodeURIComponent(termino)}`)
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "No fue posible buscar")
            setSugerencias(json.sugerencias ?? [])
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "No fue posible buscar")
            setSugerencias([])
        } finally {
            setBuscando(false)
        }
    }

    const abrirSugerencias = () => {
        setModalAbierto(true)
        setBusqueda(descripcion)
        buscarSugerencias(descripcion)
    }

    const elegirSugerencia = async (s: Sugerencia) => {
        if (ocupado) return
        setOcupado(true)
        setError("")
        try {
            const res = await fetch(`/api/articulos/imagen/${encodeURIComponent(codigoBarras)}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: s.url }),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "No fue posible guardar la imagen")
            setModalAbierto(false)
            recargar()
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "No fue posible guardar la imagen")
        } finally {
            setOcupado(false)
        }
    }

    return (
        <div className="shrink-0 flex flex-col items-center gap-1.5">
            <div className="w-20 h-20 rounded-xl border border-white/10 bg-white/[0.04] overflow-hidden flex items-center justify-center">
                {sinImagen ? (
                    <ImageOff className="h-6 w-6 text-slate-700" />
                ) : (
                    <button
                        onClick={() => setAmpliada(true)}
                        className="w-full h-full cursor-zoom-in"
                        title="Ver en grande"
                        aria-label="Ampliar la foto del producto"
                    >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={`/api/articulos/imagen/${encodeURIComponent(codigoBarras)}?v=${version}`}
                            alt={descripcion}
                            className="w-full h-full object-contain"
                            onError={() => setSinImagen(true)}
                        />
                    </button>
                )}
            </div>

            {/* Lightbox: la foto en grande (clic o Esc para cerrar) */}
            {ampliada && !sinImagen && (
                <div
                    className="fixed inset-0 z-[90] bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center p-6 cursor-zoom-out"
                    onClick={() => setAmpliada(false)}
                >
                    <button
                        onClick={() => setAmpliada(false)}
                        className="absolute top-4 right-4 p-2 rounded-xl bg-white/10 border border-white/15 text-slate-300 hover:text-white transition-all"
                        aria-label="Cerrar"
                    >
                        <X className="h-5 w-5" />
                    </button>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src={`/api/articulos/imagen/${encodeURIComponent(codigoBarras)}?v=${version}`}
                        alt={descripcion}
                        className="max-h-[82vh] max-w-[92vw] object-contain rounded-2xl bg-white/[0.04] border border-white/10 shadow-2xl shadow-black/60"
                    />
                    <p className="mt-4 text-[13px] font-bold text-slate-200 text-center max-w-2xl">
                        {descripcion}
                        <span className="block text-[11px] font-bold text-slate-500 mt-1">{codigoBarras}</span>
                    </p>
                </div>
            )}

            {esOficina && (
                <div className="flex items-center gap-1">
                    <input
                        ref={archivoRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={e => subir(e.target.files?.[0] ?? null)}
                    />
                    <button
                        onClick={() => archivoRef.current?.click()}
                        disabled={ocupado}
                        className="p-1.5 rounded-lg bg-white/[0.05] border border-white/10 text-slate-400 hover:text-emerald-300 hover:border-emerald-500/30 transition-all disabled:opacity-40"
                        title="Subir foto propia (manda sobre la automática)"
                    >
                        {ocupado ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                    </button>
                    <button
                        onClick={abrirSugerencias}
                        disabled={ocupado}
                        className="p-1.5 rounded-lg bg-white/[0.05] border border-white/10 text-slate-400 hover:text-cyan-300 hover:border-cyan-500/30 transition-all disabled:opacity-40"
                        title="Buscar imagen por descripción (Open Food Facts)"
                    >
                        <Search className="h-3 w-3" />
                    </button>
                    {!sinImagen && (
                        <button
                            onClick={quitar}
                            disabled={ocupado}
                            className="p-1.5 rounded-lg bg-white/[0.05] border border-white/10 text-slate-400 hover:text-rose-300 hover:border-rose-500/30 transition-all disabled:opacity-40"
                            title="Quitar imagen"
                        >
                            <Trash2 className="h-3 w-3" />
                        </button>
                    )}
                </div>
            )}
            {error && <p className="text-[9px] font-bold text-rose-300 max-w-[9rem] text-center">{error}</p>}

            {/* Modal de sugerencias por descripción */}
            {modalAbierto && (
                <div
                    className="fixed inset-0 z-[85] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
                    onClick={() => setModalAbierto(false)}
                >
                    <div
                        className="w-full max-w-lg max-h-[80vh] bg-[#0d1320] border border-white/10 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden flex flex-col"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="px-5 py-4 border-b border-white/10 bg-cyan-500/[0.06] flex items-center justify-between gap-3">
                            <div>
                                <h3 className="text-[14px] font-black text-white flex items-center gap-2">
                                    <Search className="h-4 w-4 text-cyan-300" /> Buscar imagen del producto
                                </h3>
                                <p className="text-[10px] font-bold text-slate-500 mt-1">
                                    Open Food Facts por descripción — elige la correcta
                                </p>
                            </div>
                            <button
                                onClick={() => setModalAbierto(false)}
                                className="p-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-400 hover:text-white transition-all"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="px-4 pt-3 flex gap-2">
                            <input
                                value={busqueda}
                                onChange={e => setBusqueda(e.target.value)}
                                onKeyDown={e => { if (e.key === "Enter") buscarSugerencias(busqueda) }}
                                placeholder="Descripción del producto..."
                                className="flex-1 px-3.5 py-2 bg-white/[0.03] border border-white/10 rounded-xl text-[13px] font-medium text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-400/60"
                            />
                            <button
                                onClick={() => buscarSugerencias(busqueda)}
                                disabled={buscando || !busqueda.trim()}
                                className="px-3 py-2 rounded-xl text-[11px] font-black bg-cyan-400 text-slate-950 hover:brightness-110 transition-all disabled:opacity-40"
                            >
                                Buscar
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4">
                            {buscando ? (
                                <div className="flex items-center justify-center py-10">
                                    <Loader2 className="h-6 w-6 text-cyan-400 animate-spin" />
                                </div>
                            ) : sugerencias.length === 0 ? (
                                <p className="text-[11px] font-bold text-slate-600 text-center py-8 px-4">
                                    Sin resultados — prueba con menos palabras (marca y producto) o sube la foto manualmente.
                                </p>
                            ) : (
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                    {sugerencias.map((s, i) => (
                                        <button
                                            key={i}
                                            onClick={() => elegirSugerencia(s)}
                                            disabled={ocupado}
                                            className={cn(
                                                "rounded-xl border border-white/10 bg-white/[0.03] p-2 text-left transition-all",
                                                "hover:border-cyan-400/50 hover:bg-cyan-500/[0.06] disabled:opacity-40"
                                            )}
                                            title={`${s.nombre}${s.marca ? ` · ${s.marca}` : ""}`}
                                        >
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img
                                                src={s.url}
                                                alt={s.nombre}
                                                className="w-full h-24 object-contain rounded-lg bg-white/[0.04]"
                                                loading="lazy"
                                            />
                                            <p className="text-[10px] font-bold text-slate-300 mt-1.5 truncate">{s.nombre}</p>
                                            {s.marca && <p className="text-[9px] font-bold text-slate-600 truncate">{s.marca}</p>}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
