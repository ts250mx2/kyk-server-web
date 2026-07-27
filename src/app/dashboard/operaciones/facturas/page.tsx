"use client"

import { useCallback, useEffect, useState } from "react"
import {
    Search, Loader2, AlertTriangle, ListRestart, FileStack, X,
    FileText, FileSpreadsheet, RefreshCw
} from "lucide-react"
import { cn } from "@/lib/utils"
import { fmtMoney, fmtInt, fmtFechaHora } from "@/lib/format"
import { exportarPdf, exportarExcel, obtenerTiendaSesion, sufijoArchivo } from "@/lib/export"

interface Documento {
    tipoId: number
    tipoDocumento: string
    idFolio: number
    folio: string
    fecha: string
    receptor: string
    rfc: string
    uuid: string
    metodoPagoClave: string
    metodoPago: string
    total: number
    saldo: number
    cancelada: boolean
    z: string | null
    idSalida: number
    idTiendaSalida: number
}

interface Resumen {
    documentos: number
    facturas: number
    totalFacturado: number
    publicoGeneral: number
    traslados: number
    canceladas: number
}

interface VentaFactura {
    idVenta: number; caja: number; fecha: string | null; total: number
    tieneDevolucion?: boolean
    facturadoEn?: { folio: string; fecha: string; receptor: string }[] | null
}
interface ConceptoFactura {
    codigoBarras: string; descripcion: string; cantidad: number;
    precio: number; iva: number; importe: number
}
interface DetalleFactura {
    factura: {
        folio: string; receptor: string; rfc: string; metodoPago: string;
        formaPago: string; usoCfdi: string; regimenFiscal: string;
        total: number; iva: number; ieps: number; z: string | null
    }
    cliente: {
        direccion: string; colonia: string; municipio: string; cp: string;
        correo: string; regimenFiscal: string
    } | null
    apertura: {
        cajero: string; supervisorCierre: string | null;
        fechaApertura: string; fechaCierre: string | null
    } | null
    pagos: Record<string, number> | null
    conceptos: ConceptoFactura[]
    ventas: VentaFactura[]
    resumenTickets: { conDevolucion: number; facturados: number; totalFacturados: number } | null
}
interface PartidaTraslado {
    codigoBarras: string; descripcion: string; medida: string; mov: number;
    costo: number; importe: number
}

const lbl = "text-[10px] font-black text-slate-500 uppercase tracking-widest"
const inputCls = "block w-full px-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-400/25 focus:border-emerald-400/60 transition-all"

const TIPO_BADGE: Record<number, string> = {
    0: "text-emerald-300 bg-emerald-500/10 border-emerald-500/25",
    1: "text-cyan-300 bg-cyan-500/10 border-cyan-500/25",
    2: "text-violet-300 bg-violet-500/10 border-violet-500/25",
    4: "text-amber-300 bg-amber-500/10 border-amber-500/25",
    5: "text-indigo-300 bg-indigo-500/10 border-indigo-500/25",
    6: "text-slate-300 bg-white/[0.06] border-white/15",
}

const PAGO_BADGE: Record<string, string> = {
    "01": "text-emerald-300 bg-emerald-500/10 border-emerald-500/25",
    "02": "text-violet-300 bg-violet-500/10 border-violet-500/25",
    "03": "text-cyan-300 bg-cyan-500/10 border-cyan-500/25",
    "04": "text-orange-300 bg-orange-500/10 border-orange-500/25",
    "28": "text-blue-300 bg-blue-500/10 border-blue-500/25",
}

const TIPOS_FILTRO = [
    { valor: -1, label: "Todos los tipos" },
    { valor: 0, label: "Contado" },
    { valor: 1, label: "Crédito" },
    { valor: 2, label: "Nota Crédito" },
    { valor: 4, label: "Público General" },
    { valor: 5, label: "Traslados" },
    { valor: 6, label: "Entradas Transf." },
]

const hoyISO = () => new Date().toLocaleDateString("sv-SE")
const diasAtras = (n: number) => {
    const d = new Date()
    d.setDate(d.getDate() - n)
    return d.toLocaleDateString("sv-SE")
}

