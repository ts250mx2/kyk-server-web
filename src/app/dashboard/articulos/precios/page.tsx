"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
    Search, ScanBarcode, Loader2, ChevronLeft, ChevronRight,
    CalendarClock, Package, Truck, Star, AlertTriangle, ListRestart,
    FileText, FileSpreadsheet
} from "lucide-react"
import { cn } from "@/lib/utils"
import { fmtMoney, fmtInt, fmtFechaHora, fmtPct } from "@/lib/format"
import { exportarPdf, exportarExcel, obtenerTiendaSesion, sufijoArchivo } from "@/lib/export"

const PAGE_SIZE = 50

interface ArticuloItem {
    codigoInterno: number
    codigoBarras: string
    descripcion: string
    precio: number
    precioOferta: number
    idTipo: number
    eliminado: boolean
}

type EstadoFiltro = "activos" | "eliminados" | "todos"

const ESTADO_LABELS: Record<EstadoFiltro, string> = {
    activos: "Activos",
    eliminados: "Eliminados",
    todos: "Todos",
}

interface Mayoreo { escala: number; descuento: number; precioDesc: number }

interface ArticuloDetalle {
    articulo: {
        codigoInterno: number
        codigoBarras: string
        descripcion: string
        idTipo: number
        unidad: string
        eliminado: boolean
        precio: number
        iva: number
        ieps: number
        precioOferta: number
        ofertaPublica: { precio: number; fechaInicio: string; fechaFin: string } | null
        ultimaActualizacion: string | null
        categoria: string
        familia: string
        medidaVenta: string
        proveedorDefault: string | null
        mayoreo: Mayoreo[]
    }
    proveedores: {
        idProveedor: number
        proveedor: string
        esDefault: boolean
        costoCaja: number
        cantidadCaja: number
        costoUnitario: number
        descuentos: number[]
        costoReal: number
        cambioCosto: string | null
        codigoCompra: string
        descripcionCompra: string
    }[]
}

interface ProveedorOption { idProveedor: number; proveedor: string }

interface Filtros {
    busqueda?: string
    codigoBarras?: string
    idProveedor?: number
    cambiosDesde?: string
}

const lbl = "text-[10px] font-black text-slate-500 uppercase tracking-widest"
const box = "bg-white/[0.03] border border-white/10 rounded-xl p-3"
const inputCls = "block w-full px-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-400/25 focus:border-emerald-400/60 transition-all"

