"use client"

import { useEffect, useRef, useState } from "react"
import { Search, Loader2, AlertTriangle, ScanBarcode, Boxes } from "lucide-react"
import { cn } from "@/lib/utils"
import { fmtMoney, fmtInt, fmtFechaHora } from "@/lib/format"

interface ArticuloItem {
    codigoInterno: number
    codigoBarras: string
    descripcion: string
    precio: number
}

interface Existencia {
    articulo: {
        codigoInterno: number
        codigoBarras: string
        descripcion: string
        medidaVenta: string
        precio: number
        ultimoCosto: number
    }
    existencia: number
    diasCobertura: number | null
    pvd: number
    corte: {
        base: number
        origen: "corte" | "ajuste" | "sin-corte"
        desde: string
        snapshotFecha: string | null
    }
    desdeElCorte: { entradas: number; salidas: number }
    variantesKit: number
    varianteConsultada: { codigoInterno: number; codigoBarras: string; descripcion: string } | null
    advertencias: string[]
}

interface PuntoHistorico { fecha: string; exi: number; pvd: number }

const lbl = "text-[10px] font-black text-slate-500 uppercase tracking-widest"
const inputCls = "block w-full px-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-400/25 focus:border-emerald-400/60 transition-all"

const decFmt = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDec = (n: number) => decFmt.format(n || 0)

const fechaCorta = (v: string) => {
    const d = new Date(`${v}T00:00:00`)
    return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" })
}

const fechaDia = (v: string) => {
    const d = new Date(`${v}T00:00:00`)
    return Number.isNaN(d.getTime())
        ? v
        : d.toLocaleDateString("es-MX", { weekday: "short", day: "2-digit", month: "short" })
}

