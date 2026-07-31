"use client"

import { Fragment, useEffect, useRef, useState } from "react"
import { FileSpreadsheet, Loader2, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { fmtInt, fmtFechaHora } from "@/lib/format"
import { exportarExcel, obtenerTiendaSesion, sufijoArchivo } from "@/lib/export"

interface Movimiento {
    codigoInterno: number
    codigoBarras: string
    fecha: string
    tipo: string
    folio: string
    referencia: string
    concepto: string
    mov: number
    equiv: number
}

interface Cierre {
    existencia: number
    fecha: string
    origen: "corte" | "ajuste"
}

interface ArticuloRef {
    codigoInterno: number
    codigoBarras: string
    descripcion: string
}

const lbl = "text-[10px] font-black text-slate-500 uppercase tracking-widest"
const decFmt = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDec = (n: number) => decFmt.format(n || 0)

// Modal de movimientos por artículo para las pantallas del corte (Quiebre de
// Stock y Quiebres/Sobre-inventario): usa /api/inventarios/movimientos-articulo
// (SQL de ThreadMovimientos directo a la tienda, familia recursiva de kits),
// sin depender del buffer del Tomcat como el modal de Por Proveedor.
export function MovimientosArticuloModal({ articulo, onClose }: {
    articulo: ArticuloRef
    onClose: () => void
}) {
    const [movimientos, setMovimientos] = useState<Movimiento[]>([])
    const [cargando, setCargando] = useState(true)
    const [dias, setDias] = useState(30)
    const [desde, setDesde] = useState("")
    const [cierre, setCierre] = useState<Cierre | null>(null)
    const [truncado, setTruncado] = useState(false)
    const [error, setError] = useState("")

    const contenedorRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        fetch(`/api/inventarios/movimientos-articulo?codigoInterno=${articulo.codigoInterno}&dias=30`)
            .then(r => r.json().then(json => ({ ok: r.ok, json })))
            .then(({ ok, json }) => {
                if (!ok) throw new Error(json.error || "Error al consultar los movimientos")
                setMovimientos(json.movimientos)
                setDesde(json.desde ?? "")
                setCierre(json.cierre ?? null)
                setTruncado(Boolean(json.truncado))
            })
            .catch((err: unknown) => {
                setError(err instanceof Error ? err.message : "Error al consultar los movimientos")
            })
            .finally(() => setCargando(false))
    }, [articulo.codigoInterno])

    const cambiarDias = async (d: number) => {
        if (d === dias || cargando) return
        setDias(d)
        setCargando(true)
        setError("")
        try {
            const res = await fetch(`/api/inventarios/movimientos-articulo?codigoInterno=${articulo.codigoInterno}&dias=${d}`)
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "Error al consultar los movimientos")
            setMovimientos(json.movimientos)
            setDesde(json.desde ?? "")
            setCierre(json.cierre ?? null)
            setTruncado(Boolean(json.truncado))
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Error al consultar los movimientos")
            setMovimientos([])
        } finally {
            setCargando(false)
        }
    }

    // Al cargar, ir hasta el último movimiento (los más recientes al fondo)
    useEffect(() => {
        if (cargando) return
        const el = contenedorRef.current
        if (el) el.scrollTop = el.scrollHeight
    }, [cargando, movimientos])

    // Posición cronológica del cierre dentro de la lista: los movimientos
    // anteriores ya están incluidos en esa cifra; los posteriores todavía no
    let indiceCierre = -1
    if (cierre) {
        const i = movimientos.findIndex(m => m.fecha >= cierre.fecha)
        indiceCierre = i === -1 ? movimientos.length : i
    }

    const filaCierre = cierre ? (
        <tr className="bg-emerald-500/[0.10]">
            <td colSpan={7} className="px-4 py-2.5 border-y border-emerald-500/30">
                <p className="text-[11px] font-black text-emerald-300 uppercase tracking-widest text-center">
                    ⬆ Ya incluidos en el cierre &nbsp;·&nbsp; Cierre del {cierre.fecha}
                    {cierre.origen === "ajuste" ? " (ajuste)" : " (corte nocturno)"}:{" "}
                    <span className={cn("text-[14px]", cierre.existencia < 0 ? "text-rose-300" : "text-emerald-200")}>
                        {fmtDec(cierre.existencia)}
                    </span>
                    &nbsp;·&nbsp; Posteriores al cierre ⬇
                </p>
            </td>
        </tr>
    ) : null

    const exportar = async () => {
        if (movimientos.length === 0) return
        const tienda = await obtenerTiendaSesion()
        exportarExcel({
            titulo: "MOVIMIENTOS DE INVENTARIO",
            subtitulo: `${articulo.descripcion} · Código ${articulo.codigoBarras}`
                + (cierre ? ` · Cierre del ${cierre.fecha}: ${fmtDec(cierre.existencia)}` : "")
                + ` · Últimos ${dias} días · ${fmtInt(movimientos.length)} movimientos`,
            tienda,
            hoja: "Movimientos",
            nombreArchivo: `movimientos_${articulo.codigoBarras || articulo.codigoInterno}_${sufijoArchivo()}`,
            columnas: [
                { header: "Fecha" },
                { header: "Tipo de Movimiento" },
                { header: "Folio" },
                { header: "Referencia" },
                { header: "Código" },
                { header: "Movimiento", align: "right" },
                { header: "Equiv", align: "right" },
            ],
            filas: movimientos.map(m => [
                fmtFechaHora(m.fecha), m.tipo, m.folio, m.referencia, m.codigoBarras, m.mov, m.equiv,
            ]),
        })
    }

    return (
        <div
            className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={onClose}
        >
            <div
                className="w-full max-w-5xl max-h-[85vh] bg-[#0d1320] border border-white/10 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden flex flex-col"
                onClick={e => e.stopPropagation()}
            >
                <div className="px-6 py-4 border-b border-white/10 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h3 className="text-[15px] font-black text-white truncate">
                            Movimientos — {articulo.descripcion}
                        </h3>
                        <p className="text-[12px] font-bold text-slate-400 mt-1">
                            Código {articulo.codigoBarras}
                            {desde && ` · desde el ${desde}`}
                            {truncado && " · mostrando los más recientes"}
                        </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <div className="flex items-center rounded-xl bg-white/[0.03] border border-white/10 p-1">
                            {[30, 90].map(d => (
                                <button
                                    key={d}
                                    onClick={() => cambiarDias(d)}
                                    className={cn(
                                        "px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                                        dias === d ? "bg-white/[0.08] text-white" : "text-slate-400 hover:text-white"
                                    )}
                                >
                                    {d} días
                                </button>
                            ))}
                        </div>
                        <button
                            onClick={exportar}
                            disabled={cargando || movimientos.length === 0}
                            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 hover:text-emerald-300 hover:border-emerald-500/30 font-black text-[11px] uppercase tracking-widest transition-all disabled:opacity-40"
                            title="Exportar movimientos a Excel"
                        >
                            <FileSpreadsheet className="h-4 w-4" />
                            <span className="hidden sm:inline">Excel</span>
                        </button>
                        <button
                            onClick={onClose}
                            className="p-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-400 hover:text-white transition-all"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                </div>

                {/* Cómo cerró el día anterior (corte nocturno, o ajuste si es más nuevo) */}
                {!cargando && cierre && (
                    <div className="px-6 py-2.5 border-b border-white/[0.06] bg-emerald-500/[0.05] flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-black text-emerald-300/90 uppercase tracking-widest">
                            Cierre del {cierre.fecha}:
                        </span>
                        <span className={cn(
                            "text-[15px] font-black",
                            cierre.existencia < 0 ? "text-rose-300" : "text-emerald-300"
                        )}>
                            {fmtDec(cierre.existencia)}
                        </span>
                        <span className="text-[10px] font-bold text-slate-500">
                            {cierre.origen === "ajuste"
                                ? "según el último ajuste de inventario"
                                : "según el corte nocturno de inventario"}
                            {" — la línea verde de la lista marca el cierre: lo de arriba ya está contado en esa cifra, lo de abajo aún no"}
                        </span>
                    </div>
                )}

                {error && (
                    <p className="px-6 py-2 text-[10px] font-black text-rose-300 uppercase tracking-wider">{error}</p>
                )}

                {cargando ? (
                    <div className="flex items-center justify-center py-24">
                        <Loader2 className="h-7 w-7 text-emerald-400 animate-spin" />
                    </div>
                ) : movimientos.length === 0 ? (
                    <div className="flex items-center justify-center py-16">
                        <p className="text-[12px] font-bold text-slate-600 uppercase tracking-widest">
                            Sin movimientos en los últimos {dias} días
                        </p>
                    </div>
                ) : (
                    <>
                        <div ref={contenedorRef} className="overflow-auto flex-1">
                            <table className="w-full">
                                <thead className="sticky top-0 z-10 bg-[#141a28]">
                                    <tr>
                                        <th className={cn(lbl, "px-4 py-2.5 text-left")}>Fecha y Hora</th>
                                        <th className={cn(lbl, "px-4 py-2.5 text-left")}>Tipo de Movimiento</th>
                                        <th className={cn(lbl, "px-4 py-2.5 text-left")}>Folio</th>
                                        <th className={cn(lbl, "px-4 py-2.5 text-left")}>Referencia</th>
                                        <th className={cn(lbl, "px-4 py-2.5 text-left")}>Código</th>
                                        <th className={cn(lbl, "px-4 py-2.5 text-right")}>Movimiento</th>
                                        <th className={cn(lbl, "px-4 py-2.5 text-right")} title="Equivalencia en unidades del maestro">Equiv</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/[0.04]">
                                    {movimientos.map((m, i) => (
                                        <Fragment key={i}>
                                        {i === indiceCierre && filaCierre}
                                        <tr className="hover:bg-white/[0.03]">
                                            <td className="px-4 py-2 text-[12px] font-bold text-slate-400 whitespace-nowrap">{fmtFechaHora(m.fecha)}</td>
                                            <td className={cn(
                                                "px-4 py-2 text-[12px] font-black whitespace-nowrap",
                                                m.mov < 0 ? "text-rose-300/90" : "text-emerald-300/90"
                                            )}>
                                                {m.tipo || "—"}
                                            </td>
                                            <td className="px-4 py-2 text-[12px] font-black text-amber-300 whitespace-nowrap">
                                                {m.folio || "—"}
                                            </td>
                                            <td className="px-4 py-2 text-[12px] font-bold text-slate-300 max-w-[220px] truncate" title={m.referencia}>
                                                {m.referencia || "—"}
                                            </td>
                                            <td className="px-4 py-2 text-[12px] font-black text-cyan-300 whitespace-nowrap">{m.codigoBarras}</td>
                                            <td className={cn(
                                                "px-4 py-2 text-[13px] font-black text-right whitespace-nowrap",
                                                m.mov < 0 ? "text-rose-300" : "text-emerald-300"
                                            )}>
                                                {fmtDec(m.mov)}
                                            </td>
                                            <td className={cn(
                                                "px-4 py-2 text-[12px] font-bold text-right whitespace-nowrap",
                                                m.equiv < 0 ? "text-rose-300/80" : "text-slate-400"
                                            )}>
                                                {fmtDec(m.equiv)}
                                            </td>
                                        </tr>
                                        </Fragment>
                                    ))}
                                    {indiceCierre === movimientos.length && filaCierre}
                                </tbody>
                            </table>
                        </div>
                        <div className="px-6 py-3 border-t border-white/10 flex justify-end">
                            <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest">
                                {fmtInt(movimientos.length)} movimientos
                            </p>
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}
