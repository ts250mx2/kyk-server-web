"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, Printer, ScanBarcode, Search, Tag } from "lucide-react"
import { cn } from "@/lib/utils"
import { fmtMoney } from "@/lib/format"
import { generarCenefasPdf, type TamanoCenefa } from "@/lib/cenefa-pdf"

// Cenefas de precio "KE PRECIAZO": eliges el artículo (buscar o escanear su
// código), se precargan descripción/precio/mayoreo, ajustas los textos, ves la
// vista previa y se imprime el PDF (1, 2 o 4 por hoja carta).

interface ArticuloItem {
    codigoInterno: number
    codigoBarras: string
    descripcion: string
    precio: number
}

interface Detalle {
    articulo: {
        codigoInterno: number
        codigoBarras: string
        descripcion: string
        unidad: string
        precio: number
        precioOferta: number
        ofertaPublica: { precio: number } | null
        mayoreo: { escala: number; descuento: number; precioDesc: number }[]
    }
}

const lbl = "text-[10px] font-black text-slate-500 uppercase tracking-widest"
const inputCls = "block w-full px-3.5 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-400/25 focus:border-emerald-400/60 transition-all"

const TAMANOS: { id: TamanoCenefa; nombre: string; porHoja: number }[] = [
    { id: "carta", nombre: "Carta", porHoja: 1 },
    { id: "media", nombre: "Media carta", porHoja: 2 },
    { id: "cuarto", nombre: "Cuarto", porHoja: 4 },
]

