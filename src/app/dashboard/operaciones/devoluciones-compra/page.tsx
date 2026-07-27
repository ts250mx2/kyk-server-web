"use client"

import { useCallback, useEffect, useState } from "react"
import {
    Search, Loader2, AlertTriangle, ListRestart, PackageX,
    FileText, FileSpreadsheet, RefreshCw
} from "lucide-react"
import { cn } from "@/lib/utils"
import { fmtMoney, fmtInt, fmtFechaHora } from "@/lib/format"
import { exportarPdf, exportarExcel, obtenerTiendaSesion, sufijoArchivo } from "@/lib/export"

type TipoVista = "pendientes" | "historial"

interface PartidaDevCompra {
    idProveedor: number
    proveedor: string
    codigoBarras: string
    descripcion: string
    unidad: string
    cantidad: number
    costo: number
    importe: number
    usuario: string
    fecha: string | null
}

interface Resumen {
    partidas: number
    proveedores: number
    monto: number
}

const lbl = "text-[10px] font-black text-slate-500 uppercase tracking-widest"
const inputCls = "block w-full px-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-400/25 focus:border-emerald-400/60 transition-all"

const hoyISO = () => new Date().toLocaleDateString("sv-SE")
const diasAtras = (n: number) => {
    const d = new Date()
    d.setDate(d.getDate() - n)
    return d.toLocaleDateString("sv-SE")
}

