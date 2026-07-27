"use client"

import { useCallback, useEffect, useState } from "react"
import {
    Search, Loader2, AlertTriangle, ListRestart, ArrowLeftRight, X,
    FileText, FileSpreadsheet, RefreshCw, Printer
} from "lucide-react"
import { cn } from "@/lib/utils"
import { fmtMoney, fmtInt, fmtFechaHora, fmtPct } from "@/lib/format"
import { exportarPdf, exportarExcel, obtenerTiendaSesion, sufijoArchivo } from "@/lib/export"
import { imprimirTransferenciaPdf, type ImpresionTransferencia } from "@/lib/transferencia-pdf"

type TipoTransferencia = "entradas" | "salidas"

interface TransferenciaItem {
    folio: string
    fecha: string
    tienda: string
    descripcion: string
    idSalida: number
    idTiendaSalida: number
    monto: number
    partidas: number
    cancelada: boolean
    recibida: boolean
}

interface Resumen {
    transferencias: number
    monto: number
    canceladas: number
}

interface PartidaTransferencia {
    codigoInterno: number
    codigoBarras: string
    descripcion: string
    medida: string
    mov: number
    piezasPedido: number
    piezasRecibo: number
    costo: number
    iva: number
    importe: number
}

interface TransferenciaDetalle {
    empresa: ImpresionTransferencia["empresa"]
    transferencia: {
        idSalida: number
        folioSalida: string
        folioEntrada: string
        descripcion: string
        origen: string
        destino: string
        fechaSalida: string
        fechaEntrada: string | null
        recibida: boolean
        cancelada: boolean
        monto: number
    }
    partidas: PartidaTransferencia[]
}

const lbl = "text-[10px] font-black text-slate-500 uppercase tracking-widest"
const inputCls = "block w-full px-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-400/25 focus:border-emerald-400/60 transition-all"

const hoyISO = () => new Date().toLocaleDateString("sv-SE")
const diasAtras = (n: number) => {
    const d = new Date()
    d.setDate(d.getDate() - n)
    return d.toLocaleDateString("sv-SE")
}

