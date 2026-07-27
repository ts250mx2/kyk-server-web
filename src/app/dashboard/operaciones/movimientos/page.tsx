"use client"

import { useCallback, useEffect, useState } from "react"
import {
    Search, Loader2, AlertTriangle, ListRestart, ClipboardList, X,
    FileText, FileSpreadsheet, RefreshCw
} from "lucide-react"
import { cn } from "@/lib/utils"
import { fmtMoney, fmtInt, fmtFechaHora } from "@/lib/format"
import { exportarPdf, exportarExcel, obtenerTiendaSesion, sufijoArchivo } from "@/lib/export"

type TipoMovimiento = "entradas" | "salidas"

interface MovimientoItem {
    idMovimiento: number
    idTienda: number
    folio: string
    fecha: string
    concepto: string
    usuario: string
    proveedor: string
    monto: number
    partidas: number
    cancelado: boolean
}

interface Resumen {
    movimientos: number
    monto: number
    cancelados: number
}

interface PartidaMovimiento {
    codigoBarras: string
    descripcion: string
    medida: string
    mov: number
    costo: number
    iva: number
    importe: number
}

interface MovimientoDetalle {
    movimiento: {
        idMovimiento: number
        folio: string
        concepto: string
        fecha: string
        tipo: string
        usuario: string
        proveedor: string
        cancelado: boolean
        monto: number
    }
    partidas: PartidaMovimiento[]
}

const lbl = "text-[10px] font-black text-slate-500 uppercase tracking-widest"
const inputCls = "block w-full px-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-400/25 focus:border-emerald-400/60 transition-all"

const hoyISO = () => new Date().toLocaleDateString("sv-SE")
const diasAtras = (n: number) => {
    const d = new Date()
    d.setDate(d.getDate() - n)
    return d.toLocaleDateString("sv-SE")
}

