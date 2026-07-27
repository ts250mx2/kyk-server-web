"use client"

import { useCallback, useEffect, useState } from "react"
import {
    Search, Loader2, AlertTriangle, X, Monitor, Receipt, Ban, Lock,
    RefreshCw, Calendar, Store, FileText, FileSpreadsheet, Printer
} from "lucide-react"
import jsPDF from "jspdf"
import { cn } from "@/lib/utils"
import { fmtMoney, fmtInt, fmtFechaLarga } from "@/lib/format"
import { exportarPdf, exportarExcel, obtenerTiendaSesion, sufijoArchivo } from "@/lib/export"

interface Corte {
    idApertura: number
    caja: number
    z: string
    fechaApertura: string
    fechaCierre: string | null
    cajero: string
    supervisor: string | null
    cerrada: boolean
    efectivoInicio: number
    declarado: { efectivo: number; cheques: number; tarjeta: number; dolares: number }
    ventas: number
    operaciones: number
    ticketPromedio: number
    cancelaciones: number
    cancelacionesMonto: number
}

interface Resumen {
    aperturas: number
    ventas: number
    operaciones: number
    ticketPromedio: number
    cancelaciones: number
    cancelacionesMonto: number
    cierres: number
}

interface VentaTicket { idVenta: number; fecha: string; total: number; pago: number }
interface PartidaTicket {
    codigoBarras: string; descripcion: string; unidad: string;
    cantidad: number; precio: number; importe: number; cantidadDevuelta: number
}
interface TicketVenta {
    venta: { idVenta: number; caja: number; fecha: string; total: number; pago: number; cambio: number }
    partidas: PartidaTicket[]
}
interface CancelacionDet {
    idCancelacion: number; fecha: string; supervisor: string;
    codigoBarras: string; descripcion: string; cantidad: number; precio: number; importe: number
}

const lbl = "text-[10px] font-black text-slate-500 uppercase tracking-widest"
const inputCls = "block w-full px-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-400/25 focus:border-emerald-400/60 transition-all"

const hoyISO = () => new Date().toLocaleDateString("sv-SE")
const diasAtras = (n: number) => {
    const d = new Date()
    d.setDate(d.getDate() - n)
    return d.toLocaleDateString("sv-SE")
}

const hora = (v: string | null) => {
    if (!v) return "--:--"
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? "--:--" : d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })
}

const duracion = (inicio: string, fin: string | null) => {
    if (!fin) return null
    const ms = new Date(fin).getTime() - new Date(inicio).getTime()
    if (Number.isNaN(ms) || ms <= 0) return null
    const h = Math.floor(ms / 3_600_000)
    const m = Math.floor((ms % 3_600_000) / 60_000)
    return `${h}h ${m}m`
}

