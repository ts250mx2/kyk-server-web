"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
    Search, Loader2, AlertTriangle, PackageX, TrendingDown, Layers, RefreshCw,
    FileText, FileSpreadsheet, ArrowUpDown, Calendar
} from "lucide-react"
import { cn } from "@/lib/utils"
import { fmtMoney, fmtInt } from "@/lib/format"
import { exportarPdf, exportarExcel, obtenerTiendaSesion, sufijoArchivo } from "@/lib/export"
import { AnalisisProfundoModal, BotonAnalisisProfundo, type PageSummaryContext } from "@/components/dashboard/AnalisisProfundo"

interface ItemQuiebre {
    codigoInterno: number
    codigoBarras: string
    descripcion: string
    depto: string
    medidaVenta: string
    stock: number
    pvd: number
    variantes: number
    precio: number
    diasQuiebre: number
    ventaDiaria: number
    ventaPerdida: number
    unidadesPerdidas: number
    utilidadPerdida: number
    severidad: "critico" | "alto" | "medio"
}

interface Datos {
    corteFecha: string
    umbral: number
    horizonte: number
    truncado: boolean
    items: ItemQuiebre[]
    porDepto: { depto: string; skus: number; ventaPerdida: number }[]
    kpis: {
        skusEnQuiebre: number
        skusConVenta: number
        ventaPerdida: number
        ventaPerdidaDiaria: number
        unidadesPerdidas: number
        utilidadPerdida: number
        deptosAfectados: number
    }
}

type OrdenKey = "ventaPerdida" | "ventaDiaria" | "pvd" | "stock" | "diasQuiebre"
type Agrupar = "sku" | "depto"

const lbl = "text-[10px] font-black text-slate-500 uppercase tracking-widest"
const inputCls = "block w-full px-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-400/25 focus:border-emerald-400/60 transition-all"

const UMBRALES = [
    { label: "= 0 (quiebre)", value: 0 },
    { label: "≤ 1", value: 1 },
    { label: "≤ 2", value: 2 },
    { label: "≤ 5", value: 5 },
]
const HORIZONTES = [7, 14, 30]

const SEVERIDAD = {
    critico: { label: "CRÍTICO", cls: "text-rose-300 bg-rose-500/15 border-rose-500/40" },
    alto: { label: "ALTO", cls: "text-amber-300 bg-amber-500/10 border-amber-500/25" },
    medio: { label: "MEDIO", cls: "text-slate-300 bg-white/[0.06] border-white/15" },
} as const

const decFmt = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 })
const fmtDec = (n: number) => decFmt.format(n || 0)

const diasAtras = (n: number) => {
    const d = new Date()
    d.setDate(d.getDate() - n)
    return d.toLocaleDateString("sv-SE")
}

function urlDatos(umbral: number, horizonte: number): string {
    return `/api/inventarios/quiebre-stock?umbral=${umbral}&horizonte=${horizonte}`
}