export default function DevolucionesCompraPage() {
    const [tipo, setTipo] = useState<TipoVista>("pendientes")
    const [fechaInicio, setFechaInicio] = useState(diasAtras(7))
    const [fechaFin, setFechaFin] = useState(hoyISO())
    const [busqueda, setBusqueda] = useState("")
    const [partidas, setPartidas] = useState<PartidaDevCompra[]>([])
    const [resumen, setResumen] = useState<Resumen | null>(null)
    const [truncado, setTruncado] = useState(false)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState("")
    const [exportando, setExportando] = useState<"pdf" | "excel" | null>(null)

    const cargar = useCallback(async (t: TipoVista, inicio: string, fin: string, filtro: string) => {
        setLoading(true)
        setError("")
        try {
            const qs = new URLSearchParams({ tipo: t })
            if (t === "historial") {
                qs.set("fechaInicio", inicio)
                qs.set("fechaFin", fin)
            }
            if (filtro) qs.set("busqueda", filtro)

            const res = await fetch(`/api/devoluciones-compra?${qs.toString()}`)
            if (res.status === 401) { window.location.href = "/login"; return }
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "Error al consultar devoluciones de compra")
            setPartidas(json.partidas)
            setResumen(json.resumen)
            setTruncado(Boolean(json.truncado))
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Error desconocido")
            setPartidas([])
            setResumen(null)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        cargar("pendientes", diasAtras(7), hoyISO(), "")
    }, [cargar])

    const actualizar = () => cargar(tipo, fechaInicio, fechaFin, busqueda.trim())
    const cambiarTipo = (t: TipoVista) => {
        setTipo(t)
        cargar(t, fechaInicio, fechaFin, busqueda.trim())
    }
    const limpiar = () => {
        setBusqueda("")
        setFechaInicio(diasAtras(7))
        setFechaFin(hoyISO())
        cargar(tipo, diasAtras(7), hoyISO(), "")
    }
    const preset = (dias: number) => {
        const inicio = diasAtras(dias)
        const fin = hoyISO()
        setFechaInicio(inicio)
        setFechaFin(fin)
        cargar(tipo, inicio, fin, busqueda.trim())
    }

    const esPendientes = tipo === "pendientes"

    const exportar = async (formato: "pdf" | "excel") => {
        setExportando(formato)
        try {
            const tienda = await obtenerTiendaSesion()
            const columnas = [
                { header: "Proveedor" },
                { header: "Código" },
                { header: "Artículo" },
                { header: "Cantidad", align: "right" as const },
                { header: "Costo", align: "right" as const },
                { header: "Importe Est.", align: "right" as const },
                { header: "Usuario" },
                { header: "Fecha" },
            ]
            const base = {
                titulo: `DEVOLUCIONES DE COMPRA — ${esPendientes ? "PENDIENTES" : "HISTORIAL"}`,
                subtitulo: `${esPendientes ? "Mercancía por devolver al proveedor" : `Del ${fechaInicio} al ${fechaFin}`}${busqueda.trim() ? `  ·  Búsqueda: "${busqueda.trim()}"` : ""}  ·  ${fmtInt(partidas.length)} partidas`,
                tienda,
                columnas,
                nombreArchivo: `devoluciones_compra_${tipo}_${sufijoArchivo()}`,
            }

            if (formato === "pdf") {
                exportarPdf({
                    ...base,
                    orientacion: "landscape",
                    filas: partidas.map(p => [
                        String(p.proveedor),
                        String(p.codigoBarras),
                        String(p.descripcion),
                        `${p.cantidad} ${p.unidad}`,
                        fmtMoney(p.costo),
                        fmtMoney(p.importe),
                        String(p.usuario),
                        fmtFechaHora(p.fecha),
                    ]),
                })
            } else {
                exportarExcel({
                    ...base,
                    hoja: esPendientes ? "Pendientes" : "Historial",
                    columnasMoneda: [4, 5],
                    filas: partidas.map(p => [
                        String(p.proveedor),
                        String(p.codigoBarras),
                        String(p.descripcion),
                        p.cantidad,
                        p.costo,
                        p.importe,
                        String(p.usuario),
                        fmtFechaHora(p.fecha),
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
                    <h1 className="text-2xl font-black text-white uppercase tracking-tight">Devoluciones de Compra</h1>
                    <p className="text-[12px] font-bold text-slate-500 mt-1">
                        {loading
                            ? "Consultando..."
                            : esPendientes
                                ? `${fmtInt(resumen?.partidas ?? 0)} partidas por devolver al proveedor`
                                : `${fmtInt(resumen?.partidas ?? 0)} partidas devueltas`}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => exportar("pdf")}
                        disabled={exportando !== null || loading || partidas.length === 0}
                        className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 hover:text-rose-300 hover:border-rose-500/30 font-black text-[11px] uppercase tracking-widest transition-all disabled:opacity-40"
                        title="Imprimir a PDF"
                    >
                        {exportando === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                        PDF
                    </button>
                    <button
                        onClick={() => exportar("excel")}
                        disabled={exportando !== null || loading || partidas.length === 0}
                        className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 hover:text-emerald-300 hover:border-emerald-500/30 font-black text-[11px] uppercase tracking-widest transition-all disabled:opacity-40"
                        title="Exportar a Excel"
                    >
                        {exportando === "excel" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                        Excel
                    </button>

                    {/* Tabs Pendientes / Historial */}
                    <div className="flex items-center rounded-xl bg-white/[0.04] border border-white/10 p-1">
                        {(["pendientes", "historial"] as const).map(t => (
                            <button
                                key={t}
                                onClick={() => cambiarTipo(t)}
                                className={cn(
                                    "px-4 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all",
                                    tipo === t ? "bg-emerald-500 text-slate-950" : "text-slate-400 hover:text-white"
                                )}
                            >
                                {t === "pendientes" ? "Pendientes" : "Historial"}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Filtros */}
            <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 backdrop-blur-xl space-y-3">
                {!esPendientes && (
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
                )}
                <div className="flex flex-wrap gap-2 items-center">
                    <div className="relative flex-1 min-w-[240px]">
                        <Search className="absolute top-1/2 -translate-y-1/2 left-3.5 h-4 w-4 text-slate-500" />
                        <input
                            type="text"
                            placeholder="PROVEEDOR, CÓDIGO, ARTÍCULO O USUARIO (ENTER)"
                            className={cn(inputCls, "pl-10")}
                            value={busqueda}
                            onChange={e => setBusqueda(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && actualizar()}
                        />
                    </div>
                    {esPendientes && (
                        <button
                            onClick={actualizar}
                            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500 text-slate-950 font-black text-[11px] uppercase tracking-widest hover:brightness-110 transition-all"
                        >
                            <RefreshCw className="h-4 w-4" /> Actualizar
                        </button>
                    )}
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
                        { titulo: "Partidas", valor: fmtInt(resumen.partidas), color: "text-white" },
                        { titulo: "Proveedores", valor: fmtInt(resumen.proveedores), color: "text-cyan-300" },
                        { titulo: "Monto Estimado", valor: fmtMoney(resumen.monto), color: "text-rose-300" },
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
                    <AlertTriangle className="h-4 w-4" /> Mostrando las primeras {fmtInt(partidas.length)} partidas — acota el rango o la búsqueda
                </div>
            )}

            {/* Tabla */}
            <div className="bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl overflow-hidden">
                {loading ? (
                    <div className="flex items-center justify-center py-24">
                        <Loader2 className="h-7 w-7 text-emerald-400 animate-spin" />
                    </div>
                ) : partidas.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-24 gap-3">
                        <PackageX className="h-8 w-8 text-slate-700" />
                        <p className="text-[12px] font-bold text-slate-600 uppercase tracking-widest">
                            {esPendientes ? "Sin mercancía pendiente de devolver" : "Sin devoluciones en el rango seleccionado"}
                        </p>
                    </div>
                ) : (
                    <div className="overflow-auto max-h-[calc(100vh-24rem)]">
                        <table className="w-full">
                            <thead className="sticky top-0 z-10 bg-[#10151f] shadow-[0_1px_0_rgba(255,255,255,0.08)]">
                                <tr>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Proveedor</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Código</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Artículo</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Cantidad</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Costo</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Importe Est.</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Usuario</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Fecha</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/[0.04]">
                                {partidas.map((p, i) => (
                                    <tr key={i} className="hover:bg-white/[0.03] transition-colors">
                                        <td className="px-4 py-2.5 text-[13px] font-bold text-slate-200 max-w-[240px] truncate" title={p.proveedor}>
                                            {p.proveedor}
                                        </td>
                                        <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 whitespace-nowrap">{p.codigoBarras}</td>
                                        <td className="px-4 py-2.5 text-[13px] font-bold text-slate-200 max-w-[300px] truncate" title={p.descripcion}>
                                            {p.descripcion}
                                        </td>
                                        <td className="px-4 py-2.5 text-[13px] font-black text-rose-300 text-right whitespace-nowrap">
                                            {p.cantidad} {p.unidad}
                                        </td>
                                        <td className="px-4 py-2.5 text-[13px] font-bold text-slate-300 text-right whitespace-nowrap">
                                            {p.costo > 0 ? fmtMoney(p.costo) : "—"}
                                        </td>
                                        <td className="px-4 py-2.5 text-[13px] font-black text-rose-300 text-right whitespace-nowrap">
                                            {p.importe > 0 ? fmtMoney(p.importe) : "—"}
                                        </td>
                                        <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 max-w-[180px] truncate">{p.usuario}</td>
                                        <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 whitespace-nowrap">{fmtFechaHora(p.fecha)}</td>
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
