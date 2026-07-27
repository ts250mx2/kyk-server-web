"use client"

import { useCallback, useEffect, useState } from "react"
import {
    Search, Loader2, AlertTriangle, ListRestart, Undo2, X,
    FileText, FileSpreadsheet, RefreshCw
} from "lucide-react"
import { cn } from "@/lib/utils"
import { fmtMoney, fmtInt, fmtFechaHora } from "@/lib/format"
import { exportarPdf, exportarExcel, obtenerTiendaSesion, sufijoArchivo } from "@/lib/export"

interface DevolucionItem {
    idDevolucionVenta: number
    clave: string
    fecha: string
    cliente: string
    concepto: string
    empleado: string
    usuario: string
    valor: number
    canjeada: boolean
    fechaCanje: string | null
    cajaCanje: number
    notaCredito: number | null
    cancelada: boolean
}

interface Resumen {
    devoluciones: number
    valor: number
    canjeadas: number
    pendientes: number
}

interface PartidaDevolucion {
    codigoBarras: string
    descripcion: string
    unidad: string
    cantidadOriginal: number
    cantidadDevuelta: number
    precio: number
    importe: number
    ticket: string
}

interface DevolucionDetalle {
    devolucion: DevolucionItem & { dirTel: string }
    partidas: PartidaDevolucion[]
}

const lbl = "text-[10px] font-black text-slate-500 uppercase tracking-widest"
const inputCls = "block w-full px-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-400/25 focus:border-emerald-400/60 transition-all"

const hoyISO = () => new Date().toLocaleDateString("sv-SE")
const diasAtras = (n: number) => {
    const d = new Date()
    d.setDate(d.getDate() - n)
    return d.toLocaleDateString("sv-SE")
}

