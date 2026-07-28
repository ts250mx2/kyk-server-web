"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
    Search, Loader2, AlertTriangle, ChevronDown, X, Boxes,
    FileText, FileSpreadsheet
} from "lucide-react"
import { cn } from "@/lib/utils"
import { fmtInt, fmtFechaHora, fmtHora } from "@/lib/format"
import { exportarPdf, exportarExcel, obtenerTiendaSesion, sufijoArchivo } from "@/lib/export"
import { AnalisisProfundoModal, BotonAnalisisProfundo, type PageSummaryContext } from "@/components/dashboard/AnalisisProfundo"

interface Proveedor {
    idProveedor: number
    proveedor: string
    diasPedido: number
}

interface ArticuloInventario {
    codigoInterno: number
    codigoBarras: string
    descripcion: string
    exiActual: number
    exiPara: number
    pvd: number
    medidaVenta: string
    estatus: number
    pedido: string
    pedidoSugerido: number
    pedidoTransito: number
    medidaCompra: string
    idComputadora: number
}

interface Movimiento {
    fecha: string
    codigoBarras: string
    descripcion: string
    concepto: string
    usuario: string
    mov: number
    equiv: number
    medidaVenta: string
}

const lbl = "text-[10px] font-black text-slate-500 uppercase tracking-widest"
const inputCls = "block w-full px-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-400/25 focus:border-emerald-400/60 transition-all"

const MAX_LISTA_PROVEEDORES = 100

// Misma semántica de iconos que la página PHP original (frm Inventarios):
// 0 = hay que pedir, 1 = sobre-inventario, 2 = agotado con demanda creciente,
// 3 y 4 = OK. El servidor ya ordena por estatus (pendientes de pedir arriba).
const ESTATUS: Record<number, { etiqueta: string; titulo: string; cls: string }> = {
    0: { etiqueta: "Pedir", titulo: "Hay que pedir", cls: "text-amber-300 bg-amber-500/10 border-amber-500/25" },
    1: { etiqueta: "Exceso", titulo: "Sobre-inventario", cls: "text-rose-300 bg-rose-500/10 border-rose-500/25" },
    2: { etiqueta: "Agotado", titulo: "Agotado con demanda creciente", cls: "text-rose-200 bg-rose-500/20 border-rose-500/40" },
    3: { etiqueta: "OK", titulo: "Existencia sana", cls: "text-emerald-300 bg-emerald-500/10 border-emerald-500/25" },
    4: { etiqueta: "OK", titulo: "Sin existencia ni demanda", cls: "text-emerald-300 bg-emerald-500/10 border-emerald-500/25" },
}

const decFmt = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDec = (n: number) => decFmt.format(n || 0)

// La consulta persiste en sessionStorage (recalcularla cuesta minutos): al
// volver a la página se restauran proveedor, días y el resultado, validando
// que sigan siendo de la misma tienda. Se pierde al cerrar la pestaña.
const CLAVE_STORAGE = "inventarios-proveedor"

interface Consulta {
    proveedor: string
    dias: number
    en?: string
}