export default function QuiebreStockPage() {
    const router = useRouter()
    const [umbral, setUmbral] = useState(0)
    const [horizonte, setHorizonte] = useState(7)
    const [datos, setDatos] = useState<Datos | null>(null)
    const [cargando, setCargando] = useState(true)
    const [error, setError] = useState("")
    const [busqueda, setBusqueda] = useState("")
    // Drill-down: clic en un departamento acota el detalle a sus artículos
    const [deptoSel, setDeptoSel] = useState("")
    const [agrupar, setAgrupar] = useState<Agrupar>("sku")
    const [orden, setOrden] = useState<OrdenKey>("ventaPerdida")
    const [exportando, setExportando] = useState<"pdf" | "excel" | null>(null)
    const [tienda, setTienda] = useState("")
    const [analisisAbierto, setAnalisisAbierto] = useState(false)

    // Carga inicial (umbral 0, horizonte 7) e identidad para el análisis
    useEffect(() => {
        fetch(urlDatos(0, 7))
            .then(r => {
                if (r.status === 401) { window.location.href = "/login"; return null }
                return r.json().then(json => ({ ok: r.ok, json }))
            })
            .then(res => {
                if (!res) return
                if (res.ok) setDatos(res.json)
                else setError(res.json.error || "Error al consultar el quiebre de stock")
            })
            .catch(() => setError("Error al consultar el quiebre de stock"))
            .finally(() => setCargando(false))

        fetch("/api/auth/me")
            .then(r => r.json())
            .then(d => setTienda(d.user?.tienda ?? ""))
            .catch(() => { /* el análisis usa alcance genérico */ })
    }, [])

    const cargar = async (u: number, h: number) => {
        setCargando(true)
        setError("")
        try {
            const res = await fetch(urlDatos(u, h))
            if (res.status === 401) { router.push("/login"); return }
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "Error al consultar el quiebre de stock")
            setDatos(json)
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Error al consultar el quiebre de stock")
            setDatos(null)
        } finally {
            setCargando(false)
        }
    }

    const cambiarUmbral = (u: number) => { setUmbral(u); cargar(u, horizonte) }
    const cambiarHorizonte = (h: number) => { setHorizonte(h); cargar(umbral, h) }

    const visibles = useMemo(() => {
        const filtro = busqueda.trim().toLowerCase()
        const lista = (datos?.items ?? []).filter(i =>
            (!deptoSel || (i.depto || "(sin depto)") === deptoSel) &&
            (!filtro ||
                i.descripcion.toLowerCase().includes(filtro) ||
                i.codigoBarras.includes(filtro) ||
                i.depto.toLowerCase().includes(filtro))
        )
        return [...lista].sort((a, b) => {
            switch (orden) {
                case "ventaDiaria": return b.ventaDiaria - a.ventaDiaria
                case "pvd": return b.pvd - a.pvd
                case "stock": return a.stock - b.stock
                case "diasQuiebre": return b.diasQuiebre - a.diasQuiebre
                default: return b.ventaPerdida - a.ventaPerdida
            }
        })
    }, [datos, busqueda, deptoSel, orden])

    const elegirDepto = (depto: string) => {
        setDeptoSel(depto)
        setAgrupar("sku")
    }

    const porDeptoVisibles = useMemo(() => {
        if (agrupar !== "depto") return []
        const mapa = new Map<string, { skus: number; ventaPerdida: number }>()
        for (const it of visibles) {
            const clave = it.depto || "(sin depto)"
            const acumulado = mapa.get(clave) ?? { skus: 0, ventaPerdida: 0 }
            mapa.set(clave, { skus: acumulado.skus + 1, ventaPerdida: acumulado.ventaPerdida + it.ventaPerdida })
        }
        return [...mapa.entries()]
            .map(([depto, v]) => ({ depto, ...v }))
            .sort((a, b) => b.ventaPerdida - a.ventaPerdida)
    }, [visibles, agrupar])

    const top10 = useMemo(
        () => [...(datos?.items ?? [])].sort((a, b) => b.ventaPerdida - a.ventaPerdida).slice(0, 10),
        [datos]
    )

    const corteViejo = useMemo(
        () => Boolean(datos?.corteFecha && datos.corteFecha < diasAtras(2)),
        [datos]
    )

    const contextoAnalisis: PageSummaryContext = useMemo(() => {
        const k = datos?.kpis
        return {
            pageContext: `Quiebre de Stock: SKUs con existencia <= ${datos?.umbral ?? umbral} y venta reciente, con venta perdida proyectada a ${datos?.horizonte ?? horizonte} días. Más SKUs en quiebre y más venta perdida es PEOR.`,
            period: { fechaInicio: datos?.corteFecha || diasAtras(0), fechaFin: datos?.corteFecha || diasAtras(0) },
            scope: tienda || "Tienda de la sesión",
            kpis: {
                skusEnQuiebre: k?.skusEnQuiebre ?? 0,
                skusConVentaReciente: k?.skusConVenta ?? 0,
                ventaPerdidaProyectadaMXN: Math.round(k?.ventaPerdida ?? 0),
                utilidadPerdidaProyectadaMXN: Math.round(k?.utilidadPerdida ?? 0),
                ventaPerdidaPorDiaMXN: Math.round(k?.ventaPerdidaDiaria ?? 0),
                departamentosAfectados: k?.deptosAfectados ?? 0,
            },
            highlights: {
                topStores: (datos?.porDepto ?? []).slice(0, 8).map(d => ({
                    name: `${d.depto} (${d.skus} SKUs)`,
                    value: Math.round(d.ventaPerdida),
                })),
                topItems: top10.map(i => ({ name: i.descripcion, value: Math.round(i.ventaPerdida) })),
                anomalies: (datos?.items ?? [])
                    .filter(i => i.severidad === "critico")
                    .slice(0, 10)
                    .map(i => `${i.descripcion}: vende ${fmtMoney(i.ventaDiaria)}/día y está en ${i.stock <= 0 ? "cero" : `stock ${fmtDec(i.stock)}`}${i.diasQuiebre > 0 ? `, ${i.diasQuiebre} días en quiebre en 30 días` : ""}`),
            },
        }
    }, [datos, umbral, horizonte, tienda, top10])

    const exportar = async (formato: "pdf" | "excel") => {
        if (!datos) return
        setExportando(formato)
        try {
            const nombreTienda = tienda || await obtenerTiendaSesion()
            const base = {
                titulo: "QUIEBRE DE STOCK",
                subtitulo: `Stock ≤ ${datos.umbral} · Proyección ${datos.horizonte} días · Corte ${datos.corteFecha}${deptoSel ? ` · Depto: ${deptoSel}` : ""} · ${fmtInt(visibles.length)} SKUs`,
                tienda: nombreTienda,
                columnas: [
                    { header: "Código" },
                    { header: "Producto" },
                    { header: "Depto" },
                    { header: "Severidad", align: "center" as const },
                    { header: "Stock", align: "right" as const },
                    { header: "Días Quiebre 30d", align: "right" as const },
                    { header: "PVD", align: "right" as const },
                    { header: "Venta/Día", align: "right" as const },
                    { header: "Venta Perdida", align: "right" as const },
                    { header: "Utilidad Perdida", align: "right" as const },
                ],
                nombreArchivo: `quiebre_stock_${sufijoArchivo()}`,
            }
            if (formato === "pdf") {
                exportarPdf({
                    ...base, orientacion: "landscape",
                    filas: visibles.map(i => [
                        i.codigoBarras, i.descripcion, i.depto,
                        SEVERIDAD[i.severidad].label, fmtDec(i.stock), String(i.diasQuiebre),
                        fmtDec(i.pvd), fmtMoney(i.ventaDiaria), fmtMoney(i.ventaPerdida), fmtMoney(i.utilidadPerdida),
                    ]),
                })
            } else {
                exportarExcel({
                    ...base, hoja: "Quiebre de Stock", columnasMoneda: [7, 8, 9],
                    filas: visibles.map(i => [
                        i.codigoBarras, i.descripcion, i.depto,
                        SEVERIDAD[i.severidad].label, i.stock, i.diasQuiebre,
                        i.pvd, i.ventaDiaria, i.ventaPerdida, i.utilidadPerdida,
                    ]),
                })
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Error al exportar")
        } finally {
            setExportando(null)
        }
    }

    const k = datos?.kpis
    const maxVentaPerdida = top10[0]?.ventaPerdida || 1
    const maxDeptoVenta = (datos?.porDepto ?? [])[0]?.ventaPerdida || 1

    return (
        <div className="space-y-4">
            {/* Encabezado */}
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-black text-white uppercase tracking-tight flex items-center gap-2">
                        <PackageX className="h-6 w-6 text-rose-400" /> Quiebre de Stock
                    </h1>
                    <p className="text-[12px] font-bold text-slate-500 mt-1">
                        SKUs sin existencia (o bajo umbral) con venta reciente — venta perdida estimada si no se resurte
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <BotonAnalisisProfundo
                        onClick={() => setAnalisisAbierto(true)}
                        disabled={cargando || !datos || datos.items.length === 0}
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
                    <button
                        onClick={() => cargar(umbral, horizonte)}
                        disabled={cargando}
                        className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-emerald-500 text-slate-950 font-black text-[11px] uppercase tracking-widest hover:brightness-110 transition-all disabled:opacity-40"
                        title="Recalcular"
                    >
                        <RefreshCw className={cn("h-4 w-4", cargando && "animate-spin")} />
                        Recalcular
                    </button>
                </div>
            </div>

            {/* Filtros */}
            <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 backdrop-blur-xl space-y-3">
                <div className="flex flex-wrap gap-x-6 gap-y-3 items-end">
                    <div>
                        <span className={lbl}>Umbral de stock</span>
                        <div className="flex items-center rounded-xl bg-white/[0.03] border border-white/10 p-1 mt-1">
                            {UMBRALES.map(u => (
                                <button
                                    key={u.value}
                                    onClick={() => cambiarUmbral(u.value)}
                                    disabled={cargando}
                                    className={cn(
                                        "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                                        umbral === u.value
                                            ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                                            : "text-slate-400 hover:text-white border border-transparent"
                                    )}
                                >
                                    {u.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div>
                        <span className={lbl}>Horizonte (venta perdida)</span>
                        <div className="flex items-center rounded-xl bg-white/[0.03] border border-white/10 p-1 mt-1">
                            {HORIZONTES.map(h => (
                                <button
                                    key={h}
                                    onClick={() => cambiarHorizonte(h)}
                                    disabled={cargando}
                                    className={cn(
                                        "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                                        horizonte === h
                                            ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                                            : "text-slate-400 hover:text-white border border-transparent"
                                    )}
                                >
                                    {h} días
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
                {datos && (
                    <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-white/[0.06]">
                        <span className={lbl}>Filtros:</span>
                        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.05] border border-white/10 text-[10px] font-black text-slate-300 uppercase tracking-wider">
                            <Calendar className="h-3 w-3" /> Corte del {datos.corteFecha} · Proyección {datos.horizonte}d
                        </span>
                        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-500/10 border border-rose-500/25 text-[10px] font-black text-rose-300 uppercase tracking-wider">
                            <PackageX className="h-3 w-3" /> {datos.umbral === 0 ? "Stock = 0" : `Stock ≤ ${datos.umbral}`}
                        </span>
                        {deptoSel && (
                            <button
                                onClick={() => setDeptoSel("")}
                                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-500/10 border border-cyan-500/25 text-[10px] font-black text-cyan-300 uppercase tracking-wider hover:bg-cyan-500/20 transition-all"
                                title="Quitar el filtro de departamento"
                            >
                                <Layers className="h-3 w-3" /> {deptoSel} ✕
                            </button>
                        )}
                    </div>
                )}
            </div>

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

            {cargando ? (
                <div className="bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl flex items-center justify-center py-24">
                    <Loader2 className="h-7 w-7 text-emerald-400 animate-spin" />
                </div>
            ) : datos && (
                <>
                    {/* KPIs */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 backdrop-blur-xl">
                            <p className={lbl}>SKUs en Quiebre</p>
                            <p className={cn("text-2xl font-black mt-1", (k?.skusEnQuiebre ?? 0) > 0 ? "text-rose-300" : "text-emerald-300")}>
                                {fmtInt(k?.skusEnQuiebre ?? 0)}
                            </p>
                            <p className="text-[10px] font-bold text-slate-600 mt-0.5">
                                de {fmtInt(k?.skusConVenta ?? 0)} con venta reciente
                            </p>
                        </div>
                        <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 backdrop-blur-xl">
                            <p className={lbl}>Venta Perdida Est. ({datos.horizonte}d)</p>
                            <p className="text-2xl font-black text-rose-300 mt-1">{fmtMoney(k?.ventaPerdida ?? 0)}</p>
                            <p className="text-[10px] font-bold text-slate-600 mt-0.5">
                                ≈ {fmtMoney(k?.ventaPerdidaDiaria ?? 0)} / día
                            </p>
                        </div>
                        <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 backdrop-blur-xl">
                            <p className={lbl}>Utilidad Perdida Est.</p>
                            <p className="text-2xl font-black text-amber-300 mt-1">{fmtMoney(k?.utilidadPerdida ?? 0)}</p>
                            <p className="text-[10px] font-bold text-slate-600 mt-0.5">margen con UltimoCosto</p>
                        </div>
                        <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 backdrop-blur-xl">
                            <p className={lbl}>Unidades Faltantes Est.</p>
                            <p className="text-2xl font-black text-slate-200 mt-1">{fmtDec(k?.unidadesPerdidas ?? 0)}</p>
                            <p className="text-[10px] font-bold text-slate-600 mt-0.5">
                                {fmtInt(k?.deptosAfectados ?? 0)} departamentos afectados
                            </p>
                        </div>
                    </div>

                    {datos.items.length === 0 ? (
                        <div className="bg-emerald-500/[0.06] border border-emerald-500/25 rounded-2xl p-8 text-center">
                            <p className="text-lg font-black text-emerald-300">🎉 Sin quiebres detectados</p>
                            <p className="text-[12px] font-bold text-slate-500 mt-1">
                                Ningún SKU con venta reciente está bajo el umbral seleccionado
                            </p>
                        </div>
                    ) : (
                        <>
                            {/* Top 10 por venta perdida */}
                            <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-5 backdrop-blur-xl">
                                <h3 className="text-[12px] font-black text-slate-300 uppercase tracking-widest mb-4 flex items-center gap-2">
                                    <TrendingDown className="h-4 w-4 text-rose-400" /> Top 10 SKUs por venta perdida estimada
                                </h3>
                                <div className="space-y-2.5">
                                    {top10.map((it, idx) => (
                                        <div key={it.codigoInterno}>
                                            <div className="flex items-center justify-between gap-3 mb-1">
                                                <p className="text-[12px] font-bold text-slate-300 truncate min-w-0">
                                                    <span className="text-slate-600">{idx + 1}.</span> {it.descripcion}
                                                    <span className="text-slate-600"> · {it.depto || "(sin depto)"}</span>
                                                </p>
                                                <p className="text-[12px] font-black text-rose-300 whitespace-nowrap">{fmtMoney(it.ventaPerdida)}</p>
                                            </div>
                                            <div className="h-1.5 rounded-full bg-white/[0.05]">
                                                <div
                                                    className="h-full rounded-full bg-gradient-to-r from-rose-500 to-amber-400"
                                                    style={{ width: `${(it.ventaPerdida / maxVentaPerdida) * 100}%` }}
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Por departamento */}
                            <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-5 backdrop-blur-xl">
                                <h3 className="text-[12px] font-black text-slate-300 uppercase tracking-widest mb-4 flex items-center gap-2">
                                    <Layers className="h-4 w-4 text-cyan-400" /> Por departamento
                                </h3>
                                <div className="space-y-1">
                                    {datos.porDepto.slice(0, 8).map(d => (
                                        <button
                                            key={d.depto}
                                            onClick={() => elegirDepto(d.depto)}
                                            className={cn(
                                                "w-full text-left rounded-xl px-2 py-1.5 transition-colors border",
                                                deptoSel === d.depto
                                                    ? "bg-cyan-500/10 border-cyan-500/25"
                                                    : "border-transparent hover:bg-white/[0.04]"
                                            )}
                                            title={`Ver los artículos de ${d.depto}`}
                                        >
                                            <div className="flex items-center justify-between gap-3 mb-1">
                                                <p className="text-[12px] font-bold text-slate-300 truncate min-w-0">{d.depto}</p>
                                                <p className="text-[11px] font-black text-slate-400 whitespace-nowrap">
                                                    {fmtInt(d.skus)} SKUs · <span className="text-rose-300">{fmtMoney(d.ventaPerdida)}</span>
                                                </p>
                                            </div>
                                            <div className="h-1.5 rounded-full bg-white/[0.05]">
                                                <div
                                                    className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-rose-400"
                                                    style={{ width: `${(d.ventaPerdida / maxDeptoVenta) * 100}%` }}
                                                />
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {datos.truncado && (
                                <div className="flex items-center gap-2 text-amber-300 text-[11px] font-black bg-amber-500/10 p-3 rounded-xl border border-amber-500/25 uppercase tracking-wider">
                                    <AlertTriangle className="h-4 w-4" /> Mostrando los SKUs de mayor demanda — hay más bajo el umbral
                                </div>
                            )}

                            {/* Tabla de detalle */}
                            <div className="bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl overflow-hidden">
                                <div className="px-4 py-3 border-b border-white/[0.06] flex flex-wrap items-center gap-3">
                                    <h3 className="text-[12px] font-black text-slate-300 uppercase tracking-widest">
                                        Detalle ({fmtInt(agrupar === "sku" ? visibles.length : porDeptoVisibles.length)} filas)
                                    </h3>
                                    <div className="relative flex-1 min-w-[220px]">
                                        <Search className="absolute top-1/2 -translate-y-1/2 left-3.5 h-4 w-4 text-slate-500" />
                                        <input
                                            type="text"
                                            placeholder="BUSCAR SKU, DESCRIPCIÓN O DEPTO"
                                            className={cn(inputCls, "pl-10 py-2")}
                                            value={busqueda}
                                            onChange={e => setBusqueda(e.target.value)}
                                        />
                                    </div>
                                    <div className="flex items-center rounded-xl bg-white/[0.03] border border-white/10 p-1">
                                        {([
                                            { id: "sku", nombre: "Por SKU" },
                                            { id: "depto", nombre: "Por departamento" },
                                        ] as { id: Agrupar; nombre: string }[]).map(g => (
                                            <button
                                                key={g.id}
                                                onClick={() => setAgrupar(g.id)}
                                                className={cn(
                                                    "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                                                    agrupar === g.id ? "bg-white/[0.08] text-white" : "text-slate-400 hover:text-white"
                                                )}
                                            >
                                                {g.nombre}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="overflow-auto max-h-[60vh]">
                                    {agrupar === "sku" ? (
                                        <table className="w-full">
                                            <thead className="sticky top-0 z-10 bg-[#10151f] shadow-[0_1px_0_rgba(255,255,255,0.08)]">
                                                <tr>
                                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Producto</th>
                                                    <th className={cn(lbl, "px-4 py-2.5 text-center")}>Severidad</th>
                                                    <EncOrden label="Stock" activo={orden === "stock"} onClick={() => setOrden("stock")} />
                                                    <EncOrden label="Días Quiebre 30d" activo={orden === "diasQuiebre"} onClick={() => setOrden("diasQuiebre")} />
                                                    <EncOrden label="PVD" activo={orden === "pvd"} onClick={() => setOrden("pvd")} />
                                                    <EncOrden label="Venta/Día" activo={orden === "ventaDiaria"} onClick={() => setOrden("ventaDiaria")} />
                                                    <EncOrden label="Venta Perdida" activo={orden === "ventaPerdida"} onClick={() => setOrden("ventaPerdida")} />
                                                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Utilidad Perdida</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-white/[0.04]">
                                                {visibles.map(it => {
                                                    const sev = SEVERIDAD[it.severidad]
                                                    return (
                                                        <tr key={it.codigoInterno} className="hover:bg-white/[0.03]">
                                                            <td className="px-4 py-2.5">
                                                                <p className="text-[13px] font-bold text-slate-200 max-w-[300px] truncate" title={it.descripcion}>
                                                                    {it.descripcion}
                                                                </p>
                                                                <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider">
                                                                    <span className="text-cyan-300">{it.codigoBarras}</span>
                                                                    {it.depto && ` · ${it.depto}`}
                                                                    {it.variantes > 0 && (
                                                                        <span className="text-violet-300"> · incluye {it.variantes} variante{it.variantes > 1 ? "s" : ""} de kit</span>
                                                                    )}
                                                                </p>
                                                            </td>
                                                            <td className="px-4 py-2.5 text-center whitespace-nowrap">
                                                                <span className={cn("text-[10px] font-black rounded-md px-2 py-0.5 border uppercase", sev.cls)}>
                                                                    {sev.label}
                                                                </span>
                                                            </td>
                                                            <td className={cn(
                                                                "px-4 py-2.5 text-[13px] font-black text-right whitespace-nowrap",
                                                                it.stock <= 0 ? "text-rose-300" : "text-amber-300"
                                                            )}>
                                                                {fmtDec(it.stock)}
                                                            </td>
                                                            <td className="px-4 py-2.5 text-[12px] font-black text-amber-300 text-right whitespace-nowrap">
                                                                {it.diasQuiebre > 0 ? it.diasQuiebre : "—"}
                                                            </td>
                                                            <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 text-right whitespace-nowrap">{fmtDec(it.pvd)}</td>
                                                            <td className="px-4 py-2.5 text-[12px] font-bold text-slate-300 text-right whitespace-nowrap">{fmtMoney(it.ventaDiaria)}</td>
                                                            <td className="px-4 py-2.5 text-[13px] font-black text-rose-300 text-right whitespace-nowrap">{fmtMoney(it.ventaPerdida)}</td>
                                                            <td className="px-4 py-2.5 text-[12px] font-black text-amber-300 text-right whitespace-nowrap">{fmtMoney(it.utilidadPerdida)}</td>
                                                        </tr>
                                                    )
                                                })}
                                            </tbody>
                                        </table>
                                    ) : (
                                        <table className="w-full">
                                            <thead className="sticky top-0 z-10 bg-[#10151f] shadow-[0_1px_0_rgba(255,255,255,0.08)]">
                                                <tr>
                                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Departamento</th>
                                                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>SKUs en Quiebre</th>
                                                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Venta Perdida Est.</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-white/[0.04]">
                                                {porDeptoVisibles.map(d => (
                                                    <tr
                                                        key={d.depto}
                                                        onClick={() => elegirDepto(d.depto)}
                                                        className="hover:bg-white/[0.03] cursor-pointer"
                                                        title={`Ver los artículos de ${d.depto}`}
                                                    >
                                                        <td className="px-4 py-2.5 text-[13px] font-bold text-slate-200">{d.depto}</td>
                                                        <td className="px-4 py-2.5 text-[13px] font-black text-slate-300 text-right">{fmtInt(d.skus)}</td>
                                                        <td className="px-4 py-2.5 text-[13px] font-black text-rose-300 text-right">{fmtMoney(d.ventaPerdida)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </>
            )}

            <AnalisisProfundoModal
                open={analisisAbierto}
                onClose={() => setAnalisisAbierto(false)}
                context={contextoAnalisis}
            />
        </div>
    )
}

function EncOrden({ label, activo, onClick }: { label: string; activo: boolean; onClick: () => void }) {
    return (
        <th className={cn(lbl, "px-4 py-2.5 text-right")}>
            <button
                onClick={onClick}
                className={cn(
                    "inline-flex items-center gap-1 uppercase transition-colors",
                    activo ? "text-emerald-300" : "hover:text-white"
                )}
            >
                {label}
                <ArrowUpDown className={cn("h-3 w-3", activo ? "opacity-100" : "opacity-30")} />
            </button>
        </th>
    )
}