export default function CenefasPage() {
    const [busqueda, setBusqueda] = useState("")
    const [resultados, setResultados] = useState<ArticuloItem[]>([])
    const [buscando, setBuscando] = useState(false)
    const [cargandoDetalle, setCargandoDetalle] = useState(false)
    const [error, setError] = useState("")
    const [seleccionado, setSeleccionado] = useState<Detalle["articulo"] | null>(null)

    // Diseño de la cenefa
    const [titulo, setTitulo] = useState("KE PRECIAZO")
    const [descripcion, setDescripcion] = useState("")
    const [etiqueta, setEtiqueta] = useState("A Solo:")
    const [precio, setPrecio] = useState(0)
    const [unidad, setUnidad] = useState("PZA")
    const [conPanel, setConPanel] = useState(false)
    const [panelTitulo, setPanelTitulo] = useState("¡PRECIO ESPECIAL!")
    const [panelCantidad, setPanelCantidad] = useState(6)
    const [panelUnidad, setPanelUnidad] = useState("PZS")
    const [panelPrecio, setPanelPrecio] = useState(0)
    const [tamano, setTamano] = useState<TamanoCenefa>("carta")
    const [copias, setCopias] = useState(1)
    const [imprimiendo, setImprimiendo] = useState(false)

    const entradaRef = useRef<HTMLInputElement>(null)
    useEffect(() => { entradaRef.current?.focus() }, [])

    const buscar = async () => {
        const termino = busqueda.trim()
        if (!termino || buscando) return
        setBuscando(true)
        setError("")
        setResultados([])
        try {
            const esCodigo = /^\d{5,}$/.test(termino)
            const qs = esCodigo
                ? `codigoBarras=${encodeURIComponent(termino)}&pageSize=10`
                : `busqueda=${encodeURIComponent(termino)}&pageSize=10&estado=activos`
            const res = await fetch(`/api/articulos?${qs}`)
            if (res.status === 401) { window.location.href = "/login"; return }
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "Error al buscar artículos")
            if (json.items.length === 1) {
                elegir(json.items[0])
            } else {
                setResultados(json.items)
                if (json.items.length === 0) setError(`Sin resultados para "${termino}"`)
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Error al buscar artículos")
        } finally {
            setBuscando(false)
        }
    }

    const elegir = async (item: ArticuloItem) => {
        setResultados([])
        setCargandoDetalle(true)
        setError("")
        try {
            const res = await fetch(`/api/articulos/${item.codigoInterno}`)
            const json: Detalle & { error?: string } = await res.json()
            if (!res.ok) throw new Error(json.error || "Error al consultar el artículo")
            const art = json.articulo
            setSeleccionado(art)
            setDescripcion(art.descripcion)
            const oferta = art.ofertaPublica?.precio || art.precioOferta
            setPrecio(oferta > 0 && oferta < art.precio ? oferta : art.precio)
            setUnidad(art.unidad.toUpperCase() === "KG" ? "KG" : "PZA")
            const escala = art.mayoreo.find(m => m.escala > 0 && m.precioDesc > 0)
            if (escala) {
                setConPanel(true)
                setPanelCantidad(escala.escala)
                setPanelPrecio(escala.precioDesc)
                setPanelUnidad(art.unidad.toUpperCase() === "KG" ? "KG" : "PZS")
            } else {
                setConPanel(false)
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Error al consultar el artículo")
        } finally {
            setCargandoDetalle(false)
        }
    }

    const imprimir = async () => {
        if (imprimiendo || !descripcion.trim() || precio <= 0) return
        setImprimiendo(true)
        try {
            await generarCenefasPdf({
                titulo,
                descripcion,
                etiqueta,
                precio,
                unidad,
                panel: conPanel
                    ? { titulo: panelTitulo, cantidad: panelCantidad, unidad: panelUnidad, precio: panelPrecio }
                    : null,
            }, tamano, copias)
        } finally {
            setImprimiendo(false)
        }
    }

    const entero = Math.floor(precio)
    const centavos = String(Math.round((precio - entero) * 100)).padStart(2, "0")

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-red-500/15 border border-red-500/30 flex items-center justify-center">
                    <Tag className="h-4 w-4 text-red-300" />
                </div>
                <div>
                    <h1 className="text-lg font-black text-white leading-tight">Cenefas de Precio</h1>
                    <p className="text-[11px] font-bold text-slate-500">
                        Elige el artículo, ajusta los textos e imprime el cartel "KE PRECIAZO" en PDF
                    </p>
                </div>
            </div>

            {/* Buscador */}
            <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 backdrop-blur-xl">
                <div className="flex gap-2">
                    <div className="relative flex-1">
                        <ScanBarcode className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                        <input
                            ref={entradaRef}
                            value={busqueda}
                            onChange={e => setBusqueda(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") buscar() }}
                            placeholder="Escanea el código de barras o busca por descripción..."
                            className={cn(inputCls, "pl-10")}
                        />
                    </div>
                    <button
                        onClick={buscar}
                        disabled={buscando || !busqueda.trim()}
                        className="px-4 py-2.5 rounded-xl bg-emerald-500 text-slate-950 font-black text-[12px] uppercase tracking-widest hover:brightness-110 transition-all disabled:opacity-40 flex items-center gap-2"
                    >
                        {buscando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                        Buscar
                    </button>
                </div>
                {error && <p className="mt-2 text-[10px] font-black text-rose-300 uppercase tracking-wider">{error}</p>}
                {resultados.length > 0 && (
                    <div className="mt-2 space-y-1">
                        {resultados.map(r => (
                            <button
                                key={r.codigoInterno}
                                onClick={() => elegir(r)}
                                className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-xl text-left hover:bg-white/[0.05] transition-all"
                            >
                                <span className="min-w-0">
                                    <span className="block text-[13px] font-bold text-slate-100 truncate">{r.descripcion}</span>
                                    <span className="block text-[10px] font-bold text-slate-500">{r.codigoBarras}</span>
                                </span>
                                <span className="text-[13px] font-black text-emerald-300 shrink-0">{fmtMoney(r.precio)}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {cargandoDetalle && (
                <div className="flex items-center justify-center py-16">
                    <Loader2 className="h-7 w-7 text-emerald-400 animate-spin" />
                </div>
            )}

            {seleccionado && !cargandoDetalle && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
                    {/* ── Formulario ── */}
                    <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-5 backdrop-blur-xl space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="col-span-2">
                                <p className={cn(lbl, "mb-1.5")}>Título del cartel</p>
                                <input value={titulo} onChange={e => setTitulo(e.target.value)} className={inputCls} maxLength={24} />
                            </div>
                            <div className="col-span-2">
                                <p className={cn(lbl, "mb-1.5")}>Descripción del producto</p>
                                <textarea
                                    value={descripcion}
                                    onChange={e => setDescripcion(e.target.value)}
                                    rows={2}
                                    maxLength={90}
                                    className={cn(inputCls, "resize-none")}
                                />
                            </div>
                            <div>
                                <p className={cn(lbl, "mb-1.5")}>Etiqueta</p>
                                <input value={etiqueta} onChange={e => setEtiqueta(e.target.value)} className={inputCls} maxLength={16} />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <p className={cn(lbl, "mb-1.5")}>Precio</p>
                                    <input
                                        type="number" step="0.01" min="0" value={precio || ""}
                                        onChange={e => setPrecio(Number(e.target.value))}
                                        className={inputCls}
                                    />
                                </div>
                                <div>
                                    <p className={cn(lbl, "mb-1.5")}>Unidad</p>
                                    <input value={unidad} onChange={e => setUnidad(e.target.value)} className={inputCls} maxLength={6} />
                                </div>
                            </div>
                            {(seleccionado.precioOferta > 0 || seleccionado.ofertaPublica) && (
                                <div className="col-span-2 flex items-center gap-2 flex-wrap text-[11px] font-bold">
                                    <span className={lbl}>Usar:</span>
                                    <button
                                        onClick={() => setPrecio(seleccionado.precio)}
                                        className={cn(
                                            "px-2.5 py-1.5 rounded-lg border transition-all",
                                            precio === seleccionado.precio
                                                ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                                                : "border-white/10 text-slate-400 hover:text-white"
                                        )}
                                    >
                                        Normal {fmtMoney(seleccionado.precio)}
                                    </button>
                                    {[seleccionado.ofertaPublica?.precio, seleccionado.precioOferta]
                                        .filter((p): p is number => Boolean(p && p > 0))
                                        .filter((p, i, arr) => arr.indexOf(p) === i)
                                        .map(p => (
                                            <button
                                                key={p}
                                                onClick={() => setPrecio(p)}
                                                className={cn(
                                                    "px-2.5 py-1.5 rounded-lg border transition-all",
                                                    precio === p
                                                        ? "bg-amber-500/15 border-amber-500/40 text-amber-300"
                                                        : "border-white/10 text-slate-400 hover:text-white"
                                                )}
                                            >
                                                Oferta {fmtMoney(p)}
                                            </button>
                                        ))}
                                </div>
                            )}
                        </div>

                        {/* Panel de precio especial */}
                        <div className="border-t border-white/[0.06] pt-4 space-y-3">
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={conPanel}
                                    onChange={e => setConPanel(e.target.checked)}
                                    className="h-4 w-4 accent-amber-400"
                                />
                                <span className="text-[12px] font-black text-slate-200 uppercase tracking-widest">
                                    Panel de precio especial (mayoreo)
                                </span>
                            </label>
                            {conPanel && (
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="col-span-2">
                                        <p className={cn(lbl, "mb-1.5")}>Título del panel</p>
                                        <input value={panelTitulo} onChange={e => setPanelTitulo(e.target.value)} className={inputCls} maxLength={30} />
                                    </div>
                                    <div>
                                        <p className={cn(lbl, "mb-1.5")}>A partir de</p>
                                        <div className="flex gap-2">
                                            <input
                                                type="number" min="1" value={panelCantidad || ""}
                                                onChange={e => setPanelCantidad(Number(e.target.value))}
                                                className={inputCls}
                                            />
                                            <input
                                                value={panelUnidad}
                                                onChange={e => setPanelUnidad(e.target.value)}
                                                className={cn(inputCls, "w-20")} maxLength={6}
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <p className={cn(lbl, "mb-1.5")}>Precio especial</p>
                                        <input
                                            type="number" step="0.01" min="0" value={panelPrecio || ""}
                                            onChange={e => setPanelPrecio(Number(e.target.value))}
                                            className={inputCls}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Tamaño e impresión */}
                        <div className="border-t border-white/[0.06] pt-4 flex items-end gap-3 flex-wrap">
                            <div>
                                <p className={cn(lbl, "mb-1.5")}>Tamaño (por hoja carta)</p>
                                <div className="flex items-center rounded-xl bg-white/[0.03] border border-white/10 p-1">
                                    {TAMANOS.map(t => (
                                        <button
                                            key={t.id}
                                            onClick={() => { setTamano(t.id); setCopias(c => Math.max(c, t.porHoja)) }}
                                            className={cn(
                                                "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                                                tamano === t.id ? "bg-white/[0.08] text-white" : "text-slate-400 hover:text-white"
                                            )}
                                            title={`${t.porHoja} por hoja`}
                                        >
                                            {t.nombre}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <p className={cn(lbl, "mb-1.5")}>Copias</p>
                                <input
                                    type="number" min="1" max="100" value={copias || ""}
                                    onChange={e => setCopias(Number(e.target.value))}
                                    className={cn(inputCls, "w-24")}
                                />
                            </div>
                            <button
                                onClick={imprimir}
                                disabled={imprimiendo || !descripcion.trim() || precio <= 0}
                                className="ml-auto px-5 py-2.5 rounded-xl bg-red-500 text-white font-black text-[12px] uppercase tracking-widest hover:brightness-110 transition-all disabled:opacity-40 flex items-center gap-2"
                            >
                                {imprimiendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                                Imprimir PDF
                            </button>
                        </div>
                    </div>

                    {/* ── Vista previa ── */}
                    <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-5 backdrop-blur-xl">
                        <p className={cn(lbl, "mb-3")}>Vista previa</p>
                        <div
                            className="aspect-[4/3] w-full rounded-xl overflow-hidden select-none"
                            style={{ background: "#e4101c", containerType: "inline-size" }}
                        >
                            <div className="relative h-full w-full p-[3%]">
                                {/* Título */}
                                <div className="leading-none font-black uppercase" style={{ color: "#ffcd00" }}>
                                    {(() => {
                                        const [l1, ...resto] = titulo.trim().toUpperCase().split(/\s+/)
                                        const l2 = resto.join(" ")
                                        return (
                                            <>
                                                <p className="tracking-tight" style={{ fontSize: "min(9cqw, 3rem)" }}>{l1}</p>
                                                {l2 && <p style={{ fontSize: "min(10cqw, 3.4rem)" }}>{l2}</p>}
                                            </>
                                        )
                                    })()}
                                </div>
                                {/* Logo */}
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src="/kyklogo.jpg"
                                    alt="Logo"
                                    className="absolute top-[4%] right-[3%] w-[26%] rounded-md"
                                    onError={e => { (e.target as HTMLImageElement).style.display = "none" }}
                                />
                                {/* Caja blanca */}
                                <div
                                    className="absolute bottom-[3.5%] left-[3%] bg-white rounded-xl flex flex-col items-center justify-between px-[2%] py-[1.5%]"
                                    style={{ width: conPanel ? "66.5%" : "94%", height: "58.5%" }}
                                >
                                    <p className="text-black font-black uppercase text-center leading-tight" style={{ fontSize: "min(3.6cqw, 1.35rem)" }}>
                                        {descripcion.toUpperCase() || "DESCRIPCIÓN DEL PRODUCTO"}
                                    </p>
                                    <div className="flex items-end justify-center gap-1 pb-[2%]">
                                        <span className="text-black font-black underline" style={{ fontSize: "min(2.6cqw, 0.9rem)" }}>{etiqueta}</span>
                                        <span className="text-black font-black" style={{ fontSize: "min(7cqw, 2.6rem)", lineHeight: 0.9 }}>$</span>
                                        <span className="text-black font-black" style={{ fontSize: "min(13cqw, 4.6rem)", lineHeight: 0.75 }}>{entero}.</span>
                                        <span className="flex flex-col items-start leading-none">
                                            <span className="text-black font-black" style={{ fontSize: "min(5.5cqw, 2rem)" }}>{centavos}</span>
                                            <span className="text-black font-black" style={{ fontSize: "min(3.6cqw, 1.3rem)" }}>{unidad.toUpperCase()}</span>
                                        </span>
                                    </div>
                                </div>
                                {/* Panel amarillo */}
                                {conPanel && (
                                    <div
                                        className="absolute bottom-[3.5%] right-[3%] rounded-xl flex flex-col items-center justify-around px-[1%] py-[2%] text-center"
                                        style={{ width: "24%", height: "58.5%", background: "#ffcd00" }}
                                    >
                                        <p className="text-black font-black uppercase leading-tight" style={{ fontSize: "min(3cqw, 1.05rem)" }}>
                                            {panelTitulo.toUpperCase()}
                                        </p>
                                        <div className="text-black font-black uppercase leading-snug" style={{ fontSize: "min(3cqw, 1.05rem)" }}>
                                            <p>A PARTIR</p>
                                            <p>DE {panelCantidad} {panelUnidad.toUpperCase()}</p>
                                            <p>${panelPrecio.toFixed(2)}</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                        <p className="mt-2 text-[10px] font-bold text-slate-600">
                            La vista previa es aproximada; el PDF sale con el diseño exacto. {TAMANOS.find(t => t.id === tamano)?.porHoja} por hoja carta.
                        </p>
                    </div>
                </div>
            )}

            {!seleccionado && !cargandoDetalle && resultados.length === 0 && (
                <div className="bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl flex flex-col items-center justify-center py-24 gap-3">
                    <Tag className="h-8 w-8 text-slate-700" />
                    <p className="text-[12px] font-bold text-slate-600 uppercase tracking-widest">
                        Escanea o busca un artículo para armar su cenefa
                    </p>
                </div>
            )}
        </div>
    )
}
