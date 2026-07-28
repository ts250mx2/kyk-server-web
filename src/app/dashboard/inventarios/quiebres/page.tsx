"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
    Search, Loader2, AlertTriangle, TrendingDown, PackageX,
    FileText, FileSpreadsheet, RefreshCw
} from "lucide-react"
import { cn } from "@/lib/utils"
import { fmtMoney, fmtInt } from "@/lib/format"
import { exportarPdf, exportarExcel, obtenerTiendaSesion, sufijoArchivo } from "@/lib/export"
import { AnalisisProfundoModal, BotonAnalisisProfundo, type PageSummaryContext } from "@/components/dashboard/AnalisisProfundo"

type Tab = "quiebres" | "exceso"

interface FilaQuiebre {
    codigoInterno: number
    codigoBarras: string
    descripcion: string
    medidaVenta: string
    exi: number
    pvd: number
    precio: number
    enQuiebreHoy: boolean
    diasQuiebre: number
    diasTotal: number
    ventaPerdidaDiaria: number
    ventaPerdidaPeriodo: number
}

interface FilaExceso {
    codigoInterno: number
    codigoBarras: string
    descripcion: string
    medidaVenta: string
    exi: number
    pvd: number
    cobertura: number | null
    costo: number
    valorInventario: number
    sinVenta: boolean
}

interface Datos {
    tipo: Tab
    corteFecha: string
    dias?: number
    umbral?: number
    truncado: boolean
    articulos: (FilaQuiebre | FilaExceso)[]
    resumen: Record<string, number>
}

const lbl = "text-[10px] font-black text-slate-500 uppercase tracking-widest"
const inputCls = "block w-full px-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-400/25 focus:border-emerald-400/60 transition-all"

const decFmt = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDec = (n: number) => decFmt.format(n || 0)

const hoyISO = () => new Date().toLocaleDateString("sv-SE")
const diasAtras = (n: number) => {
    const d = new Date()
    d.setDate(d.getDate() - n)
    return d.toLocaleDateString("sv-SE")
}

function urlDatos(tab: Tab, dias: number, umbral: number): string {
    return tab === "quiebres"
        ? `/api/inventarios/quiebres?tipo=quiebres&dias=${dias}`
        : `/api/inventarios/quiebres?tipo=exceso&umbral=${umbral}`
}