export default function DevolucionesVentaPage() {
    const [fechaInicio, setFechaInicio] = useState(hoyISO())
    const [fechaFin, setFechaFin] = useState(hoyISO())
    const [busqueda, setBusqueda] = useState("")
    const [devoluciones, setDevoluciones] = useState<DevolucionItem[]>([])
    const [resumen, setResumen] = useState<Resumen | null>(null)
    const [truncado, setTruncado] = useState(false)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState("")
    const [exportando, setExportando] = useState<"pdf" | "excel" | null>(null)

    // Modal de detalle
    const [detalle, setDetalle] = useState<DevolucionDetalle | null>(null)
    const [loadingDetalle, setLoadingDetalle] = useState(false)

    const cargar = useCallback(async (inicio: string, fin: string, filtro: string) => {
        setLoading(true)
        setError("")
        try {
            const qs = new URLSearchParams({ fechaInicio: inicio, fechaFin: fin })
            if (filtro) qs.set("busqueda", filtro)

            const res = await fetch(`/api/devoluciones?${qs.toString()}`)
            if (res.status === 401) { window.location.href = "/login"; return }
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "Error al consultar devoluciones")
            setDevoluciones(json.devoluciones)
            setResumen(json.resumen)
            setTruncado(Boolean(json.truncado))
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Error desconocido")
            setDevoluciones([])
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
        try {
            const res = await fetch(`/api/devoluciones/${id}`)
            const json = await res.json()
            if (res.ok) setDetalle(json)
            else setError(json.error || "Error al consultar el detalle")
        } catch {
            setError("Error al consultar el detalle de la devolución")
        } finally {
            setLoadingDetalle(false)
        }
    }

    const exportar = async (formato: "pdf" | "excel") => {
        setExportando(formato)
        try {
            const tienda = await obtenerTiendaSesion()
            const columnas = [
                { header: "Clave" },
                { header: "Fecha" },
                { header: "Cliente" },
                { header: "Motivo" },
                { header: "Empleado" },
                { header: "Canje" },
                { header: "Valor", align: "right" as const },
            ]
            const base = {
                titulo: "DEVOLUCIONES DE VENTA",
                subtitulo: `Del ${fechaInicio} al ${fechaFin}${busqueda.trim() ? `  ·  Búsqueda: "${busqueda.trim()}"` : ""}  ·  ${fmtInt(devoluciones.length)} devoluciones`,
                tienda,
                columnas,
                nombreArchivo: `devoluciones_venta_${sufijoArchivo()}`,
            }
            const canjeTexto = (d: DevolucionItem) =>
                d.canjeada ? `Canjeada ${fmtFechaHora(d.fechaCanje)}` : (d.cancelada ? "CANCELADA" : "Pendiente")

            if (formato === "pdf") {
                exportarPdf({
                    ...base,
                    orientacion: "landscape",
                    filas: devoluciones.map(d => [
                        String(d.clave),
                        fmtFechaHora(d.fecha),
                        String(d.cliente),
                        String(d.concepto),
                        String(d.empleado),
                        canjeTexto(d),
                        fmtMoney(d.valor),
                    ]),
                })
            } else {
                exportarExcel({
                    ...base,
                    hoja: "Devoluciones",
                    columnasMoneda: [6],
                    filas: devoluciones.map(d => [
                        String(d.clave),
                        fmtFechaHora(d.fecha),
                        String(d.cliente),
                        String(d.concepto),
                        String(d.empleado),
                        canjeTexto(d),
                        d.valor,
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
                    <h1 className="text-2xl font-black text-white uppercase tracking-tight">Devoluciones de Venta</h1>
                    <p className="text-[12px] font-bold text-slate-500 mt-1">
                        {loading ? "Consultando..." : `${fmtInt(resumen?.devoluciones ?? 0)} devoluciones`}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => exportar("pdf")}
                        disabled={exportando !== null || loading || devoluciones.length === 0}
                        className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 hover:text-rose-300 hover:border-rose-500/30 font-black text-[11px] uppercase tracking-widest transition-all disabled:opacity-40"
                        title="Imprimir a PDF"
                    >
                        {exportando === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                        PDF
                    </button>
                    <button
                        onClick={() => exportar("excel")}
                        disabled={exportando !== null || loading || devoluciones.length === 0}
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
                            placeholder="CLAVE, CLIENTE, MOTIVO O EMPLEADO (ENTER)"
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

            {/* Resumen */}
            {resumen && !loading && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {[
                        { titulo: "Devoluciones", valor: fmtInt(resumen.devoluciones), color: "text-white" },
                        { titulo: "Valor Total", valor: fmtMoney(resumen.valor), color: "text-rose-300" },
                        { titulo: "Canjeadas", valor: fmtInt(resumen.canjeadas), color: "text-emerald-300" },
                        { titulo: "Pendientes de Canje", valor: fmtInt(resumen.pendientes), color: resumen.pendientes > 0 ? "text-amber-300" : "text-slate-500" },
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
                    <AlertTriangle className="h-4 w-4" /> Mostrando las primeras {fmtInt(devoluciones.length)} devoluciones — acota el rango de fechas
                </div>
            )}

            {/* Tabla */}
            <div className="bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl overflow-hidden">
                {loading ? (
                    <div className="flex items-center justify-center py-24">
                        <Loader2 className="h-7 w-7 text-emerald-400 animate-spin" />
                    </div>
                ) : devoluciones.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-24 gap-3">
                        <Undo2 className="h-8 w-8 text-slate-700" />
                        <p className="text-[12px] font-bold text-slate-600 uppercase tracking-widest">
                            Sin devoluciones en el rango seleccionado
                        </p>
                    </div>
                ) : (
                    <div className="overflow-auto max-h-[calc(100vh-26rem)]">
                        <table className="w-full">
                            <thead className="sticky top-0 z-10 bg-[#10151f] shadow-[0_1px_0_rgba(255,255,255,0.08)]">
                                <tr>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Clave</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Fecha</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Cliente</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Motivo</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Empleado</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Canje</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Valor</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/[0.04]">
                                {devoluciones.map(d => (
                                    <tr
                                        key={d.idDevolucionVenta}
                                        onClick={() => verDetalle(d.idDevolucionVenta)}
                                        className={cn(
                                            "cursor-pointer transition-colors hover:bg-white/[0.03]",
                                            d.cancelada && "bg-rose-500/[0.05]"
                                        )}
                                        title="Ver partidas de la devolución"
                                    >
                                        <td className="px-4 py-2.5 whitespace-nowrap">
                                            <span className="text-[12px] font-black text-cyan-300">{d.clave}</span>
                                            {d.notaCredito && (
                                                <span className="ml-1.5 text-[9px] font-black text-violet-300 bg-violet-500/10 border border-violet-500/25 rounded-md px-1.5 py-0.5 uppercase">
                                                    NC {d.notaCredito}
                                                </span>
                                            )}
                                            {d.cancelada && (
                                                <span className="ml-1.5 text-[9px] font-black text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-md px-1.5 py-0.5 uppercase">
                                                    Cancelada
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 whitespace-nowrap">{fmtFechaHora(d.fecha)}</td>
                                        <td className="px-4 py-2.5 text-[13px] font-bold text-slate-200 max-w-[200px] truncate" title={d.cliente}>{d.cliente || "—"}</td>
                                        <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 max-w-[240px] truncate" title={d.concepto}>{d.concepto || "—"}</td>
                                        <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 max-w-[200px] truncate" title={d.empleado}>{d.empleado}</td>
                                        <td className="px-4 py-2.5 whitespace-nowrap">
                                            <span className={cn(
                                                "text-[10px] font-black rounded-md px-2 py-0.5 border uppercase",
                                                d.canjeada
                                                    ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/25"
                                                    : "text-amber-300 bg-amber-500/10 border-amber-500/25"
                                            )}
                                                title={d.canjeada ? `Caja ${d.cajaCanje} · ${fmtFechaHora(d.fechaCanje)}` : ""}
                                            >
                                                {d.canjeada ? "Canjeada" : "Pendiente"}
                                            </span>
                                        </td>
                                        <td className="px-4 py-2.5 text-[13px] font-black text-rose-300 text-right whitespace-nowrap">{fmtMoney(d.valor)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Modal de detalle */}
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
                                <div className="px-6 py-4 border-b border-white/10 flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <h3 className="text-[15px] font-black text-white flex items-center gap-2 flex-wrap">
                                            Devolución {detalle.devolucion.clave}
                                            <span className={cn(
                                                "text-[9px] font-black rounded-md px-1.5 py-0.5 border uppercase",
                                                detalle.devolucion.canjeada
                                                    ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/25"
                                                    : "text-amber-300 bg-amber-500/10 border-amber-500/25"
                                            )}>
                                                {detalle.devolucion.canjeada
                                                    ? `Canjeada en caja ${detalle.devolucion.cajaCanje}`
                                                    : "Pendiente de canje"}
                                            </span>
                                            {detalle.devolucion.notaCredito && (
                                                <span className="text-[9px] font-black text-violet-300 bg-violet-500/10 border border-violet-500/25 rounded-md px-1.5 py-0.5 uppercase">
                                                    Nota de Crédito {detalle.devolucion.notaCredito}
                                                </span>
                                            )}
                                        </h3>
                                        <p className="text-[12px] font-bold text-slate-400 mt-1">
                                            {detalle.devolucion.cliente || "Sin cliente"}
                                            {detalle.devolucion.dirTel ? ` · ${detalle.devolucion.dirTel}` : ""}
                                            {detalle.devolucion.concepto ? ` · Motivo: ${detalle.devolucion.concepto}` : ""}
                                        </p>
                                        <p className="text-[11px] font-bold text-slate-500 mt-0.5">
                                            {fmtFechaHora(detalle.devolucion.fecha)} · Empleado: {detalle.devolucion.empleado}
                                            {detalle.devolucion.canjeada && detalle.devolucion.fechaCanje
                                                ? ` · Canje: ${fmtFechaHora(detalle.devolucion.fechaCanje)}`
                                                : ""}
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => setDetalle(null)}
                                        className="p-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-400 hover:text-white transition-all"
                                    >
                                        <X className="h-4 w-4" />
                                    </button>
                                </div>

                                <div className="overflow-auto flex-1">
                                    <table className="w-full">
                                        <thead className="sticky top-0 z-10 bg-[#141a28]">
                                            <tr>
                                                <th className={cn(lbl, "px-4 py-2.5 text-left")}>Código</th>
                                                <th className={cn(lbl, "px-4 py-2.5 text-left")}>Artículo</th>
                                                <th className={cn(lbl, "px-4 py-2.5 text-left")}>Ticket</th>
                                                <th className={cn(lbl, "px-4 py-2.5 text-right")}>Cant. Ticket</th>
                                                <th className={cn(lbl, "px-4 py-2.5 text-right")}>Devuelto</th>
                                                <th className={cn(lbl, "px-4 py-2.5 text-right")}>Precio</th>
                                                <th className={cn(lbl, "px-4 py-2.5 text-right")}>Importe</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/[0.04]">
                                            {detalle.partidas.map((p, i) => (
                                                <tr key={i} className={cn(
                                                    "hover:bg-white/[0.03]",
                                                    p.cantidadDevuelta > 0 ? "bg-rose-500/[0.05]" : "opacity-50"
                                                )}>
                                                    <td className="px-4 py-2 text-[12px] font-bold text-slate-400 whitespace-nowrap">{p.codigoBarras}</td>
                                                    <td className="px-4 py-2 text-[13px] font-bold text-slate-200">{p.descripcion}</td>
                                                    <td className="px-4 py-2 text-[12px] font-bold text-slate-500 whitespace-nowrap">{p.ticket || "—"}</td>
                                                    <td className="px-4 py-2 text-[12px] font-bold text-slate-400 text-right whitespace-nowrap">
                                                        {p.cantidadOriginal} {p.unidad}
                                                    </td>
                                                    <td className={cn(
                                                        "px-4 py-2 text-[13px] font-black text-right whitespace-nowrap",
                                                        p.cantidadDevuelta > 0 ? "text-rose-300" : "text-slate-600"
                                                    )}>
                                                        {p.cantidadDevuelta > 0 ? `${p.cantidadDevuelta} ${p.unidad}` : "—"}
                                                    </td>
                                                    <td className="px-4 py-2 text-[13px] font-bold text-slate-300 text-right whitespace-nowrap">{fmtMoney(p.precio)}</td>
                                                    <td className={cn(
                                                        "px-4 py-2 text-[13px] font-black text-right whitespace-nowrap",
                                                        p.cantidadDevuelta > 0 ? "text-rose-300" : "text-slate-600"
                                                    )}>
                                                        {p.cantidadDevuelta > 0 ? fmtMoney(p.importe) : "—"}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                <div className="px-6 py-3.5 border-t border-white/10 flex justify-end gap-8">
                                    <div className="text-right">
                                        <p className={lbl}>Partidas Devueltas</p>
                                        <p className="text-[15px] font-black text-slate-200">
                                            {fmtInt(detalle.partidas.filter(p => p.cantidadDevuelta > 0).length)}
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <p className={lbl}>Valor de la Devolución</p>
                                        <p className="text-[15px] font-black text-rose-300">{fmtMoney(detalle.devolucion.valor)}</p>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