export default function FacturasPage() {
    const [fechaInicio, setFechaInicio] = useState(hoyISO())
    const [fechaFin, setFechaFin] = useState(hoyISO())
    const [busqueda, setBusqueda] = useState("")
    const [tipo, setTipo] = useState(-1)
    const [documentos, setDocumentos] = useState<Documento[]>([])
    const [resumen, setResumen] = useState<Resumen | null>(null)
    const [truncado, setTruncado] = useState(false)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState("")
    const [exportando, setExportando] = useState<"pdf" | "excel" | null>(null)

    // Modal de drill-down
    const [modal, setModal] = useState<Documento | null>(null)
    const [detalleFactura, setDetalleFactura] = useState<DetalleFactura | null>(null)
    const [partidasTraslado, setPartidasTraslado] = useState<PartidaTraslado[] | null>(null)
    const [usuarioSalida, setUsuarioSalida] = useState<string | null>(null)
    const [tabModal, setTabModal] = useState<"conceptos" | "tickets">("conceptos")
    const [loadingModal, setLoadingModal] = useState(false)

    const cargar = useCallback(async (inicio: string, fin: string, filtro: string, t: number) => {
        setLoading(true)
        setError("")
        try {
            const qs = new URLSearchParams({ fechaInicio: inicio, fechaFin: fin })
            if (filtro) qs.set("busqueda", filtro)
            if (t >= 0) qs.set("tipo", String(t))

            const res = await fetch(`/api/facturas?${qs.toString()}`)
            if (res.status === 401) { window.location.href = "/login"; return }
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "Error al consultar facturas")
            setDocumentos(json.documentos)
            setResumen(json.resumen)
            setTruncado(Boolean(json.truncado))
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Error desconocido")
            setDocumentos([])
            setResumen(null)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        cargar(hoyISO(), hoyISO(), "", -1)
    }, [cargar])

    const actualizar = () => cargar(fechaInicio, fechaFin, busqueda.trim(), tipo)
    const limpiar = () => {
        setBusqueda("")
        setTipo(-1)
        setFechaInicio(hoyISO())
        setFechaFin(hoyISO())
        cargar(hoyISO(), hoyISO(), "", -1)
    }
    const preset = (dias: number) => {
        const inicio = diasAtras(dias)
        const fin = hoyISO()
        setFechaInicio(inicio)
        setFechaFin(fin)
        cargar(inicio, fin, busqueda.trim(), tipo)
    }
    const cambiarTipo = (t: number) => {
        setTipo(t)
        cargar(fechaInicio, fechaFin, busqueda.trim(), t)
    }

    const verDetalle = async (d: Documento) => {
        setModal(d)
        setDetalleFactura(null)
        setPartidasTraslado(null)
        setUsuarioSalida(null)
        // Público general abre en Tickets (lo relevante del corte); las demás en Conceptos
        setTabModal(d.tipoId === 4 ? "tickets" : "conceptos")
        setLoadingModal(true)
        try {
            if (d.tipoId < 5) {
                // frmProcDetalleFacturas / frmProcCorteFacturaServer
                const res = await fetch(`/api/facturas/${d.idFolio}/detalle`)
                const json = await res.json()
                if (res.ok) setDetalleFactura(json)
                else { setError(json.error || "Error al consultar el detalle"); setModal(null) }
            } else {
                // frmProcDetalleFacturasTraslados
                const res = await fetch(`/api/transferencias/detalle?idSalida=${d.idSalida}&idTiendaSalida=${d.idTiendaSalida}`)
                const json = await res.json()
                if (res.ok) {
                    setPartidasTraslado(json.partidas)
                    setUsuarioSalida(json.transferencia?.usuarioSalida ?? null)
                } else { setError(json.error || "Error al consultar el detalle"); setModal(null) }
            }
        } catch {
            setError("Error al consultar el detalle")
            setModal(null)
        } finally {
            setLoadingModal(false)
        }
    }

    const exportar = async (formato: "pdf" | "excel") => {
        setExportando(formato)
        try {
            const tienda = await obtenerTiendaSesion()
            const columnas = [
                { header: "Tipo" },
                { header: "Folio" },
                { header: "Fecha" },
                { header: "Receptor" },
                { header: "RFC" },
                { header: "Método de Pago" },
                { header: "Total", align: "right" as const },
                { header: "Estado" },
            ]
            const base = {
                titulo: "REPORTE DE FACTURAS Y DOCUMENTOS",
                subtitulo: `Del ${fechaInicio} al ${fechaFin}${busqueda.trim() ? `  ·  Búsqueda: "${busqueda.trim()}"` : ""}  ·  ${fmtInt(documentos.length)} documentos`,
                tienda,
                columnas,
                nombreArchivo: `facturas_${sufijoArchivo()}`,
            }

            if (formato === "pdf") {
                exportarPdf({
                    ...base,
                    orientacion: "landscape",
                    filas: documentos.map(d => [
                        d.tipoDocumento,
                        String(d.folio),
                        fmtFechaHora(d.fecha),
                        String(d.receptor),
                        String(d.rfc),
                        String(d.metodoPago),
                        d.total > 0 ? fmtMoney(d.total) : "—",
                        d.cancelada ? "CANCELADA" : "",
                    ]),
                })
            } else {
                exportarExcel({
                    ...base,
                    hoja: "Facturas",
                    columnasMoneda: [6],
                    filas: documentos.map(d => [
                        d.tipoDocumento,
                        String(d.folio),
                        fmtFechaHora(d.fecha),
                        String(d.receptor),
                        String(d.rfc),
                        String(d.metodoPago),
                        d.total > 0 ? d.total : "",
                        d.cancelada ? "CANCELADA" : "",
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
                    <h1 className="text-2xl font-black text-white uppercase tracking-tight">Facturas</h1>
                    <p className="text-[12px] font-bold text-slate-500 mt-1">
                        {loading ? "Consultando..." : `${fmtInt(resumen?.documentos ?? 0)} documentos`}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => exportar("pdf")}
                        disabled={exportando !== null || loading || documentos.length === 0}
                        className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 hover:text-rose-300 hover:border-rose-500/30 font-black text-[11px] uppercase tracking-widest transition-all disabled:opacity-40"
                        title="Imprimir a PDF"
                    >
                        {exportando === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                        PDF
                    </button>
                    <button
                        onClick={() => exportar("excel")}
                        disabled={exportando !== null || loading || documentos.length === 0}
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
                    <select
                        className={cn(inputCls, "appearance-none [color-scheme:dark] w-52")}
                        value={tipo}
                        onChange={e => cambiarTipo(Number(e.target.value))}
                    >
                        {TIPOS_FILTRO.map(t => (
                            <option key={t.valor} value={t.valor} className="bg-[#0b1220]">{t.label.toUpperCase()}</option>
                        ))}
                    </select>
                    <div className="relative flex-1 min-w-[240px]">
                        <Search className="absolute top-1/2 -translate-y-1/2 left-3.5 h-4 w-4 text-slate-500" />
                        <input
                            type="text"
                            placeholder="FOLIO, TOTAL, RECEPTOR, RFC O UUID (ENTER)"
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

            {/* Resumen */}
            {resumen && !loading && (
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                    {[
                        { titulo: "Documentos", valor: fmtInt(resumen.documentos), color: "text-white" },
                        { titulo: "Total Facturado", valor: fmtMoney(resumen.totalFacturado), color: "text-emerald-300" },
                        { titulo: "Público General", valor: fmtInt(resumen.publicoGeneral), color: "text-amber-300" },
                        { titulo: "Traslados", valor: fmtInt(resumen.traslados), color: "text-indigo-300" },
                        { titulo: "Canceladas", valor: fmtInt(resumen.canceladas), color: resumen.canceladas > 0 ? "text-rose-300" : "text-slate-500" },
                    ].map(c => (
                        <div key={c.titulo} className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 backdrop-blur-xl">
                            <p className={lbl}>{c.titulo}</p>
                            <p className={cn("text-lg font-black mt-1 truncate", c.color)}>{c.valor}</p>
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
                    <AlertTriangle className="h-4 w-4" /> Mostrando los primeros {fmtInt(documentos.length)} documentos — acota el rango de fechas
                </div>
            )}

            {/* Tabla de documentos */}
            <div className="bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl overflow-hidden">
                {loading ? (
                    <div className="flex items-center justify-center py-24">
                        <Loader2 className="h-7 w-7 text-emerald-400 animate-spin" />
                    </div>
                ) : documentos.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-24 gap-3">
                        <FileStack className="h-8 w-8 text-slate-700" />
                        <p className="text-[12px] font-bold text-slate-600 uppercase tracking-widest">
                            Sin documentos en el rango seleccionado
                        </p>
                    </div>
                ) : (
                    <div className="overflow-auto max-h-[calc(100vh-30rem)] min-h-[300px]">
                        <table className="w-full">
                            <thead className="sticky top-0 z-10 bg-[#10151f] shadow-[0_1px_0_rgba(255,255,255,0.08)]">
                                <tr>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Tipo</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Folio</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Fecha</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Receptor</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>RFC</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Método de Pago</th>
                                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Total</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/[0.04]">
                                {documentos.map((d, i) => (
                                    <tr
                                        key={`${d.tipoId}-${d.idFolio}-${i}`}
                                        onClick={() => verDetalle(d)}
                                        className={cn(
                                            "cursor-pointer transition-colors hover:bg-white/[0.03]",
                                            d.cancelada && "bg-rose-500/[0.05]"
                                        )}
                                        title="Ver detalle del documento"
                                    >
                                        <td className="px-4 py-2.5 whitespace-nowrap">
                                            <span className={cn(
                                                "text-[10px] font-black rounded-md px-2 py-0.5 border uppercase",
                                                TIPO_BADGE[d.tipoId] ?? TIPO_BADGE[6]
                                            )}>
                                                {d.tipoDocumento}
                                            </span>
                                        </td>
                                        <td className="px-4 py-2.5 whitespace-nowrap">
                                            <span className="text-[12px] font-black text-cyan-300">{d.folio}</span>
                                            {d.cancelada && (
                                                <span className="ml-1.5 text-[9px] font-black text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-md px-1.5 py-0.5 uppercase">
                                                    Cancelada
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 whitespace-nowrap">{fmtFechaHora(d.fecha)}</td>
                                        <td className="px-4 py-2.5 text-[13px] font-bold text-slate-200 max-w-[280px] truncate" title={d.receptor}>
                                            {d.receptor || "—"}
                                        </td>
                                        <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 whitespace-nowrap">{d.rfc || "—"}</td>
                                        <td className="px-4 py-2.5 whitespace-nowrap">
                                            <span className={cn(
                                                "text-[10px] font-black rounded-md px-2 py-0.5 border uppercase",
                                                PAGO_BADGE[d.metodoPagoClave] ?? "text-slate-400 bg-white/[0.04] border-white/10"
                                            )}>
                                                {d.metodoPago}
                                            </span>
                                        </td>
                                        <td className="px-4 py-2.5 text-[13px] font-black text-emerald-300 text-right whitespace-nowrap">
                                            {d.total > 0 ? fmtMoney(d.total) : "—"}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Modal de detalle */}
            {modal && (
                <div
                    className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
                    onClick={() => setModal(null)}
                >
                    <div
                        className="w-full max-w-3xl max-h-[85vh] bg-[#0d1320] border border-white/10 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden flex flex-col"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="px-6 py-4 border-b border-white/10 flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <h3 className="text-[15px] font-black text-white flex items-center gap-2 flex-wrap">
                                    {modal.tipoDocumento} {modal.folio}
                                    {modal.cancelada && (
                                        <span className="text-[9px] font-black text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-md px-1.5 py-0.5 uppercase">
                                            Cancelada
                                        </span>
                                    )}
                                    {modal.z && (
                                        <span className="text-[9px] font-black text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-md px-1.5 py-0.5 uppercase">
                                            Z: {modal.z}
                                        </span>
                                    )}
                                </h3>
                                <p className="text-[12px] font-bold text-slate-400 mt-1 truncate" title={modal.receptor}>
                                    {modal.receptor}{modal.rfc ? ` · ${modal.rfc}` : ""}
                                </p>
                                <p className="text-[11px] font-bold text-slate-500 mt-0.5">
                                    {fmtFechaHora(modal.fecha)}{modal.uuid ? ` · UUID: ${modal.uuid}` : ""}
                                </p>
                            </div>
                            <button
                                onClick={() => setModal(null)}
                                className="p-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-400 hover:text-white transition-all"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>

                        <div className="overflow-auto flex-1">
                            {loadingModal ? (
                                <div className="flex items-center justify-center py-20">
                                    <Loader2 className="h-6 w-6 text-emerald-400 animate-spin" />
                                </div>
                            ) : detalleFactura ? (
                                <>
                                    {/* Datos fiscales del cliente (frmProcDetalleFacturas) */}
                                    {detalleFactura.cliente && (
                                        <div className="mx-4 mt-4 p-3.5 rounded-xl bg-white/[0.03] border border-white/10 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
                                            {[
                                                ["Dirección", `${detalleFactura.cliente.direccion}${detalleFactura.cliente.colonia ? `, ${detalleFactura.cliente.colonia}` : ""}`],
                                                ["Municipio", `${detalleFactura.cliente.municipio}${detalleFactura.cliente.cp ? ` CP ${detalleFactura.cliente.cp}` : ""}`],
                                                ["Correo", detalleFactura.cliente.correo],
                                                ["Régimen Fiscal", detalleFactura.cliente.regimenFiscal || detalleFactura.factura.regimenFiscal],
                                                ["Uso CFDI", detalleFactura.factura.usoCfdi],
                                                ["Forma de Pago", detalleFactura.factura.formaPago || detalleFactura.factura.metodoPago],
                                            ].filter(([, v]) => v).map(([k, v]) => (
                                                <p key={k} className="text-[11px] font-bold text-slate-300 truncate" title={String(v)}>
                                                    <span className="text-slate-500 uppercase text-[9px] font-black tracking-widest mr-1.5">{k}:</span>{v}
                                                </p>
                                            ))}
                                        </div>
                                    )}

                                    {/* Apertura y formas de pago (frmProcCorteFacturaServer) */}
                                    {detalleFactura.apertura && (
                                        <div className="mx-4 mt-4 p-3.5 rounded-xl bg-amber-500/[0.05] border border-amber-500/20 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
                                            <p className="text-[11px] font-bold text-slate-300">
                                                <span className="text-slate-500 uppercase text-[9px] font-black tracking-widest mr-1.5">Cajero:</span>
                                                {detalleFactura.apertura.cajero}
                                            </p>
                                            {detalleFactura.apertura.supervisorCierre && (
                                                <p className="text-[11px] font-bold text-slate-300">
                                                    <span className="text-slate-500 uppercase text-[9px] font-black tracking-widest mr-1.5">Supervisor Cierre:</span>
                                                    {detalleFactura.apertura.supervisorCierre}
                                                </p>
                                            )}
                                            <p className="text-[11px] font-bold text-slate-300">
                                                <span className="text-slate-500 uppercase text-[9px] font-black tracking-widest mr-1.5">Apertura:</span>
                                                {fmtFechaHora(detalleFactura.apertura.fechaApertura)}
                                            </p>
                                            <p className="text-[11px] font-bold text-slate-300">
                                                <span className="text-slate-500 uppercase text-[9px] font-black tracking-widest mr-1.5">Cierre:</span>
                                                {fmtFechaHora(detalleFactura.apertura.fechaCierre)}
                                            </p>
                                        </div>
                                    )}
                                    {detalleFactura.pagos && (
                                        <div className="mx-4 mt-3 flex flex-wrap gap-2">
                                            {[
                                                ["Efectivo", detalleFactura.pagos.efectivo, "text-emerald-300 bg-emerald-500/10 border-emerald-500/25"],
                                                ["Tarjeta", detalleFactura.pagos.tarjeta, "text-orange-300 bg-orange-500/10 border-orange-500/25"],
                                                ["Cheques", detalleFactura.pagos.cheques, "text-violet-300 bg-violet-500/10 border-violet-500/25"],
                                                ["Transferencia", detalleFactura.pagos.transferencia, "text-cyan-300 bg-cyan-500/10 border-cyan-500/25"],
                                                ["Vales", detalleFactura.pagos.vales, "text-blue-300 bg-blue-500/10 border-blue-500/25"],
                                                ["Devoluciones", detalleFactura.pagos.devoluciones, "text-rose-300 bg-rose-500/10 border-rose-500/25"],
                                            ].filter(([, v]) => Number(v) !== 0).map(([k, v, c]) => (
                                                <span key={String(k)} className={cn("text-[10px] font-black rounded-lg px-2.5 py-1.5 border uppercase", String(c))}>
                                                    {k}: {fmtMoney(Number(v))}
                                                </span>
                                            ))}
                                        </div>
                                    )}

                                    {/* Tabs Conceptos / Tickets */}
                                    <div className="flex border-b border-white/10 mt-4 sticky top-0 z-20 bg-[#0d1320]">
                                        {(["conceptos", "tickets"] as const).map(t => (
                                            <button
                                                key={t}
                                                onClick={() => setTabModal(t)}
                                                className={cn(
                                                    "flex-1 py-2.5 text-[11px] font-black uppercase tracking-widest transition-all border-b-2",
                                                    tabModal === t
                                                        ? "text-emerald-300 border-emerald-400 bg-emerald-500/[0.06]"
                                                        : "text-slate-500 border-transparent hover:text-slate-300"
                                                )}
                                            >
                                                {t === "conceptos"
                                                    ? `Conceptos (${fmtInt(detalleFactura.conceptos.length)})`
                                                    : `Tickets (${fmtInt(detalleFactura.ventas.length)})`}
                                            </button>
                                        ))}
                                    </div>

                                    {tabModal === "conceptos" ? (
                                        detalleFactura.conceptos.length === 0 ? (
                                            <p className="py-10 text-center text-[12px] font-bold text-slate-600 uppercase tracking-widest">
                                                Sin conceptos disponibles
                                            </p>
                                        ) : (
                                            <table className="w-full">
                                                <thead className="bg-[#141a28]">
                                                    <tr>
                                                        <th className={cn(lbl, "px-4 py-2.5 text-left")}>Código</th>
                                                        <th className={cn(lbl, "px-4 py-2.5 text-left")}>Descripción</th>
                                                        <th className={cn(lbl, "px-4 py-2.5 text-right")}>Cantidad</th>
                                                        <th className={cn(lbl, "px-4 py-2.5 text-right")}>Precio</th>
                                                        <th className={cn(lbl, "px-4 py-2.5 text-right")}>IVA</th>
                                                        <th className={cn(lbl, "px-4 py-2.5 text-right")}>Importe</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-white/[0.04]">
                                                    {detalleFactura.conceptos.map((c, i) => (
                                                        <tr key={i} className="hover:bg-white/[0.03]">
                                                            <td className="px-4 py-2 text-[12px] font-bold text-slate-400 whitespace-nowrap">{c.codigoBarras}</td>
                                                            <td className="px-4 py-2 text-[13px] font-bold text-slate-200">{c.descripcion}</td>
                                                            <td className="px-4 py-2 text-[13px] font-bold text-slate-300 text-right">{Math.round(c.cantidad * 1000) / 1000}</td>
                                                            <td className="px-4 py-2 text-[13px] font-bold text-slate-300 text-right whitespace-nowrap">{fmtMoney(c.precio)}</td>
                                                            <td className="px-4 py-2 text-[12px] font-bold text-slate-400 text-right">{c.iva > 0 ? `${Math.round(c.iva * 100)}%` : "—"}</td>
                                                            <td className="px-4 py-2 text-[13px] font-black text-emerald-300 text-right whitespace-nowrap">{fmtMoney(c.importe)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        )
                                    ) : (
                                        <>
                                            {/* Resumen de marcados (frmProcCorteFacturaServer) */}
                                            {detalleFactura.resumenTickets &&
                                                (detalleFactura.resumenTickets.facturados > 0 || detalleFactura.resumenTickets.conDevolucion > 0) && (
                                                <div className="px-4 pt-3 flex flex-wrap gap-2">
                                                    {detalleFactura.resumenTickets.facturados > 0 && (
                                                        <span className="text-[10px] font-black rounded-lg px-2.5 py-1.5 border uppercase text-amber-300 bg-amber-500/10 border-amber-500/25">
                                                            {fmtInt(detalleFactura.resumenTickets.facturados)} tickets facturados en otra factura · {fmtMoney(detalleFactura.resumenTickets.totalFacturados)}
                                                        </span>
                                                    )}
                                                    {detalleFactura.resumenTickets.conDevolucion > 0 && (
                                                        <span className="text-[10px] font-black rounded-lg px-2.5 py-1.5 border uppercase text-rose-300 bg-rose-500/10 border-rose-500/25">
                                                            {fmtInt(detalleFactura.resumenTickets.conDevolucion)} tickets con devolución
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                            <table className="w-full mt-2">
                                                <thead className="bg-[#141a28]">
                                                    <tr>
                                                        <th className={cn(lbl, "px-4 py-2.5 text-left")}># Venta</th>
                                                        <th className={cn(lbl, "px-4 py-2.5 text-right")}>Caja</th>
                                                        <th className={cn(lbl, "px-4 py-2.5 text-left")}>Fecha</th>
                                                        <th className={cn(lbl, "px-4 py-2.5 text-left")}>Estado</th>
                                                        <th className={cn(lbl, "px-4 py-2.5 text-right")}>Total</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-white/[0.04]">
                                                    {detalleFactura.ventas.map((v, i) => {
                                                        const facturado = v.facturadoEn && v.facturadoEn.length > 0
                                                        const multiple = v.facturadoEn && v.facturadoEn.length > 1
                                                        return (
                                                            <tr key={i} className={cn(
                                                                "hover:bg-white/[0.03]",
                                                                multiple ? "bg-rose-500/[0.07]" : facturado ? "bg-amber-500/[0.05]" : v.tieneDevolucion && "bg-rose-500/[0.04]"
                                                            )}>
                                                                <td className="px-4 py-2 text-[12px] font-bold text-slate-400">{v.idVenta}</td>
                                                                <td className="px-4 py-2 text-[12px] font-bold text-slate-400 text-right">{v.caja}</td>
                                                                <td className="px-4 py-2 text-[12px] font-bold text-slate-300 whitespace-nowrap">{fmtFechaHora(v.fecha)}</td>
                                                                <td className="px-4 py-2 whitespace-nowrap">
                                                                    <span className="flex flex-wrap gap-1">
                                                                        {multiple ? (
                                                                            <span
                                                                                className="text-[9px] font-black text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-md px-1.5 py-0.5 uppercase"
                                                                                title={v.facturadoEn!.map(f => `${f.folio} · ${f.receptor}`).join(" | ")}
                                                                            >
                                                                                Facturado más de una vez
                                                                            </span>
                                                                        ) : facturado ? (
                                                                            <span
                                                                                className="text-[9px] font-black text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-md px-1.5 py-0.5 uppercase"
                                                                                title={`${v.facturadoEn![0].receptor} · ${fmtFechaHora(v.facturadoEn![0].fecha)}`}
                                                                            >
                                                                                Facturado: {v.facturadoEn![0].folio}
                                                                            </span>
                                                                        ) : null}
                                                                        {v.tieneDevolucion && (
                                                                            <span className="text-[9px] font-black text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-md px-1.5 py-0.5 uppercase">
                                                                                Devolución
                                                                            </span>
                                                                        )}
                                                                        {!facturado && !v.tieneDevolucion && (
                                                                            <span className="text-[10px] font-bold text-slate-600">—</span>
                                                                        )}
                                                                    </span>
                                                                </td>
                                                                <td className="px-4 py-2 text-[13px] font-black text-emerald-300 text-right">{fmtMoney(v.total)}</td>
                                                            </tr>
                                                        )
                                                    })}
                                                </tbody>
                                            </table>
                                        </>
                                    )}
                                </>
                            ) : partidasTraslado ? (
                                <table className="w-full">
                                    <thead className="sticky top-0 z-10 bg-[#141a28]">
                                        <tr>
                                            <th className={cn(lbl, "px-4 py-2.5 text-left")}>Código</th>
                                            <th className={cn(lbl, "px-4 py-2.5 text-left")}>Descripción</th>
                                            <th className={cn(lbl, "px-4 py-2.5 text-right")}>Cantidad</th>
                                            <th className={cn(lbl, "px-4 py-2.5 text-right")}>Costo</th>
                                            <th className={cn(lbl, "px-4 py-2.5 text-right")}>Importe</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/[0.04]">
                                        {partidasTraslado.map((p, i) => (
                                            <tr key={i} className="hover:bg-white/[0.03]">
                                                <td className="px-4 py-2 text-[12px] font-bold text-slate-400 whitespace-nowrap">{p.codigoBarras}</td>
                                                <td className="px-4 py-2 text-[13px] font-bold text-slate-200">{p.descripcion}</td>
                                                <td className="px-4 py-2 text-[13px] font-bold text-slate-200 text-right whitespace-nowrap">{p.mov} {p.medida}</td>
                                                <td className="px-4 py-2 text-[13px] font-bold text-slate-300 text-right">{fmtMoney(p.costo)}</td>
                                                <td className="px-4 py-2 text-[13px] font-black text-emerald-300 text-right">{fmtMoney(p.importe)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            ) : null}
                        </div>

                        {!loadingModal && (
                            <div className="px-6 py-3.5 border-t border-white/10 flex flex-wrap items-center justify-end gap-x-8 gap-y-2">
                                {detalleFactura && (
                                    <>
                                        <div className="text-right">
                                            <p className={lbl}>Tickets Amparados</p>
                                            <p className="text-[15px] font-black text-slate-200">{fmtInt(detalleFactura.ventas.length)}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className={lbl}>Suma Tickets</p>
                                            <p className="text-[15px] font-black text-emerald-300">
                                                {fmtMoney(detalleFactura.ventas.reduce((a, v) => a + v.total, 0))}
                                            </p>
                                        </div>
                                        {detalleFactura.factura.iva > 0 && (
                                            <div className="text-right">
                                                <p className={lbl}>IVA</p>
                                                <p className="text-[15px] font-black text-slate-200">{fmtMoney(detalleFactura.factura.iva)}</p>
                                            </div>
                                        )}
                                        <div className="text-right">
                                            <p className={lbl}>Total Factura</p>
                                            <p className="text-[15px] font-black text-cyan-300">{fmtMoney(modal.total)}</p>
                                        </div>
                                    </>
                                )}
                                {partidasTraslado && (
                                    <>
                                        {usuarioSalida && (
                                            <div className="text-right">
                                                <p className={lbl}>Realizó Salida</p>
                                                <p className="text-[13px] font-black text-slate-200">{usuarioSalida}</p>
                                            </div>
                                        )}
                                        <div className="text-right">
                                            <p className={lbl}>Partidas</p>
                                            <p className="text-[15px] font-black text-slate-200">{fmtInt(partidasTraslado.length)}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className={lbl}>Monto</p>
                                            <p className="text-[15px] font-black text-emerald-300">
                                                {fmtMoney(partidasTraslado.reduce((a, p) => a + p.importe, 0))}
                                            </p>
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