export default function InventariosPage() {
    const [proveedores, setProveedores] = useState<Proveedor[]>([])
    const [cargandoProveedores, setCargandoProveedores] = useState(true)

    // Combo buscable de proveedor
    const [filtroProv, setFiltroProv] = useState("")
    const [proveedorSel, setProveedorSel] = useState<Proveedor | null>(null)
    const [listaAbierta, setListaAbierta] = useState(false)

    const [diasPedido, setDiasPedido] = useState("")
    const [articulos, setArticulos] = useState<ArticuloInventario[]>([])
    // Cantidades a pedir por artículo, precargadas con el pedido sugerido
    const [pedidos, setPedidos] = useState<Record<number, string>>({})
    const [consultado, setConsultado] = useState<Consulta | null>(null)
    const [filtroArticulos, setFiltroArticulos] = useState("")
    const [cargando, setCargando] = useState(false)
    const [segundos, setSegundos] = useState(0)
    const [error, setError] = useState("")
    const [exportando, setExportando] = useState<"pdf" | "excel" | null>(null)
    const [tienda, setTienda] = useState("")
    const [idTienda, setIdTienda] = useState(0)
    const [analisisAbierto, setAnalisisAbierto] = useState(false)

    // Modal de movimientos
    const [movArticulo, setMovArticulo] = useState<ArticuloInventario | null>(null)
    const [movimientos, setMovimientos] = useState<Movimiento[]>([])
    const [cargandoMov, setCargandoMov] = useState(false)

    const provInputRef = useRef<HTMLInputElement>(null)
    const movContenedorRef = useRef<HTMLDivElement>(null)

    // Al cargar los movimientos, ir hasta el último (los más recientes al fondo)
    useEffect(() => {
        if (cargandoMov) return
        const el = movContenedorRef.current
        if (el) el.scrollTop = el.scrollHeight
    }, [cargandoMov, movimientos])

    useEffect(() => {
        fetch("/api/inventarios/proveedores")
            .then(r => {
                if (r.status === 401) { window.location.href = "/login"; return null }
                return r.json()
            })
            .then(json => {
                if (!json) return
                if (json.proveedores) setProveedores(json.proveedores)
                else setError(json.error || "Error al consultar proveedores")
            })
            .catch(() => setError("Error al consultar los proveedores de la tienda"))
            .finally(() => setCargandoProveedores(false))

        // Identidad de la tienda: alcance del análisis y validación de la
        // consulta persistida (se restaura solo si es de la misma tienda).
        // La restauración va después de la hidratación para no desfasar el SSR.
        fetch("/api/auth/me")
            .then(r => r.json())
            .then(d => {
                setTienda(d.user?.tienda ?? "")
                const idT = Number(d.user?.idTienda) || 0
                setIdTienda(idT)
                if (!idT) return
                try {
                    const crudo = sessionStorage.getItem(CLAVE_STORAGE)
                    const e = crudo ? JSON.parse(crudo) : null
                    if (!e || e.idTienda !== idT) {
                        if (e) sessionStorage.removeItem(CLAVE_STORAGE)
                        return
                    }
                    if (typeof e.filtroProv === "string") setFiltroProv(e.filtroProv)
                    if (e.proveedorSel?.idProveedor) setProveedorSel(e.proveedorSel)
                    if (typeof e.diasPedido === "string") setDiasPedido(e.diasPedido)
                    if (Array.isArray(e.articulos)) setArticulos(e.articulos)
                    if (e.pedidos && typeof e.pedidos === "object") setPedidos(e.pedidos)
                    if (e.consultado?.proveedor) setConsultado(e.consultado)
                } catch { /* estado guardado ilegible: se inicia limpio */ }
            })
            .catch(() => { /* sin identidad no hay persistencia ni alcance */ })
    }, [])

    // Guarda la consulta al cambiar (solo con la identidad ya validada, para
    // no pisar lo guardado con el estado vacío del primer render)
    useEffect(() => {
        if (!idTienda) return
        try {
            sessionStorage.setItem(CLAVE_STORAGE, JSON.stringify({
                idTienda, filtroProv, proveedorSel, diasPedido, articulos, pedidos, consultado,
            }))
        } catch { /* p.ej. cuota llena: la página sigue sin persistencia */ }
    }, [idTienda, filtroProv, proveedorSel, diasPedido, articulos, pedidos, consultado])

    // Contador de espera: el servicio recalcula el inventario y puede tardar minutos
    useEffect(() => {
        if (!cargando) return
        const intervalo = setInterval(() => setSegundos(s => s + 1), 1000)
        return () => clearInterval(intervalo)
    }, [cargando])

    const proveedoresFiltrados = useMemo(() => {
        // Con proveedor ya elegido el texto es su nombre: se muestra la lista completa
        const filtro = proveedorSel ? "" : filtroProv.trim().toLowerCase()
        const lista = filtro
            ? proveedores.filter(p => p.proveedor.toLowerCase().includes(filtro))
            : proveedores
        return { visibles: lista.slice(0, MAX_LISTA_PROVEEDORES), total: lista.length }
    }, [proveedores, filtroProv, proveedorSel])

    const elegirProveedor = (p: Proveedor) => {
        setProveedorSel(p)
        setFiltroProv(p.proveedor)
        setDiasPedido(String(p.diasPedido || 7))
        setListaAbierta(false)
    }

    const buscar = async () => {
        const dias = Number(diasPedido)
        if (!proveedorSel) { setError("Elige un proveedor"); return }
        if (!Number.isInteger(dias) || dias <= 0 || dias > 99) { setError("Captura los días de pedido (1 a 99)"); return }
        if (cargando) return

        setError("")
        setFiltroArticulos("")
        setSegundos(0)
        setCargando(true)
        try {
            const qs = new URLSearchParams({ idProveedor: String(proveedorSel.idProveedor), diasPedido: String(dias) })
            const res = await fetch(`/api/inventarios?${qs.toString()}`)
            if (res.status === 401) { window.location.href = "/login"; return }
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "Error al consultar el inventario")
            setArticulos(json.articulos)
            // Precarga el pedido con el sugerido del servicio; el usuario lo ajusta
            setPedidos(Object.fromEntries(
                (json.articulos as ArticuloInventario[])
                    .filter(a => a.pedidoSugerido > 0)
                    .map(a => [a.codigoInterno, String(a.pedidoSugerido)])
            ))
            setConsultado({ proveedor: proveedorSel.proveedor, dias, en: new Date().toISOString() })
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Error al consultar el inventario")
            setArticulos([])
            setConsultado(null)
        } finally {
            setCargando(false)
        }
    }

    const verMovimientos = async (articulo: ArticuloInventario) => {
        setMovArticulo(articulo)
        setMovimientos([])
        setCargandoMov(true)
        try {
            const qs = new URLSearchParams({
                codigoInterno: String(articulo.codigoInterno),
                idComputadora: String(articulo.idComputadora),
            })
            const res = await fetch(`/api/inventarios/movimientos?${qs.toString()}`)
            const json = await res.json()
            if (res.ok) setMovimientos(json.movimientos)
            else {
                setMovArticulo(null)
                setError(json.error || "Error al consultar los movimientos")
            }
        } catch {
            setMovArticulo(null)
            setError("Error al consultar los movimientos del artículo")
        } finally {
            setCargandoMov(false)
        }
    }

    // Export a Excel del detalle de movimientos, con el formato del portal
    const exportarMovimientos = async () => {
        if (!movArticulo || movimientos.length === 0) return
        const nombreTienda = tienda || await obtenerTiendaSesion()
        exportarExcel({
            titulo: "MOVIMIENTOS DE INVENTARIO",
            subtitulo: `${movArticulo.descripcion} · Código ${movArticulo.codigoBarras} · Existencia actual: ${fmtDec(movArticulo.exiActual)} ${movArticulo.medidaVenta} · ${fmtInt(movimientos.length)} movimientos`,
            tienda: nombreTienda,
            hoja: "Movimientos",
            nombreArchivo: `movimientos_${movArticulo.codigoBarras || movArticulo.codigoInterno}_${sufijoArchivo()}`,
            columnas: [
                { header: "Fecha" },
                { header: "Concepto" },
                { header: "Usuario" },
                { header: "Real", align: "right" },
                { header: "Equiv", align: "right" },
                { header: "Medida", align: "center" },
            ],
            filas: movimientos.map(m => [
                fmtFechaHora(m.fecha),
                m.concepto || "",
                m.usuario || "",
                m.mov,
                m.equiv,
                m.medidaVenta || "",
            ]),
        })
    }

    const articulosVisibles = useMemo(() => {
        const filtro = filtroArticulos.trim().toLowerCase()
        if (!filtro) return articulos
        return articulos.filter(a =>
            a.descripcion.toLowerCase().includes(filtro) || a.codigoBarras.includes(filtro)
        )
    }, [articulos, filtroArticulos])

    const resumen = useMemo(() => ({
        total: articulos.length,
        porPedir: articulos.filter(a => a.estatus === 0).length,
        exceso: articulos.filter(a => a.estatus === 1).length,
        agotados: articulos.filter(a => a.estatus === 2).length,
    }), [articulos])

    // Renglones del pedido: artículos con cantidad capturada mayor a cero
    const pedidoResumen = useMemo(() => {
        const lineas = articulos.filter(a => Number(pedidos[a.codigoInterno]) > 0)
        return {
            lineas,
            unidades: lineas.reduce((t, a) => t + Number(pedidos[a.codigoInterno]), 0),
        }
    }, [articulos, pedidos])

    // Export del pedido al proveedor: solo los renglones con cantidad a pedir
    const exportarPedido = async (formato: "pdf" | "excel") => {
        if (!consultado || pedidoResumen.lineas.length === 0) return
        setExportando(formato)
        try {
            const nombreTienda = tienda || await obtenerTiendaSesion()
            const base = {
                titulo: "PEDIDO A PROVEEDOR",
                subtitulo: `${consultado.proveedor} · ${fmtInt(pedidoResumen.lineas.length)} artículos · ${fmtInt(pedidoResumen.unidades)} unidades`,
                tienda: nombreTienda,
                columnas: [
                    { header: "Código" },
                    { header: "Descripción" },
                    { header: "Existencia", align: "right" as const },
                    { header: "PVD", align: "right" as const },
                    { header: "Cantidad", align: "right" as const },
                    { header: "Medida Compra" },
                ],
                nombreArchivo: `pedido_${sufijoArchivo()}`,
            }
            if (formato === "pdf") {
                exportarPdf({
                    ...base,
                    filas: pedidoResumen.lineas.map(a => [
                        a.codigoBarras, a.descripcion, fmtDec(a.exiActual), fmtDec(a.pvd),
                        String(Number(pedidos[a.codigoInterno])), a.medidaCompra,
                    ]),
                })
            } else {
                exportarExcel({
                    ...base,
                    hoja: "Pedido",
                    filas: pedidoResumen.lineas.map(a => [
                        a.codigoBarras, a.descripcion, a.exiActual, a.pvd,
                        Number(pedidos[a.codigoInterno]), a.medidaCompra,
                    ]),
                })
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Error al exportar el pedido")
        } finally {
            setExportando(null)
        }
    }

    // Contexto para el Análisis Profundo IA con los agregados de la consulta
    const contextoAnalisis: PageSummaryContext = useMemo(() => {
        const hoy = new Date().toLocaleDateString("sv-SE")
        const porPedir = articulos.filter(a => a.estatus === 0)
        const agotados = articulos.filter(a => a.estatus === 2)
        return {
            pageContext: consultado
                ? `Inventario del proveedor ${consultado.proveedor} (días de pedido: ${consultado.dias}). Estatus: Pedir = hay que resurtir, Agotado = quiebre con demanda creciente, Exceso = sobre-inventario.`
                : "Inventario por proveedor",
            period: { fechaInicio: hoy, fechaFin: hoy },
            scope: tienda || "Tienda de la sesión",
            kpis: {
                articulos: resumen.total,
                articulosPorPedir: resumen.porPedir,
                agotadosConDemanda: resumen.agotados,
                articulosConSobreInventario: resumen.exceso,
            },
            highlights: {
                topItems: [...porPedir]
                    .sort((a, b) => b.pedidoSugerido - a.pedidoSugerido)
                    .slice(0, 10)
                    .map(a => ({ name: `${a.descripcion} (pedido sugerido)`, value: a.pedidoSugerido })),
                anomalies: [
                    ...agotados.slice(0, 8).map(a =>
                        `${a.descripcion}: agotado con demanda creciente (vende ${fmtDec(a.pvd)}/día)`),
                    ...porPedir.slice(0, 7).map(a =>
                        `${a.descripcion}: quedan ${fmtDec(a.exiPara)} días de existencia, pedir ${a.pedido} ${a.medidaCompra}`),
                ],
            },
        }
    }, [articulos, consultado, resumen, tienda])

    const exportar = async (formato: "pdf" | "excel") => {
        if (!consultado) return
        setExportando(formato)
        try {
            const tienda = await obtenerTiendaSesion()
            const columnas = [
                { header: "Código" },
                { header: "Descripción" },
                { header: "Existencia", align: "right" as const },
                { header: "Para (días)", align: "right" as const },
                { header: "PVD", align: "right" as const },
                { header: "Medida Venta", align: "center" as const },
                { header: "Estatus", align: "center" as const },
                { header: "Pedido", align: "right" as const },
                { header: "Medida Compra" },
            ]
            const base = {
                titulo: "INVENTARIO",
                subtitulo: `${consultado.proveedor}  ·  Días pedido: ${consultado.dias}  ·  ${fmtInt(articulosVisibles.length)} artículos${filtroArticulos.trim() ? `  ·  Filtro: "${filtroArticulos.trim()}"` : ""}`,
                tienda,
                columnas,
                nombreArchivo: `inventario_${sufijoArchivo()}`,
            }
            const filas = articulosVisibles.map(a => [
                a.codigoBarras,
                a.descripcion,
                fmtDec(a.exiActual),
                fmtDec(a.exiPara),
                fmtDec(a.pvd),
                a.medidaVenta,
                ESTATUS[a.estatus]?.etiqueta ?? String(a.estatus),
                a.pedido,
                a.medidaCompra,
            ])
            if (formato === "pdf") {
                exportarPdf({ ...base, orientacion: "landscape", filas })
            } else {
                exportarExcel({ ...base, hoja: "Inventario", filas })
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
                    <h1 className="text-2xl font-black text-white uppercase tracking-tight">Inventarios por Proveedor</h1>
                    <p className="text-[12px] font-bold text-slate-500 mt-1">
                        {cargando
                            ? `Calculando inventario en la tienda... ${segundos}s`
                            : consultado
                                ? `${consultado.proveedor} · ${fmtInt(resumen.total)} artículos${consultado.en ? ` · consultado a las ${fmtHora(consultado.en)}` : ""}`
                                : "Existencias por proveedor de tu tienda"}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <BotonAnalisisProfundo
                        onClick={() => setAnalisisAbierto(true)}
                        disabled={cargando || articulos.length === 0}
                    />
                    <button
                        onClick={() => exportar("pdf")}
                        disabled={exportando !== null || cargando || articulosVisibles.length === 0}
                        className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 hover:text-rose-300 hover:border-rose-500/30 font-black text-[11px] uppercase tracking-widest transition-all disabled:opacity-40"
                        title="Imprimir a PDF"
                    >
                        {exportando === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                        PDF
                    </button>
                    <button
                        onClick={() => exportar("excel")}
                        disabled={exportando !== null || cargando || articulosVisibles.length === 0}
                        className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 hover:text-emerald-300 hover:border-emerald-500/30 font-black text-[11px] uppercase tracking-widest transition-all disabled:opacity-40"
                        title="Exportar a Excel"
                    >
                        {exportando === "excel" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                        Excel
                    </button>
                </div>
            </div>

            {/* Filtros: relative z-20 para que el drilldown de proveedores se pinte
                encima del resumen y la tabla (cada tarjeta con backdrop-blur crea su
                propio stacking context y atraparía el z-index de la lista) */}
            <div className="relative z-20 bg-white/[0.04] border border-white/10 rounded-2xl p-4 backdrop-blur-xl">
                <div className="flex flex-wrap gap-3 items-end">
                    <div className="flex-1 min-w-[260px] relative">
                        <span className={lbl}>Proveedor</span>
                        <div className="relative mt-1">
                            <input
                                ref={provInputRef}
                                type="text"
                                placeholder={cargandoProveedores ? "Cargando proveedores..." : "Escribe para buscar el proveedor"}
                                disabled={cargandoProveedores}
                                className={cn(inputCls, "pr-10")}
                                value={filtroProv}
                                onChange={e => {
                                    setFiltroProv(e.target.value)
                                    setProveedorSel(null)
                                    setListaAbierta(true)
                                }}
                                onFocus={() => setListaAbierta(true)}
                                onBlur={() => setListaAbierta(false)}
                                onKeyDown={e => {
                                    if (e.key === "Escape") setListaAbierta(false)
                                    if (e.key === "Enter" && proveedoresFiltrados.visibles.length === 1) {
                                        elegirProveedor(proveedoresFiltrados.visibles[0])
                                    }
                                }}
                            />
                            <button
                                onMouseDown={e => e.preventDefault()}
                                onClick={() => { setListaAbierta(v => !v); provInputRef.current?.focus() }}
                                className="absolute top-1/2 -translate-y-1/2 right-2 p-1.5 rounded-lg text-slate-500 hover:text-white transition-all"
                                aria-label="Ver todos los proveedores"
                            >
                                <ChevronDown className={cn("h-4 w-4 transition-transform", listaAbierta && "rotate-180")} />
                            </button>
                        </div>
                        {listaAbierta && !cargandoProveedores && (
                            <div className="absolute z-30 mt-1 w-full max-h-64 overflow-y-auto rounded-xl bg-[#0d1320] border border-white/10 shadow-2xl shadow-black/60">
                                {proveedoresFiltrados.visibles.length === 0 ? (
                                    <p className="px-4 py-3 text-[12px] font-bold text-slate-500">Sin proveedores que coincidan</p>
                                ) : (
                                    <>
                                        {proveedoresFiltrados.visibles.map(p => (
                                            <button
                                                key={p.idProveedor}
                                                onMouseDown={e => e.preventDefault()}
                                                onClick={() => elegirProveedor(p)}
                                                className={cn(
                                                    "w-full text-left px-4 py-2 text-[13px] font-bold transition-colors flex items-center justify-between gap-2",
                                                    proveedorSel?.idProveedor === p.idProveedor
                                                        ? "bg-emerald-500/15 text-emerald-300"
                                                        : "text-slate-300 hover:bg-white/[0.06] hover:text-white"
                                                )}
                                            >
                                                <span className="truncate">{p.proveedor}</span>
                                                <span className="shrink-0 text-[10px] font-black text-slate-600">{p.diasPedido || "—"} d</span>
                                            </button>
                                        ))}
                                        {proveedoresFiltrados.total > MAX_LISTA_PROVEEDORES && (
                                            <p className="px-4 py-2 text-[10px] font-black text-slate-600 uppercase tracking-widest border-t border-white/[0.06]">
                                                {fmtInt(proveedoresFiltrados.total - MAX_LISTA_PROVEEDORES)} más — afina la búsqueda
                                            </p>
                                        )}
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="w-32">
                        <span className={lbl}>Días Pedido</span>
                        <input
                            type="number"
                            min={1}
                            max={99}
                            className={cn(inputCls, "mt-1")}
                            value={diasPedido}
                            onChange={e => setDiasPedido(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && buscar()}
                        />
                    </div>

                    <button
                        onClick={buscar}
                        disabled={cargando || cargandoProveedores}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 text-slate-950 font-black text-[11px] uppercase tracking-widest hover:brightness-110 transition-all disabled:opacity-40"
                    >
                        {cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                        Buscar
                    </button>

                    {consultado && !cargando && (
                        <div className="relative flex-1 min-w-[220px]">
                            <Search className="absolute top-1/2 -translate-y-1/2 left-3.5 h-4 w-4 text-slate-500" />
                            <input
                                type="text"
                                placeholder="FILTRAR ARTÍCULOS DEL RESULTADO"
                                className={cn(inputCls, "pl-10")}
                                value={filtroArticulos}
                                onChange={e => setFiltroArticulos(e.target.value)}
                            />
                        </div>
                    )}
                </div>
            </div>

            {/* Resumen */}
            {consultado && !cargando && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {[
                        { titulo: "Artículos", valor: fmtInt(resumen.total), color: "text-white" },
                        { titulo: "Por Pedir", valor: fmtInt(resumen.porPedir), color: resumen.porPedir > 0 ? "text-amber-300" : "text-slate-500" },
                        { titulo: "Agotados con Demanda", valor: fmtInt(resumen.agotados), color: resumen.agotados > 0 ? "text-rose-300" : "text-slate-500" },
                        { titulo: "Sobre-inventario", valor: fmtInt(resumen.exceso), color: resumen.exceso > 0 ? "text-rose-300" : "text-slate-500" },
                    ].map(c => (
                        <div key={c.titulo} className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 backdrop-blur-xl">
                            <p className={lbl}>{c.titulo}</p>
                            <p className={cn("text-lg font-black mt-1", c.color)}>{c.valor}</p>
                        </div>
                    ))}
                </div>
            )}

            {/* Pedido armado: renglones con cantidad a pedir capturada */}
            {consultado && !cargando && pedidoResumen.lineas.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3 bg-amber-500/[0.06] border border-amber-500/25 rounded-2xl px-4 py-3 backdrop-blur-xl">
                    <p className="text-[12px] font-black text-amber-300 uppercase tracking-widest">
                        🛒 Pedido: {fmtInt(pedidoResumen.lineas.length)} artículo{pedidoResumen.lineas.length > 1 ? "s" : ""} · {fmtInt(pedidoResumen.unidades)} unidades
                    </p>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => exportarPedido("pdf")}
                            disabled={exportando !== null}
                            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 hover:text-rose-300 hover:border-rose-500/30 font-black text-[11px] uppercase tracking-widest transition-all disabled:opacity-40"
                            title="Imprimir el pedido a PDF"
                        >
                            <FileText className="h-4 w-4" /> Pedido PDF
                        </button>
                        <button
                            onClick={() => exportarPedido("excel")}
                            disabled={exportando !== null}
                            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 hover:text-emerald-300 hover:border-emerald-500/30 font-black text-[11px] uppercase tracking-widest transition-all disabled:opacity-40"
                            title="Exportar el pedido a Excel"
                        >
                            <FileSpreadsheet className="h-4 w-4" /> Pedido Excel
                        </button>
                    </div>
                </div>
            )}

            {error && (
                <div className="flex items-center gap-2 text-rose-300 text-[11px] font-black bg-rose-500/10 p-3 rounded-xl border border-rose-500/25 uppercase tracking-wider">
                    <AlertTriangle className="h-4 w-4" /> {error}
                </div>
            )}

            {/* Tabla */}
            <div className="bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl overflow-hidden">
                {cargando ? (
                    <div className="flex flex-col items-center justify-center py-24 gap-4">
                        <Loader2 className="h-7 w-7 text-emerald-400 animate-spin" />
                        <div className="text-center">
                            <p className="text-[12px] font-bold text-slate-400 uppercase tracking-widest">
                                Calculando inventario en la tienda... {segundos}s
                            </p>
                            <p className="text-[11px] font-bold text-slate-600 mt-1">
                                El servicio suma recibos, ventas, transferencias y ajustes — puede tardar hasta 2 minutos
                            </p>
                        </div>
                    </div>
                ) : !consultado ? (
                    <div className="flex flex-col items-center justify-center py-24 gap-3">
                        <Boxes className="h-8 w-8 text-slate-700" />
                        <p className="text-[12px] font-bold text-slate-600 uppercase tracking-widest">
                            Elige un proveedor y presiona Buscar
                        </p>
                    </div>
                ) : articulosVisibles.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-24 gap-3">
                        <Boxes className="h-8 w-8 text-slate-700" />
                        <p className="text-[12px] font-bold text-slate-600 uppercase tracking-widest">
                            {articulos.length === 0 ? "Sin artículos para el proveedor" : "Sin artículos que coincidan con el filtro"}
                        </p>
                    </div>
                ) : (
                    <div className="overflow-auto max-h-[calc(100vh-24rem)]">
                        <table className="w-full">
                            <thead className="sticky top-0 z-10 bg-[#10151f] shadow-[0_1px_0_rgba(255,255,255,0.08)]">
                                <tr>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Código</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Descripción</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Existencia</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Para</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-right")} title="Promedio de venta diaria">PVD</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-center")}>Medida Venta</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-center")}>Estatus</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Pedido</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>A Pedir</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Medida Compra</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/[0.04]">
                                {articulosVisibles.map(a => {
                                    const estatus = ESTATUS[a.estatus] ?? ESTATUS[4]
                                    return (
                                        <tr
                                            key={`${a.codigoInterno}-${a.codigoBarras}`}
                                            onClick={() => verMovimientos(a)}
                                            className="cursor-pointer transition-colors hover:bg-white/[0.03]"
                                            title="Ver movimientos del artículo"
                                        >
                                            <td className="px-4 py-2.5 text-[12px] font-black text-cyan-300 whitespace-nowrap">{a.codigoBarras}</td>
                                            <td className="px-4 py-2.5 text-[13px] font-bold text-slate-200 max-w-[280px] truncate" title={a.descripcion}>
                                                {a.descripcion}
                                            </td>
                                            <td className={cn(
                                                "px-4 py-2.5 text-[13px] font-black text-right whitespace-nowrap",
                                                a.exiActual <= 0 ? "text-rose-300" : "text-slate-100"
                                            )}>
                                                {fmtDec(a.exiActual)}
                                            </td>
                                            <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 text-right whitespace-nowrap">
                                                {fmtDec(a.exiPara)} días
                                            </td>
                                            <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 text-right whitespace-nowrap">{fmtDec(a.pvd)}</td>
                                            <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 text-center whitespace-nowrap">{a.medidaVenta || "—"}</td>
                                            <td className="px-4 py-2.5 text-center whitespace-nowrap">
                                                <span
                                                    className={cn("text-[10px] font-black rounded-md px-2 py-0.5 border uppercase", estatus.cls)}
                                                    title={estatus.titulo}
                                                >
                                                    {estatus.etiqueta}
                                                </span>
                                            </td>
                                            <td className={cn(
                                                "px-4 py-2.5 text-[13px] font-black text-right whitespace-nowrap",
                                                a.pedidoSugerido > 0 ? "text-amber-300" : "text-slate-500"
                                            )}
                                                title={a.pedidoTransito > 0 ? `${a.pedidoTransito} en tránsito` : ""}
                                            >
                                                {a.pedido || "—"}
                                            </td>
                                            {/* La celda no abre el modal de movimientos: aquí se captura el pedido */}
                                            <td className="px-4 py-2.5 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                                                <input
                                                    type="number"
                                                    min={0}
                                                    placeholder="0"
                                                    className="w-20 px-2 py-1.5 bg-white/[0.03] border border-white/10 rounded-lg text-[13px] font-black text-amber-200 text-right focus:outline-none focus:ring-2 focus:ring-amber-400/25 focus:border-amber-400/60 transition-all"
                                                    value={pedidos[a.codigoInterno] ?? ""}
                                                    onChange={e => setPedidos(prev => ({ ...prev, [a.codigoInterno]: e.target.value }))}
                                                />
                                            </td>
                                            <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 whitespace-nowrap">{a.medidaCompra || "—"}</td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Modal de movimientos */}
            {movArticulo && (
                <div
                    className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
                    onClick={() => setMovArticulo(null)}
                >
                    <div
                        className="w-full max-w-5xl max-h-[85vh] bg-[#0d1320] border border-white/10 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden flex flex-col"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="px-6 py-4 border-b border-white/10 flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <h3 className="text-[15px] font-black text-white truncate">
                                    Movimientos — {movArticulo.descripcion}
                                </h3>
                                <p className="text-[12px] font-bold text-slate-400 mt-1">
                                    Código {movArticulo.codigoBarras} · Existencia actual: {fmtDec(movArticulo.exiActual)} {movArticulo.medidaVenta}
                                </p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                <button
                                    onClick={exportarMovimientos}
                                    disabled={cargandoMov || movimientos.length === 0}
                                    className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 hover:text-emerald-300 hover:border-emerald-500/30 font-black text-[11px] uppercase tracking-widest transition-all disabled:opacity-40"
                                    title="Exportar movimientos a Excel"
                                >
                                    <FileSpreadsheet className="h-4 w-4" />
                                    <span className="hidden sm:inline">Excel</span>
                                </button>
                                <button
                                    onClick={() => setMovArticulo(null)}
                                    className="p-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-400 hover:text-white transition-all"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                        </div>

                        {cargandoMov ? (
                            <div className="flex items-center justify-center py-24">
                                <Loader2 className="h-7 w-7 text-emerald-400 animate-spin" />
                            </div>
                        ) : movimientos.length === 0 ? (
                            <div className="flex items-center justify-center py-16">
                                <p className="text-[12px] font-bold text-slate-600 uppercase tracking-widest">
                                    Sin movimientos registrados para el artículo
                                </p>
                            </div>
                        ) : (
                            <>
                                <div ref={movContenedorRef} className="overflow-auto flex-1">
                                    <table className="w-full">
                                        <thead className="sticky top-0 z-10 bg-[#141a28]">
                                            <tr>
                                                <th className={cn(lbl, "px-4 py-2.5 text-left")}>Fecha</th>
                                                <th className={cn(lbl, "px-4 py-2.5 text-left")}>Concepto</th>
                                                <th className={cn(lbl, "px-4 py-2.5 text-left")}>Usuario</th>
                                                <th className={cn(lbl, "px-4 py-2.5 text-right")}>Real</th>
                                                <th className={cn(lbl, "px-4 py-2.5 text-right")}>Equiv</th>
                                                <th className={cn(lbl, "px-4 py-2.5 text-center")}>Medida</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/[0.04]">
                                            {movimientos.map((m, i) => (
                                                <tr key={i} className="hover:bg-white/[0.03]">
                                                    <td className="px-4 py-2 text-[12px] font-bold text-slate-400 whitespace-nowrap">{fmtFechaHora(m.fecha)}</td>
                                                    <td className="px-4 py-2 text-[12px] font-bold text-slate-300 max-w-[320px] truncate" title={m.concepto}>
                                                        {m.concepto || "—"}
                                                    </td>
                                                    <td className="px-4 py-2 text-[12px] font-bold text-slate-500 whitespace-nowrap">{m.usuario || "—"}</td>
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
                                                    <td className="px-4 py-2 text-[12px] font-bold text-slate-400 text-center whitespace-nowrap">{m.medidaVenta || "—"}</td>
                                                </tr>
                                            ))}
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
            )}

            <AnalisisProfundoModal
                open={analisisAbierto}
                onClose={() => setAnalisisAbierto(false)}
                context={contextoAnalisis}
            />
        </div>
    )
}
