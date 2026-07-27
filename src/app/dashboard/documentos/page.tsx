"use client"

import { useCallback, useEffect, useState } from "react"
import {
    Loader2, AlertTriangle, X, Plus, Search, RefreshCw, Download,
    FolderOpen, FileText, FileSpreadsheet, Image as ImageIcon, File as FileIcon,
    Trash2, Eye, Upload
} from "lucide-react"
import { cn } from "@/lib/utils"
import { fmtInt, fmtFechaHora, fmtTamano } from "@/lib/format"
import { DropZone } from "@/components/dashboard/DropZone"

interface Documento {
    idDocumento: number
    idCarpeta: number
    carpeta: string
    nombre: string
    nombreArchivo: string
    tamano: number
    tipoMime: string
    todasTiendas: boolean
    subidoPor: string
    fecha: string
    descargas: number
}

interface Carpeta { idCarpeta: number; nombre: string }
interface TiendaOption { IdTienda: number; Tienda: string }
interface Descarga { tienda: string; usuario: string; fecha: string }

const lbl = "text-[10px] font-black text-slate-500 uppercase tracking-widest"
const inputCls = "block w-full px-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-400/25 focus:border-emerald-400/60 transition-all"

const IconoArchivo = ({ nombre, mime }: { nombre: string; mime: string }) => {
    const ext = nombre.split(".").pop()?.toLowerCase() ?? ""
    if (mime.includes("pdf") || ext === "pdf") return <FileText className="h-5 w-5 text-rose-400" />
    if (mime.includes("sheet") || ["xlsx", "xls", "csv"].includes(ext)) return <FileSpreadsheet className="h-5 w-5 text-emerald-400" />
    if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return <ImageIcon className="h-5 w-5 text-cyan-400" />
    if (["doc", "docx"].includes(ext)) return <FileText className="h-5 w-5 text-blue-400" />
    return <FileIcon className="h-5 w-5 text-slate-400" />
}

