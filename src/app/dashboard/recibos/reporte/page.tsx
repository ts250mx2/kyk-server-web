"use client"

import { useCallback, useEffect, useState } from "react"
import {
    Search, Loader2, AlertTriangle, ListRestart, Receipt, X,
    FileText, FileSpreadsheet, RefreshCw, Printer
} from "lucide-react"
import { cn } from "@/lib/utils"
import { fmtMoney, fmtInt, fmtFechaHora, fmtPct } from "@/lib/format"
import { exportarPdf, exportarExcel, obtenerTiendaSesion, sufijoArchivo } from "@/lib/export"
import { imprimirReciboPdf } from "@/lib/recibo-pdf"

interface ReciboItem {
    idReciboMovil: number
    folio: string
    fecha: string
    proveedor: string
    rfc: string
    numero: string
    subtotal: number
    descuentos: number
    iva: number
    ieps: number
    totalRecibo: number
    devoluciones: number
    totalPagar: number
    cancelado: boolean
}

interface Resumen {
    recibos: number
    totalRecibo: number
    totalDevoluciones: number
    totalPagar: number
}

interface Partida {
    codigoInterno: number
    codigoBarras: string
    descripcion: string
    medida: string
    pedido: number
    recibido: number
    granel: number
    costo: number
    descuento: number
    iva: number
    esDevolucion: boolean
    importe: number
}

interface ReciboDetalle {
    recibo: ReciboItem & { descuentosFinancieros: number }
    partidas: Partida[]
}

const lbl = "text-[10px] font-black text-slate-500 uppercase tracking-widest"
const inputCls = "block w-full px-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-400/25 focus:border-emerald-400/60 transition-all"

const hoyISO = () => new Date().toLocaleDateString("sv-SE")
const diasAtras = (n: number) => {
    const d = new Date()
    d.setDate(d.getDate() - n)
    return d.toLocaleDateString("sv-SE")
}

