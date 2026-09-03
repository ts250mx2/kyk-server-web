"use client"

import { useCallback, useEffect, useState } from "react"
import QRCode from "qrcode"
import { BarChart3, Copy, Download, ExternalLink, History, Loader2, QrCode, RefreshCw, Save, Settings2 } from "lucide-react"
import { cn } from "@/lib/utils"
import EditorPreguntas, { type PreguntaEditable } from "@/components/encuestas/EditorPreguntas"
import ReporteEncuestas, { type Reporte } from "@/components/encuestas/ReporteEncuestas"
import HistorialCapturas, { type CapturaHistorial } from "@/components/encuestas/HistorialCapturas"
import { ESCALA, MAX_TEXTO_CONFIG_LEN, type ConfigEncuesta } from "@/lib/encuestas-tipos"

// Encuestas de satisfacción de CLIENTES (plantilla oficial de Kesos y Kosas):
// cada sucursal tiene su QR con liga propia; aquí oficina ve el reporte (NPS),
// el historial de encuestas levantadas en tienda (cliente, foto, ticket),
// administra los QR y configura textos y preguntas. Todo vive en BDKYKPortal.

interface TiendaQr { idTienda: number; tienda: string; uuid: string; activa: boolean }

const tarjeta = "bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl"
const campo = "w-full px-3.5 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-[13px] font-medium text-slate-100 placeholder-slate-600 focus:outline-none focus:border-emerald-400/50"
const etiquetaCampo = "block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 mt-3"
const botonIcono = "p-2 rounded-lg bg-white/[0.05] border border-white/10 text-slate-400 transition-all"
const AVISO_MS = 2500

const PESTANAS = [
    ["reporte", "Reporte", BarChart3],
    ["historial", "Historial", History],
    ["qr", "QR por sucursal", QrCode],
    ["config", "Configuración", Settings2],
] as const
type Pestana = typeof PESTANAS[number][0]

/** Parámetros de filtro compartidos por reporte e historial. */
function parametrosFiltro(fechaInicio: string, fechaFin: string, idTienda: number): URLSearchParams {
    const parametros = new URLSearchParams()
    if (fechaInicio) parametros.set("fechaInicio", fechaInicio)
    if (fechaFin) parametros.set("fechaFin", fechaFin)
    if (idTienda > 0) parametros.set("idTienda", String(idTienda))
    return parametros
}