export default function ArticulosPage() {
    // Filtros y listado
    const [modo, setModo] = useState<"articulo" | "proveedor">("articulo")
    const [busqueda, setBusqueda] = useState("")
    const [codigoBarras, setCodigoBarras] = useState("")
    const [cambiosDesde, setCambiosDesde] = useState("")
    const [idProveedor, setIdProveedor] = useState("")
    const [proveedores, setProveedores] = useState<ProveedorOption[]>([])
    const [estadoFiltro, setEstadoFiltro] = useState<EstadoFiltro>("activos")
    const [filtros, setFiltros] = useState<Filtros>({})
    const [page, setPage] = useState(1)
    const [items, setItems] = useState<ArticuloItem[]>([])
    const [total, setTotal] = useState(0)
    const [loadingList, setLoadingList] = useState(true)
    const [error, setError] = useState("")

    // Detalle
    const [seleccion, setSeleccion] = useState<number | null>(null)
    const [detalle, setDetalle] = useState<ArticuloDetalle | null>(null)
    const [loadingDetalle, setLoadingDetalle] = useState(false)
    const [tab, setTab] = useState<"venta" | "compra">("venta")
    const [provSel, setProvSel] = useState(0)
    const [exportando, setExportando] = useState<"pdf" | "excel" | null>(null)

    const barcodeRef = useRef<HTMLInputElement>(null)

    const cargarLista = useCallback(async (f: Filtros, pagina: number, estado: EstadoFiltro) => {
        setLoadingList(true)
        setError("")
        try {
            const qs = new URLSearchParams()
            if (f.busqueda) qs.set("busqueda", f.busqueda)
            if (f.codigoBarras) qs.set("codigoBarras", f.codigoBarras)
            if (f.idProveedor) qs.set("idProveedor", String(f.idProveedor))
            if (f.cambiosDesde) qs.set("cambiosDesde", f.cambiosDesde)
            qs.set("estado", estado)
            qs.set("page", String(pagina))
            qs.set("pageSize", String(PAGE_SIZE))

            const res = await fetch(`/api/articulos?${qs.toString()}`)
            if (res.status === 401) { window.location.href = "/login"; return }
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "Error al consultar artículos")

            setItems(json.items)
            setTotal(json.total)
            setSeleccion(json.items.length > 0 ? json.items[0].codigoInterno : null)
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Error desconocido")
            setItems([])
            setTotal(0)
            setSeleccion(null)
        } finally {
            setLoadingList(false)
        }
    }, [])

    // Carga inicial: todos los artículos activos + catálogo de proveedores
    useEffect(() => {
        cargarLista({}, 1, "activos")
        const cargarProveedores = async () => {
            try {
                const res = await fetch("/api/articulos/proveedores")
                const json = await res.json()
                if (res.ok) setProveedores(json.proveedores)
            } catch {
                // el filtro por proveedor queda deshabilitado si falla
            }
        }
        cargarProveedores()
    }, [cargarLista])

    // Cargar detalle al cambiar la selección
    useEffect(() => {
        if (seleccion === null) { setDetalle(null); return }
        let cancelado = false
        const cargar = async () => {
            setLoadingDetalle(true)
            try {
                const res = await fetch(`/api/articulos/${seleccion}`)
                const json = await res.json()
                if (!cancelado && res.ok) {
                    setDetalle(json)
                    setProvSel(0)
                }
            } catch {
                if (!cancelado) setDetalle(null)
            } finally {
                if (!cancelado) setLoadingDetalle(false)
            }
        }
        cargar()
        return () => { cancelado = true }
    }, [seleccion])

    const aplicarFiltros = (f: Filtros) => {
        setFiltros(f)
        setPage(1)
        cargarLista(f, 1, estadoFiltro)
    }

    const cambiarEstado = (e: EstadoFiltro) => {
        setEstadoFiltro(e)
        setPage(1)
        cargarLista(filtros, 1, e)
    }

    const buscarTexto = () => aplicarFiltros({ busqueda: busqueda.trim() || undefined })
    const verTodos = () => {
        setBusqueda(""); setCodigoBarras(""); setCambiosDesde(""); setIdProveedor("")
        aplicarFiltros({})
    }
    const buscarCodigoBarras = () => {
        if (!codigoBarras.trim()) return
        aplicarFiltros({ codigoBarras: codigoBarras.trim() })
        barcodeRef.current?.select()
    }
    const buscarProveedor = (id: string) => {
        setIdProveedor(id)
        if (id) aplicarFiltros({ idProveedor: Number(id) })
    }
    const verCambios = () => {
        if (cambiosDesde) aplicarFiltros({ cambiosDesde })
    }

    const cambiarPagina = (nueva: number) => {
        setPage(nueva)
        cargarLista(filtros, nueva, estadoFiltro)
    }

    const totalPaginas = Math.max(1, Math.ceil(total / PAGE_SIZE))
    const art = detalle?.articulo
    const prov = detalle?.proveedores[provSel]

    // Descripción del filtro activo para el encabezado del reporte
    const descripcionFiltro = (): string => {
        if (filtros.codigoBarras) return `Código: ${filtros.codigoBarras}`
        if (filtros.busqueda) return `Búsqueda: "${filtros.busqueda}"`
        if (filtros.idProveedor) {
            const p = proveedores.find(x => x.idProveedor === filtros.idProveedor)
            return `Proveedor: ${p?.proveedor ?? filtros.idProveedor}`
        }
        if (filtros.cambiosDesde) return `Cambios a partir de ${filtros.cambiosDesde}`
        return "Todos los artículos"
    }

    // Exporta el resultado COMPLETO del filtro activo (no solo la página visible)
    const exportar = async (formato: "pdf" | "excel") => {
        setExportando(formato)
        try {
            const qs = new URLSearchParams()
            if (filtros.busqueda) qs.set("busqueda", filtros.busqueda)
            if (filtros.codigoBarras) qs.set("codigoBarras", filtros.codigoBarras)
            if (filtros.idProveedor) qs.set("idProveedor", String(filtros.idProveedor))
            if (filtros.cambiosDesde) qs.set("cambiosDesde", filtros.cambiosDesde)
            qs.set("estado", estadoFiltro)
            qs.set("page", "1")
            qs.set("pageSize", "20000")

            const res = await fetch(`/api/articulos?${qs.toString()}`)
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "Error al exportar")

            const todos: ArticuloItem[] = json.items
            const tienda = await obtenerTiendaSesion()
            const incluirEstado = estadoFiltro !== "activos"
            const columnas = [
                { header: "Código de Barras" },
                { header: "Descripción" },
                { header: "Unidad", align: "center" as const },
                { header: "Precio", align: "right" as const },
                { header: "Oferta", align: "right" as const },
                ...(incluirEstado ? [{ header: "Estado", align: "center" as const }] : []),
            ]
            const base = {
                titulo: "REPORTE DE PRECIOS",
                subtitulo: `${descripcionFiltro()}  ·  ${ESTADO_LABELS[estadoFiltro]}  ·  ${fmtInt(todos.length)} artículos`,
                tienda,
                columnas,
                nombreArchivo: `precios_${sufijoArchivo()}`,
            }
            const colEstado = (a: ArticuloItem) => (incluirEstado ? [a.eliminado ? "ELIMINADO" : "Activo"] : [])

            if (formato === "pdf") {
                exportarPdf({
                    ...base,
                    filas: todos.map(a => [
                        String(a.codigoBarras),
                        String(a.descripcion),
                        a.idTipo === 2 ? "Kg" : "Pzs",
                        fmtMoney(a.precio),
                        a.precioOferta > 0 ? fmtMoney(a.precioOferta) : "—",
                        ...colEstado(a),
                    ]),
                })
            } else {
                exportarExcel({
                    ...base,
                    hoja: "Precios",
                    columnasMoneda: [3, 4],
                    filas: todos.map(a => [
                        String(a.codigoBarras),
                        String(a.descripcion),
                        a.idTipo === 2 ? "Kg" : "Pzs",
                        a.precio,
                        a.precioOferta > 0 ? a.precioOferta : "",
                        ...colEstado(a),
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
                    <h1 className="text-2xl font-black text-white uppercase tracking-tight">Catálogo de Artículos</h1>
                    <p className="text-[12px] font-bold text-slate-500 mt-1">
                        {loadingList ? "Consultando..." : `${fmtInt(total)} registros`}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {/* Exportar */}
                    <button
                        onClick={() => exportar("pdf")}
                        disabled={exportando !== null || loadingList || total === 0}
                        className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 hover:text-rose-300 hover:border-rose-500/30 font-black text-[11px] uppercase tracking-widest transition-all disabled:opacity-40"
                        title="Imprimir a PDF"
                    >
                        {exportando === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                        PDF
                    </button>
                    <button
                        onClick={() => exportar("excel")}
                        disabled={exportando !== null || loadingList || total === 0}
                        className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 hover:text-emerald-300 hover:border-emerald-500/30 font-black text-[11px] uppercase tracking-widest transition-all disabled:opacity-40"
                        title="Exportar a Excel"
                    >
                        {exportando === "excel" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                        Excel
                    </button>

                    {/* Modo de búsqueda: Artículo / Proveedor */}
                    <div className="flex items-center rounded-xl bg-white/[0.04] border border-white/10 p-1">
                        {(["articulo", "proveedor"] as const).map(m => (
                            <button
                                key={m}
                                onClick={() => setModo(m)}
                                className={cn(
                                    "px-4 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all",
                                    modo === m ? "bg-emerald-500 text-slate-950" : "text-slate-400 hover:text-white"
                                )}
                            >
                                {m === "articulo" ? "Artículo" : "Proveedor"}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Barra de búsqueda */}
            <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 backdrop-blur-xl space-y-3">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {modo === "articulo" ? (
                        <div className="flex gap-2">
                            <div className="relative flex-1">
                                <Search className="absolute top-1/2 -translate-y-1/2 left-3.5 h-4 w-4 text-slate-500" />
                                <input
                                    type="text"
                                    placeholder="BUSCAR POR DESCRIPCIÓN..."
                                    className={cn(inputCls, "pl-10")}
                                    value={busqueda}
                                    onChange={e => setBusqueda(e.target.value)}
                                    onKeyDown={e => e.key === "Enter" && buscarTexto()}
                                />
                            </div>
                            <button
                                onClick={buscarTexto}
                                className="px-4 py-2.5 rounded-xl bg-emerald-500 text-slate-950 font-black text-[11px] uppercase tracking-widest hover:brightness-110 transition-all"
                                title="Buscar"
                            >
                                <Search className="h-4 w-4" />
                            </button>
                            <button
                                onClick={verTodos}
                                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 hover:text-emerald-300 hover:border-emerald-500/30 font-black text-[11px] uppercase tracking-widest transition-all"
                                title="Ver todos"
                            >
                                <ListRestart className="h-4 w-4" />
                                <span className="hidden sm:inline">Ver todos</span>
                            </button>
                        </div>
                    ) : (
                        <div className="relative">
                            <Truck className="absolute top-1/2 -translate-y-1/2 left-3.5 h-4 w-4 text-slate-500 pointer-events-none" />
                            <select
                                className={cn(inputCls, "pl-10 appearance-none [color-scheme:dark]")}
                                value={idProveedor}
                                onChange={e => buscarProveedor(e.target.value)}
                            >
                                <option value="" className="bg-[#0b1220]">SELECCIONA UN PROVEEDOR...</option>
                                {proveedores.map(p => (
                                    <option key={p.idProveedor} value={p.idProveedor} className="bg-[#0b1220]">
                                        {p.proveedor}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div className="flex gap-2">
                        <div className="relative flex-1">
                            <ScanBarcode className="absolute top-1/2 -translate-y-1/2 left-3.5 h-4 w-4 text-slate-500" />
                            <input
                                ref={barcodeRef}
                                type="text"
                                placeholder="CÓDIGO DE BARRAS (ENTER)"
                                className={cn(inputCls, "pl-10")}
                                value={codigoBarras}
                                onChange={e => setCodigoBarras(e.target.value)}
                                onKeyDown={e => e.key === "Enter" && buscarCodigoBarras()}
                            />
                        </div>
                        <div className="relative">
                            <CalendarClock className="absolute top-1/2 -translate-y-1/2 left-3 h-4 w-4 text-slate-500 pointer-events-none" />
                            <input
                                type="date"
                                className={cn(inputCls, "pl-9 [color-scheme:dark] w-40")}
                                value={cambiosDesde}
                                onChange={e => setCambiosDesde(e.target.value)}
                                title="Ver cambios a partir de"
                            />
                        </div>
                        <button
                            onClick={verCambios}
                            disabled={!cambiosDesde}
                            className="px-3 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 hover:text-emerald-300 hover:border-emerald-500/30 font-black text-[10px] uppercase tracking-widest transition-all disabled:opacity-40 whitespace-nowrap"
                        >
                            Ver cambios
                        </button>
                    </div>
                </div>

                {/* Filtro por estado del artículo (Status = 2 → eliminado) */}
                <div className="flex items-center gap-2 mt-3">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Estado:</span>
                    <div className="flex items-center rounded-xl bg-white/[0.03] border border-white/10 p-1">
                        {(["activos", "eliminados", "todos"] as const).map(e => (
                            <button
                                key={e}
                                onClick={() => cambiarEstado(e)}
                                className={cn(
                                    "px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                                    estadoFiltro === e
                                        ? e === "eliminados"
                                            ? "bg-rose-500 text-white"
                                            : "bg-emerald-500 text-slate-950"
                                        : "text-slate-400 hover:text-white"
                                )}
                            >
                                {ESTADO_LABELS[e]}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {error && (
                <div className="flex items-center gap-2 text-rose-300 text-[11px] font-black bg-rose-500/10 p-3 rounded-xl border border-rose-500/25 uppercase tracking-wider">
                    <AlertTriangle className="h-4 w-4" /> {error}
                </div>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
                {/* Grid de artículos */}
                <div className="xl:col-span-7 bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl overflow-hidden">
                    {loadingList ? (
                        <div className="flex items-center justify-center py-24">
                            <Loader2 className="h-7 w-7 text-emerald-400 animate-spin" />
                        </div>
                    ) : items.length === 0 ? (
                        <p className="py-24 text-center text-[12px] font-bold text-slate-600 uppercase tracking-widest">
                            Sin artículos con ese criterio
                        </p>
                    ) : (
                        <div className="overflow-auto max-h-[55vh] xl:max-h-[calc(100vh-20rem)]">
                            <table className="w-full">
                                <thead className="sticky top-0 z-10 bg-[#10151f] shadow-[0_1px_0_rgba(255,255,255,0.08)]">
                                    <tr>
                                        <th className={cn(lbl, "px-4 py-2.5 text-left")}>Código de Barras</th>
                                        <th className={cn(lbl, "px-4 py-2.5 text-left")}>Descripción</th>
                                        <th className={cn(lbl, "px-4 py-2.5 text-right")}>Precio</th>
                                        <th className={cn(lbl, "px-4 py-2.5 text-right")}>Oferta</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/[0.04]">
                                    {items.map(a => (
                                        <tr
                                            key={a.codigoInterno}
                                            onClick={() => setSeleccion(a.codigoInterno)}
                                            className={cn(
                                                "cursor-pointer transition-colors",
                                                seleccion === a.codigoInterno
                                                    ? "bg-emerald-500/15"
                                                    : "hover:bg-white/[0.03]"
                                            )}
                                        >
                                            <td className={cn(
                                                "px-4 py-2.5 text-[12px] font-bold whitespace-nowrap",
                                                a.eliminado ? "text-slate-600" : "text-slate-400"
                                            )}>{a.codigoBarras}</td>
                                            <td className={cn(
                                                "px-4 py-2.5 text-[13px] font-bold",
                                                a.eliminado
                                                    ? "text-slate-500 line-through decoration-rose-500/50"
                                                    : seleccion === a.codigoInterno ? "text-emerald-300" : "text-slate-200"
                                            )}>
                                                {a.descripcion}
                                                {a.eliminado && (
                                                    <span className="ml-2 no-underline inline-block text-[9px] font-black text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-md px-1.5 py-0.5 uppercase align-middle">
                                                        Eliminado
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-4 py-2.5 text-[13px] font-bold text-slate-200 text-right whitespace-nowrap">{fmtMoney(a.precio)}</td>
                                            <td className={cn(
                                                "px-4 py-2.5 text-[13px] font-bold text-right whitespace-nowrap",
                                                a.precioOferta > 0 ? "text-amber-300" : "text-slate-600"
                                            )}>{a.precioOferta > 0 ? fmtMoney(a.precioOferta) : "—"}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Paginación */}
                    {total > PAGE_SIZE && (
                        <div className="flex items-center justify-between px-4 py-3 border-t border-white/[0.06]">
                            <button
                                onClick={() => cambiarPagina(page - 1)}
                                disabled={page <= 1 || loadingList}
                                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/[0.05] border border-white/10 text-slate-300 text-[11px] font-black uppercase tracking-widest disabled:opacity-40 hover:text-emerald-300 transition-all"
                            >
                                <ChevronLeft className="h-3.5 w-3.5" /> Anterior
                            </button>
                            <span className={lbl}>
                                Página {fmtInt(page)} de {fmtInt(totalPaginas)}
                            </span>
                            <button
                                onClick={() => cambiarPagina(page + 1)}
                                disabled={page >= totalPaginas || loadingList}
                                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/[0.05] border border-white/10 text-slate-300 text-[11px] font-black uppercase tracking-widest disabled:opacity-40 hover:text-emerald-300 transition-all"
                            >
                                Siguiente <ChevronRight className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    )}
                </div>

                {/* Detalle del artículo — fijo al hacer scroll para no perder los tabs Venta/Compra */}
                <div className="xl:col-span-5 xl:sticky xl:top-20 bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl overflow-hidden xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto">
                    {loadingDetalle ? (
                        <div className="flex items-center justify-center py-24">
                            <Loader2 className="h-6 w-6 text-emerald-400 animate-spin" />
                        </div>
                    ) : !art ? (
                        <div className="flex flex-col items-center justify-center py-24 gap-3">
                            <Package className="h-8 w-8 text-slate-700" />
                            <p className="text-[12px] font-bold text-slate-600 uppercase tracking-widest">
                                Selecciona un artículo
                            </p>
                        </div>
                    ) : (
                        <>
                            {/* Encabezado del artículo */}
                            <div className="px-5 py-4 border-b border-white/[0.06]">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <h3 className="text-[15px] font-black text-white leading-tight">{art.descripcion}</h3>
                                        <p className="text-[11px] font-bold text-slate-500 mt-1 flex items-center gap-2">
                                            <ScanBarcode className="h-3.5 w-3.5" /> {art.codigoBarras}
                                        </p>
                                    </div>
                                    <div className="shrink-0 flex flex-col items-end gap-1">
                                        <span className="text-[10px] font-black text-cyan-300 bg-cyan-500/10 border border-cyan-500/25 rounded-md px-2 py-1 uppercase">
                                            {art.unidad}
                                        </span>
                                        {art.eliminado && (
                                            <span className="text-[10px] font-black text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-md px-2 py-1 uppercase">
                                                Eliminado
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Tabs Venta / Compra */}
                            <div className="flex border-b border-white/[0.06] xl:sticky xl:top-0 xl:z-10 xl:bg-[#10151f]">
                                {(["venta", "compra"] as const).map(t => (
                                    <button
                                        key={t}
                                        onClick={() => setTab(t)}
                                        className={cn(
                                            "flex-1 py-3 text-[11px] font-black uppercase tracking-widest transition-all border-b-2",
                                            tab === t
                                                ? "text-emerald-300 border-emerald-400 bg-emerald-500/[0.06]"
                                                : "text-slate-500 border-transparent hover:text-slate-300"
                                        )}
                                    >
                                        {t === "venta" ? "Venta" : "Compra"}
                                    </button>
                                ))}
                            </div>

                            {tab === "venta" ? (
                                <div className="p-5 space-y-4">
                                    {/* Precios */}
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className={box}>
                                            <p className={lbl}>Precio Menudeo</p>
                                            <p className="text-xl font-black text-emerald-300 mt-1">{fmtMoney(art.precio)}</p>
                                        </div>
                                        <div className={box}>
                                            <p className={lbl}>IVA</p>
                                            <p className="text-xl font-black text-slate-200 mt-1">{fmtPct(art.iva)}</p>
                                        </div>
                                        <div className={box}>
                                            <p className={lbl}>Precio Oferta</p>
                                            <p className={cn(
                                                "text-xl font-black mt-1",
                                                art.precioOferta > 0 ? "text-amber-300" : "text-slate-600"
                                            )}>
                                                {art.precioOferta > 0 ? fmtMoney(art.precioOferta) : "—"}
                                            </p>
                                        </div>
                                        <div className={box}>
                                            <p className={lbl}>Oferta Pública</p>
                                            {art.ofertaPublica ? (
                                                <>
                                                    <p className="text-xl font-black text-amber-300 mt-1">{fmtMoney(art.ofertaPublica.precio)}</p>
                                                    <p className="text-[10px] font-bold text-slate-500 mt-0.5">
                                                        {fmtFechaHora(art.ofertaPublica.fechaInicio)} → {fmtFechaHora(art.ofertaPublica.fechaFin)}
                                                    </p>
                                                </>
                                            ) : (
                                                <p className="text-xl font-black text-slate-600 mt-1">—</p>
                                            )}
                                        </div>
                                    </div>

                                    {/* Descuento Mayoreo */}
                                    <div>
                                        <p className={cn(lbl, "mb-2")}>Descuento Mayoreo</p>
                                        {art.mayoreo.some(m => m.escala > 0) ? (
                                            <table className="w-full">
                                                <thead className="bg-white/[0.02]">
                                                    <tr>
                                                        <th className={cn(lbl, "px-3 py-2 text-left")}>A partir de ({art.unidad})</th>
                                                        <th className={cn(lbl, "px-3 py-2 text-right")}>% Desc.</th>
                                                        <th className={cn(lbl, "px-3 py-2 text-right")}>Precio</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-white/[0.04]">
                                                    {art.mayoreo.filter(m => m.escala > 0).map((m, i) => (
                                                        <tr key={i}>
                                                            <td className="px-3 py-2 text-[13px] font-bold text-slate-200">{m.escala}</td>
                                                            <td className="px-3 py-2 text-[13px] font-bold text-slate-300 text-right">{fmtPct(m.descuento)}</td>
                                                            <td className="px-3 py-2 text-[13px] font-black text-emerald-300 text-right">{fmtMoney(m.precioDesc)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        ) : (
                                            <p className="text-[12px] font-bold text-slate-600 py-2">Sin escalas de mayoreo</p>
                                        )}
                                    </div>

                                    <div className="flex items-center justify-between pt-1 border-t border-white/[0.06]">
                                        <span className={lbl}>Último cambio</span>
                                        <span className="text-[12px] font-bold text-slate-300">{fmtFechaHora(art.ultimaActualizacion)}</span>
                                    </div>
                                </div>
                            ) : (
                                <div className="p-5 space-y-4">
                                    {/* Proveedores del artículo */}
                                    <div>
                                        <p className={cn(lbl, "mb-2")}>Proveedores</p>
                                        {detalle && detalle.proveedores.length > 0 ? (
                                            <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                                                {detalle.proveedores.map((p, i) => (
                                                    <button
                                                        key={p.idProveedor}
                                                        onClick={() => setProvSel(i)}
                                                        className={cn(
                                                            "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-[12px] font-bold transition-all border",
                                                            provSel === i
                                                                ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                                                                : "bg-white/[0.02] text-slate-300 border-white/[0.06] hover:bg-white/[0.05]"
                                                        )}
                                                    >
                                                        {p.esDefault && <Star className="h-3.5 w-3.5 text-amber-300 shrink-0" />}
                                                        <span className="truncate">{p.proveedor}</span>
                                                    </button>
                                                ))}
                                            </div>
                                        ) : (
                                            <p className="text-[12px] font-bold text-slate-600 py-2">Sin proveedores registrados</p>
                                        )}
                                        {art.proveedorDefault && (
                                            <p className="mt-2 text-[10px] font-bold text-slate-500 flex items-center gap-1.5">
                                                <Star className="h-3 w-3 text-amber-300" /> Proveedor default: {art.proveedorDefault}
                                            </p>
                                        )}
                                    </div>

                                    {/* Costos del proveedor seleccionado */}
                                    {prov && (
                                        <>
                                            <div className="grid grid-cols-2 gap-3">
                                                <div className={box}>
                                                    <p className={lbl}>Costo Caja</p>
                                                    <p className="text-lg font-black text-cyan-300 mt-1">{fmtMoney(prov.costoCaja)}</p>
                                                </div>
                                                <div className={box}>
                                                    <p className={lbl}>Costo Unitario</p>
                                                    <p className="text-lg font-black text-slate-200 mt-1">{fmtMoney(prov.costoUnitario)}</p>
                                                </div>
                                                <div className={box}>
                                                    <p className={lbl}>Cantidad por Caja</p>
                                                    <p className="text-lg font-black text-slate-200 mt-1">{prov.cantidadCaja || "—"}</p>
                                                </div>
                                                <div className={box}>
                                                    <p className={lbl}>Costo Real</p>
                                                    <p className="text-lg font-black text-emerald-300 mt-1">{fmtMoney(prov.costoReal)}</p>
                                                </div>
                                            </div>

                                            <div>
                                                <p className={cn(lbl, "mb-2")}>Descuentos de compra</p>
                                                <div className="flex gap-2 flex-wrap">
                                                    {prov.descuentos.map((d, i) => (
                                                        <span
                                                            key={i}
                                                            className={cn(
                                                                "px-2.5 py-1 rounded-lg border text-[11px] font-black",
                                                                d > 0
                                                                    ? "bg-cyan-500/10 border-cyan-500/25 text-cyan-300"
                                                                    : "bg-white/[0.02] border-white/[0.06] text-slate-600"
                                                            )}
                                                        >
                                                            D{i}: {fmtPct(d)}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>

                                            {prov.descripcionCompra && (
                                                <div className={box}>
                                                    <p className={lbl}>Descripción de compra</p>
                                                    <p className="text-[12px] font-bold text-slate-300 mt-1">
                                                        {prov.codigoCompra ? `[${prov.codigoCompra}] ` : ""}{prov.descripcionCompra}
                                                    </p>
                                                </div>
                                            )}

                                            <div className="flex items-center justify-between pt-1 border-t border-white/[0.06]">
                                                <span className={lbl}>Último cambio de costo</span>
                                                <span className="text-[12px] font-bold text-slate-300">{fmtFechaHora(prov.cambioCosto)}</span>
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}
