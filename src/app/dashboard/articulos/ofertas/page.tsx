"use client"

import { useCallback, useEffect, useState } from "react"
import { Search, Loader2, AlertTriangle, ListRestart, Tag, FileText, FileSpreadsheet } from "lucide-react"
import { cn } from "@/lib/utils"
import { fmtMoney, fmtInt, fmtFechaHora, fmtPct } from "@/lib/format"
import { exportarPdf, exportarExcel, obtenerTiendaSesion, sufijoArchivo } from "@/lib/export"

type TipoOferta = "internas" | "publicadas"

interface Oferta {
    codigoInterno: number
    codigoBarras: string
    descripcion: string
    unidad: string
    precio: number
    precioOferta: number
    descuento: number
    fechaInicio?: string
    fechaFin?: string
    estado?: "vigente" | "porIniciar" | "vencida"
}

const lbl = "text-[10px] font-black text-slate-500 uppercase tracking-widest"
const inputCls = "block w-full px-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-400/25 focus:border-emerald-400/60 transition-all"

const ESTADOS = {
    vigente: { texto: "Vigente", clases: "text-emerald-300 bg-emerald-500/10 border-emerald-500/25" },
    porIniciar: { texto: "Por iniciar", clases: "text-cyan-300 bg-cyan-500/10 border-cyan-500/25" },
    vencida: { texto: "Vencida", clases: "text-rose-300 bg-rose-500/10 border-rose-500/25" },
} as const