// Consulta rápida de existencia por artículo: pensada para teclear o ESCANEAR
// un código de barras (lector de teclado + Enter). Usa la API de existencia
// puntual (corte nocturno + movimientos del día) y el histórico diario central.
export default function ExistenciasPage() {
    const [busqueda, setBusqueda] = useState("")
    const [resultados, setResultados] = useState<ArticuloItem[]>([])
    const [buscando, setBuscando] = useState(false)
    const [existencia, setExistencia] = useState<Existencia | null>(null)
    const [cargandoExi, setCargandoExi] = useState(false)
    const [historico, setHistorico] = useState<PuntoHistorico[]>([])
    const [cargandoHist, setCargandoHist] = useState(false)
    const [diasHist, setDiasHist] = useState(90)
    // Día bajo el cursor en la gráfica, para la lectura de fecha + existencia
    const [puntoActivo, setPuntoActivo] = useState<PuntoHistorico | null>(null)
    const [error, setError] = useState("")

    const entradaRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        entradaRef.current?.focus()
    }, [])

    const cargarHistorico = async (codigoInterno: number, dias: number) => {
        setCargandoHist(true)
        try {
            const res = await fetch(`/api/inventarios/existencia/historico?codigoInterno=${codigoInterno}&dias=${dias}`)
            const json = await res.json()
            setHistorico(res.ok ? json.historico : [])
        } catch {
            setHistorico([])
        } finally {
            setCargandoHist(false)
        }
    }

    const elegir = async (item: ArticuloItem) => {
        setResultados([])
        setExistencia(null)
        setHistorico([])
        setPuntoActivo(null)
        setError("")
        setCargandoExi(true)
        cargarHistorico(item.codigoInterno, diasHist)
        try {
            const res = await fetch(`/api/inventarios/existencia?codigoInterno=${item.codigoInterno}`)
            if (res.status === 401) { window.location.href = "/login"; return }
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "Error al calcular la existencia")
            setExistencia(json)
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Error al calcular la existencia")
        } finally {
            setCargandoExi(false)
            entradaRef.current?.select()
        }
    }

    const buscar = async () => {
        const q = busqueda.trim()
        if (!q || buscando) return
        setBuscando(true)
        setError("")
        setResultados([])
        try {
            // Los códigos de barras (escáner) van por búsqueda exacta
            const esCodigo = /^\d{6,}$/.test(q)
            const url = esCodigo
                ? `/api/articulos?codigoBarras=${encodeURIComponent(q)}&pageSize=10`
                : `/api/articulos?busqueda=${encodeURIComponent(q)}&pageSize=10&estado=activos`
            const res = await fetch(url)
            if (res.status === 401) { window.location.href = "/login"; return }
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "Error al buscar el artículo")
            const items: ArticuloItem[] = json.items ?? []
            if (items.length === 0) {
                setError(`Sin artículos para "${q}"`)
            } else if (items.length === 1) {
                await elegir(items[0])
            } else {
                setResultados(items)
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Error al buscar el artículo")
        } finally {
            setBuscando(false)
        }
    }

    const cambiarDiasHist = (dias: number) => {
        setDiasHist(dias)
        if (existencia) cargarHistorico(existencia.articulo.codigoInterno, dias)
    }

    const maxExi = Math.max(...historico.map(h => h.exi), 1)

    // Pérdida estimada por quiebre: se usa el PVD registrado CADA DÍA en quiebre
    // (la demanda de ese momento) por el precio actual; la utilidad descuenta el
    // UltimoCosto. Es un estimado: el precio histórico no se conserva.
    const precioActual = existencia?.articulo.precio ?? 0
    const margenActual = Math.max(0, precioActual - (existencia?.articulo.ultimoCosto ?? 0))
    const diasQuiebre = historico.filter(h => h.exi <= 0 && h.pvd > 0)
    const ventaPerdida = diasQuiebre.reduce((t, h) => t + h.pvd * precioActual, 0)
    const utilidadPerdida = diasQuiebre.reduce((t, h) => t + h.pvd * margenActual, 0)

    return (
        <div className="space-y-4">
            {/* Encabezado */}
            <div>
                <h1 className="text-2xl font-black text-white uppercase tracking-tight">Existencias</h1>
                <p className="text-[12px] font-bold text-slate-500 mt-1">
                    Consulta rápida por artículo — teclea la descripción o escanea el código de barras
                </p>
            </div>

            {/* Búsqueda */}
            <div className="relative z-20 bg-white/[0.04] border border-white/10 rounded-2xl p-4 backdrop-blur-xl">
                <div className="flex gap-2">
                    <div className="relative flex-1">
                        <ScanBarcode className="absolute top-1/2 -translate-y-1/2 left-3.5 h-5 w-5 text-slate-500" />
                        <input
                            ref={entradaRef}
                            type="text"
                            placeholder="DESCRIPCIÓN O CÓDIGO DE BARRAS (ENTER)"
                            className={cn(inputCls, "pl-11 py-3 text-base")}
                            value={busqueda}
                            onChange={e => setBusqueda(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && buscar()}
                        />
                    </div>
                    <button
                        onClick={buscar}
                        disabled={buscando || !busqueda.trim()}
                        className="flex items-center gap-2 px-5 rounded-xl bg-emerald-500 text-slate-950 font-black text-[11px] uppercase tracking-widest hover:brightness-110 transition-all disabled:opacity-40"
                    >
                        {buscando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                        Buscar
                    </button>
                </div>

                {resultados.length > 0 && (
                    <div className="absolute left-4 right-4 mt-2 max-h-72 overflow-y-auto rounded-xl bg-[#0d1320] border border-white/10 shadow-2xl shadow-black/60">
                        {resultados.map(r => (
                            <button
                                key={r.codigoInterno}
                                onClick={() => elegir(r)}
                                className="w-full text-left px-4 py-2.5 flex items-center justify-between gap-3 text-slate-300 hover:bg-white/[0.06] hover:text-white transition-colors"
                            >
                                <span className="min-w-0">
                                    <span className="block text-[13px] font-bold truncate">{r.descripcion}</span>
                                    <span className="block text-[11px] font-black text-cyan-300">{r.codigoBarras}</span>
                                </span>
                                <span className="shrink-0 text-[12px] font-black text-slate-400">{fmtMoney(r.precio)}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {error && (
                <div className="flex items-center gap-2 text-rose-300 text-[11px] font-black bg-rose-500/10 p-3 rounded-xl border border-rose-500/25 uppercase tracking-wider">
                    <AlertTriangle className="h-4 w-4" /> {error}
                </div>
            )}

            {cargandoExi && (
                <div className="bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl flex items-center justify-center py-16 gap-3">
                    <Loader2 className="h-6 w-6 text-emerald-400 animate-spin" />
                    <p className="text-[12px] font-bold text-slate-500 uppercase tracking-widest">Calculando existencia...</p>
                </div>
            )}

            {/* Resultado */}
            {existencia && !cargandoExi && (
                <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-5 backdrop-blur-xl space-y-4">
                    {existencia.varianteConsultada && (
                        <div className="flex items-center gap-2 text-violet-300 text-[11px] font-bold bg-violet-500/10 px-3.5 py-2.5 rounded-xl border border-violet-500/25">
                            <span className="shrink-0" aria-hidden>🧩</span>
                            <span>
                                <span className="font-black">{existencia.varianteConsultada.descripcion}</span>
                                {" "}({existencia.varianteConsultada.codigoBarras}) es una <span className="font-black">variante de kit</span> —
                                se muestra la existencia consolidada de su maestro
                            </span>
                        </div>
                    )}
                    <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                            <h2 className="text-lg font-black text-white truncate">{existencia.articulo.descripcion}</h2>
                            <p className="text-[12px] font-bold text-slate-500 mt-0.5">
                                Código <span className="text-cyan-300 font-black">{existencia.articulo.codigoBarras}</span>
                                {existencia.variantesKit > 0 && ` · incluye ${existencia.variantesKit} variante${existencia.variantesKit > 1 ? "s" : ""} de kit`}
                            </p>
                        </div>
                        <p className="text-[11px] font-bold text-slate-600">
                            {existencia.corte.origen === "ajuste"
                                ? `Base: ajuste de inventario (${fmtFechaHora(existencia.corte.desde)})`
                                : existencia.corte.origen === "corte"
                                    ? `Base: corte del ${existencia.corte.snapshotFecha}`
                                    : "Sin corte de inventario — solo movimientos de 30 días"}
                        </p>
                    </div>

                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4">
                            <p className={lbl}>Existencia Estimada</p>
                            <p className={cn(
                                "text-2xl font-black mt-1",
                                existencia.existencia <= 0 ? "text-rose-300" : "text-emerald-300"
                            )}>
                                {fmtDec(existencia.existencia)}
                                <span className="text-[11px] font-bold text-slate-500 ml-1.5">{existencia.articulo.medidaVenta}</span>
                            </p>
                        </div>
                        <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4">
                            <p className={lbl}>Cobertura</p>
                            <p className={cn(
                                "text-2xl font-black mt-1",
                                existencia.diasCobertura === null ? "text-slate-500"
                                    : existencia.diasCobertura <= 3 ? "text-rose-300"
                                        : existencia.diasCobertura <= 7 ? "text-amber-300" : "text-emerald-300"
                            )}>
                                {existencia.diasCobertura === null ? "Sin venta" : `~${fmtDec(existencia.diasCobertura)} días`}
                            </p>
                        </div>
                        <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4">
                            <p className={lbl} title="Promedio de venta diaria">PVD</p>
                            <p className="text-2xl font-black text-slate-200 mt-1">{fmtDec(existencia.pvd)}</p>
                        </div>
                        <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4">
                            <p className={lbl}>Precio</p>
                            <p className="text-2xl font-black text-slate-200 mt-1">{fmtMoney(existencia.articulo.precio)}</p>
                        </div>
                    </div>

                    <p className="text-[12px] font-bold text-slate-400">
                        Desglose: base <span className="text-slate-200 font-black">{fmtDec(existencia.corte.base)}</span>
                        {" + "}<span className="text-emerald-300 font-black">{fmtDec(existencia.desdeElCorte.entradas)}</span> entradas
                        {" − "}<span className="text-rose-300 font-black">{fmtDec(existencia.desdeElCorte.salidas)}</span> salidas desde el corte
                    </p>

                    {existencia.advertencias.length > 0 && (
                        <p className="text-[11px] font-bold text-amber-300/80">
                            Sin datos de: {existencia.advertencias.join(", ")} (tablas no disponibles en la tienda)
                        </p>
                    )}
                </div>
            )}

            {/* Histórico */}
            {existencia && !cargandoExi && (
                <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-5 backdrop-blur-xl">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                        <h3 className="text-[12px] font-black text-slate-300 uppercase tracking-widest">
                            📈 Existencia al corte de cada día
                        </h3>
                        <div className="flex items-center rounded-xl bg-white/[0.03] border border-white/10 p-1">
                            {[30, 90].map(d => (
                                <button
                                    key={d}
                                    onClick={() => cambiarDiasHist(d)}
                                    className={cn(
                                        "px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                                        diasHist === d ? "bg-white/[0.08] text-white" : "text-slate-400 hover:text-white"
                                    )}
                                >
                                    {d} días
                                </button>
                            ))}
                        </div>
                    </div>

                    {cargandoHist ? (
                        <div className="flex items-center justify-center h-28">
                            <Loader2 className="h-6 w-6 text-emerald-400 animate-spin" />
                        </div>
                    ) : historico.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-28 gap-2">
                            <Boxes className="h-6 w-6 text-slate-700" />
                            <p className="text-[11px] font-bold text-slate-600 uppercase tracking-widest">
                                Sin histórico en el central para el artículo
                            </p>
                        </div>
                    ) : (
                        <div onMouseLeave={() => setPuntoActivo(null)}>
                            {/* Pérdida estimada del periodo por días en quiebre */}
                            {diasQuiebre.length > 0 && (
                                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 bg-rose-500/[0.06] border border-rose-500/25 rounded-xl px-4 py-2.5 mb-3">
                                    <span className="text-[11px] font-black text-rose-300 uppercase tracking-wider">
                                        {fmtInt(diasQuiebre.length)} día{diasQuiebre.length > 1 ? "s" : ""} en quiebre en el periodo
                                    </span>
                                    <span className="text-[11px] font-bold text-slate-300">
                                        Venta perdida est.: <span className="font-black text-rose-300">{fmtMoney(ventaPerdida)}</span>
                                    </span>
                                    <span className="text-[11px] font-bold text-slate-300">
                                        Utilidad perdida est.: <span className="font-black text-rose-300">{fmtMoney(utilidadPerdida)}</span>
                                    </span>
                                </div>
                            )}

                            {/* Lectura del día bajo el cursor (altura fija para no brincar) */}
                            <div className="h-6 mb-1 flex items-center justify-between gap-2">
                                {puntoActivo ? (
                                    <p className="text-[13px] font-black">
                                        <span className="text-slate-200 capitalize">{fechaDia(puntoActivo.fecha)}</span>
                                        <span className={cn(
                                            "ml-2",
                                            puntoActivo.exi <= 0 ? "text-rose-300" : "text-emerald-300"
                                        )}>
                                            {fmtDec(puntoActivo.exi)} {existencia.articulo.medidaVenta}
                                        </span>
                                        {puntoActivo.exi <= 0 && puntoActivo.pvd > 0 && (
                                            <>
                                                <span className="ml-2 text-[10px] font-black text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-md px-1.5 py-0.5 uppercase">
                                                    Quiebre
                                                </span>
                                                <span className="ml-2 text-[12px] font-bold text-rose-300/90">
                                                    ~{fmtMoney(puntoActivo.pvd * precioActual)} de venta perdida
                                                </span>
                                            </>
                                        )}
                                    </p>
                                ) : (
                                    <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">
                                        Pasa el cursor por las barras para ver cada día
                                    </p>
                                )}
                                <p className="text-[10px] font-bold text-slate-600 whitespace-nowrap">
                                    Máx: {fmtDec(maxExi)} {existencia.articulo.medidaVenta}
                                </p>
                            </div>

                            <div className="flex items-end gap-px h-36 border-b border-white/10">
                                {historico.map(h => (
                                    <div
                                        key={h.fecha}
                                        className="flex-1 flex items-end h-full min-w-0 cursor-crosshair"
                                        onMouseEnter={() => setPuntoActivo(h)}
                                        title={`${fechaDia(h.fecha)} — ${fmtDec(h.exi)}${h.exi <= 0 && h.pvd > 0 ? ` (QUIEBRE, ~${fmtMoney(h.pvd * precioActual)} perdidos)` : ""}`}
                                    >
                                        <div
                                            className={cn(
                                                "w-full rounded-t-sm transition-colors",
                                                h.exi <= 0
                                                    ? (puntoActivo?.fecha === h.fecha ? "bg-rose-300" : "bg-rose-400/80")
                                                    : (puntoActivo?.fecha === h.fecha ? "bg-emerald-300" : "bg-emerald-400/60")
                                            )}
                                            style={{ height: h.exi <= 0 ? "4px" : `${Math.max((h.exi / maxExi) * 100, 3)}%` }}
                                        />
                                    </div>
                                ))}
                            </div>

                            {/* Eje de fechas: una etiqueta cada tantos días */}
                            <div className="flex gap-px mt-1.5">
                                {historico.map((h, i) => {
                                    const paso = Math.max(1, Math.ceil(historico.length / 9))
                                    const esUltimo = i === historico.length - 1
                                    const esTick = (i % paso === 0 && historico.length - 1 - i >= paso / 2) || esUltimo
                                    return (
                                        <div key={h.fecha} className="flex-1 min-w-0 text-center overflow-visible">
                                            {esTick && (
                                                <span className="text-[9px] font-bold text-slate-500 whitespace-nowrap">
                                                    {fechaCorta(h.fecha)}
                                                </span>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {!existencia && !cargandoExi && !error && resultados.length === 0 && (
                <div className="bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl flex flex-col items-center justify-center py-24 gap-3">
                    <ScanBarcode className="h-8 w-8 text-slate-700" />
                    <p className="text-[12px] font-bold text-slate-600 uppercase tracking-widest">
                        Escanea o busca un artículo para ver su existencia
                    </p>
                </div>
            )}
        </div>
    )
}