export default function EncuestasPage() {
    const [pestana, setPestana] = useState<Pestana>("reporte")
    const [config, setConfig] = useState<ConfigEncuesta | null>(null)
    const [preguntas, setPreguntas] = useState<PreguntaEditable[]>([])
    const [tiendas, setTiendas] = useState<TiendaQr[]>([])
    const [qrs, setQrs] = useState<Record<number, string>>({})
    const [error, setError] = useState("")
    const [aviso, setAviso] = useState("")
    const [guardando, setGuardando] = useState(false)

    const [reporte, setReporte] = useState<Reporte | null>(null)
    const [historial, setHistorial] = useState<CapturaHistorial[] | null>(null)
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
            const parametros = parametrosFiltro(fechaInicio, fechaFin, tiendaFiltro)
            const res = await fetch(`/api/encuestas-clientes/reporte?${parametros}`)
            const json = await res.json()
            if (res.ok) setReporte(json)
        } catch { /* el reporte reintenta con el botón */ }
    }, [fechaInicio, fechaFin, tiendaFiltro])

    const cargarHistorial = useCallback(async () => {
        try {
            const parametros = parametrosFiltro(fechaInicio, fechaFin, tiendaFiltro)
            const res = await fetch(`/api/encuestas-clientes/historial?${parametros}`)
            const json = await res.json()
            if (res.ok) setHistorial(json.capturas ?? [])
        } catch { /* el historial reintenta con el botón */ }
    }, [fechaInicio, fechaFin, tiendaFiltro])

    const actualizar = () => {
        cargarReporte()
        cargarHistorial()
    }

    // Cargas iniciales como callback diferido (los setState viven en el .then)
    useEffect(() => {
        const t = setTimeout(cargarAdmin, 0)
        return () => clearTimeout(t)
    }, [cargarAdmin])
    useEffect(() => {
        const t = setTimeout(cargarReporte, 0)
        return () => clearTimeout(t)
    }, [cargarReporte])
    useEffect(() => {
        const t = setTimeout(cargarHistorial, 0)
        return () => clearTimeout(t)
    }, [cargarHistorial])

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
        setTimeout(() => setAviso(""), AVISO_MS)
    }

    const accionQr = async (idTienda: number, accion: string) => {
        const res = await fetch("/api/encuestas-clientes/qr", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ idTienda, accion }),
        })
        if (res.ok) { avisar(accion === "rotar" ? "Liga nueva generada" : "Listo"); cargarAdmin() }
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

    const campoConfig = (clave: keyof ConfigEncuesta, nombre: string) => config && (
        <>
            <label className={etiquetaCampo}>{nombre}</label>
            <input
                value={String(config[clave])}
                onChange={e => setConfig({ ...config, [clave]: e.target.value })}
                maxLength={MAX_TEXTO_CONFIG_LEN}
                className={campo}
            />
        </>
    )

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
                {PESTANAS.map(([clave, nombre, Icono]) => (
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

            {/* ── Reporte e historial (comparten filtros) ── */}
            {(pestana === "reporte" || pestana === "historial") && (
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
                        <button onClick={actualizar} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 hover:text-emerald-300 font-black text-[11px] uppercase tracking-widest transition-all">
                            <RefreshCw className="h-3.5 w-3.5" /> Actualizar
                        </button>
                    </div>

                    {pestana === "reporte" && (!reporte ? (
                        <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 text-emerald-400 animate-spin" /></div>
                    ) : (
                        <ReporteEncuestas reporte={reporte} />
                    ))}
                    {pestana === "historial" && (!historial ? (
                        <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 text-emerald-400 animate-spin" /></div>
                    ) : (
                        <HistorialCapturas capturas={historial} />
                    ))}
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
                            <a href={`/encuesta/${t.uuid}`} target="_blank" rel="noopener noreferrer"
                                className="text-[9px] font-bold text-slate-500 hover:text-cyan-300 mt-2 break-all text-center transition-colors"
                                title="Abrir la encuesta">
                                /encuesta/{t.uuid}
                            </a>
                            <div className="flex flex-wrap justify-center gap-1.5 mt-3">
                                <a href={`/encuesta/${t.uuid}`} target="_blank" rel="noopener noreferrer"
                                    title="Abrir la encuesta en una pestaña nueva"
                                    className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-[10px] font-black uppercase tracking-widest hover:bg-cyan-500/25 transition-all">
                                    <ExternalLink className="h-3.5 w-3.5" /> Abrir
                                </a>
                                <button onClick={() => copiarLiga(t.uuid)} title="Copiar la liga"
                                    className={cn(botonIcono, "hover:text-emerald-300")}>
                                    <Copy className="h-3.5 w-3.5" />
                                </button>
                                <a href={qrs[t.idTienda] ?? "#"} download={`qr-encuesta-${t.tienda.replace(/\s+/g, "-").toLowerCase()}.png`}
                                    title="Descargar el QR (imprímelo para la tienda)"
                                    className={cn(botonIcono, "hover:text-cyan-300")}>
                                    <Download className="h-3.5 w-3.5" />
                                </a>
                                <button onClick={() => accionQr(t.idTienda, "rotar")} title="Rotar la liga (la anterior deja de servir)"
                                    className={cn(botonIcono, "hover:text-amber-300")}>
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
                        {campoConfig("titulo", "Título")}
                        {campoConfig("subtitulo", "Subtítulo")}
                        {campoConfig("subtitulo2", "Subtítulo 2")}
                        <label className={etiquetaCampo}>Comentario abierto cuando una respuesta (llevada a 1-5) sea ≤ (0 = nunca)</label>
                        <input type="number" min={0} max={ESCALA} value={config.umbralComentario}
                            onChange={e => setConfig({ ...config, umbralComentario: Number(e.target.value) })} className={campo} />
                        {campoConfig("tituloComentario", "Título del comentario")}
                        {campoConfig("textoComentario", "Texto del comentario")}
                        <label className="mt-4 flex items-center gap-2 text-[12px] font-bold text-slate-300">
                            <input type="checkbox" checked={config.regaloActivo}
                                onChange={e => setConfig({ ...config, regaloActivo: e.target.checked })} className="h-4 w-4 accent-emerald-500" />
                            Pedir contacto para promociones
                        </label>
                        {config.regaloActivo && (
                            <>
                                {campoConfig("tituloRegalo", "Título del bloque de contacto")}
                                {campoConfig("textoRegalo", "Texto del bloque de contacto")}
                                {campoConfig("textoPromos", "Texto del checkbox de promociones")}
                            </>
                        )}
                        {campoConfig("textoBotonEnviar", "Texto del botón enviar")}
                        {campoConfig("tituloGracias", "Título de gracias")}
                        {campoConfig("textoGracias", "Texto de gracias")}
                    </div>

                    <div className={cn(tarjeta, "p-5")}>
                        <EditorPreguntas preguntas={preguntas} onChange={setPreguntas} onAviso={avisar} />
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