export default function QuiebresPage() {
    const router = useRouter()
    const [tab, setTab] = useState<Tab>("quiebres")
    const [dias, setDias] = useState(30)
    const [umbral, setUmbral] = useState("30")
    const [datos, setDatos] = useState<Datos | null>(null)
    const [busqueda, setBusqueda] = useState("")
    const [cargando, setCargando] = useState(true)
    const [error, setError] = useState("")
    const [exportando, setExportando] = useState<"pdf" | "excel" | null>(null)
    const [tienda, setTienda] = useState("")
    const [analisisAbierto, setAnalisisAbierto] = useState(false)

    // Carga inicial (quiebres a 30 días) e identidad de la tienda para el análisis
    useEffect(() => {
        fetch(urlDatos("quiebres", 30, 30))
            .then(r => {
                if (r.status === 401) { window.location.href = "/login"; return null }
                return r.json().then(json => ({ ok: r.ok, json }))
            })
            .then(res => {
                if (!res) return
                if (res.ok) setDatos(res.json)
                else setError(res.json.error || "Error al consultar el inventario")
            })
            .catch(() => setError("Error al consultar el inventario"))
            .finally(() => setCargando(false))

        fetch("/api/auth/me")
            .then(r => r.json())
            .then(d => setTienda(d.user?.tienda ?? ""))
            .catch(() => { /* el análisis usa alcance genérico */ })
    }, [])

    const cargar = async (t: Tab, d: number, u: number) => {
        setCargando(true)
        setError("")
        setBusqueda("")
        try {
            const res = await fetch(urlDatos(t, d, u))
            if (res.status === 401) { router.push("/login"); return }
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "Error al consultar el inventario")
            setDatos(json)
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Error al consultar el inventario")
            setDatos(null)
        } finally {
            setCargando(false)
        }
    }

    const cambiarTab = (t: Tab) => {
        if (t === tab || cargando) return
        setTab(t)
        cargar(t, dias, Number(umbral) || 30)
    }

    const visibles = useMemo(() => {
        const filtro = busqueda.trim().toLowerCase()
        const lista = datos?.articulos ?? []
        if (!filtro) return lista
        return lista.filter(a =>
            a.descripcion.toLowerCase().includes(filtro) || a.codigoBarras.includes(filtro)
        )
    }, [datos, busqueda])

    const corteViejo = useMemo(() => {
        if (!datos?.corteFecha) return false
        return datos.corteFecha < diasAtras(2)
    }, [datos])

    // Contexto para el Análisis Profundo IA con los agregados del tab activo
    const contextoAnalisis: PageSummaryContext = useMemo((): PageSummaryContext => {
        const r = datos?.resumen ?? {}
        if (tab === "quiebres") {
            const filas = (datos?.articulos ?? []) as FilaQuiebre[]
            return {
                pageContext: `Quiebres de inventario (artículos agotados con demanda) de los últimos ${datos?.dias ?? dias} días. Más quiebres y más venta perdida es PEOR.`,
                period: { fechaInicio: diasAtras(datos?.dias ?? dias), fechaFin: datos?.corteFecha || hoyISO() },
                scope: tienda || "Tienda de la sesión",
                kpis: {
                    articulosEnQuiebreHoy: r.enQuiebreHoy ?? 0,
                    articulosAfectadosEnPeriodo: r.afectadosPeriodo ?? 0,
                    ventaPerdidaDiariaMXN: Math.round(r.ventaPerdidaDiaria ?? 0),
                    ventaPerdidaPeriodoMXN: Math.round(r.ventaPerdidaPeriodo ?? 0),
                },
                highlights: {
                    topItems: filas.slice(0, 10).map(f => ({
                        name: f.descripcion,
                        value: Math.round(f.ventaPerdidaPeriodo),
                    })),
                    anomalies: filas.slice(0, 10).map(f =>
                        `${f.descripcion}: ${f.diasQuiebre} de ${f.diasTotal} días en quiebre` +
                        `${f.enQuiebreHoy ? " (agotado hoy)" : ""}, ~$${fmtInt(Math.round(f.ventaPerdidaPeriodo))} de venta perdida`
                    ),
                },
            }
        }
        const filas = (datos?.articulos ?? []) as FilaExceso[]
        return {
            pageContext: `Sobre-inventario e inventario muerto (cobertura >= ${datos?.umbral ?? umbral} días de venta). Más valor inmovilizado es PEOR.`,
            period: { fechaInicio: datos?.corteFecha || hoyISO(), fechaFin: datos?.corteFecha || hoyISO() },
            scope: tienda || "Tienda de la sesión",
            kpis: {
                articulosConExceso: r.articulos ?? 0,
                valorInmovilizadoMXN: Math.round(r.valorInmovilizado ?? 0),
                articulosSinVenta: r.sinVenta ?? 0,
                valorSinVentaMXN: Math.round(r.valorSinVenta ?? 0),
            },
            highlights: {
                topItems: filas.slice(0, 10).map(f => ({
                    name: f.descripcion,
                    value: Math.round(f.valorInventario),
                })),
                anomalies: filas.slice(0, 10).map(f =>
                    f.sinVenta
                        ? `${f.descripcion}: ${fmtDec(f.exi)} ${f.medidaVenta} SIN VENTA ($${fmtInt(Math.round(f.valorInventario))} inmovilizados)`
                        : `${f.descripcion}: ${fmtInt(Math.round(f.cobertura ?? 0))} días de cobertura ($${fmtInt(Math.round(f.valorInventario))})`
                ),
            },
        }
    }, [datos, tab, dias, umbral, tienda])

    const exportar = async (formato: "pdf" | "excel") => {
        if (!datos) return
        setExportando(formato)
        try {
            const nombreTienda = tienda || await obtenerTiendaSesion()
            if (tab === "quiebres") {
                const filas = visibles as FilaQuiebre[]
                const base = {
                    titulo: "QUIEBRES DE INVENTARIO",
                    subtitulo: `Últimos ${datos.dias} días · Corte ${datos.corteFecha} · ${fmtInt(filas.length)} artículos`,
                    tienda: nombreTienda,
                    columnas: [
                        { header: "Código" },
                        { header: "Descripción" },
                        { header: "Existencia", align: "right" as const },
                        { header: "PVD", align: "right" as const },
                        { header: "Precio", align: "right" as const },
                        { header: "Días Quiebre", align: "right" as const },
                        { header: "Venta Perdida/Día", align: "right" as const },
                        { header: "Venta Perdida Periodo", align: "right" as const },
                    ],
                    nombreArchivo: `quiebres_inventario_${sufijoArchivo()}`,
                }
                if (formato === "pdf") {
                    exportarPdf({
                        ...base, orientacion: "landscape",
                        filas: filas.map(f => [
                            f.codigoBarras, f.descripcion, fmtDec(f.exi), fmtDec(f.pvd), fmtMoney(f.precio),
                            `${f.diasQuiebre} de ${f.diasTotal}`, fmtMoney(f.ventaPerdidaDiaria), fmtMoney(f.ventaPerdidaPeriodo),
                        ]),
                    })
                } else {
                    exportarExcel({
                        ...base, hoja: "Quiebres", columnasMoneda: [4, 6, 7],
                        filas: filas.map(f => [
                            f.codigoBarras, f.descripcion, f.exi, f.pvd, f.precio,
                            `${f.diasQuiebre} de ${f.diasTotal}`, f.ventaPerdidaDiaria, f.ventaPerdidaPeriodo,
                        ]),
                    })
                }
            } else {
                const filas = visibles as FilaExceso[]
                const base = {
                    titulo: "SOBRE-INVENTARIO",
                    subtitulo: `Cobertura >= ${datos.umbral} días · Corte ${datos.corteFecha} · ${fmtInt(filas.length)} artículos`,
                    tienda: nombreTienda,
                    columnas: [
                        { header: "Código" },
                        { header: "Descripción" },
                        { header: "Existencia", align: "right" as const },
                        { header: "PVD", align: "right" as const },
                        { header: "Cobertura", align: "right" as const },
                        { header: "Costo", align: "right" as const },
                        { header: "Valor Inmovilizado", align: "right" as const },
                    ],
                    nombreArchivo: `sobre_inventario_${sufijoArchivo()}`,
                }
                const cobertura = (f: FilaExceso) => f.sinVenta ? "Sin venta" : `${fmtInt(Math.round(f.cobertura ?? 0))} días`
                if (formato === "pdf") {
                    exportarPdf({
                        ...base, orientacion: "landscape",
                        filas: filas.map(f => [
                            f.codigoBarras, f.descripcion, fmtDec(f.exi), fmtDec(f.pvd),
                            cobertura(f), fmtMoney(f.costo), fmtMoney(f.valorInventario),
                        ]),
                    })
                } else {
                    exportarExcel({
                        ...base, hoja: "Sobre-inventario", columnasMoneda: [5, 6],
                        filas: filas.map(f => [
                            f.codigoBarras, f.descripcion, f.exi, f.pvd,
                            cobertura(f), f.costo, f.valorInventario,
                        ]),
                    })
                }
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Error al exportar")
        } finally {
            setExportando(null)
        }
    }

    const resumen = datos?.resumen ?? {}
    const chips = tab === "quiebres"
        ? [
            { titulo: "En Quiebre Hoy", valor: fmtInt(resumen.enQuiebreHoy ?? 0), color: (resumen.enQuiebreHoy ?? 0) > 0 ? "text-rose-300" : "text-emerald-300" },
            { titulo: "Venta Perdida por Día", valor: fmtMoney(resumen.ventaPerdidaDiaria ?? 0), color: "text-rose-300" },
            { titulo: `Afectados (${datos?.dias ?? dias} días)`, valor: fmtInt(resumen.afectadosPeriodo ?? 0), color: "text-amber-300" },
            { titulo: "Venta Perdida del Periodo", valor: fmtMoney(resumen.ventaPerdidaPeriodo ?? 0), color: "text-rose-300" },
        ]
        : [
            { titulo: "Artículos con Exceso", valor: fmtInt(resumen.articulos ?? 0), color: "text-amber-300" },
            { titulo: "Valor Inmovilizado", valor: fmtMoney(resumen.valorInmovilizado ?? 0), color: "text-amber-300" },
            { titulo: "Sin Venta (Muerto)", valor: fmtInt(resumen.sinVenta ?? 0), color: (resumen.sinVenta ?? 0) > 0 ? "text-rose-300" : "text-slate-500" },
            { titulo: "Valor Sin Venta", valor: fmtMoney(resumen.valorSinVenta ?? 0), color: "text-rose-300" },
        ]

    return (
        <div className="space-y-4">
            {/* Encabezado */}
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-black text-white uppercase tracking-tight">Quiebres y Sobre-inventario</h1>
                    <p className="text-[12px] font-bold text-slate-500 mt-1">
                        {cargando ? "Consultando el corte de inventario..." : datos
                            ? `Corte del ${datos.corteFecha} · ${fmtInt(visibles.length)} artículos`
                            : "Sin datos"}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <BotonAnalisisProfundo
                        onClick={() => setAnalisisAbierto(true)}
                        disabled={cargando || !datos || datos.articulos.length === 0}
                    />
                    <button
                        onClick={() => exportar("pdf")}
                        disabled={exportando !== null || cargando || visibles.length === 0}
                        className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 hover:text-rose-300 hover:border-rose-500/30 font-black text-[11px] uppercase tracking-widest transition-all disabled:opacity-40"
                        title="Imprimir a PDF"
                    >
                        {exportando === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                        PDF
                    </button>
                    <button
                        onClick={() => exportar("excel")}
                        disabled={exportando !== null || cargando || visibles.length === 0}
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
                <div className="flex flex-wrap gap-3 items-center">
                    {/* Tabs */}
                    <div className="flex items-center rounded-xl bg-white/[0.03] border border-white/10 p-1">
                        {([
                            { id: "quiebres", nombre: "Quiebres", icono: <PackageX className="h-3.5 w-3.5" /> },
                            { id: "exceso", nombre: "Sobre-inventario", icono: <TrendingDown className="h-3.5 w-3.5" /> },
                        ] as { id: Tab; nombre: string; icono: React.ReactNode }[]).map(t => (
                            <button
                                key={t.id}
                                onClick={() => cambiarTab(t.id)}
                                className={cn(
                                    "flex items-center gap-2 px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all",
                                    tab === t.id
                                        ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                                        : "text-slate-400 hover:text-white border border-transparent"
                                )}
                            >
                                {t.icono} {t.nombre}
                            </button>
                        ))}
                    </div>

                    {tab === "quiebres" ? (
                        <div className="flex items-center gap-2">
                            <span className={lbl}>Analizar:</span>
                            <div className="flex items-center rounded-xl bg-white/[0.03] border border-white/10 p-1">
                                {[7, 30, 90].map(d => (
                                    <button
                                        key={d}
                                        onClick={() => { setDias(d); cargar("quiebres", d, Number(umbral) || 30) }}
                                        className={cn(
                                            "px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                                            dias === d ? "bg-white/[0.08] text-white" : "text-slate-400 hover:text-white"
                                        )}
                                    >
                                        {d} días
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2">
                            <span className={lbl}>Cobertura mínima:</span>
                            <input
                                type="number"
                                min={7}
                                max={365}
                                className={cn(inputCls, "w-24")}
                                value={umbral}
                                onChange={e => setUmbral(e.target.value)}
                                onKeyDown={e => e.key === "Enter" && cargar("exceso", dias, Number(umbral) || 30)}
                            />
                            <span className={lbl}>días</span>
                            <button
                                onClick={() => cargar("exceso", dias, Number(umbral) || 30)}
                                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500 text-slate-950 font-black text-[11px] uppercase tracking-widest hover:brightness-110 transition-all"
                            >
                                <RefreshCw className="h-4 w-4" /> Aplicar
                            </button>
                        </div>
                    )}

                    <div className="relative flex-1 min-w-[220px]">
                        <Search className="absolute top-1/2 -translate-y-1/2 left-3.5 h-4 w-4 text-slate-500" />
                        <input
                            type="text"
                            placeholder="FILTRAR POR DESCRIPCIÓN O CÓDIGO"
                            className={cn(inputCls, "pl-10")}
                            value={busqueda}
                            onChange={e => setBusqueda(e.target.value)}
                        />
                    </div>
                </div>
            </div>

            {/* Resumen */}
            {datos && !cargando && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {chips.map(c => (
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

            {corteViejo && !cargando && datos && (
                <div className="flex items-center gap-2 text-amber-300 text-[11px] font-black bg-amber-500/10 p-3 rounded-xl border border-amber-500/25 uppercase tracking-wider">
                    <AlertTriangle className="h-4 w-4" />
                    El corte de inventario es del {datos.corteFecha} — revisa que KYKInvServices esté corriendo en la tienda
                </div>
            )}

            {datos?.truncado && !cargando && (
                <div className="flex items-center gap-2 text-amber-300 text-[11px] font-black bg-amber-500/10 p-3 rounded-xl border border-amber-500/25 uppercase tracking-wider">
                    <AlertTriangle className="h-4 w-4" /> Mostrando los primeros {fmtInt(datos.articulos.length)} artículos por impacto
                </div>
            )}

            {/* Tabla */}
            <div className="bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl overflow-hidden">
                {cargando ? (
                    <div className="flex items-center justify-center py-24">
                        <Loader2 className="h-7 w-7 text-emerald-400 animate-spin" />
                    </div>
                ) : visibles.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-24 gap-3">
                        <PackageX className="h-8 w-8 text-slate-700" />
                        <p className="text-[12px] font-bold text-slate-600 uppercase tracking-widest">
                            {tab === "quiebres" ? "Sin quiebres de inventario — buen trabajo" : "Sin sobre-inventario con ese umbral"}
                        </p>
                    </div>
                ) : tab === "quiebres" ? (
                    <div className="overflow-auto max-h-[calc(100vh-26rem)]">
                        <table className="w-full">
                            <thead className="sticky top-0 z-10 bg-[#10151f] shadow-[0_1px_0_rgba(255,255,255,0.08)]">
                                <tr>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Código</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Descripción</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-center")}>Estado</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Existencia</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-right")} title="Promedio de venta diaria">PVD</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Precio</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Días en Quiebre</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Perdida / Día</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Perdida Periodo</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/[0.04]">
                                {(visibles as FilaQuiebre[]).map(f => (
                                    <tr key={f.codigoInterno} className={cn("hover:bg-white/[0.03]", f.enQuiebreHoy && "bg-rose-500/[0.04]")}>
                                        <td className="px-4 py-2.5 text-[12px] font-black text-cyan-300 whitespace-nowrap">{f.codigoBarras}</td>
                                        <td className="px-4 py-2.5 text-[13px] font-bold text-slate-200 max-w-[260px] truncate" title={f.descripcion}>{f.descripcion}</td>
                                        <td className="px-4 py-2.5 text-center whitespace-nowrap">
                                            <span className={cn(
                                                "text-[10px] font-black rounded-md px-2 py-0.5 border uppercase",
                                                f.enQuiebreHoy
                                                    ? "text-rose-300 bg-rose-500/10 border-rose-500/25"
                                                    : "text-emerald-300 bg-emerald-500/10 border-emerald-500/25"
                                            )}>
                                                {f.enQuiebreHoy ? "Agotado" : "Recuperado"}
                                            </span>
                                        </td>
                                        <td className={cn(
                                            "px-4 py-2.5 text-[13px] font-black text-right whitespace-nowrap",
                                            f.exi <= 0 ? "text-rose-300" : "text-slate-100"
                                        )}>
                                            {fmtDec(f.exi)}
                                        </td>
                                        <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 text-right whitespace-nowrap">{fmtDec(f.pvd)}</td>
                                        <td className="px-4 py-2.5 text-[12px] font-bold text-slate-300 text-right whitespace-nowrap">{fmtMoney(f.precio)}</td>
                                        <td className="px-4 py-2.5 text-[12px] font-black text-amber-300 text-right whitespace-nowrap">
                                            {f.diasQuiebre > 0 ? `${f.diasQuiebre} de ${f.diasTotal}` : "—"}
                                        </td>
                                        <td className="px-4 py-2.5 text-[12px] font-bold text-slate-300 text-right whitespace-nowrap">{fmtMoney(f.ventaPerdidaDiaria)}</td>
                                        <td className="px-4 py-2.5 text-[13px] font-black text-rose-300 text-right whitespace-nowrap">{fmtMoney(f.ventaPerdidaPeriodo)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="overflow-auto max-h-[calc(100vh-26rem)]">
                        <table className="w-full">
                            <thead className="sticky top-0 z-10 bg-[#10151f] shadow-[0_1px_0_rgba(255,255,255,0.08)]">
                                <tr>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Código</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Descripción</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Existencia</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-right")} title="Promedio de venta diaria">PVD</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-center")}>Cobertura</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Costo</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Valor Inmovilizado</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/[0.04]">
                                {(visibles as FilaExceso[]).map(f => (
                                    <tr key={f.codigoInterno} className={cn("hover:bg-white/[0.03]", f.sinVenta && "bg-rose-500/[0.04]")}>
                                        <td className="px-4 py-2.5 text-[12px] font-black text-cyan-300 whitespace-nowrap">{f.codigoBarras}</td>
                                        <td className="px-4 py-2.5 text-[13px] font-bold text-slate-200 max-w-[280px] truncate" title={f.descripcion}>{f.descripcion}</td>
                                        <td className="px-4 py-2.5 text-[13px] font-black text-slate-100 text-right whitespace-nowrap">
                                            {fmtDec(f.exi)} <span className="text-[10px] font-bold text-slate-500">{f.medidaVenta}</span>
                                        </td>
                                        <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 text-right whitespace-nowrap">{fmtDec(f.pvd)}</td>
                                        <td className="px-4 py-2.5 text-center whitespace-nowrap">
                                            {f.sinVenta ? (
                                                <span className="text-[10px] font-black rounded-md px-2 py-0.5 border uppercase text-rose-300 bg-rose-500/10 border-rose-500/25">
                                                    Sin venta
                                                </span>
                                            ) : (
                                                <span className="text-[12px] font-black text-amber-300">
                                                    {fmtInt(Math.round(f.cobertura ?? 0))} días
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-2.5 text-[12px] font-bold text-slate-300 text-right whitespace-nowrap">{fmtMoney(f.costo)}</td>
                                        <td className="px-4 py-2.5 text-[13px] font-black text-amber-300 text-right whitespace-nowrap">{fmtMoney(f.valorInventario)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <AnalisisProfundoModal
                open={analisisAbierto}
                onClose={() => setAnalisisAbierto(false)}
                context={contextoAnalisis}
            />
        </div>
    )
}