export default function OtrosMovimientosPage() {
    const [tipo, setTipo] = useState<TipoMovimiento>("entradas")
    const [fechaInicio, setFechaInicio] = useState(hoyISO())
    const [fechaFin, setFechaFin] = useState(hoyISO())
    const [busqueda, setBusqueda] = useState("")
    const [movimientos, setMovimientos] = useState<MovimientoItem[]>([])
    const [resumen, setResumen] = useState<Resumen | null>(null)
    const [truncado, setTruncado] = useState(false)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState("")
    const [exportando, setExportando] = useState<"pdf" | "excel" | null>(null)

    // Modal de detalle
    const [detalle, setDetalle] = useState<MovimientoDetalle | null>(null)
    const [loadingDetalle, setLoadingDetalle] = useState(false)

    const cargar = useCallback(async (t: TipoMovimiento, inicio: string, fin: string, filtro: string) => {
        setLoading(true)
        setError("")
        try {
            const qs = new URLSearchParams({ tipo: t, fechaInicio: inicio, fechaFin: fin })
            if (filtro) qs.set("busqueda", filtro)

            const res = await fetch(`/api/movimientos?${qs.toString()}`)
            if (res.status === 401) { window.location.href = "/login"; return }
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "Error al consultar movimientos")
            setMovimientos(json.movimientos)
            setResumen(json.resumen)
            setTruncado(Boolean(json.truncado))
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Error desconocido")
            setMovimientos([])
            setResumen(null)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        cargar("entradas", hoyISO(), hoyISO(), "")
    }, [cargar])

    const actualizar = () => cargar(tipo, fechaInicio, fechaFin, busqueda.trim())
    const cambiarTipo = (t: TipoMovimiento) => {
        setTipo(t)
        cargar(t, fechaInicio, fechaFin, busqueda.trim())
    }
    const limpiar = () => {
        setBusqueda("")
        setFechaInicio(hoyISO())
        setFechaFin(hoyISO())
        cargar(tipo, hoyISO(), hoyISO(), "")
    }
    const preset = (dias: number) => {
        const inicio = diasAtras(dias)
        const fin = hoyISO()
        setFechaInicio(inicio)
        setFechaFin(fin)
        cargar(tipo, inicio, fin, busqueda.trim())
    }

    const verDetalle = async (m: MovimientoItem) => {
        setLoadingDetalle(true)
        setDetalle(null)
        try {
            const res = await fetch(`/api/movimientos/detalle?idMovimiento=${m.idMovimiento}&idTienda=${m.idTienda}`)
            const json = await res.json()
            if (res.ok) setDetalle(json)
            else setError(json.error || "Error al consultar el detalle")
        } catch {
            setError("Error al consultar el detalle del movimiento")
        } finally {
            setLoadingDetalle(false)
        }
    }

    const esEntradas = tipo === "entradas"

    const exportar = async (formato: "pdf" | "excel") => {
        setExportando(formato)
        try {
            const tienda = await obtenerTiendaSesion()
            const columnas = [
                { header: "Folio" },
                { header: "Fecha" },
                { header: "Concepto" },
                { header: "Usuario" },
                { header: "Proveedor" },
                { header: "Partidas", align: "right" as const },
                { header: "Monto", align: "right" as const },
                { header: "Estado" },
            ]
            const base = {
                titulo: `OTROS MOVIMIENTOS — ${esEntradas ? "ENTRADAS" : "SALIDAS"}`,
                subtitulo: `Del ${fechaInicio} al ${fechaFin}${busqueda.trim() ? `  ·  Búsqueda: "${busqueda.trim()}"` : ""}  ·  ${fmtInt(movimientos.length)} movimientos`,
                tienda,
                columnas,
                nombreArchivo: `movimientos_${tipo}_${sufijoArchivo()}`,
            }

            if (formato === "pdf") {
                exportarPdf({
                    ...base,
                    orientacion: "landscape",
                    filas: movimientos.map(m => [
                        String(m.folio),
                        fmtFechaHora(m.fecha),
                        String(m.concepto),
                        String(m.usuario),
                        m.proveedor || "—",
                        fmtInt(m.partidas),
                        m.monto > 0 ? fmtMoney(m.monto) : "—",
                        m.cancelado ? "CANCELADO" : "",
                    ]),
                })
            } else {
                exportarExcel({
                    ...base,
                    hoja: esEntradas ? "Entradas" : "Salidas",
                    columnasMoneda: [6],
                    filas: movimientos.map(m => [
                        String(m.folio),
                        fmtFechaHora(m.fecha),
                        String(m.concepto),
                        String(m.usuario),
                        m.proveedor || "",
                        m.partidas,
                        m.monto > 0 ? m.monto : "",
                        m.cancelado ? "CANCELADO" : "",
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
                    <h1 className="text-2xl font-black text-white uppercase tracking-tight">Otros Movimientos</h1>
                    <p className="text-[12px] font-bold text-slate-500 mt-1">
                        {loading ? "Consultando..." : `${fmtInt(resumen?.movimientos ?? 0)} movimientos de ${esEntradas ? "entrada" : "salida"}`}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => exportar("pdf")}
                        disabled={exportando !== null || loading || movimientos.length === 0}
                        className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 hover:text-rose-300 hover:border-rose-500/30 font-black text-[11px] uppercase tracking-widest transition-all disabled:opacity-40"
                        title="Imprimir a PDF"
                    >
                        {exportando === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                        PDF
                    </button>
                    <button
                        onClick={() => exportar("excel")}
                        disabled={exportando !== null || loading || movimientos.length === 0}
                        className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 hover:text-emerald-300 hover:border-emerald-500/30 font-black text-[11px] uppercase tracking-widest transition-all disabled:opacity-40"
                        title="Exportar a Excel"
                    >
                        {exportando === "excel" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                        Excel
                    </button>

                    {/* Tabs Entradas / Salidas */}
                    <div className="flex items-center rounded-xl bg-white/[0.04] border border-white/10 p-1">
                        {(["entradas", "salidas"] as const).map(t => (
                            <button
                                key={t}
                                onClick={() => cambiarTipo(t)}
                                className={cn(
                                    "px-4 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all",
                                    tipo === t ? "bg-emerald-500 text-slate-950" : "text-slate-400 hover:text-white"
                                )}
                            >
                                {t === "entradas" ? "Entradas" : "Salidas"}
                            </button>
                        ))}
                    </div>
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
                            placeholder="FOLIO, CONCEPTO, USUARIO O PROVEEDOR (ENTER)"
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
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                    {[
                        { titulo: esEntradas ? "Entradas" : "Salidas", valor: fmtInt(resumen.movimientos), color: "text-white" },
                        { titulo: "Monto Total", valor: fmtMoney(resumen.monto), color: esEntradas ? "text-emerald-300" : "text-rose-300" },
                        { titulo: "Cancelados", valor: fmtInt(resumen.cancelados), color: resumen.cancelados > 0 ? "text-rose-300" : "text-slate-500" },
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
                    <AlertTriangle className="h-4 w-4" /> Mostrando los primeros {fmtInt(movimientos.length)} movimientos — acota el rango de fechas
                </div>
            )}

            {/* Tabla de movimientos */}
            <div className="bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl overflow-hidden">
                {loading ? (
                    <div className="flex items-center justify-center py-24">
                        <Loader2 className="h-7 w-7 text-emerald-400 animate-spin" />
                    </div>
                ) : movimientos.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-24 gap-3">
                        <ClipboardList className="h-8 w-8 text-slate-700" />
                        <p className="text-[12px] font-bold text-slate-600 uppercase tracking-widest">
                            Sin movimientos en el rango seleccionado
                        </p>
                    </div>
                ) : (
                    <div className="overflow-auto max-h-[calc(100vh-26rem)]">
                        <table className="w-full">
                            <thead className="sticky top-0 z-10 bg-[#10151f] shadow-[0_1px_0_rgba(255,255,255,0.08)]">
                                <tr>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Folio</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Fecha</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Concepto</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Usuario</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Proveedor</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Partidas</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Monto</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/[0.04]">
                                {movimientos.map((m, i) => (
                                    <tr
                                        key={`${m.idMovimiento}-${i}`}
                                        onClick={() => verDetalle(m)}
                                        className={cn(
                                            "cursor-pointer transition-colors hover:bg-white/[0.03]",
                                            m.cancelado && "bg-rose-500/[0.05]"
                                        )}
                                        title="Ver partidas del movimiento"
                                    >
                                        <td className="px-4 py-2.5 whitespace-nowrap">
                                            <span className="text-[12px] font-black text-cyan-300">{m.folio}</span>
                                            {m.cancelado && (
                                                <span className="ml-1.5 text-[9px] font-black text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-md px-1.5 py-0.5 uppercase">
                                                    Cancelado
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 whitespace-nowrap">{fmtFechaHora(m.fecha)}</td>
                                        <td className="px-4 py-2.5 text-[13px] font-bold text-slate-200 max-w-[300px] truncate" title={m.concepto}>
                                            {m.concepto}
                                        </td>
                                        <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 max-w-[180px] truncate">{m.usuario}</td>
                                        <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 max-w-[200px] truncate">{m.proveedor || "—"}</td>
                                        <td className="px-4 py-2.5 text-[13px] font-bold text-slate-300 text-right whitespace-nowrap">{m.partidas || "—"}</td>
                                        <td className={cn(
                                            "px-4 py-2.5 text-[13px] font-black text-right whitespace-nowrap",
                                            esEntradas ? "text-emerald-300" : "text-rose-300"
                                        )}>
                                            {m.monto > 0 ? fmtMoney(m.monto) : "—"}
                                        </td>
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
                        className="w-full max-w-3xl max-h-[85vh] bg-[#0d1320] border border-white/10 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden flex flex-col"
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
                                            {detalle.movimiento.concepto}
                                            <span className={cn(
                                                "text-[9px] font-black rounded-md px-1.5 py-0.5 border uppercase",
                                                detalle.movimiento.tipo === "ENTRADA"
                                                    ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/25"
                                                    : "text-rose-300 bg-rose-500/10 border-rose-500/25"
                                            )}>
                                                {detalle.movimiento.tipo}
                                            </span>
                                            {detalle.movimiento.cancelado && (
                                                <span className="text-[9px] font-black text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-md px-1.5 py-0.5 uppercase">
                                                    Cancelado
                                                </span>
                                            )}
                                        </h3>
                                        <p className="text-[12px] font-bold text-slate-400 mt-1">
                                            Folio {detalle.movimiento.folio} · {fmtFechaHora(detalle.movimiento.fecha)}
                                        </p>
                                        <p className="text-[11px] font-bold text-slate-500 mt-0.5">
                                            Realizó: {detalle.movimiento.usuario}
                                            {detalle.movimiento.proveedor ? ` · Proveedor: ${detalle.movimiento.proveedor}` : ""}
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
                                                <th className={cn(lbl, "px-4 py-2.5 text-left")}>Descripción</th>
                                                <th className={cn(lbl, "px-4 py-2.5 text-right")}>Cantidad</th>
                                                <th className={cn(lbl, "px-4 py-2.5 text-right")}>Costo</th>
                                                <th className={cn(lbl, "px-4 py-2.5 text-right")}>Importe</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/[0.04]">
                                            {detalle.partidas.map((p, i) => (
                                                <tr key={i} className="hover:bg-white/[0.03]">
                                                    <td className="px-4 py-2 text-[12px] font-bold text-slate-400 whitespace-nowrap">{p.codigoBarras}</td>
                                                    <td className="px-4 py-2 text-[13px] font-bold text-slate-200">{p.descripcion}</td>
                                                    <td className="px-4 py-2 text-[13px] font-bold text-slate-200 text-right whitespace-nowrap">
                                                        {p.mov} {p.medida}
                                                    </td>
                                                    <td className="px-4 py-2 text-[13px] font-bold text-slate-300 text-right whitespace-nowrap">{fmtMoney(p.costo)}</td>
                                                    <td className="px-4 py-2 text-[13px] font-black text-emerald-300 text-right whitespace-nowrap">{fmtMoney(p.importe)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                <div className="px-6 py-3.5 border-t border-white/10 flex justify-end gap-8">
                                    <div className="text-right">
                                        <p className={lbl}>Partidas</p>
                                        <p className="text-[15px] font-black text-slate-200">{fmtInt(detalle.partidas.length)}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className={lbl}>Monto Total</p>
                                        <p className="text-[15px] font-black text-emerald-300">{fmtMoney(detalle.movimiento.monto)}</p>
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
