"use client"

import { useEffect, useState } from "react"
import { ExternalLink, Lightbulb, Loader2, Newspaper, Sparkles, X } from "lucide-react"
import { cn } from "@/lib/utils"

// Tarjetas del día en el dashboard principal: clima según la IP del usuario
// (clic → noticias más importantes del día), tip de mejora continua para
// retail y reflexión del día (generados una vez al día en la base central).

interface Clima {
    temperatura: number
    sensacion: number
    humedad: number
    viento: number
    maxima: number
    minima: number
    probabilidadLluvia: number
    icono: string
    descripcion: string
}

interface Inspiracion {
    tip: { titulo: string; texto: string }
    reflexion: string
}

interface Noticia {
    titulo: string
    fuente: string
    hace: string
    url: string
}

const tarjeta = "bg-white/[0.04] border border-white/10 rounded-2xl p-5 backdrop-blur-xl"

export function TarjetasDia() {
    const [clima, setClima] = useState<Clima | null>(null)
    const [ciudad, setCiudad] = useState("")
    const [sinClima, setSinClima] = useState(false)
    const [inspiracion, setInspiracion] = useState<Inspiracion | null>(null)

    const [noticiasAbiertas, setNoticiasAbiertas] = useState(false)
    const [noticias, setNoticias] = useState<Noticia[] | null>(null)
    const [errorNoticias, setErrorNoticias] = useState("")

    // Clima: primero la ubicación por IP (ipwho.is, gratuito con CORS). OJO: la
    // IP pública de la red suele salir por el proveedor y geolocalizarse en
    // CDMX; solo se confía en ella si cae en Nuevo León — si no, Monterrey,
    // que es donde están las tiendas.
    useEffect(() => {
        let activo = true
        const cargar = async () => {
            let lat = ""
            let lon = ""
            let ciudadDetectada = "Monterrey"
            try {
                const res = await fetch("https://ipwho.is/", { signal: AbortSignal.timeout(4_000) })
                const geo = await res.json()
                const region = String(geo?.region ?? "")
                    .normalize("NFD")
                    .replace(/[̀-ͯ]/g, "")
                    .toLowerCase()
                if (geo?.success && region.includes("nuevo leon")
                    && Number.isFinite(geo.latitude) && Number.isFinite(geo.longitude)) {
                    lat = String(geo.latitude)
                    lon = String(geo.longitude)
                    ciudadDetectada = String(geo.city ?? "Monterrey")
                }
            } catch { /* sin geolocalización: clima de Monterrey */ }
            if (activo) setCiudad(ciudadDetectada)
            try {
                const res = await fetch(`/api/dashboard/clima${lat ? `?lat=${lat}&lon=${lon}` : ""}`)
                const json = await res.json()
                if (!res.ok) throw new Error(json.error)
                if (activo) setClima(json)
            } catch {
                if (activo) setSinClima(true)
            }
        }
        cargar()
        return () => { activo = false }
    }, [])

    // Tip y reflexión del día (compartidos por todos, generados una vez al día)
    useEffect(() => {
        let activo = true
        fetch("/api/dashboard/inspiracion")
            .then(r => r.json())
            .then(d => { if (activo && d?.tip) setInspiracion(d) })
            .catch(() => { /* sin tarjetas de contenido si el central no responde */ })
        return () => { activo = false }
    }, [])

    // Esc cierra el modal de noticias
    useEffect(() => {
        if (!noticiasAbiertas) return
        const alTeclear = (e: KeyboardEvent) => { if (e.key === "Escape") setNoticiasAbiertas(false) }
        window.addEventListener("keydown", alTeclear)
        return () => window.removeEventListener("keydown", alTeclear)
    }, [noticiasAbiertas])

    const abrirNoticias = () => {
        setNoticiasAbiertas(true)
        if (noticias) return
        fetch("/api/dashboard/noticias")
            .then(r => r.json().then(json => ({ ok: r.ok, json })))
            .then(({ ok, json }) => {
                if (!ok) throw new Error(json.error)
                setNoticias(json.noticias ?? [])
            })
            .catch(err => setErrorNoticias(err instanceof Error ? err.message : "No fue posible consultar las noticias"))
    }

    return (
        <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Clima (clic → noticias del día) */}
                <button
                    onClick={abrirNoticias}
                    className={cn(tarjeta, "text-left transition-all hover:border-sky-400/40 hover:bg-sky-500/[0.06] cursor-pointer")}
                    title="Clic para ver las noticias más importantes del día"
                >
                    <div className="flex items-center justify-between mb-3">
                        <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest">
                            Clima {ciudad ? `· ${ciudad}` : ""}
                        </p>
                        <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-sky-300/80">
                            <Newspaper className="h-3 w-3" /> Noticias
                        </span>
                    </div>
                    {clima ? (
                        <div className="flex items-center gap-4">
                            <span className="text-5xl" aria-hidden>{clima.icono}</span>
                            <div className="min-w-0">
                                <p className="text-3xl font-black text-white tracking-tight leading-none">
                                    {clima.temperatura}°C
                                </p>
                                <p className="text-[12px] font-bold text-slate-400 mt-1">{clima.descripcion}</p>
                                <p className="text-[11px] font-bold text-slate-500 mt-0.5">
                                    ↑{clima.maxima}° ↓{clima.minima}°
                                    {clima.probabilidadLluvia > 20 ? ` · 🌧️ ${clima.probabilidadLluvia}%` : ""}
                                    {` · 💨 ${clima.viento} km/h`}
                                </p>
                            </div>
                        </div>
                    ) : sinClima ? (
                        <p className="text-[12px] font-bold text-slate-500 py-3">
                            Sin datos de clima por ahora — el clic sigue abriendo las noticias del día.
                        </p>
                    ) : (
                        <div className="flex items-center gap-2 py-3">
                            <Loader2 className="h-4 w-4 text-sky-400 animate-spin" />
                            <span className="text-[11px] font-bold text-slate-500">Consultando el clima…</span>
                        </div>
                    )}
                </button>

                {/* Tip de mejora continua */}
                <div className={tarjeta}>
                    <p className="flex items-center gap-1.5 text-[11px] font-black text-amber-300/90 uppercase tracking-widest mb-3">
                        <Lightbulb className="h-3.5 w-3.5" /> Tip de mejora continua
                    </p>
                    {inspiracion ? (
                        <>
                            <p className="text-[14px] font-black text-white leading-snug">{inspiracion.tip.titulo}</p>
                            <p className="text-[12px] font-medium text-slate-300 mt-1.5 leading-relaxed">{inspiracion.tip.texto}</p>
                        </>
                    ) : (
                        <div className="flex items-center gap-2 py-3">
                            <Loader2 className="h-4 w-4 text-amber-400 animate-spin" />
                            <span className="text-[11px] font-bold text-slate-500">Preparando el tip de hoy…</span>
                        </div>
                    )}
                </div>

                {/* Reflexión del día */}
                <div className={tarjeta}>
                    <p className="flex items-center gap-1.5 text-[11px] font-black text-violet-300/90 uppercase tracking-widest mb-3">
                        <Sparkles className="h-3.5 w-3.5" /> Reflexión del día
                    </p>
                    {inspiracion ? (
                        <p className="text-[13px] font-medium italic text-slate-200 leading-relaxed">
                            “{inspiracion.reflexion}”
                        </p>
                    ) : (
                        <div className="flex items-center gap-2 py-3">
                            <Loader2 className="h-4 w-4 text-violet-400 animate-spin" />
                            <span className="text-[11px] font-bold text-slate-500">Preparando la reflexión…</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Modal: noticias más importantes del día */}
            {noticiasAbiertas && (
                <div
                    className="fixed inset-0 z-[85] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
                    onClick={() => setNoticiasAbiertas(false)}
                >
                    <div
                        className="w-full max-w-xl max-h-[82vh] bg-[#0d1320] border border-white/10 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden flex flex-col"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="px-5 py-4 border-b border-white/10 bg-sky-500/[0.06] flex items-center justify-between gap-3">
                            <h3 className="text-[14px] font-black text-white flex items-center gap-2">
                                <Newspaper className="h-4 w-4 text-sky-300" /> Noticias del día
                            </h3>
                            <button
                                onClick={() => setNoticiasAbiertas(false)}
                                className="p-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-400 hover:text-white transition-all"
                                aria-label="Cerrar"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-3">
                            {errorNoticias ? (
                                <p className="text-[12px] font-bold text-rose-300 text-center py-8 px-4">{errorNoticias}</p>
                            ) : !noticias ? (
                                <div className="flex items-center justify-center py-12">
                                    <Loader2 className="h-6 w-6 text-sky-400 animate-spin" />
                                </div>
                            ) : noticias.length === 0 ? (
                                <p className="text-[12px] font-bold text-slate-600 text-center py-8">Sin noticias por ahora.</p>
                            ) : (
                                <div className="space-y-1.5">
                                    {noticias.map((n, i) => (
                                        <a
                                            key={i}
                                            href={n.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="block rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 hover:border-sky-400/40 hover:bg-sky-500/[0.06] transition-all"
                                        >
                                            <p className="text-[13px] font-bold text-slate-100 leading-snug flex items-start gap-2">
                                                <span className="flex-1">{n.titulo}</span>
                                                <ExternalLink className="h-3.5 w-3.5 shrink-0 mt-0.5 text-slate-500" />
                                            </p>
                                            <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider mt-1">
                                                {n.fuente}{n.hace ? ` · ${n.hace}` : ""}
                                            </p>
                                        </a>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    )
}