export default function ReporteRecibosPage() {
    const [fechaInicio, setFechaInicio] = useState(hoyISO())
    const [fechaFin, setFechaFin] = useState(hoyISO())
    const [busqueda, setBusqueda] = useState("")
    const [recibos, setRecibos] = useState<ReciboItem[]>([])
    const [resumen, setResumen] = useState<Resumen | null>(null)
    const [truncado, setTruncado] = useState(false)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState("")
    const [exportando, setExportando] = useState<"pdf" | "excel" | null>(null)

    // Modal de detalle
    const [detalle, setDetalle] = useState<ReciboDetalle | null>(null)
    const [loadingDetalle, setLoadingDetalle] = useState(false)
    const [tabDetalle, setTabDetalle] = useState<"recibido" | "devoluciones">("recibido")
    const [imprimiendo, setImprimiendo] = useState(false)

    // Impresión del recibo con el formato del webservice Java ImprimirReciboMovil
    const imprimirRecibo = async () => {
        if (!detalle) return
        setImprimiendo(true)
        try {
            const res = await fetch(`/api/recibos/${detalle.recibo.idReciboMovil}/impresion`)
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "Error al obtener datos de impresión")
            await imprimirReciboPdf(json)
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Error al imprimir el recibo")
        } finally {
            setImprimiendo(false)
        }
    }

    const cargar = useCallback(async (inicio: string, fin: string, filtro: string) => {
        setLoading(true)
        setError("")
        try {
            const qs = new URLSearchParams({ fechaInicio: inicio, fechaFin: fin })
            if (filtro) qs.set("busqueda", filtro)

            const res = await fetch(`/api/recibos?${qs.toString()}`)
            if (res.status === 401) { window.location.href = "/login"; return }
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "Error al consultar recibos")
            setRecibos(json.recibos)
            setResumen(json.resumen)
            setTruncado(Boolean(json.truncado))
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Error desconocido")
            setRecibos([])
            setResumen(null)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        cargar(hoyISO(), hoyISO(), "")
    }, [cargar])

    const actualizar = () => cargar(fechaInicio, fechaFin, busqueda.trim())
    const limpiar = () => {
        setBusqueda("")
        setFechaInicio(hoyISO())
        setFechaFin(hoyISO())
        cargar(hoyISO(), hoyISO(), "")
    }
    const preset = (dias: number) => {
        const inicio = diasAtras(dias)
        const fin = hoyISO()
        setFechaInicio(inicio)
        setFechaFin(fin)
        cargar(inicio, fin, busqueda.trim())
    }

    const verDetalle = async (id: number) => {
        setLoadingDetalle(true)
        setDetalle(null)
        setTabDetalle("recibido")
        try {
            const res = await fetch(`/api/recibos/${id}`)
            const json = await res.json()
            if (res.ok) setDetalle(json)
            else setError(json.error || "Error al consultar el detalle")
        } catch {
            setError("Error al consultar el detalle del recibo")
        } finally {
            setLoadingDetalle(false)
        }
    }

    const exportar = async (formato: "pdf" | "excel") => {
        setExportando(formato)
        try {
            const tienda = await obtenerTiendaSesion()
            const columnas = [
                { header: "Folio" },
                { header: "Fecha" },
                { header: "Proveedor" },
                { header: "RFC" },
                { header: "Factura/Remisión" },
                { header: "Total Recibo", align: "right" as const },
                { header: "Devoluciones", align: "right" as const },
                { header: "Total a Pagar", align: "right" as const },
            ]
            const base = {
                titulo: "REPORTE DE RECIBOS",
                subtitulo: `Del ${fechaInicio} al ${fechaFin}${busqueda.trim() ? `  ·  Búsqueda: "${busqueda.trim()}"` : ""}  ·  ${fmtInt(recibos.length)} recibos`,
                tienda,
                columnas,
                nombreArchivo: `recibos_${sufijoArchivo()}`,
            }

            if (formato === "pdf") {
                exportarPdf({
                    ...base,
                    orientacion: "landscape",
                    filas: recibos.map(r => [
                        `${r.folio}${r.cancelado ? " (CANCELADO)" : ""}`,
                        fmtFechaHora(r.fecha),
                        String(r.proveedor),
                        String(r.rfc),
                        String(r.numero),
                        fmtMoney(r.totalRecibo),
                        r.devoluciones > 0 ? fmtMoney(r.devoluciones) : "—",
                        fmtMoney(r.totalPagar),
                    ]),
                })
            } else {
                exportarExcel({
                    ...base,
                    hoja: "Recibos",
                    columnasMoneda: [5, 6, 7],
                    filas: recibos.map(r => [
                        `${r.folio}${r.cancelado ? " (CANCELADO)" : ""}`,
                        fmtFechaHora(r.fecha),
                        String(r.proveedor),
                        String(r.rfc),
                        String(r.numero),
                        r.totalRecibo,
                        r.devoluciones > 0 ? r.devoluciones : "",
                        r.totalPagar,
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
                    <h1 className="text-2xl font-black text-white uppercase tracking-tight">Reporte Recibos</h1>
                    <p className="text-[12px] font-bold text-slate-500 mt-1">
                        {loading ? "Consultando..." : `${fmtInt(resumen?.recibos ?? 0)} recibos de mercancía`}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => exportar("pdf")}
                        disabled={exportando !== null || loading || recibos.length === 0}
                        className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 hover:text-rose-300 hover:border-rose-500/30 font-black text-[11px] uppercase tracking-widest transition-all disabled:opacity-40"
                        title="Imprimir a PDF"
                    >
                        {exportando === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                        PDF
                    </button>
                    <button
                        onClick={() => exportar("excel")}
                        disabled={exportando !== null || loading || recibos.length === 0}
                        className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 hover:text-emerald-300 hover:border-emerald-500/30 font-black text-[11px] uppercase tracking-widest transition-all disabled:opacity-40"
                        title="Exportar a Excel"
                    >
                        {exportando === "excel" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                        Excel
                    </button>
                </div>
            </div>

            {/* Filtros */}
            <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 backdrop-blur-xl space-y-3">
                <div className="flex flex-wrap gap-2 items-center">
                    <div className="flex items-center gap-2">
                        <span className={lbl}>Del:</span>
                        <input
                            type="date"
                            className={cn(inputCls, "[color-scheme:dark] w-40")}
                            value={fechaInicio}
                            onChange={e => setFechaInicio(e.target.value)}
                        />
                        <span className={lbl}>Al:</span>
                        <input
                            type="date"
                            className={cn(inputCls, "[color-scheme:dark] w-40")}
                            value={fechaFin}
                            onChange={e => setFechaFin(e.target.value)}
                        />
                    </div>
                    <button
                        onClick={actualizar}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500 text-slate-950 font-black text-[11px] uppercase tracking-widest hover:brightness-110 transition-all"
                    >
                        <RefreshCw className="h-4 w-4" /> Actualizar
                    </button>
                    <div className="flex items-center rounded-xl bg-white/[0.03] border border-white/10 p-1">
                        {[
                            { label: "Hoy", dias: 0 },
                            { label: "7 días", dias: 7 },
                            { label: "30 días", dias: 30 },
                        ].map(p => (
                            <button
                                key={p.label}
                                onClick={() => preset(p.dias)}
                                className="px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-white hover:bg-white/[0.06] transition-all"
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                    <div className="relative flex-1 min-w-[240px]">
                        <Search className="absolute top-1/2 -translate-y-1/2 left-3.5 h-4 w-4 text-slate-500" />
                        <input
                            type="text"
                            placeholder="FOLIO, # RECIBO, PROVEEDOR, RFC O UUID (ENTER)"
                            className={cn(inputCls, "pl-10")}
                            value={busqueda}
                            onChange={e => setBusqueda(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && actualizar()}
                        />
                    </div>
                    <button
                        onClick={limpiar}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 hover:text-emerald-300 hover:border-emerald-500/30 font-black text-[11px] uppercase tracking-widest transition-all"
                    >
                        <ListRestart className="h-4 w-4" /> Limpiar
                    </button>
                </div>
            </div>

            {/* Resumen del rango */}
            {resumen && !loading && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {[
                        { titulo: "Recibos", valor: fmtInt(resumen.recibos), color: "text-white" },
                        { titulo: "Total Recibido", valor: fmtMoney(resumen.totalRecibo), color: "text-cyan-300" },
                        { titulo: "Devoluciones", valor: fmtMoney(resumen.totalDevoluciones), color: "text-rose-300" },
                        { titulo: "Total a Pagar", valor: fmtMoney(resumen.totalPagar), color: "text-emerald-300" },
                    ].map(c => (
                        <div key={c.titulo} className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 backdrop-blur-xl">
                            <p className={lbl}>{c.titulo}</p>
                            <p className={cn("text-lg font-black mt-1", c.color)}>{c.valor}</p>
                        </div>
                    ))}
                </div>
            )}

            {error && (
                <div className="flex items-center gap-2 text-rose-300 text-[11px] font-black bg-rose-500/10 p-3 rounded-xl border border-rose-500/25 uppercase tracking-wider">
                    <AlertTriangle className="h-4 w-4" /> {error}
                </div>
            )}

            {truncado && !loading && (
                <div className="flex items-center gap-2 text-amber-300 text-[11px] font-black bg-amber-500/10 p-3 rounded-xl border border-amber-500/25 uppercase tracking-wider">
                    <AlertTriangle className="h-4 w-4" /> Mostrando los primeros {fmtInt(recibos.length)} recibos — acota el rango de fechas
                </div>
            )}

            {/* Tabla de recibos */}
            <div className="bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl overflow-hidden">
                {loading ? (
                    <div className="flex items-center justify-center py-24">
                        <Loader2 className="h-7 w-7 text-emerald-400 animate-spin" />
                    </div>
                ) : recibos.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-24 gap-3">
                        <Receipt className="h-8 w-8 text-slate-700" />
                        <p className="text-[12px] font-bold text-slate-600 uppercase tracking-widest">
                            Sin recibos en el rango seleccionado
                        </p>
                    </div>
                ) : (
                    <div className="overflow-auto max-h-[calc(100vh-26rem)]">
                        <table className="w-full">
                            <thead className="sticky top-0 z-10 bg-[#10151f] shadow-[0_1px_0_rgba(255,255,255,0.08)]">
                                <tr>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Folio</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Fecha</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Proveedor</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Factura/Remisión</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Total Recibo</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Devoluciones</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Total a Pagar</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/[0.04]">
                                {recibos.map(r => (
                                    <tr
                                        key={r.idReciboMovil}
                                        onClick={() => verDetalle(r.idReciboMovil)}
                                        className={cn(
                                            "cursor-pointer transition-colors",
                                            r.devoluciones > 0
                                                ? "bg-rose-500/[0.07] hover:bg-rose-500/[0.12] border-l-2 border-l-rose-500"
                                                : "hover:bg-white/[0.03]"
                                        )}
                                        title="Ver partidas del recibo"
                                    >
                                        <td className="px-4 py-2.5 whitespace-nowrap">
                                            <span className="text-[12px] font-black text-cyan-300">{r.folio}</span>
                                            {r.cancelado && (
                                                <span className="ml-1.5 text-[9px] font-black text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-md px-1.5 py-0.5 uppercase">
                                                    Cancelado
                                                </span>
                                            )}
                                            {r.devoluciones > 0 && (
                                                <span className="ml-1.5 text-[9px] font-black text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-md px-1.5 py-0.5 uppercase">
                                                    Devolución
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 whitespace-nowrap">{fmtFechaHora(r.fecha)}</td>
                                        <td className="px-4 py-2.5 text-[13px] font-bold text-slate-200 max-w-[300px] truncate" title={`${r.proveedor} (${r.rfc})`}>
                                            {r.proveedor}
                                        </td>
                                        <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 whitespace-nowrap">{r.numero}</td>
                                        <td className="px-4 py-2.5 text-[13px] font-black text-cyan-300 text-right whitespace-nowrap">{fmtMoney(r.totalRecibo)}</td>
                                        <td className={cn(
                                            "px-4 py-2.5 text-[13px] font-bold text-right whitespace-nowrap",
                                            r.devoluciones > 0 ? "text-rose-300" : "text-slate-600"
                                        )}>
                                            {r.devoluciones > 0 ? fmtMoney(r.devoluciones) : "—"}
                                        </td>
                                        <td className="px-4 py-2.5 text-[13px] font-black text-emerald-300 text-right whitespace-nowrap">{fmtMoney(r.totalPagar)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Modal de detalle (frmProcDetalleReciboMovil) */}
            {(detalle || loadingDetalle) && (
                <div
                    className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
                    onClick={() => { setDetalle(null); setLoadingDetalle(false) }}
                >
                    <div
                        className="w-full max-w-4xl max-h-[85vh] bg-[#0d1320] border border-white/10 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden flex flex-col"
                        onClick={e => e.stopPropagation()}
                    >
                        {loadingDetalle ? (
                            <div className="flex items-center justify-center py-24">
                                <Loader2 className="h-7 w-7 text-emerald-400 animate-spin" />
                            </div>
                        ) : detalle && (
                            <>
                                {/* Encabezado del recibo */}
                                <div className="px-6 py-4 border-b border-white/10 flex items-start justify-between gap-3">
                                    <div>
                                        <h3 className="text-[15px] font-black text-white flex items-center gap-2">
                                            Recibo {detalle.recibo.folio}
                                            {detalle.recibo.cancelado && (
                                                <span className="text-[9px] font-black text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-md px-1.5 py-0.5 uppercase">
                                                    Cancelado
                                                </span>
                                            )}
                                        </h3>
                                        <p className="text-[12px] font-bold text-slate-400 mt-1">
                                            {detalle.recibo.proveedor} · {detalle.recibo.rfc}
                                        </p>
                                        <p className="text-[11px] font-bold text-slate-500 mt-0.5">
                                            {fmtFechaHora(detalle.recibo.fecha)} · Factura/Remisión: {detalle.recibo.numero || "—"}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={imprimirRecibo}
                                            disabled={imprimiendo}
                                            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-emerald-500 text-slate-950 font-black text-[11px] uppercase tracking-widest hover:brightness-110 transition-all disabled:opacity-60"
                                            title="Imprimir recibo en PDF"
                                        >
                                            {imprimiendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                                            Imprimir
                                        </button>
                                        <button
                                            onClick={() => setDetalle(null)}
                                            className="p-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-400 hover:text-white transition-all"
                                        >
                                            <X className="h-4 w-4" />
                                        </button>
                                    </div>
                                </div>

                                {/* Partidas separadas: Recibido / Devoluciones a proveedor */}
                                <div className="overflow-auto flex-1">
                                    {(() => {
                                        const recibidas = detalle.partidas.filter(p => !p.esDevolucion)
                                        const devueltas = detalle.partidas.filter(p => p.esDevolucion)
                                        const filaPartida = (p: Partida, i: number) => (
                                            <tr key={i} className={cn("hover:bg-white/[0.03]", p.esDevolucion && "bg-rose-500/[0.04]")}>
                                                <td className="px-4 py-2 text-[12px] font-bold text-slate-400 whitespace-nowrap">{p.codigoBarras}</td>
                                                <td className="px-4 py-2 text-[13px] font-bold text-slate-200">{p.descripcion}</td>
                                                <td className="px-4 py-2 text-[12px] font-bold text-slate-500 text-right whitespace-nowrap">{p.pedido || "—"}</td>
                                                <td className="px-4 py-2 text-[13px] font-bold text-slate-200 text-right whitespace-nowrap">
                                                    {p.recibido}{p.granel > 0 && p.granel !== p.recibido ? ` (${p.granel} gr.)` : ""} {p.medida}
                                                </td>
                                                <td className="px-4 py-2 text-[13px] font-bold text-slate-300 text-right whitespace-nowrap">{fmtMoney(p.costo)}</td>
                                                <td className="px-4 py-2 text-[12px] font-bold text-slate-400 text-right whitespace-nowrap">
                                                    {p.descuento > 0 ? fmtPct(p.descuento) : "—"}
                                                </td>
                                                <td className={cn(
                                                    "px-4 py-2 text-[13px] font-black text-right whitespace-nowrap",
                                                    p.esDevolucion ? "text-rose-300" : "text-emerald-300"
                                                )}>
                                                    {fmtMoney(p.importe)}
                                                </td>
                                            </tr>
                                        )
                                        const encabezados = (
                                            <tr>
                                                <th className={cn(lbl, "px-4 py-2 text-left")}>Código</th>
                                                <th className={cn(lbl, "px-4 py-2 text-left")}>Descripción</th>
                                                <th className={cn(lbl, "px-4 py-2 text-right")}>Pedido</th>
                                                <th className={cn(lbl, "px-4 py-2 text-right")}>Recibido</th>
                                                <th className={cn(lbl, "px-4 py-2 text-right")}>Costo</th>
                                                <th className={cn(lbl, "px-4 py-2 text-right")}>% Desc.</th>
                                                <th className={cn(lbl, "px-4 py-2 text-right")}>Importe</th>
                                            </tr>
                                        )
                                        const filas = tabDetalle === "devoluciones" ? devueltas : recibidas
                                        return (
                                            <>
                                                {/* Tabs Recibido / Devoluciones */}
                                                <div className="flex border-b border-white/10 sticky top-0 z-20 bg-[#0d1320]">
                                                    <button
                                                        onClick={() => setTabDetalle("recibido")}
                                                        className={cn(
                                                            "flex-1 py-2.5 text-[11px] font-black uppercase tracking-widest transition-all border-b-2",
                                                            tabDetalle === "recibido"
                                                                ? "text-emerald-300 border-emerald-400 bg-emerald-500/[0.06]"
                                                                : "text-slate-500 border-transparent hover:text-slate-300"
                                                        )}
                                                    >
                                                        📦 Recibido ({fmtInt(recibidas.length)})
                                                    </button>
                                                    <button
                                                        onClick={() => devueltas.length > 0 && setTabDetalle("devoluciones")}
                                                        disabled={devueltas.length === 0}
                                                        className={cn(
                                                            "flex-1 py-2.5 text-[11px] font-black uppercase tracking-widest transition-all border-b-2",
                                                            tabDetalle === "devoluciones"
                                                                ? "text-rose-300 border-rose-400 bg-rose-500/[0.06]"
                                                                : devueltas.length > 0
                                                                    ? "text-slate-500 border-transparent hover:text-rose-300"
                                                                    : "text-slate-700 border-transparent cursor-not-allowed"
                                                        )}
                                                    >
                                                        ↩️ Devoluciones ({fmtInt(devueltas.length)})
                                                    </button>
                                                </div>
                                                <table className="w-full">
                                                    <thead className="bg-[#141a28]">{encabezados}</thead>
                                                    <tbody className="divide-y divide-white/[0.04]">
                                                        {filas.map(filaPartida)}
                                                    </tbody>
                                                </table>
                                                {filas.length === 0 && (
                                                    <p className="py-10 text-center text-[12px] font-bold text-slate-600 uppercase tracking-widest">
                                                        Sin partidas
                                                    </p>
                                                )}
                                            </>
                                        )
                                    })()}
                                </div>

                                {/* Totales */}
                                <div className="px-6 py-4 border-t border-white/10 flex flex-wrap gap-x-8 gap-y-2 justify-end">
                                    {[
                                        { titulo: "Subtotal", valor: detalle.recibo.subtotal, color: "text-slate-200" },
                                        { titulo: "IVA", valor: detalle.recibo.iva, color: "text-slate-200" },
                                        { titulo: "Total Recibo", valor: detalle.recibo.totalRecibo, color: "text-cyan-300" },
                                        { titulo: "Devoluciones", valor: detalle.recibo.devoluciones, color: "text-rose-300" },
                                        { titulo: "Total a Pagar", valor: detalle.recibo.totalPagar, color: "text-emerald-300" },
                                    ].filter(t => t.valor !== 0 || ["Subtotal", "Total Recibo", "Total a Pagar"].includes(t.titulo)).map(t => (
                                        <div key={t.titulo} className="text-right">
                                            <p className={lbl}>{t.titulo}</p>
                                            <p className={cn("text-[15px] font-black", t.color)}>{fmtMoney(t.valor)}</p>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
