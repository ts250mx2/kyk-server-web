"use client"

import { useCallback, useEffect, useState } from "react"
import { Search, Loader2, AlertTriangle, ListRestart, Scale, Layers, FileText, FileSpreadsheet } from "lucide-react"
import { cn } from "@/lib/utils"
import { fmtMoney, fmtInt } from "@/lib/format"
import { exportarPdf, exportarExcel, obtenerTiendaSesion, sufijoArchivo } from "@/lib/export"

interface ArticuloBascula {
    codigoInterno: number
    codigoBarras: string
    descripcion: string
    depto: string
    precio: number
    enOferta: boolean
    codigo0: string
    codigo1: string | null
    precioDesc0: number
    codigo2: string | null
    precioDesc1: number
    codigoReb: string | null
    descripcionReb: string | null
    precioReb: number
}

interface DeptoOption { idDepto: number; depto: string }

const lbl = "text-[10px] font-black text-slate-500 uppercase tracking-widest"
const inputCls = "block w-full px-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-400/25 focus:border-emerald-400/60 transition-all"

export default function PreciosBasculasPage() {
    const [idDepto, setIdDepto] = useState("")
    const [busqueda, setBusqueda] = useState("")
    const [deptos, setDeptos] = useState<DeptoOption[]>([])
    const [articulos, setArticulos] = useState<ArticuloBascula[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState("")
    const [exportando, setExportando] = useState<"pdf" | "excel" | null>(null)

    const cargar = useCallback(async (depto: string, filtro: string) => {
        setLoading(true)
        setError("")
        try {
            const qs = new URLSearchParams()
            if (depto) qs.set("idDepto", depto)
            if (filtro) qs.set("busqueda", filtro)

            const res = await fetch(`/api/articulos/basculas?${qs.toString()}`)
            if (res.status === 401) { window.location.href = "/login"; return }
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "Error al consultar precios de básculas")
            setArticulos(json.articulos)
            setDeptos(json.deptos)
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Error desconocido")
            setArticulos([])
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        cargar("", "")
    }, [cargar])

    const buscar = () => cargar(idDepto, busqueda.trim())
    const verTodos = () => {
        setBusqueda("")
        setIdDepto("")
        cargar("", "")
    }
    const cambiarDepto = (d: string) => {
        setIdDepto(d)
        cargar(d, busqueda.trim())
    }

    const deptoNombre = deptos.find(d => String(d.idDepto) === idDepto)?.depto

    // Exportación (equivale a imprimir rptArtBas "Códigos para Básculas")
    const exportar = async (formato: "pdf" | "excel") => {
        setExportando(formato)
        try {
            const tienda = await obtenerTiendaSesion()
            const columnas = [
                { header: "Código Báscula" },
                { header: "Descripción" },
                { header: "Depto" },
                { header: "Precio", align: "right" as const },
                { header: "Mayoreo 1" },
                { header: "Precio M1", align: "right" as const },
                { header: "Mayoreo 2" },
                { header: "Precio M2", align: "right" as const },
                { header: "Rebanado" },
                { header: "Precio Reb.", align: "right" as const },
            ]
            const base = {
                titulo: "CODIGOS PARA BASCULAS",
                subtitulo: `Tipo: ${deptoNombre ?? "Todos"}${busqueda.trim() ? `  ·  Búsqueda: "${busqueda.trim()}"` : ""}  ·  ${fmtInt(articulos.length)} artículos`,
                tienda,
                columnas,
                nombreArchivo: `precios_basculas_${sufijoArchivo()}`,
            }

            if (formato === "pdf") {
                exportarPdf({
                    ...base,
                    orientacion: "landscape",
                    filas: articulos.map(a => [
                        a.codigo0,
                        String(a.descripcion),
                        String(a.depto),
                        fmtMoney(a.precio),
                        a.codigo1 ?? "—",
                        a.precioDesc0 > 0 ? fmtMoney(a.precioDesc0) : "—",
                        a.codigo2 ?? "—",
                        a.precioDesc1 > 0 ? fmtMoney(a.precioDesc1) : "—",
                        a.codigoReb ?? "—",
                        a.precioReb > 0 ? fmtMoney(a.precioReb) : "—",
                    ]),
                })
            } else {
                exportarExcel({
                    ...base,
                    hoja: "Precios Básculas",
                    columnasMoneda: [3, 5, 7, 9],
                    filas: articulos.map(a => [
                        a.codigo0,
                        String(a.descripcion),
                        String(a.depto),
                        a.precio,
                        a.codigo1 ?? "",
                        a.precioDesc0 > 0 ? a.precioDesc0 : "",
                        a.codigo2 ?? "",
                        a.precioDesc1 > 0 ? a.precioDesc1 : "",
                        a.codigoReb ?? "",
                        a.precioReb > 0 ? a.precioReb : "",
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
                    <h1 className="text-2xl font-black text-white uppercase tracking-tight">Precios Básculas</h1>
                    <p className="text-[12px] font-bold text-slate-500 mt-1">
                        {loading ? "Consultando..." : `Códigos para básculas · ${fmtInt(articulos.length)} artículos a granel`}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => exportar("pdf")}
                        disabled={exportando !== null || loading || articulos.length === 0}
                        className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 hover:text-rose-300 hover:border-rose-500/30 font-black text-[11px] uppercase tracking-widest transition-all disabled:opacity-40"
                        title="Imprimir a PDF"
                    >
                        {exportando === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                        PDF
                    </button>
                    <button
                        onClick={() => exportar("excel")}
                        disabled={exportando !== null || loading || articulos.length === 0}
                        className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 hover:text-emerald-300 hover:border-emerald-500/30 font-black text-[11px] uppercase tracking-widest transition-all disabled:opacity-40"
                        title="Exportar a Excel"
                    >
                        {exportando === "excel" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                        Excel
                    </button>
                </div>
            </div>

            {/* Filtros: tipo de granel (departamento) + búsqueda */}
            <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 backdrop-blur-xl">
                <div className="flex flex-wrap gap-2 items-center">
                    <div className="relative min-w-[240px]">
                        <Layers className="absolute top-1/2 -translate-y-1/2 left-3.5 h-4 w-4 text-slate-500 pointer-events-none" />
                        <select
                            className={cn(inputCls, "pl-10 appearance-none [color-scheme:dark]")}
                            value={idDepto}
                            onChange={e => cambiarDepto(e.target.value)}
                        >
                            <option value="" className="bg-[#0b1220]">TODOS LOS TIPOS</option>
                            {deptos.map(d => (
                                <option key={d.idDepto} value={d.idDepto} className="bg-[#0b1220]">
                                    {d.depto}
                                </option>
                            ))}
                        </select>
                    </div>
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
                        onClick={verTodos}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 hover:text-emerald-300 hover:border-emerald-500/30 font-black text-[11px] uppercase tracking-widest transition-all"
                    >
                        <ListRestart className="h-4 w-4" />
                        <span className="hidden sm:inline">Ver todos</span>
                    </button>
                </div>
            </div>

            {error && (
                <div className="flex items-center gap-2 text-rose-300 text-[11px] font-black bg-rose-500/10 p-3 rounded-xl border border-rose-500/25 uppercase tracking-wider">
                    <AlertTriangle className="h-4 w-4" /> {error}
                </div>
            )}

            {/* Tabla de códigos para básculas */}
            <div className="bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl overflow-hidden">
                {loading ? (
                    <div className="flex items-center justify-center py-24">
                        <Loader2 className="h-7 w-7 text-emerald-400 animate-spin" />
                    </div>
                ) : articulos.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-24 gap-3">
                        <Scale className="h-8 w-8 text-slate-700" />
                        <p className="text-[12px] font-bold text-slate-600 uppercase tracking-widest">
                            Sin artículos de báscula con ese criterio
                        </p>
                    </div>
                ) : (
                    <div className="overflow-auto max-h-[calc(100vh-21rem)]">
                        <table className="w-full">
                            <thead className="sticky top-0 z-10 bg-[#10151f] shadow-[0_1px_0_rgba(255,255,255,0.08)]">
                                <tr>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Código Báscula</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Descripción</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Depto</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Precio</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Mayoreo 1</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Mayoreo 2</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Rebanado</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/[0.04]">
                                {articulos.map(a => (
                                    <tr key={a.codigoInterno} className="hover:bg-white/[0.03] transition-colors">
                                        <td className="px-4 py-2.5 whitespace-nowrap">
                                            <span className="text-[12px] font-black text-cyan-300 bg-cyan-500/10 border border-cyan-500/25 rounded-md px-2 py-0.5">
                                                {a.codigo0}
                                            </span>
                                        </td>
                                        <td className="px-4 py-2.5 text-[13px] font-bold text-slate-200">{a.descripcion}</td>
                                        <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 whitespace-nowrap">{a.depto}</td>
                                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                                            <span className={cn(
                                                "text-[13px] font-black",
                                                a.enOferta ? "text-amber-300" : "text-emerald-300"
                                            )}>
                                                {fmtMoney(a.precio)}
                                            </span>
                                            {a.enOferta && (
                                                <span className="ml-1.5 text-[9px] font-black text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-md px-1.5 py-0.5 uppercase">
                                                    Oferta
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-2.5 text-[12px] font-bold whitespace-nowrap">
                                            {a.codigo1 ? (
                                                <span className="text-slate-300">
                                                    {a.codigo1} · <span className="text-emerald-300 font-black">{fmtMoney(a.precioDesc0)}</span>
                                                </span>
                                            ) : <span className="text-slate-600">—</span>}
                                        </td>
                                        <td className="px-4 py-2.5 text-[12px] font-bold whitespace-nowrap">
                                            {a.codigo2 ? (
                                                <span className="text-slate-300">
                                                    {a.codigo2} · <span className="text-emerald-300 font-black">{fmtMoney(a.precioDesc1)}</span>
                                                </span>
                                            ) : <span className="text-slate-600">—</span>}
                                        </td>
                                        <td className="px-4 py-2.5 text-[12px] font-bold whitespace-nowrap" title={a.descripcionReb ?? ""}>
                                            {a.codigoReb ? (
                                                <span className="text-slate-300">
                                                    {a.codigoReb} · <span className="text-emerald-300 font-black">{fmtMoney(a.precioReb)}</span>
                                                </span>
                                            ) : <span className="text-slate-600">—</span>}
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