export default function CortesCajaPage() {
    const [fecha, setFecha] = useState(hoyISO())
    const [busqueda, setBusqueda] = useState("")
    const [cortes, setCortes] = useState<Corte[]>([])
    const [resumen, setResumen] = useState<Resumen | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState("")
    const [exportando, setExportando] = useState<"pdf" | "excel" | null>(null)

    // Modales de drill-down
    const [modal, setModal] = useState<{ tipo: "ventas" | "cancelaciones" | "ticket"; corte: Corte } | null>(null)
    const [ventasDetalle, setVentasDetalle] = useState<VentaTicket[] | null>(null)
    const [cancelacionesDetalle, setCancelacionesDetalle] = useState<CancelacionDet[] | null>(null)
    const [ticketCorte, setTicketCorte] = useState<string | null>(null)
    const [loadingModal, setLoadingModal] = useState(false)

    // Drill-down dentro del modal de ventas: búsqueda por folio y detalle del ticket
    const [busquedaVenta, setBusquedaVenta] = useState("")
    const [ticket, setTicket] = useState<TicketVenta | null>(null)
    const [loadingTicket, setLoadingTicket] = useState(false)

    const cargar = useCallback(async (f: string) => {
        setLoading(true)
        setError("")
        try {
            const res = await fetch(`/api/operaciones?fecha=${f}`)
            if (res.status === 401) { window.location.href = "/login"; return }
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "Error al consultar cortes de caja")
            setCortes(json.cortes)
            setResumen(json.resumen)
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Error desconocido")
            setCortes([])
            setResumen(null)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        cargar(hoyISO())
    }, [cargar])

    const cambiarFecha = (f: string) => {
        setFecha(f)
        cargar(f)
    }

    const abrirModal = async (tipo: "ventas" | "cancelaciones" | "ticket", corte: Corte) => {
        setModal({ tipo, corte })
        setVentasDetalle(null)
        setCancelacionesDetalle(null)
        setTicketCorte(null)
        setBusquedaVenta("")
        setTicket(null)
        setLoadingModal(true)
        try {
            const qs = `fecha=${fecha}&idApertura=${corte.idApertura}&caja=${corte.caja}`
            const ruta = tipo === "ticket" ? "ticket-corte" : tipo
            const res = await fetch(`/api/operaciones/${ruta}?${qs}`)
            const json = await res.json()
            if (res.ok) {
                if (tipo === "ventas") setVentasDetalle(json.ventas)
                else if (tipo === "cancelaciones") setCancelacionesDetalle(json.cancelaciones)
                else setTicketCorte(json.ticket)
            } else {
                setError(json.error || "Error al consultar el detalle")
                setModal(null)
            }
        } catch {
            setError("Error al consultar el detalle")
            setModal(null)
        } finally {
            setLoadingModal(false)
        }
    }

    const verTicketVenta = async (v: VentaTicket) => {
        if (!modal) return
        setLoadingTicket(true)
        try {
            const res = await fetch(`/api/operaciones/ticket-venta?idVenta=${v.idVenta}&caja=${modal.corte.caja}`)
            const json = await res.json()
            if (res.ok) setTicket(json)
            else setError(json.error || "Error al consultar el ticket")
        } catch {
            setError("Error al consultar el detalle del ticket")
        } finally {
            setLoadingTicket(false)
        }
    }

    // Imprime el ticket de corte tal cual (fuente monoespaciada, como el POS)
    const imprimirTicketCorte = () => {
        if (!ticketCorte || !modal) return
        const doc = new jsPDF({ unit: "pt", format: "a4" })
        doc.setFont("courier", "normal")
        doc.setFontSize(8)
        const margen = 48
        const altoPagina = doc.internal.pageSize.getHeight()
        let y = margen
        for (const linea of ticketCorte.split(/\r?\n/)) {
            if (y > altoPagina - margen) {
                doc.addPage()
                y = margen
            }
            doc.text(linea, margen, y)
            y += 9.2
        }
        const url = doc.output("bloburl")
        const ventana = window.open(url, "_blank")
        if (!ventana) doc.save(`ticket_corte_${modal.corte.z}.pdf`)
    }

    const filtrados = cortes.filter(c => {
        const t = busqueda.toLowerCase().trim()
        if (!t) return true
        return c.cajero.toLowerCase().includes(t) || c.z.includes(t) || String(c.idApertura).includes(t)
    })

    const presets = [
        { label: "Hoy", dias: 0 },
        { label: "Ayer", dias: 1 },
        { label: "Antier", dias: 2 },
    ]

    const exportar = async (formato: "pdf" | "excel") => {
        setExportando(formato)
        try {
            const tienda = await obtenerTiendaSesion()
            const columnas = [
                { header: "Z" },
                { header: "Caja", align: "right" as const },
                { header: "Cajero" },
                { header: "Apertura" },
                { header: "Cierre" },
                { header: "Tiempo" },
                { header: "Supervisor" },
                { header: "Ventas", align: "right" as const },
                { header: "Ops.", align: "right" as const },
                { header: "Ticket Prom.", align: "right" as const },
                { header: "Cancelaciones", align: "right" as const },
            ]
            const base = {
                titulo: "CORTES DE CAJA",
                subtitulo: `${fmtFechaLarga(fecha)}  ·  ${fmtInt(filtrados.length)} aperturas`,
                tienda,
                columnas,
                nombreArchivo: `cortes_caja_${sufijoArchivo()}`,
            }

            if (formato === "pdf") {
                exportarPdf({
                    ...base,
                    orientacion: "landscape",
                    filas: filtrados.map(c => [
                        c.z,
                        String(c.caja),
                        c.cajero,
                        hora(c.fechaApertura),
                        c.cerrada ? hora(c.fechaCierre) : "ABIERTA",
                        duracion(c.fechaApertura, c.fechaCierre) ?? "—",
                        c.supervisor ?? "—",
                        fmtMoney(c.ventas),
                        fmtInt(c.operaciones),
                        fmtMoney(c.ticketPromedio),
                        c.cancelaciones > 0 ? `${fmtMoney(c.cancelacionesMonto)} (${c.cancelaciones})` : "—",
                    ]),
                })
            } else {
                exportarExcel({
                    ...base,
                    hoja: "Cortes de Caja",
                    columnasMoneda: [7, 9, 10],
                    filas: filtrados.map(c => [
                        c.z,
                        c.caja,
                        c.cajero,
                        hora(c.fechaApertura),
                        c.cerrada ? hora(c.fechaCierre) : "ABIERTA",
                        duracion(c.fechaApertura, c.fechaCierre) ?? "",
                        c.supervisor ?? "",
                        c.ventas,
                        c.operaciones,
                        c.ticketPromedio,
                        c.cancelacionesMonto > 0 ? c.cancelacionesMonto : "",
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
                    <h1 className="text-2xl font-black text-white uppercase tracking-tight">Cortes de Caja</h1>
                    <p className="text-[12px] font-bold text-slate-500 mt-1">
                        {fmtFechaLarga(fecha)} · Monitor de operaciones por terminal
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <div className="relative min-w-[210px]">
                        <Search className="absolute top-1/2 -translate-y-1/2 left-3.5 h-4 w-4 text-slate-500" />
                        <input
                            type="text"
                            placeholder="CAJERO O Z..."
                            className={cn(inputCls, "pl-10 py-2")}
                            value={busqueda}
                            onChange={e => setBusqueda(e.target.value)}
                        />
                    </div>
                    <div className="flex items-center rounded-xl bg-white/[0.03] border border-white/10 p-1">
                        {presets.map(p => {
                            const f = diasAtras(p.dias)
                            return (
                                <button
                                    key={p.label}
                                    onClick={() => cambiarFecha(f)}
                                    className={cn(
                                        "px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                                        fecha === f ? "bg-emerald-500 text-slate-950" : "text-slate-400 hover:text-white"
                                    )}
                                >
                                    {p.label}
                                </button>
                            )
                        })}
                    </div>
                    <div className="relative">
                        <Calendar className="absolute top-1/2 -translate-y-1/2 left-3 h-4 w-4 text-slate-500 pointer-events-none" />
                        <input
                            type="date"
                            className={cn(inputCls, "pl-9 py-2 [color-scheme:dark] w-40")}
                            value={fecha}
                            onChange={e => cambiarFecha(e.target.value)}
                        />
                    </div>
                    <button
                        onClick={() => cargar(fecha)}
                        className="p-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 hover:text-emerald-300 hover:border-emerald-500/30 transition-all"
                        title="Actualizar"
                    >
                        <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                    </button>
                    <button
                        onClick={() => exportar("pdf")}
                        disabled={exportando !== null || loading || filtrados.length === 0}
                        className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 hover:text-rose-300 hover:border-rose-500/30 font-black text-[11px] uppercase tracking-widest transition-all disabled:opacity-40"
                        title="Imprimir a PDF"
                    >
                        {exportando === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                        PDF
                    </button>
                    <button
                        onClick={() => exportar("excel")}
                        disabled={exportando !== null || loading || filtrados.length === 0}
                        className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 hover:text-emerald-300 hover:border-emerald-500/30 font-black text-[11px] uppercase tracking-widest transition-all disabled:opacity-40"
                        title="Exportar a Excel"
                    >
                        {exportando === "excel" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                        Excel
                    </button>
                </div>
            </div>

            {/* KPIs del día */}
            {resumen && !loading && (
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
                    {[
                        { titulo: "Aperturas", valor: fmtInt(resumen.aperturas), color: "text-amber-300" },
                        { titulo: "Ventas", valor: fmtMoney(resumen.ventas), color: "text-emerald-300" },
                        { titulo: "Operaciones", valor: fmtInt(resumen.operaciones), color: "text-white" },
                        { titulo: "Ticket Prom.", valor: fmtMoney(resumen.ticketPromedio), color: "text-cyan-300" },
                        { titulo: "Cancelaciones", valor: `${fmtMoney(resumen.cancelacionesMonto)} · ${fmtInt(resumen.cancelaciones)}`, color: resumen.cancelaciones > 0 ? "text-rose-300" : "text-slate-500" },
                        { titulo: "Cierres", valor: `${fmtInt(resumen.cierres)} / ${fmtInt(resumen.aperturas)}`, color: "text-indigo-300" },
                    ].map(c => (
                        <div key={c.titulo} className="bg-white/[0.04] border border-white/10 rounded-2xl p-3.5 backdrop-blur-xl">
                            <p className={lbl}>{c.titulo}</p>
                            <p className={cn("text-[15px] font-black mt-1 truncate", c.color)}>{c.valor}</p>
                        </div>
                    ))}
                </div>
            )}

            {error && (
                <div className="flex items-center gap-2 text-rose-300 text-[11px] font-black bg-rose-500/10 p-3 rounded-xl border border-rose-500/25 uppercase tracking-wider">
                    <AlertTriangle className="h-4 w-4" /> {error}
                </div>
            )}

            {/* Kanban por terminal */}
            {loading ? (
                <div className="flex items-center justify-center py-32">
                    <Loader2 className="h-8 w-8 text-emerald-400 animate-spin" />
                </div>
            ) : filtrados.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-32 gap-3 bg-white/[0.04] border border-white/10 rounded-2xl">
                    <Store className="h-8 w-8 text-slate-700" />
                    <p className="text-[12px] font-bold text-slate-600 uppercase tracking-widest">
                        Sin aperturas en la fecha seleccionada
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {/* Encabezados de columnas */}
                    <div className="hidden xl:grid grid-cols-4 gap-3">
                        {[
                            { titulo: "Aperturas", icono: Monitor, color: "bg-amber-500/15 text-amber-300 border-amber-500/25" },
                            { titulo: "Ventas por Terminal", icono: Receipt, color: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25" },
                            { titulo: "Cancelaciones", icono: Ban, color: "bg-rose-500/15 text-rose-300 border-rose-500/25" },
                            { titulo: "Cierres de Caja", icono: Lock, color: "bg-indigo-500/15 text-indigo-300 border-indigo-500/25" },
                        ].map(c => (
                            <div key={c.titulo} className={cn("flex items-center gap-2 px-3 py-2 rounded-xl border", c.color)}>
                                <c.icono className="h-3.5 w-3.5" />
                                <span className="text-[10px] font-black uppercase tracking-widest">{c.titulo}</span>
                            </div>
                        ))}
                    </div>

                    {/* Una fila por apertura */}
                    {filtrados.map(c => (
                        <div key={c.z} className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                            {/* Apertura */}
                            <div
                                onClick={() => abrirModal("ventas", c)}
                                className="bg-amber-500/[0.06] border border-amber-500/20 rounded-2xl p-4 cursor-pointer hover:bg-amber-500/[0.1] transition-all"
                            >
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-[11px] font-black bg-amber-500 text-slate-950 rounded-md px-2 py-0.5">Z: {c.z}</span>
                                    <Monitor className="h-4 w-4 text-amber-400" />
                                </div>
                                <p className="text-lg font-black text-white">Hora: {hora(c.fechaApertura)}</p>
                                <p className={cn(lbl, "mt-2")}>Cajero Responsable</p>
                                <p className="text-[13px] font-black text-slate-200 truncate">{c.cajero}</p>
                            </div>

                            {/* Ventas */}
                            {c.ventas > 0 ? (
                                <div
                                    onClick={() => abrirModal("ventas", c)}
                                    className="bg-emerald-500/[0.06] border border-emerald-500/20 rounded-2xl p-4 cursor-pointer hover:bg-emerald-500/[0.1] transition-all"
                                >
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-[11px] font-black bg-emerald-500 text-slate-950 rounded-md px-2 py-0.5">Z: {c.z}</span>
                                        <Receipt className="h-4 w-4 text-emerald-400" />
                                    </div>
                                    <p className="text-lg font-black text-emerald-300">{fmtMoney(c.ventas)}</p>
                                    <p className="text-[11px] font-bold text-slate-500 mt-1">
                                        {fmtInt(c.operaciones)} operaciones · ticket {fmtMoney(c.ticketPromedio)}
                                    </p>
                                </div>
                            ) : (
                                <div className="hidden xl:flex items-center justify-center bg-white/[0.02] border border-white/[0.06] rounded-2xl text-[10px] font-bold text-slate-700 uppercase tracking-widest">
                                    Sin ventas
                                </div>
                            )}

                            {/* Cancelaciones */}
                            {c.cancelaciones > 0 ? (
                                <div
                                    onClick={() => abrirModal("cancelaciones", c)}
                                    className="bg-rose-500/[0.06] border border-rose-500/20 rounded-2xl p-4 cursor-pointer hover:bg-rose-500/[0.1] transition-all"
                                >
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-[11px] font-black bg-rose-500 text-white rounded-md px-2 py-0.5">Z: {c.z}</span>
                                        <Ban className="h-4 w-4 text-rose-400" />
                                    </div>
                                    <p className="text-lg font-black text-rose-300">{fmtMoney(c.cancelacionesMonto)}</p>
                                    <p className="text-[11px] font-bold text-slate-500 mt-1">{fmtInt(c.cancelaciones)} movimientos</p>
                                </div>
                            ) : (
                                <div className="hidden xl:flex items-center justify-center bg-white/[0.02] border border-white/[0.06] rounded-2xl text-[10px] font-bold text-slate-700 uppercase tracking-widest">
                                    Sin cancelaciones
                                </div>
                            )}

                            {/* Cierre → ticket de corte */}
                            {c.cerrada ? (
                                <div
                                    onClick={() => abrirModal("ticket", c)}
                                    title="Ver ticket de corte"
                                    className="bg-indigo-500/[0.06] border border-indigo-500/20 rounded-2xl p-4 cursor-pointer hover:bg-indigo-500/[0.1] transition-all">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-[11px] font-black bg-indigo-500 text-white rounded-md px-2 py-0.5">Z: {c.z}</span>
                                        <Lock className="h-4 w-4 text-indigo-400" />
                                    </div>
                                    <p className="text-lg font-black text-indigo-300">Cierre: {hora(c.fechaCierre)}</p>
                                    <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-indigo-500/15">
                                        <div>
                                            <p className={lbl}>Tiempo Abierta</p>
                                            <p className="text-[12px] font-black text-slate-200">{duracion(c.fechaApertura, c.fechaCierre) ?? "--"}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className={lbl}>Supervisor</p>
                                            <p className="text-[11px] font-black text-slate-200 truncate">{c.supervisor ?? "—"}</p>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex items-center justify-center gap-2 bg-white/[0.02] border border-dashed border-amber-500/25 rounded-2xl py-6 text-[10px] font-black text-amber-300/70 uppercase tracking-widest">
                                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" /> Caja abierta
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Modal drill-down */}
            {modal && (
                <div
                    className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
                    onClick={() => setModal(null)}
                >
                    <div
                        className="w-full max-w-3xl max-h-[85vh] bg-[#0d1320] border border-white/10 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden flex flex-col"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="px-6 py-4 border-b border-white/10 flex items-start justify-between gap-3">
                            <div>
                                <h3 className="text-[15px] font-black text-white">
                                    {modal.tipo === "ventas" ? "Ventas" : modal.tipo === "cancelaciones" ? "Cancelaciones" : "Ticket de Corte"} · Z: {modal.corte.z}
                                </h3>
                                <p className="text-[12px] font-bold text-slate-400 mt-1">
                                    Caja {modal.corte.caja} · {modal.corte.cajero} · {fmtFechaLarga(fecha)}
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                {modal.tipo === "ticket" && ticketCorte && (
                                    <button
                                        onClick={imprimirTicketCorte}
                                        className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-emerald-500 text-slate-950 font-black text-[11px] uppercase tracking-widest hover:brightness-110 transition-all"
                                        title="Imprimir ticket de corte en PDF"
                                    >
                                        <Printer className="h-4 w-4" />
                                        Imprimir
                                    </button>
                                )}
                                <button
                                    onClick={() => setModal(null)}
                                    className="p-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-400 hover:text-white transition-all"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                        </div>

                        <div className="overflow-auto flex-1">
                            {loadingModal ? (
                                <div className="flex items-center justify-center py-20">
                                    <Loader2 className="h-6 w-6 text-emerald-400 animate-spin" />
                                </div>
                            ) : modal.tipo === "ticket" && ticketCorte !== null ? (
                                <div className="p-6 flex justify-center bg-black/20">
                                    <pre className="bg-white text-slate-800 font-mono text-[11px] leading-relaxed p-6 rounded-lg shadow-2xl whitespace-pre overflow-x-auto select-all max-w-full">
                                        {ticketCorte}
                                    </pre>
                                </div>
                            ) : modal.tipo === "ventas" && (ticket || loadingTicket) ? (
                                /* Detalle del ticket seleccionado */
                                loadingTicket || !ticket ? (
                                    <div className="flex items-center justify-center py-20">
                                        <Loader2 className="h-6 w-6 text-emerald-400 animate-spin" />
                                    </div>
                                ) : (
                                    <>
                                        <div className="px-4 py-3 flex items-center justify-between gap-3 bg-white/[0.03] border-b border-white/10 sticky top-0 z-20">
                                            <button
                                                onClick={() => setTicket(null)}
                                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.05] border border-white/10 text-slate-300 hover:text-emerald-300 font-black text-[10px] uppercase tracking-widest transition-all"
                                            >
                                                ← Volver
                                            </button>
                                            <p className="text-[12px] font-black text-white">
                                                Ticket #{ticket.venta.idVenta} · Caja {ticket.venta.caja} · {hora(ticket.venta.fecha)}
                                            </p>
                                        </div>
                                        <table className="w-full">
                                            <thead className="bg-[#141a28]">
                                                <tr>
                                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Código</th>
                                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Artículo</th>
                                                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Cantidad</th>
                                                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Precio</th>
                                                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Importe</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-white/[0.04]">
                                                {ticket.partidas.map((p, i) => (
                                                    <tr key={i} className={cn("hover:bg-white/[0.03]", p.cantidadDevuelta > 0 && "bg-rose-500/[0.05]")}>
                                                        <td className="px-4 py-2 text-[12px] font-bold text-slate-400 whitespace-nowrap">{p.codigoBarras}</td>
                                                        <td className="px-4 py-2 text-[13px] font-bold text-slate-200">
                                                            {p.descripcion}
                                                            {p.cantidadDevuelta > 0 && (
                                                                <span className="ml-2 text-[9px] font-black text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-md px-1.5 py-0.5 uppercase">
                                                                    Dev: {p.cantidadDevuelta}
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-2 text-[13px] font-bold text-slate-300 text-right whitespace-nowrap">
                                                            {Math.round(p.cantidad * 1000) / 1000} {p.unidad}
                                                        </td>
                                                        <td className="px-4 py-2 text-[13px] font-bold text-slate-300 text-right whitespace-nowrap">{fmtMoney(p.precio)}</td>
                                                        <td className="px-4 py-2 text-[13px] font-black text-emerald-300 text-right whitespace-nowrap">{fmtMoney(p.importe)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </>
                                )
                            ) : modal.tipo === "ventas" && ventasDetalle ? (
                                <>
                                    {/* Búsqueda por folio */}
                                    <div className="px-4 py-3 bg-white/[0.03] border-b border-white/10 sticky top-0 z-20">
                                        <div className="relative">
                                            <Search className="absolute top-1/2 -translate-y-1/2 left-3.5 h-4 w-4 text-slate-500" />
                                            <input
                                                type="text"
                                                placeholder="BUSCAR POR # DE VENTA..."
                                                className="block w-full pl-10 pr-4 py-2 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-400/25 focus:border-emerald-400/60 transition-all"
                                                value={busquedaVenta}
                                                onChange={e => setBusquedaVenta(e.target.value)}
                                            />
                                        </div>
                                    </div>
                                    <table className="w-full">
                                        <thead className="bg-[#141a28]">
                                            <tr>
                                                <th className={cn(lbl, "px-4 py-2.5 text-left")}># Venta</th>
                                                <th className={cn(lbl, "px-4 py-2.5 text-left")}>Hora</th>
                                                <th className={cn(lbl, "px-4 py-2.5 text-right")}>Total</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/[0.04]">
                                            {ventasDetalle
                                                .filter(v => !busquedaVenta.trim() || String(v.idVenta).includes(busquedaVenta.trim()))
                                                .map(v => (
                                                    <tr
                                                        key={v.idVenta}
                                                        onClick={() => verTicketVenta(v)}
                                                        className="cursor-pointer hover:bg-white/[0.05] transition-colors"
                                                        title="Ver detalle del ticket"
                                                    >
                                                        <td className="px-4 py-2 text-[12px] font-black text-cyan-300">{v.idVenta}</td>
                                                        <td className="px-4 py-2 text-[12px] font-bold text-slate-300">{hora(v.fecha)}</td>
                                                        <td className="px-4 py-2 text-[13px] font-black text-emerald-300 text-right">{fmtMoney(v.total)}</td>
                                                    </tr>
                                                ))}
                                        </tbody>
                                    </table>
                                </>
                            ) : modal.tipo === "cancelaciones" && cancelacionesDetalle ? (
                                <table className="w-full">
                                    <thead className="sticky top-0 z-10 bg-[#141a28]">
                                        <tr>
                                            <th className={cn(lbl, "px-4 py-2.5 text-left")}>Hora</th>
                                            <th className={cn(lbl, "px-4 py-2.5 text-left")}>Artículo</th>
                                            <th className={cn(lbl, "px-4 py-2.5 text-right")}>Cantidad</th>
                                            <th className={cn(lbl, "px-4 py-2.5 text-right")}>Precio</th>
                                            <th className={cn(lbl, "px-4 py-2.5 text-right")}>Importe</th>
                                            <th className={cn(lbl, "px-4 py-2.5 text-left")}>Supervisor</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/[0.04]">
                                        {cancelacionesDetalle.map((cd, i) => (
                                            <tr key={i} className="hover:bg-white/[0.03]">
                                                <td className="px-4 py-2 text-[12px] font-bold text-slate-400 whitespace-nowrap">{hora(cd.fecha)}</td>
                                                <td className="px-4 py-2 text-[13px] font-bold text-slate-200">
                                                    {cd.descripcion}
                                                    <span className="ml-2 text-[10px] font-bold text-slate-600">{cd.codigoBarras}</span>
                                                </td>
                                                <td className="px-4 py-2 text-[13px] font-bold text-slate-300 text-right">{cd.cantidad}</td>
                                                <td className="px-4 py-2 text-[13px] font-bold text-slate-300 text-right">{fmtMoney(cd.precio)}</td>
                                                <td className="px-4 py-2 text-[13px] font-black text-rose-300 text-right">{fmtMoney(cd.importe)}</td>
                                                <td className="px-4 py-2 text-[12px] font-bold text-slate-400 truncate max-w-[140px]">{cd.supervisor}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            ) : null}
                        </div>

                        {/* Totales del modal */}
                        {!loadingModal && (
                            <div className="px-6 py-3.5 border-t border-white/10 flex justify-end gap-8">
                                {modal.tipo === "ventas" && ticket && (
                                    <>
                                        <div className="text-right">
                                            <p className={lbl}>Partidas</p>
                                            <p className="text-[15px] font-black text-slate-200">{fmtInt(ticket.partidas.length)}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className={lbl}>Total</p>
                                            <p className="text-[15px] font-black text-emerald-300">{fmtMoney(ticket.venta.total)}</p>
                                        </div>
                                        {ticket.venta.pago > 0 && (
                                            <>
                                                <div className="text-right">
                                                    <p className={lbl}>Pagó con</p>
                                                    <p className="text-[15px] font-black text-slate-200">{fmtMoney(ticket.venta.pago)}</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className={lbl}>Cambio</p>
                                                    <p className="text-[15px] font-black text-cyan-300">{fmtMoney(ticket.venta.cambio)}</p>
                                                </div>
                                            </>
                                        )}
                                    </>
                                )}
                                {modal.tipo === "ventas" && !ticket && ventasDetalle && (
                                    <>
                                        <div className="text-right">
                                            <p className={lbl}>Operaciones</p>
                                            <p className="text-[15px] font-black text-slate-200">{fmtInt(ventasDetalle.length)}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className={lbl}>Total</p>
                                            <p className="text-[15px] font-black text-emerald-300">
                                                {fmtMoney(ventasDetalle.reduce((a, v) => a + v.total, 0))}
                                            </p>
                                        </div>
                                    </>
                                )}
                                {modal.tipo === "cancelaciones" && cancelacionesDetalle && (
                                    <>
                                        <div className="text-right">
                                            <p className={lbl}>Movimientos</p>
                                            <p className="text-[15px] font-black text-slate-200">{fmtInt(cancelacionesDetalle.length)}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className={lbl}>Monto</p>
                                            <p className="text-[15px] font-black text-rose-300">
                                                {fmtMoney(cancelacionesDetalle.reduce((a, v) => a + v.importe, 0))}
                                            </p>
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