export default function DocumentosPage() {
    const [documentos, setDocumentos] = useState<Documento[]>([])
    const [carpetas, setCarpetas] = useState<Carpeta[]>([])
    const [carpetaSel, setCarpetaSel] = useState(0)
    const [busqueda, setBusqueda] = useState("")
    const [rol, setRol] = useState<"oficina" | "tienda">("tienda")
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState("")

    // Modal subir (oficina)
    const [subirAbierto, setSubirAbierto] = useState(false)
    const [archivos, setArchivos] = useState<File[]>([])
    const [nombre, setNombre] = useState("")
    const [arrastrandoPagina, setArrastrandoPagina] = useState(false)
    const [carpetaNueva, setCarpetaNueva] = useState("")
    const [carpetaDestino, setCarpetaDestino] = useState(0)
    const [todasTiendas, setTodasTiendas] = useState(true)
    const [tiendas, setTiendas] = useState<TiendaOption[]>([])
    const [tiendasSel, setTiendasSel] = useState<Set<number>>(new Set())
    const [subiendo, setSubiendo] = useState(false)

    // Modal auditoría de descargas (oficina)
    const [auditoria, setAuditoria] = useState<{ nombre: string; total: number; descargas: Descarga[] } | null>(null)
    const [loadingAuditoria, setLoadingAuditoria] = useState(false)

    const cargar = useCallback(async (carpeta: number, filtro: string) => {
        setLoading(true)
        setError("")
        try {
            const qs = new URLSearchParams()
            if (carpeta > 0) qs.set("carpeta", String(carpeta))
            if (filtro) qs.set("busqueda", filtro)
            const res = await fetch(`/api/documentos?${qs.toString()}`)
            if (res.status === 401) { window.location.href = "/login"; return }
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "Error al consultar documentos")
            setDocumentos(json.documentos)
            setCarpetas(json.carpetas)
            setRol(json.rol)
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Error desconocido")
            setDocumentos([])
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        cargar(0, "")
    }, [cargar])

    const cambiarCarpeta = (id: number) => {
        setCarpetaSel(id)
        cargar(id, busqueda.trim())
    }

    const abrirSubir = async () => {
        setSubirAbierto(true)
        if (tiendas.length === 0) {
            try {
                const res = await fetch("/api/auth/tiendas")
                const json = await res.json()
                if (res.ok) setTiendas(json.tiendas)
            } catch { /* multiselect vacío */ }
        }
    }

    const subir = async () => {
        if (archivos.length === 0) { setError("Selecciona o arrastra al menos un archivo"); return }
        setSubiendo(true)
        setError("")
        try {
            let idCarpeta = carpetaDestino
            if (carpetaNueva.trim()) {
                const res = await fetch("/api/documentos/carpetas", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ nombre: carpetaNueva.trim() }),
                })
                const json = await res.json()
                if (res.ok) idCarpeta = json.idCarpeta
            }

            // Cada archivo se sube como un documento propio
            for (const archivo of archivos) {
                const form = new FormData()
                form.set("archivo", archivo)
                form.set("nombre", archivos.length === 1 ? (nombre.trim() || archivo.name) : archivo.name)
                form.set("carpeta", String(idCarpeta))
                form.set("tiendas", JSON.stringify(todasTiendas ? [] : [...tiendasSel]))

                const res = await fetch("/api/documentos", { method: "POST", body: form })
                const json = await res.json()
                if (!res.ok) throw new Error(json.error || `Error al subir "${archivo.name}"`)
            }

            setSubirAbierto(false)
            setArchivos([]); setNombre(""); setCarpetaNueva(""); setCarpetaDestino(0)
            setTodasTiendas(true); setTiendasSel(new Set())
            cargar(carpetaSel, busqueda.trim())
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Error al subir el documento")
        } finally {
            setSubiendo(false)
        }
    }

    // Soltar archivos en cualquier parte de la página abre el modal de subida (oficina)
    const soltarEnPagina = (files: FileList) => {
        if (rol !== "oficina") return
        const nuevos = [...files]
        if (nuevos.length === 0) return
        setArchivos(prev => [...prev, ...nuevos])
        abrirSubir()
    }

    const verAuditoria = async (d: Documento) => {
        setLoadingAuditoria(true)
        setAuditoria(null)
        try {
            const res = await fetch(`/api/documentos/${d.idDocumento}/descargas`)
            const json = await res.json()
            if (res.ok) setAuditoria(json)
            else setError(json.error || "Error al consultar descargas")
        } catch {
            setError("Error al consultar la auditoría")
        } finally {
            setLoadingAuditoria(false)
        }
    }

    const retirar = async (d: Documento) => {
        if (!window.confirm(`¿Retirar el documento "${d.nombre}"?`)) return
        try {
            const res = await fetch(`/api/documentos/${d.idDocumento}`, { method: "DELETE" })
            if (res.ok) cargar(carpetaSel, busqueda.trim())
        } catch {
            setError("No fue posible retirar el documento")
        }
    }

    const alternarTienda = (id: number) => {
        setTiendasSel(prev => {
            const s = new Set(prev)
            if (s.has(id)) s.delete(id)
            else s.add(id)
            return s
        })
    }

    return (
        <div
            className={cn(
                "space-y-4 rounded-2xl transition-all",
                arrastrandoPagina && rol === "oficina" && "ring-2 ring-emerald-400/50 ring-offset-4 ring-offset-[#060a12]"
            )}
            onDragOver={e => {
                if (rol === "oficina") {
                    e.preventDefault()
                    setArrastrandoPagina(true)
                }
            }}
            onDragLeave={e => {
                if (e.currentTarget === e.target) setArrastrandoPagina(false)
            }}
            onDrop={e => {
                if (rol === "oficina") {
                    e.preventDefault()
                    setArrastrandoPagina(false)
                    soltarEnPagina(e.dataTransfer.files)
                }
            }}
        >
            {/* Encabezado */}
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-black text-white uppercase tracking-tight">Documentos</h1>
                    <p className="text-[12px] font-bold text-slate-500 mt-1">
                        {loading ? "Consultando..." : `${fmtInt(documentos.length)} documentos disponibles`}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="relative min-w-[220px]">
                        <Search className="absolute top-1/2 -translate-y-1/2 left-3.5 h-4 w-4 text-slate-500" />
                        <input
                            type="text"
                            placeholder="BUSCAR DOCUMENTO..."
                            className={cn(inputCls, "pl-10 py-2")}
                            value={busqueda}
                            onChange={e => setBusqueda(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && cargar(carpetaSel, busqueda.trim())}
                        />
                    </div>
                    <button
                        onClick={() => cargar(carpetaSel, busqueda.trim())}
                        className="p-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 hover:text-emerald-300 hover:border-emerald-500/30 transition-all"
                        title="Actualizar"
                    >
                        <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                    </button>
                    {rol === "oficina" && (
                        <button
                            onClick={abrirSubir}
                            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500 text-slate-950 font-black text-[11px] uppercase tracking-widest hover:brightness-110 transition-all"
                        >
                            <Upload className="h-4 w-4" /> Subir Documento
                        </button>
                    )}
                </div>
            </div>

            {/* Carpetas */}
            <div className="flex flex-wrap gap-2">
                <button
                    onClick={() => cambiarCarpeta(0)}
                    className={cn(
                        "flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-widest border transition-all",
                        carpetaSel === 0
                            ? "bg-emerald-500 text-slate-950 border-emerald-500"
                            : "bg-white/[0.04] text-slate-400 border-white/10 hover:text-white"
                    )}
                >
                    <FolderOpen className="h-3.5 w-3.5" /> Todas
                </button>
                {carpetas.map(c => (
                    <button
                        key={c.idCarpeta}
                        onClick={() => cambiarCarpeta(c.idCarpeta)}
                        className={cn(
                            "flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-widest border transition-all",
                            carpetaSel === c.idCarpeta
                                ? "bg-emerald-500 text-slate-950 border-emerald-500"
                                : "bg-white/[0.04] text-slate-400 border-white/10 hover:text-white"
                        )}
                    >
                        <FolderOpen className="h-3.5 w-3.5" /> {c.nombre}
                    </button>
                ))}
            </div>

            {error && (
                <div className="flex items-center gap-2 text-rose-300 text-[11px] font-black bg-rose-500/10 p-3 rounded-xl border border-rose-500/25 uppercase tracking-wider">
                    <AlertTriangle className="h-4 w-4" /> {error}
                </div>
            )}

            {/* Lista de documentos */}
            {loading ? (
                <div className="flex items-center justify-center py-32">
                    <Loader2 className="h-8 w-8 text-emerald-400 animate-spin" />
                </div>
            ) : documentos.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-32 gap-3 bg-white/[0.04] border border-white/10 rounded-2xl">
                    <FolderOpen className="h-8 w-8 text-slate-700" />
                    <p className="text-[12px] font-bold text-slate-600 uppercase tracking-widest">
                        Sin documentos en esta carpeta
                    </p>
                </div>
            ) : (
                <div className="bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl overflow-hidden divide-y divide-white/[0.04]">
                    {documentos.map(d => (
                        <div key={d.idDocumento} className="px-5 py-3.5 flex items-center gap-4 hover:bg-white/[0.02] transition-colors">
                            <div className="shrink-0 w-10 h-10 rounded-xl bg-white/[0.04] border border-white/10 flex items-center justify-center">
                                <IconoArchivo nombre={d.nombreArchivo} mime={d.tipoMime} />
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-[13px] font-black text-slate-100 truncate">{d.nombre}</p>
                                <p className="text-[11px] font-bold text-slate-500 truncate">
                                    {d.nombreArchivo} · {fmtTamano(d.tamano)} · {d.carpeta}
                                    {!d.todasTiendas ? " · Tiendas específicas" : ""}
                                </p>
                                <p className="text-[10px] font-bold text-slate-600">
                                    {d.subidoPor} · {fmtFechaHora(d.fecha)}
                                </p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                                {rol === "oficina" && (
                                    <>
                                        <button
                                            onClick={() => verAuditoria(d)}
                                            className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-white/[0.05] border border-white/10 text-slate-400 hover:text-cyan-300 hover:border-cyan-500/30 transition-all text-[11px] font-black"
                                            title="Ver quién lo ha descargado"
                                        >
                                            <Eye className="h-4 w-4" /> {fmtInt(d.descargas)}
                                        </button>
                                        <button
                                            onClick={() => retirar(d)}
                                            className="p-2 rounded-lg bg-white/[0.05] border border-white/10 text-slate-400 hover:text-rose-300 hover:border-rose-500/30 transition-all"
                                            title="Retirar documento"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </>
                                )}
                                <a
                                    href={`/api/documentos/${d.idDocumento}/descargar`}
                                    className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-emerald-500 text-slate-950 font-black text-[11px] uppercase tracking-widest hover:brightness-110 transition-all"
                                >
                                    <Download className="h-4 w-4" /> Descargar
                                </a>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Modal subir documento */}
            {subirAbierto && (
                <div
                    className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
                    onClick={() => setSubirAbierto(false)}
                >
                    <div
                        className="w-full max-w-2xl max-h-[90vh] bg-[#0d1320] border border-white/10 rounded-2xl shadow-2xl shadow-black/60 overflow-auto"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
                            <h3 className="text-[15px] font-black text-white">Subir Documento</h3>
                            <button
                                onClick={() => setSubirAbierto(false)}
                                className="p-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-400 hover:text-white transition-all"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className={cn(lbl, "block mb-1.5 pl-1")}>Archivos (máx. 25 MB c/u)</label>
                                <DropZone
                                    multiple
                                    onFiles={fs => {
                                        setArchivos(prev => [...prev, ...fs])
                                        if (fs.length === 1 && !nombre.trim()) setNombre(fs[0].name)
                                    }}
                                    mensaje="Arrastra los archivos aquí o haz clic para seleccionar"
                                />
                                {archivos.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        {archivos.map((a, i) => (
                                            <span
                                                key={`${a.name}-${i}`}
                                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 text-[11px] font-bold"
                                            >
                                                <FileIcon className="h-3.5 w-3.5 text-cyan-400" />
                                                <span className="max-w-[200px] truncate">{a.name}</span>
                                                <span className="text-slate-500">({fmtTamano(a.size)})</span>
                                                <button
                                                    onClick={() => setArchivos(prev => prev.filter((_, j) => j !== i))}
                                                    className="text-slate-500 hover:text-rose-300 transition-colors"
                                                >
                                                    <X className="h-3.5 w-3.5" />
                                                </button>
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                            {archivos.length === 1 && (
                                <div>
                                    <label className={cn(lbl, "block mb-1.5 pl-1")}>Nombre para mostrar</label>
                                    <input
                                        type="text"
                                        className={inputCls}
                                        value={nombre}
                                        onChange={e => setNombre(e.target.value)}
                                        maxLength={200}
                                        placeholder="Nombre del documento"
                                    />
                                </div>
                            )}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className={cn(lbl, "block mb-1.5 pl-1")}>Carpeta</label>
                                    <select
                                        className={cn(inputCls, "appearance-none [color-scheme:dark]")}
                                        value={carpetaDestino}
                                        onChange={e => setCarpetaDestino(Number(e.target.value))}
                                        disabled={Boolean(carpetaNueva.trim())}
                                    >
                                        <option value={0} className="bg-[#0b1220]">SIN CARPETA</option>
                                        {carpetas.map(c => (
                                            <option key={c.idCarpeta} value={c.idCarpeta} className="bg-[#0b1220]">{c.nombre}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className={cn(lbl, "block mb-1.5 pl-1")}>...o crear carpeta nueva</label>
                                    <input
                                        type="text"
                                        className={inputCls}
                                        value={carpetaNueva}
                                        onChange={e => setCarpetaNueva(e.target.value)}
                                        maxLength={100}
                                        placeholder="Nombre de carpeta nueva"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="flex items-center gap-2 cursor-pointer select-none mb-2">
                                    <input
                                        type="checkbox"
                                        checked={todasTiendas}
                                        onChange={e => setTodasTiendas(e.target.checked)}
                                        className="accent-emerald-500 h-4 w-4"
                                    />
                                    <span className="text-[11px] font-black text-slate-300 uppercase tracking-widest">Todas las tiendas</span>
                                </label>
                                {!todasTiendas && (
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 p-3 rounded-xl bg-white/[0.03] border border-white/10 max-h-48 overflow-auto">
                                        {tiendas.map(t => (
                                            <label key={t.IdTienda} className="flex items-center gap-2 cursor-pointer select-none py-0.5">
                                                <input
                                                    type="checkbox"
                                                    checked={tiendasSel.has(t.IdTienda)}
                                                    onChange={() => alternarTienda(t.IdTienda)}
                                                    className="accent-emerald-500 h-3.5 w-3.5"
                                                />
                                                <span className="text-[11px] font-bold text-slate-300 truncate">{t.Tienda}</span>
                                            </label>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="px-6 py-4 border-t border-white/10 flex justify-end gap-2">
                            <button
                                onClick={() => setSubirAbierto(false)}
                                className="px-4 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 font-black text-[11px] uppercase tracking-widest hover:text-white transition-all"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={subir}
                                disabled={subiendo || archivos.length === 0 || (!todasTiendas && tiendasSel.size === 0)}
                                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 text-slate-950 font-black text-[11px] uppercase tracking-widest hover:brightness-110 transition-all disabled:opacity-50"
                            >
                                {subiendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                                Subir {archivos.length > 1 ? `(${archivos.length})` : ""}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal auditoría de descargas */}
            {(auditoria || loadingAuditoria) && (
                <div
                    className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
                    onClick={() => { setAuditoria(null); setLoadingAuditoria(false) }}
                >
                    <div
                        className="w-full max-w-xl max-h-[85vh] bg-[#0d1320] border border-white/10 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden flex flex-col"
                        onClick={e => e.stopPropagation()}
                    >
                        {loadingAuditoria ? (
                            <div className="flex items-center justify-center py-24">
                                <Loader2 className="h-7 w-7 text-emerald-400 animate-spin" />
                            </div>
                        ) : auditoria && (
                            <>
                                <div className="px-6 py-4 border-b border-white/10 flex items-start justify-between gap-3">
                                    <div>
                                        <h3 className="text-[15px] font-black text-white">Descargas</h3>
                                        <p className="text-[12px] font-bold text-slate-400 mt-1">{auditoria.nombre}</p>
                                        <p className="text-[11px] font-bold text-slate-500 mt-0.5">{fmtInt(auditoria.total)} descargas registradas</p>
                                    </div>
                                    <button
                                        onClick={() => setAuditoria(null)}
                                        className="p-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-400 hover:text-white transition-all"
                                    >
                                        <X className="h-4 w-4" />
                                    </button>
                                </div>
                                <div className="overflow-auto flex-1 divide-y divide-white/[0.04]">
                                    {auditoria.descargas.length === 0 ? (
                                        <p className="py-10 text-center text-[12px] font-bold text-slate-600 uppercase tracking-widest">
                                            Nadie lo ha descargado aún
                                        </p>
                                    ) : auditoria.descargas.map((d, i) => (
                                        <div key={i} className="px-6 py-2.5 flex items-center justify-between gap-3">
                                            <div>
                                                <p className="text-[13px] font-bold text-slate-200">{d.usuario}</p>
                                                <p className="text-[11px] font-bold text-slate-500">{d.tienda}</p>
                                            </div>
                                            <span className="text-[11px] font-bold text-slate-400 whitespace-nowrap">{fmtFechaHora(d.fecha)}</span>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
