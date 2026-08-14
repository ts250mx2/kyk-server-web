"use client"

import { useCallback, useEffect, useState } from "react"
import QRCode from "qrcode"
import {
    BarChart3, Copy, Download, Loader2, Plus, QrCode, RefreshCw, Save,
    Settings2, Star, Trash2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { fmtInt } from "@/lib/format"

// Encuestas de satisfacción de CLIENTES (modelo Foodie Solutions para KYK):
// cada sucursal tiene su QR con liga propia; aquí oficina ve el reporte,
// administra los QR y configura textos y preguntas. Todo vive en BDKYKPortal.

interface Pregunta { idPregunta?: number; pregunta: string; tipo: "estrellas" | "opciones"; etiquetas: string[] }
interface TiendaQr { idTienda: number; tienda: string; uuid: string; activa: boolean }
interface Config {
    titulo: string; subtitulo: string; subtitulo2: string; umbralComentario: number
    tituloComentario: string; textoComentario: string; regaloActivo: boolean
    tituloRegalo: string; textoRegalo: string; textoPromos: string
    textoBotonEnviar: string; tituloGracias: string; textoGracias: string
}
interface Reporte {
    totales: { respuestas: number; promedio: number | null }
    porPregunta: { idPregunta: number; pregunta: string; total: number; promedio: number; distribucion: number[] }[]
    porTienda: { idTienda: number; tienda: string; respuestas: number; promedio: number }[]
    comentarios: { tienda: string; comentario: string; fecha: string; promedio: number }[]
    contactos: { tienda: string; correo: string; telefono: string; aceptaPromos: boolean; fecha: string }[]
}

const tarjeta = "bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl"
const campo = "w-full px-3.5 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-[13px] font-medium text-slate-100 placeholder-slate-600 focus:outline-none focus:border-emerald-400/50"
const etiquetaCampo = "block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 mt-3"

export default function EncuestasPage() {
    const [pestana, setPestana] = useState<"reporte" | "qr" | "config">("reporte")
    const [config, setConfig] = useState<Config | null>(null)
    const [preguntas, setPreguntas] = useState<Pregunta[]>([])
    const [tiendas, setTiendas] = useState<TiendaQr[]>([])
    const [qrs, setQrs] = useState<Record<number, string>>({})
    const [error, setError] = useState("")
    const [aviso, setAviso] = useState("")
    const [guardando, setGuardando] = useState(false)

    const [reporte, setReporte] = useState<Reporte | null>(null)
    const [fechaInicio, setFechaInicio] = useState("")
    const [fechaFin, setFechaFin] = useState("")
    const [tiendaFiltro, setTiendaFiltro] = useState(0)

    // Panorama del módulo (config + preguntas + QRs; genera UUIDs faltantes)
    const cargarAdmin = useCallback(async () => {
        try {
            const res = await fetch("/api/encuestas-clientes/admin")
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "No fue posible cargar el módulo")
            setConfig(json.config)
            setPreguntas(json.preguntas ?? [])
            setTiendas(json.tiendas ?? [])
            setError("")
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "No fue posible cargar el módulo")
        }
    }, [])

    const cargarReporte = useCallback(async () => {
        try {
            const parametros = new URLSearchParams()
            if (fechaInicio) parametros.set("fechaInicio", fechaInicio)
            if (fechaFin) parametros.set("fechaFin", fechaFin)
            if (tiendaFiltro > 0) parametros.set("idTienda", String(tiendaFiltro))
            const res = await fetch(`/api/encuestas-clientes/reporte?${parametros}`)
            const json = await res.json()
            if (res.ok) setReporte(json)
        } catch { /* el reporte reintenta con el botón */ }
    }, [fechaInicio, fechaFin, tiendaFiltro])

    // Cargas iniciales como callback diferido (los setState viven en el .then)
    useEffect(() => {
        const t = setTimeout(cargarAdmin, 0)
        return () => clearTimeout(t)
    }, [cargarAdmin])
    useEffect(() => {
        const t = setTimeout(cargarReporte, 0)
        return () => clearTimeout(t)
    }, [cargarReporte])

    // QR como imagen por tienda (se generan en el navegador)
    useEffect(() => {
        let activo = true
        const generar = async () => {
            const nuevos: Record<number, string> = {}
            for (const t of tiendas) {
                try {
                    nuevos[t.idTienda] = await QRCode.toDataURL(
                        `${window.location.origin}/encuesta/${t.uuid}`,
                        { width: 480, margin: 2, color: { dark: "#0a0e14", light: "#ffffff" } }
                    )
                } catch { /* QR opcional */ }
            }
            if (activo) setQrs(nuevos)
        }
        if (tiendas.length > 0) generar()
        return () => { activo = false }
    }, [tiendas])

    const avisar = (texto: string) => {
        setAviso(texto)
        setTimeout(() => setAviso(""), 2500)
    }

    const accionQr = async (idTienda: number, accion: string) => {
        const res = await fetch("/api/encuestas-clientes/qr", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ idTienda, accion }),
        })
        if (res.ok) { avisar(accion === "rotar" ? "Liga nueva generada" : "Listo") ; cargarAdmin() }
    }

    const copiarLiga = (uuid: string) => {
        navigator.clipboard?.writeText(`${window.location.origin}/encuesta/${uuid}`)
            .then(() => avisar("Liga copiada"))
            .catch(() => avisar("No se pudo copiar"))
    }

    const guardar = async () => {
        if (!config || guardando) return
        setGuardando(true)
        try {
            const res = await fetch("/api/encuestas-clientes/config", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ config, preguntas }),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "No fue posible guardar")
            avisar("Configuración guardada")
            cargarAdmin()
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "No fue posible guardar")
        } finally {
            setGuardando(false)
        }
    }

    const cambiarPregunta = (i: number, cambios: Partial<Pregunta>) => {
        setPreguntas(prev => prev.map((p, j) => (j === i ? { ...p, ...cambios } : p)))
    }

    if (error && !config) {
        return <p className="text-[13px] font-bold text-rose-300 py-20 text-center">{error}</p>
    }

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-black text-white uppercase tracking-tight">Encuestas de clientes</h1>
                    <p className="text-[12px] font-bold text-slate-500 mt-1">
                        El cliente escanea el QR de su sucursal y opina — cada sucursal tiene su propia liga
                    </p>
                </div>
                {aviso && (
                    <span className="text-[11px] font-black text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 rounded-xl px-3 py-2 uppercase tracking-widest">
                        {aviso}
                    </span>
                )}
            </div>

            {/* Pestañas */}
            <div className="flex gap-1.5">
                {([["reporte", "Reporte", BarChart3], ["qr", "QR por sucursal", QrCode], ["config", "Configuración", Settings2]] as const).map(([clave, nombre, Icono]) => (
                    <button
                        key={clave}
                        onClick={() => setPestana(clave)}
                        className={cn(
                            "flex items-center gap-2 px-4 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest border transition-all",
                            pestana === clave
                                ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300"
                                : "bg-white/[0.03] border-white/10 text-slate-400 hover:text-white"
                        )}
                    >
                        <Icono className="h-3.5 w-3.5" /> {nombre}
                    </button>
                ))}
            </div>

            {/* ── Reporte ── */}
            {pestana === "reporte" && (
                <div className="space-y-4">
                    <div className={cn(tarjeta, "p-4 flex flex-wrap items-end gap-3")}>
                        <div>
                            <label className={etiquetaCampo}>Desde</label>
                            <input type="date" value={fechaInicio} onChange={e => setFechaInicio(e.target.value)} className={campo} />
                        </div>
                        <div>
                            <label className={etiquetaCampo}>Hasta</label>
                            <input type="date" value={fechaFin} onChange={e => setFechaFin(e.target.value)} className={campo} />
                        </div>
                        <div>
                            <label className={etiquetaCampo}>Sucursal</label>
                            <select value={tiendaFiltro} onChange={e => setTiendaFiltro(Number(e.target.value))} className={campo}>
                                <option value={0}>Todas</option>
                                {tiendas.map(t => <option key={t.idTienda} value={t.idTienda}>{t.tienda}</option>)}
                            </select>
                        </div>
                        <button onClick={cargarReporte} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 hover:text-emerald-300 font-black text-[11px] uppercase tracking-widest transition-all">
                            <RefreshCw className="h-3.5 w-3.5" /> Actualizar
                        </button>
                    </div>

                    {!reporte ? (
                        <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 text-emerald-400 animate-spin" /></div>
                    ) : (
                        <>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <div className={cn(tarjeta, "p-5")}>
                                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Respuestas</p>
                                    <p className="text-3xl font-black text-white mt-1">{fmtInt(reporte.totales.respuestas)}</p>
                                </div>
                                <div className={cn(tarjeta, "p-5")}>
                                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Calificación promedio</p>
                                    <p className="text-3xl font-black text-amber-300 mt-1 flex items-center gap-2">
                                        {reporte.totales.promedio ?? "—"} <Star className="h-6 w-6 fill-amber-400 text-amber-400" />
                                    </p>
                                </div>
                                <div className={cn(tarjeta, "p-5")}>
                                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Contactos capturados</p>
                                    <p className="text-3xl font-black text-emerald-300 mt-1">{fmtInt(reporte.contactos.length)}</p>
                                </div>
                            </div>

                            <div className={cn(tarjeta, "p-5")}>
                                <h3 className="text-[12px] font-black text-slate-300 uppercase tracking-widest mb-3">Por pregunta</h3>
                                <div className="space-y-3">
                                    {reporte.porPregunta.map(p => {
                                        const max = Math.max(...p.distribucion, 1)
                                        return (
                                            <div key={p.idPregunta} className="border border-white/[0.06] rounded-xl p-3">
                                                <div className="flex items-center justify-between gap-3">
                                                    <p className="text-[13px] font-bold text-slate-100">{p.pregunta}</p>
                                                    <span className="shrink-0 text-[14px] font-black text-amber-300">{p.promedio} ★</span>
                                                </div>
                                                <div className="mt-2 flex items-end gap-1.5 h-10">
                                                    {p.distribucion.map((cuenta, i) => (
                                                        <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                                                            <div
                                                                className={cn("w-full rounded-t", i >= 3 ? "bg-emerald-400/70" : i === 2 ? "bg-amber-400/70" : "bg-rose-400/70")}
                                                                style={{ height: `${Math.max(6, (cuenta / max) * 100)}%` }}
                                                                title={`${cuenta} respuestas de ${i + 1}`}
                                                            />
                                                            <span className="text-[9px] font-black text-slate-600">{i + 1}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                                <p className="text-[10px] font-bold text-slate-600 mt-1">{fmtInt(p.total)} respuestas</p>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                <div className={cn(tarjeta, "p-5")}>
                                    <h3 className="text-[12px] font-black text-slate-300 uppercase tracking-widest mb-3">Por sucursal</h3>
                                    <div className="space-y-1.5">
                                        {reporte.porTienda.map(t => (
                                            <div key={t.idTienda} className="flex items-center justify-between border border-white/[0.06] rounded-xl px-3 py-2">
                                                <span className="text-[13px] font-bold text-slate-100">{t.tienda}</span>
                                                <span className="text-[12px] font-black text-slate-400">
                                                    {fmtInt(t.respuestas)} resp · <span className="text-amber-300">{t.promedio} ★</span>
                                                </span>
                                            </div>
                                        ))}
                                        {reporte.porTienda.length === 0 && (
                                            <p className="text-[11px] font-bold text-slate-600 py-4 text-center">Sin respuestas todavía</p>
                                        )}
                                    </div>
                                </div>
                                <div className={cn(tarjeta, "p-5")}>
                                    <h3 className="text-[12px] font-black text-slate-300 uppercase tracking-widest mb-3">Comentarios recientes</h3>
                                    <div className="space-y-2 max-h-80 overflow-y-auto">
                                        {reporte.comentarios.map((c, i) => (
                                            <div key={i} className="border border-white/[0.06] rounded-xl px-3 py-2">
                                                <p className="text-[12px] font-medium text-slate-200 whitespace-pre-wrap">{c.comentario}</p>
                                                <p className="text-[10px] font-black text-slate-600 mt-1 uppercase tracking-wider">
                                                    {c.tienda} · {c.promedio} ★ · {String(c.fecha).slice(0, 16).replace("T", " ")}
                                                </p>
                                            </div>
                                        ))}
                                        {reporte.comentarios.length === 0 && (
                                            <p className="text-[11px] font-bold text-slate-600 py-4 text-center">Sin comentarios en el rango</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* ── QR por sucursal ── */}
            {pestana === "qr" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                    {tiendas.map(t => (
                        <div key={t.idTienda} className={cn(tarjeta, "p-5 flex flex-col items-center", !t.activa && "opacity-60")}>
                            <p className="text-[13px] font-black text-white uppercase tracking-widest">{t.tienda}</p>
                            {qrs[t.idTienda] ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={qrs[t.idTienda]} alt={`QR de ${t.tienda}`} className="w-44 h-44 rounded-xl bg-white p-1 mt-3" />
                            ) : (
                                <div className="w-44 h-44 flex items-center justify-center"><Loader2 className="h-6 w-6 text-slate-600 animate-spin" /></div>
                            )}
                            <p className="text-[9px] font-bold text-slate-600 mt-2 break-all text-center">/encuesta/{t.uuid}</p>
                            <div className="flex flex-wrap justify-center gap-1.5 mt-3">
                                <button onClick={() => copiarLiga(t.uuid)} title="Copiar la liga"
                                    className="p-2 rounded-lg bg-white/[0.05] border border-white/10 text-slate-400 hover:text-emerald-300 transition-all">
                                    <Copy className="h-3.5 w-3.5" />
                                </button>
                                <a href={qrs[t.idTienda] ?? "#"} download={`qr-encuesta-${t.tienda.replace(/\s+/g, "-").toLowerCase()}.png`}
                                    title="Descargar el QR (imprímelo para la tienda)"
                                    className="p-2 rounded-lg bg-white/[0.05] border border-white/10 text-slate-400 hover:text-cyan-300 transition-all">
                                    <Download className="h-3.5 w-3.5" />
                                </a>
                                <button onClick={() => accionQr(t.idTienda, "rotar")} title="Rotar la liga (la anterior deja de servir)"
                                    className="p-2 rounded-lg bg-white/[0.05] border border-white/10 text-slate-400 hover:text-amber-300 transition-all">
                                    <RefreshCw className="h-3.5 w-3.5" />
                                </button>
                                <button onClick={() => accionQr(t.idTienda, t.activa ? "desactivar" : "activar")}
                                    className={cn(
                                        "px-2.5 py-2 rounded-lg border text-[10px] font-black uppercase tracking-widest transition-all",
                                        t.activa
                                            ? "bg-white/[0.05] border-white/10 text-slate-400 hover:text-rose-300"
                                            : "bg-emerald-500/15 border-emerald-500/30 text-emerald-300"
                                    )}>
                                    {t.activa ? "Desactivar" : "Activar"}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* ── Configuración ── */}
            {pestana === "config" && config && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                    <div className={cn(tarjeta, "p-5")}>
                        <h3 className="text-[12px] font-black text-slate-300 uppercase tracking-widest">Textos de la encuesta</h3>
                        <label className={etiquetaCampo}>Título</label>
                        <input value={config.titulo} onChange={e => setConfig({ ...config, titulo: e.target.value })} maxLength={300} className={campo} />
                        <label className={etiquetaCampo}>Subtítulo</label>
                        <input value={config.subtitulo} onChange={e => setConfig({ ...config, subtitulo: e.target.value })} maxLength={300} className={campo} />
                        <label className={etiquetaCampo}>Subtítulo 2</label>
                        <input value={config.subtitulo2} onChange={e => setConfig({ ...config, subtitulo2: e.target.value })} maxLength={300} className={campo} />
                        <label className={etiquetaCampo}>Comentario abierto cuando una respuesta sea ≤ (0 = nunca)</label>
                        <input type="number" min={0} max={5} value={config.umbralComentario}
                            onChange={e => setConfig({ ...config, umbralComentario: Number(e.target.value) })} className={campo} />
                        <label className={etiquetaCampo}>Título del comentario</label>
                        <input value={config.tituloComentario} onChange={e => setConfig({ ...config, tituloComentario: e.target.value })} maxLength={300} className={campo} />
                        <label className={etiquetaCampo}>Texto del comentario</label>
                        <input value={config.textoComentario} onChange={e => setConfig({ ...config, textoComentario: e.target.value })} maxLength={300} className={campo} />
                        <label className="mt-4 flex items-center gap-2 text-[12px] font-bold text-slate-300">
                            <input type="checkbox" checked={config.regaloActivo}
                                onChange={e => setConfig({ ...config, regaloActivo: e.target.checked })} className="h-4 w-4 accent-emerald-500" />
                            Pedir contacto para promociones
                        </label>
                        {config.regaloActivo && (
                            <>
                                <label className={etiquetaCampo}>Título del bloque de contacto</label>
                                <input value={config.tituloRegalo} onChange={e => setConfig({ ...config, tituloRegalo: e.target.value })} maxLength={300} className={campo} />
                                <label className={etiquetaCampo}>Texto del bloque de contacto</label>
                                <input value={config.textoRegalo} onChange={e => setConfig({ ...config, textoRegalo: e.target.value })} maxLength={300} className={campo} />
                                <label className={etiquetaCampo}>Texto del checkbox de promociones</label>
                                <input value={config.textoPromos} onChange={e => setConfig({ ...config, textoPromos: e.target.value })} maxLength={300} className={campo} />
                            </>
                        )}
                        <label className={etiquetaCampo}>Texto del botón enviar</label>
                        <input value={config.textoBotonEnviar} onChange={e => setConfig({ ...config, textoBotonEnviar: e.target.value })} maxLength={300} className={campo} />
                        <label className={etiquetaCampo}>Título de gracias</label>
                        <input value={config.tituloGracias} onChange={e => setConfig({ ...config, tituloGracias: e.target.value })} maxLength={300} className={campo} />
                        <label className={etiquetaCampo}>Texto de gracias</label>
                        <input value={config.textoGracias} onChange={e => setConfig({ ...config, textoGracias: e.target.value })} maxLength={300} className={campo} />
                    </div>

                    <div className={cn(tarjeta, "p-5")}>
                        <div className="flex items-center justify-between">
                            <h3 className="text-[12px] font-black text-slate-300 uppercase tracking-widest">Preguntas</h3>
                            <button
                                onClick={() => setPreguntas(prev => [...prev, { pregunta: "", tipo: "estrellas", etiquetas: [] }])}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[10px] font-black uppercase tracking-widest transition-all hover:bg-emerald-500/25">
                                <Plus className="h-3 w-3" /> Agregar
                            </button>
                        </div>
                        <div className="space-y-3 mt-3">
                            {preguntas.map((p, i) => (
                                <div key={p.idPregunta ?? `nueva-${i}`} className="border border-white/[0.06] rounded-xl p-3">
                                    <div className="flex items-start gap-2">
                                        <span className="mt-2 text-[11px] font-black text-slate-600">{i + 1}.</span>
                                        <div className="flex-1 space-y-2">
                                            <input value={p.pregunta} maxLength={255} placeholder="Texto de la pregunta"
                                                onChange={e => cambiarPregunta(i, { pregunta: e.target.value })} className={campo} />
                                            <div className="flex gap-2">
                                                <select value={p.tipo}
                                                    onChange={e => cambiarPregunta(i, { tipo: e.target.value as Pregunta["tipo"] })}
                                                    className={cn(campo, "w-36")}>
                                                    <option value="estrellas">Estrellas 1-5</option>
                                                    <option value="opciones">Opciones</option>
                                                </select>
                                                <input
                                                    value={p.etiquetas.join(", ")}
                                                    onChange={e => cambiarPregunta(i, { etiquetas: e.target.value.split(",").map(s => s.trim()) })}
                                                    placeholder={p.tipo === "opciones" ? "Opciones de MEJOR a peor, separadas por coma" : "Etiquetas 1..5 (opcional)"}
                                                    className={campo}
                                                />
                                            </div>
                                        </div>
                                        <button onClick={() => setPreguntas(prev => prev.filter((_, j) => j !== i))}
                                            title="Quitar pregunta (el histórico de respuestas se conserva)"
                                            className="p-2 rounded-lg bg-white/[0.05] border border-white/10 text-slate-500 hover:text-rose-300 transition-all">
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <button onClick={guardar} disabled={guardando}
                            className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-500 text-slate-950 font-black text-[12px] uppercase tracking-widest hover:brightness-110 transition-all disabled:opacity-50">
                            {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                            Guardar configuración y preguntas
                        </button>
                        {error && <p className="text-[11px] font-black text-rose-300 mt-2">{error}</p>}
                    </div>
                </div>
            )}
        </div>
    )
}