export default function TransferenciasPage() {
    const [tipo, setTipo] = useState<TipoTransferencia>("entradas")
    const [fechaInicio, setFechaInicio] = useState(hoyISO())
    const [fechaFin, setFechaFin] = useState(hoyISO())
    const [busqueda, setBusqueda] = useState("")
    const [transferencias, setTransferencias] = useState<TransferenciaItem[]>([])
    const [resumen, setResumen] = useState<Resumen | null>(null)
    const [truncado, setTruncado] = useState(false)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState("")
    const [exportando, setExportando] = useState<"pdf" | "excel" | null>(null)

    // Modal de detalle
    const [detalle, setDetalle] = useState<TransferenciaDetalle | null>(null)
    const [loadingDetalle, setLoadingDetalle] = useState(false)
    const [imprimiendo, setImprimiendo] = useState(false)

    // Impresión de la transferencia (mismo formato de documento que el recibo)
    const imprimirTransferencia = async () => {
        if (!detalle) return
        setImprimiendo(true)
        try {
            await imprimirTransferenciaPdf(detalle)
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Error al imprimir la transferencia")
        } finally {
            setImprimiendo(false)
        }
    }

    const cargar = useCallback(async (t: TipoTransferencia, inicio: string, fin: string, filtro: string) => {
        setLoading(true)
        setError("")
        try {
            const qs = new URLSearchParams({ tipo: t, fechaInicio: inicio, fechaFin: fin })
            if (filtro) qs.set("busqueda", filtro)

            const res = await fetch(`/api/transferencias?${qs.toString()}`)
            if (res.status === 401) { window.location.href = "/login"; return }
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "Error al consultar transferencias")
            setTransferencias(json.transferencias)
            setResumen(json.resumen)
            setTruncado(Boolean(json.truncado))
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Error desconocido")
            setTransferencias([])
            setResumen(null)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        cargar("entradas", hoyISO(), hoyISO(), "")
    }, [cargar])

    const actualizar = () => cargar(tipo, fechaInicio, fechaFin, busqueda.trim())
    const cambiarTipo = (t: TipoTransferencia) => {
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

    const verDetalle = async (t: TransferenciaItem) => {
        if (!t.idSalida) return
        setLoadingDetalle(true)
        setDetalle(null)
        try {
            const res = await fetch(`/api/transferencias/detalle?idSalida=${t.idSalida}&idTiendaSalida=${t.idTiendaSalida}`)
            const json = await res.json()
            if (res.ok) setDetalle(json)
            else setError(json.error || "Error al consultar el detalle")
        } catch {
            setError("Error al consultar el detalle de la transferencia")
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
                { header: esEntradas ? "Origen" : "Destino" },
                { header: "Descripción" },
                { header: "Partidas", align: "right" as const },
                { header: "Monto", align: "right" as const },
                { header: "Estado" },
            ]
            const base = {
                titulo: `REPORTE DE TRANSFERENCIAS — ${esEntradas ? "ENTRADAS" : "SALIDAS"}`,
                subtitulo: `Del ${fechaInicio} al ${fechaFin}${busqueda.trim() ? `  ·  Búsqueda: "${busqueda.trim()}"` : ""}  ·  ${fmtInt(transferencias.length)} transferencias`,
                tienda,
                columnas,
                nombreArchivo: `transferencias_${tipo}_${sufijoArchivo()}`,
            }
            const estado = (t: TransferenciaItem) =>
                t.cancelada ? "CANCELADA" : (esEntradas ? "Recibida" : (t.recibida ? "Recibida" : "En tránsito"))

            if (formato === "pdf") {
                exportarPdf({
                    ...base,
                    orientacion: "landscape",
                    filas: transferencias.map(t => [
                        String(t.folio),
                        fmtFechaHora(t.fecha),
                        String(t.tienda),
                        String(t.descripcion),
                        fmtInt(t.partidas),
                        t.monto > 0 ? fmtMoney(t.monto) : "—",
                        estado(t),
                    ]),
                })
            } else {
                exportarExcel({
                    ...base,
                    hoja: esEntradas ? "Entradas" : "Salidas",
                    columnasMoneda: [5],
                    filas: transferencias.map(t => [
                        String(t.folio),
                        fmtFechaHora(t.fecha),
                        String(t.tienda),
                        String(t.descripcion),
                        t.partidas,
                        t.monto > 0 ? t.monto : "",
                        estado(t),
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
                    <h1 className="text-2xl font-black text-white uppercase tracking-tight">Transferencias</h1>
                    <p className="text-[12px] font-bold text-slate-500 mt-1">
                        {loading ? "Consultando..." : `${fmtInt(resumen?.transferencias ?? 0)} transferencias de ${esEntradas ? "entrada" : "salida"}`}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => exportar("pdf")}
                        disabled={exportando !== null || loading || transferencias.length === 0}
                        className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 hover:text-rose-300 hover:border-rose-500/30 font-black text-[11px] uppercase tracking-widest transition-all disabled:opacity-40"
                        title="Imprimir a PDF"
                    >
                        {exportando === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                        PDF
                    </button>
                    <button
                        onClick={() => exportar("excel")}
                        disabled={exportando !== null || loading || transferencias.length === 0}
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
                            placeholder="FOLIO, DESCRIPCIÓN O TIENDA (ENTER)"
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
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                    {[
                        { titulo: esEntradas ? "Entradas" : "Salidas", valor: fmtInt(resumen.transferencias), color: "text-white" },
                        { titulo: "Monto Total", valor: fmtMoney(resumen.monto), color: "text-emerald-300" },
                        { titulo: "Canceladas", valor: fmtInt(resumen.canceladas), color: resumen.canceladas > 0 ? "text-rose-300" : "text-slate-500" },
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
                    <AlertTriangle className="h-4 w-4" /> Mostrando las primeras {fmtInt(transferencias.length)} transferencias — acota el rango de fechas
                </div>
            )}

            {/* Tabla de transferencias */}
            <div className="bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl overflow-hidden">
                {loading ? (
                    <div className="flex items-center justify-center py-24">
                        <Loader2 className="h-7 w-7 text-emerald-400 animate-spin" />
                    </div>
                ) : transferencias.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-24 gap-3">
                        <ArrowLeftRight className="h-8 w-8 text-slate-700" />
                        <p className="text-[12px] font-bold text-slate-600 uppercase tracking-widest">
                            Sin transferencias en el rango seleccionado
                        </p>
                    </div>
                ) : (
                    <div className="overflow-auto max-h-[calc(100vh-26rem)]">
                        <table className="w-full">
                            <thead className="sticky top-0 z-10 bg-[#10151f] shadow-[0_1px_0_rgba(255,255,255,0.08)]">
                                <tr>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Folio</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Fecha</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>{esEntradas ? "Origen" : "Destino"}</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Descripción</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Partidas</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Monto</th>
                                    {!esEntradas && <th className={cn(lbl, "px-4 py-2.5 text-left")}>Estado</th>}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/[0.04]">
                                {transferencias.map((t, i) => (
                                    <tr
                                        key={`${t.folio}-${i}`}
                                        onClick={() => verDetalle(t)}
                                        className={cn(
                                            "transition-colors",
                                            t.idSalida > 0 ? "cursor-pointer hover:bg-white/[0.03]" : "opacity-60",
                                            t.cancelada && "bg-rose-500/[0.05]"
                                        )}
                                        title={t.idSalida > 0 ? "Ver partidas de la transferencia" : "Sin salida ligada"}
                                    >
                                        <td className="px-4 py-2.5 whitespace-nowrap">
                                            <span className="text-[12px] font-black text-cyan-300">{t.folio}</span>
                                            {t.cancelada && (
                                                <span className="ml-1.5 text-[9px] font-black text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-md px-1.5 py-0.5 uppercase">
                                                    Cancelada
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 whitespace-nowrap">{fmtFechaHora(t.fecha)}</td>
                                        <td className="px-4 py-2.5 text-[13px] font-bold text-slate-200 whitespace-nowrap">{t.tienda || "—"}</td>
                                        <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 max-w-[340px] truncate" title={t.descripcion}>
                                            {t.descripcion || "—"}
                                        </td>
                                        <td className="px-4 py-2.5 text-[13px] font-bold text-slate-300 text-right whitespace-nowrap">{t.partidas || "—"}</td>
                                        <td className="px-4 py-2.5 text-[13px] font-black text-emerald-300 text-right whitespace-nowrap">
                                            {t.monto > 0 ? fmtMoney(t.monto) : "—"}
                                        </td>
                                        {!esEntradas && (
                                            <td className="px-4 py-2.5 whitespace-nowrap">
                                                <span className={cn(
                                                    "text-[10px] font-black rounded-md px-2 py-0.5 border uppercase",
                                                    t.recibida
                                                        ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/25"
                                                        : "text-amber-300 bg-amber-500/10 border-amber-500/25"
                                                )}>
                                                    {t.recibida ? "Recibida" : "En tránsito"}
                                                </span>
                                            </td>
                                        )}
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
                                {/* Encabezado */}
                                <div className="px-6 py-4 border-b border-white/10 flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <h3 className="text-[15px] font-black text-white flex items-center gap-2 flex-wrap">
                                            Transferencia {detalle.transferencia.folioSalida}
                                            {detalle.transferencia.cancelada && (
                                                <span className="text-[9px] font-black text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-md px-1.5 py-0.5 uppercase">
                                                    Cancelada
                                                </span>
                                            )}
                                            <span className={cn(
                                                "text-[9px] font-black rounded-md px-1.5 py-0.5 border uppercase",
                                                detalle.transferencia.recibida
                                                    ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/25"
                                                    : "text-amber-300 bg-amber-500/10 border-amber-500/25"
                                            )}>
                                                {detalle.transferencia.recibida ? "Recibida" : "En tránsito"}
                                            </span>
                                        </h3>
                                        <p className="text-[12px] font-bold text-slate-400 mt-1 truncate" title={detalle.transferencia.descripcion}>
                                            {detalle.transferencia.descripcion}
                                        </p>
                                        <p className="text-[11px] font-bold text-slate-500 mt-0.5">
                                            {detalle.transferencia.origen} → {detalle.transferencia.destino}
                                            {" · "}Salida: {fmtFechaHora(detalle.transferencia.fechaSalida)}
                                            {detalle.transferencia.recibida && detalle.transferencia.fechaEntrada
                                                ? ` · Entrada: ${fmtFechaHora(detalle.transferencia.fechaEntrada)} (${detalle.transferencia.folioEntrada})`
                                                : ""}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <button
                                            onClick={imprimirTransferencia}
                                            disabled={imprimiendo}
                                            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-emerald-500 text-slate-950 font-black text-[11px] uppercase tracking-widest hover:brightness-110 transition-all disabled:opacity-60"
                                            title="Imprimir transferencia en PDF"
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

                                {/* Partidas */}
                                <div className="overflow-auto flex-1">
                                    <table className="w-full">
                                        <thead className="sticky top-0 z-10 bg-[#141a28]">
                                            <tr>
                                                <th className={cn(lbl, "px-4 py-2.5 text-left")}>Código</th>
                                                <th className={cn(lbl, "px-4 py-2.5 text-left")}>Descripción</th>
                                                <th className={cn(lbl, "px-4 py-2.5 text-right")}>Cantidad</th>
                                                <th className={cn(lbl, "px-4 py-2.5 text-right")}>Pzs Ped/Rec</th>
                                                <th className={cn(lbl, "px-4 py-2.5 text-right")}>Costo</th>
                                                <th className={cn(lbl, "px-4 py-2.5 text-right")}>IVA</th>
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
                                                    <td className="px-4 py-2 text-[12px] font-bold text-slate-500 text-right whitespace-nowrap">
                                                        {p.piezasPedido || p.piezasRecibo ? `${p.piezasPedido} / ${p.piezasRecibo}` : "—"}
                                                    </td>
                                                    <td className="px-4 py-2 text-[13px] font-bold text-slate-300 text-right whitespace-nowrap">{fmtMoney(p.costo)}</td>
                                                    <td className="px-4 py-2 text-[12px] font-bold text-slate-400 text-right whitespace-nowrap">
                                                        {p.iva > 0 ? fmtPct(p.iva) : "—"}
                                                    </td>
                                                    <td className="px-4 py-2 text-[13px] font-black text-emerald-300 text-right whitespace-nowrap">
                                                        {fmtMoney(p.importe)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Totales */}
                                <div className="px-6 py-4 border-t border-white/10 flex flex-wrap gap-x-8 gap-y-2 justify-end">
                                    <div className="text-right">
                                        <p className={lbl}>Partidas</p>
                                        <p className="text-[15px] font-black text-slate-200">{fmtInt(detalle.partidas.length)}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className={lbl}>Monto Total</p>
                                        <p className="text-[15px] font-black text-emerald-300">{fmtMoney(detalle.transferencia.monto)}</p>
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