export default function OfertasPage() {
    const [tipo, setTipo] = useState<TipoOferta>("internas")
    const [busqueda, setBusqueda] = useState("")
    const [soloVigentes, setSoloVigentes] = useState(true)
    const [ofertas, setOfertas] = useState<Oferta[]>([])
    const [truncado, setTruncado] = useState(false)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState("")
    const [exportando, setExportando] = useState<"pdf" | "excel" | null>(null)

    const cargar = useCallback(async (t: TipoOferta, filtro: string, vigentes: boolean) => {
        setLoading(true)
        setError("")
        try {
            const qs = new URLSearchParams({ tipo: t })
            if (filtro) qs.set("busqueda", filtro)
            if (!vigentes) qs.set("soloVigentes", "0")

            const res = await fetch(`/api/ofertas?${qs.toString()}`)
            if (res.status === 401) { window.location.href = "/login"; return }
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "Error al consultar ofertas")
            setOfertas(json.ofertas)
            setTruncado(Boolean(json.truncado))
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Error desconocido")
            setOfertas([])
            setTruncado(false)
        } finally {
            setLoading(false)
        }
    }, [])

    // Al cambiar de tab se limpia la búsqueda y se regresa a solo vigentes.
    useEffect(() => {
        cargar(tipo, "", true)
    }, [tipo, cargar])

    const cambiarTipo = (t: TipoOferta) => {
        setBusqueda("")
        setSoloVigentes(true)
        setTipo(t)
    }

    const buscar = () => cargar(tipo, busqueda.trim(), soloVigentes)
    const verTodas = () => {
        setBusqueda("")
        cargar(tipo, "", soloVigentes)
    }
    const cambiarVigentes = (v: boolean) => {
        setSoloVigentes(v)
        cargar(tipo, busqueda.trim(), v)
    }

    const esPublicadas = tipo === "publicadas"

    // Exporta las ofertas del filtro activo (mismo título que los reportes Crystal del VB6)
    const exportar = async (formato: "pdf" | "excel") => {
        setExportando(formato)
        try {
            const tienda = await obtenerTiendaSesion()
            const titulo = esPublicadas ? "REPORTE DE OFERTAS PUBLICADAS" : "REPORTE DE OFERTAS INTERNAS"
            const columnas = [
                { header: "Código de Barras" },
                { header: "Descripción" },
                { header: "Unidad", align: "center" as const },
                { header: "Precio", align: "right" as const },
                { header: "Oferta", align: "right" as const },
                { header: "% Desc.", align: "right" as const },
                { header: "Vigencia" },
                { header: "Estado" },
            ]
            const base = {
                titulo,
                subtitulo: `${soloVigentes ? "Solo vigentes" : "Todas"}${busqueda.trim() ? `  ·  Búsqueda: "${busqueda.trim()}"` : ""}  ·  ${fmtInt(ofertas.length)} artículos`,
                tienda,
                columnas,
                nombreArchivo: `ofertas_${tipo}_${sufijoArchivo()}`,
            }
            const estadoTexto = (o: Oferta) => (o.estado ? ESTADOS[o.estado].texto : "")
            const vigenciaTexto = (o: Oferta) => `${fmtFechaHora(o.fechaInicio)} → ${fmtFechaHora(o.fechaFin)}`

            if (formato === "pdf") {
                exportarPdf({
                    ...base,
                    orientacion: "landscape",
                    filas: ofertas.map(o => [
                        String(o.codigoBarras),
                        String(o.descripcion),
                        o.unidad,
                        fmtMoney(o.precio),
                        fmtMoney(o.precioOferta),
                        fmtPct(o.descuento),
                        vigenciaTexto(o),
                        estadoTexto(o),
                    ]),
                })
            } else {
                exportarExcel({
                    ...base,
                    hoja: esPublicadas ? "Ofertas Publicadas" : "Ofertas Internas",
                    columnasMoneda: [3, 4],
                    columnasPorcentaje: [5],
                    filas: ofertas.map(o => [
                        String(o.codigoBarras),
                        String(o.descripcion),
                        o.unidad,
                        o.precio,
                        o.precioOferta,
                        o.descuento,
                        vigenciaTexto(o),
                        estadoTexto(o),
                    ]),
                })
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Error al exportar")
        } finally {
            setExportando(null)
        }
    }

    return (
        <div className="space-y-4">
            {/* Encabezado */}
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-black text-white uppercase tracking-tight">Ofertas</h1>
                    <p className="text-[12px] font-bold text-slate-500 mt-1">
                        {loading
                            ? "Consultando..."
                            : `Reporte de ofertas ${esPublicadas ? "publicadas" : "internas"} · ${fmtInt(ofertas.length)} artículos`}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {/* Exportar */}
                    <button
                        onClick={() => exportar("pdf")}
                        disabled={exportando !== null || loading || ofertas.length === 0}
                        className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 hover:text-rose-300 hover:border-rose-500/30 font-black text-[11px] uppercase tracking-widest transition-all disabled:opacity-40"
                        title="Imprimir a PDF"
                    >
                        {exportando === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                        PDF
                    </button>
                    <button
                        onClick={() => exportar("excel")}
                        disabled={exportando !== null || loading || ofertas.length === 0}
                        className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 hover:text-emerald-300 hover:border-emerald-500/30 font-black text-[11px] uppercase tracking-widest transition-all disabled:opacity-40"
                        title="Exportar a Excel"
                    >
                        {exportando === "excel" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                        Excel
                    </button>

                    {/* Tabs Internas / Publicadas (los dos reportes del menú VB6) */}
                    <div className="flex items-center rounded-xl bg-white/[0.04] border border-white/10 p-1">
                        {(["internas", "publicadas"] as const).map(t => (
                            <button
                                key={t}
                                onClick={() => cambiarTipo(t)}
                                className={cn(
                                    "px-4 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all",
                                    tipo === t ? "bg-emerald-500 text-slate-950" : "text-slate-400 hover:text-white"
                                )}
                            >
                                {t === "internas" ? "Internas" : "Publicadas"}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Barra de búsqueda */}
            <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 backdrop-blur-xl">
                <div className="flex flex-wrap gap-2 items-center">
                    <div className="relative flex-1 min-w-[220px]">
                        <Search className="absolute top-1/2 -translate-y-1/2 left-3.5 h-4 w-4 text-slate-500" />
                        <input
                            type="text"
                            placeholder="BUSCAR POR DESCRIPCIÓN O CÓDIGO..."
                            className={cn(inputCls, "pl-10")}
                            value={busqueda}
                            onChange={e => setBusqueda(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && buscar()}
                        />
                    </div>
                    <button
                        onClick={buscar}
                        className="px-4 py-2.5 rounded-xl bg-emerald-500 text-slate-950 font-black text-[11px] uppercase tracking-widest hover:brightness-110 transition-all"
                        title="Buscar"
                    >
                        <Search className="h-4 w-4" />
                    </button>
                    <button
                        onClick={verTodas}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 hover:text-emerald-300 hover:border-emerald-500/30 font-black text-[11px] uppercase tracking-widest transition-all"
                    >
                        <ListRestart className="h-4 w-4" />
                        <span className="hidden sm:inline">Ver todas</span>
                    </button>
                    <label className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/10 cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={soloVigentes}
                            onChange={e => cambiarVigentes(e.target.checked)}
                            className="accent-emerald-500 h-4 w-4"
                        />
                        <span className="text-[11px] font-black text-slate-300 uppercase tracking-widest">Solo vigentes</span>
                    </label>
                </div>
            </div>

            {error && (
                <div className="flex items-center gap-2 text-rose-300 text-[11px] font-black bg-rose-500/10 p-3 rounded-xl border border-rose-500/25 uppercase tracking-wider">
                    <AlertTriangle className="h-4 w-4" /> {error}
                </div>
            )}

            {truncado && !loading && (
                <div className="flex items-center gap-2 text-amber-300 text-[11px] font-black bg-amber-500/10 p-3 rounded-xl border border-amber-500/25 uppercase tracking-wider">
                    <AlertTriangle className="h-4 w-4" /> Mostrando los primeros {fmtInt(ofertas.length)} resultados — usa la búsqueda para afinar
                </div>
            )}

            {/* Tabla de ofertas */}
            <div className="bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl overflow-hidden">
                {loading ? (
                    <div className="flex items-center justify-center py-24">
                        <Loader2 className="h-7 w-7 text-emerald-400 animate-spin" />
                    </div>
                ) : ofertas.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-24 gap-3">
                        <Tag className="h-8 w-8 text-slate-700" />
                        <p className="text-[12px] font-bold text-slate-600 uppercase tracking-widest">
                            Sin ofertas {esPublicadas ? "publicadas" : "internas"} con ese criterio
                        </p>
                    </div>
                ) : (
                    <div className="overflow-auto max-h-[calc(100vh-22rem)]">
                        <table className="w-full">
                            <thead className="sticky top-0 z-10 bg-[#10151f] shadow-[0_1px_0_rgba(255,255,255,0.08)]">
                                <tr>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Código de Barras</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Descripción</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Precio</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Oferta</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>% Desc.</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Vigencia</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Estado</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/[0.04]">
                                {ofertas.map(o => (
                                    <tr key={`${o.codigoInterno}-${o.fechaInicio ?? ""}`} className="hover:bg-white/[0.03] transition-colors">
                                        <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 whitespace-nowrap">{o.codigoBarras}</td>
                                        <td className="px-4 py-2.5 text-[13px] font-bold text-slate-200">
                                            {o.descripcion}
                                            <span className="ml-2 text-[10px] font-black text-slate-600 uppercase">{o.unidad}</span>
                                        </td>
                                        <td className="px-4 py-2.5 text-[13px] font-bold text-slate-400 text-right whitespace-nowrap line-through decoration-slate-600">
                                            {fmtMoney(o.precio)}
                                        </td>
                                        <td className="px-4 py-2.5 text-[13px] font-black text-amber-300 text-right whitespace-nowrap">
                                            {fmtMoney(o.precioOferta)}
                                        </td>
                                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                                            <span className={cn(
                                                "text-[11px] font-black rounded-md px-2 py-0.5 border",
                                                o.descuento > 0
                                                    ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/25"
                                                    : "text-slate-500 bg-white/[0.03] border-white/10"
                                            )}>
                                                {fmtPct(o.descuento)}
                                            </span>
                                        </td>
                                        <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 whitespace-nowrap">
                                            {fmtFechaHora(o.fechaInicio)} → {fmtFechaHora(o.fechaFin)}
                                        </td>
                                        <td className="px-4 py-2.5 whitespace-nowrap">
                                            {o.estado && (
                                                <span className={cn(
                                                    "text-[10px] font-black rounded-md px-2 py-0.5 border uppercase",
                                                    ESTADOS[o.estado].clases
                                                )}>
                                                    {ESTADOS[o.estado].texto}
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    )
}
