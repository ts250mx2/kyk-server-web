"use client"

import { useCallback, useEffect, useState } from "react"
import {
    Loader2, AlertTriangle, X, Plus, Search, RefreshCw, Download,
    FolderOpen, FileText, FileSpreadsheet, Image as ImageIcon, File as FileIcon,
    Trash2, Eye, Upload, Folder, FolderPlus, ArrowLeft, ChevronRight, Check,
    FileArchive, FileVideo, FileAudio, FileCode, Presentation, Info, FolderInput
} from "lucide-react"
import { cn } from "@/lib/utils"
import { fmtInt, fmtFechaHora, fmtTamano } from "@/lib/format"
import { DropZone } from "@/components/dashboard/DropZone"
import { MenuContextual, PropiedadesModal, type OpcionMenu } from "@/components/dashboard/DocumentosMenus"

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

interface Carpeta { idCarpeta: number; nombre: string; idPadre: number; documentos: number }

// Cadena de carpetas desde la raíz hasta la indicada (breadcrumb y rutas)
const rutaHasta = (carpetas: Carpeta[], id: number): Carpeta[] => {
    const ruta: Carpeta[] = []
    let actual = id
    for (let i = 0; i < 10 && actual > 0; i++) {
        const c = carpetas.find(x => x.idCarpeta === actual)
        if (!c) break
        ruta.unshift(c)
        actual = c.idPadre
    }
    return ruta
}
interface TiendaOption { IdTienda: number; Tienda: string }
interface Descarga { tienda: string; usuario: string; fecha: string }

const lbl = "text-[10px] font-black text-slate-500 uppercase tracking-widest"
const inputCls = "block w-full px-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-400/25 focus:border-emerald-400/60 transition-all"

// Icono por tipo de archivo, como los iconos del explorador de Windows
const IconoArchivo = ({ nombre, mime, clase = "h-5 w-5" }: { nombre: string; mime: string; clase?: string }) => {
    const ext = nombre.split(".").pop()?.toLowerCase() ?? ""
    if (mime.includes("pdf") || ext === "pdf") return <FileText className={cn(clase, "text-rose-400")} />
    if (mime.includes("sheet") || ["xlsx", "xls", "xlsm", "csv"].includes(ext)) return <FileSpreadsheet className={cn(clase, "text-emerald-400")} />
    if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(ext)) return <ImageIcon className={cn(clase, "text-cyan-400")} />
    if (["doc", "docx", "rtf", "odt"].includes(ext)) return <FileText className={cn(clase, "text-blue-400")} />
    if (["ppt", "pptx", "odp"].includes(ext)) return <Presentation className={cn(clase, "text-orange-400")} />
    if (["zip", "rar", "7z", "gz", "tar"].includes(ext)) return <FileArchive className={cn(clase, "text-amber-400")} />
    if (mime.startsWith("video/") || ["mp4", "avi", "mkv", "mov", "wmv"].includes(ext)) return <FileVideo className={cn(clase, "text-violet-400")} />
    if (mime.startsWith("audio/") || ["mp3", "wav", "ogg", "wma"].includes(ext)) return <FileAudio className={cn(clase, "text-pink-400")} />
    if (["xml", "json", "html", "js", "ts", "sql", "txt", "log"].includes(ext)) return <FileCode className={cn(clase, "text-teal-400")} />
    return <FileIcon className={cn(clase, "text-slate-400")} />
}

export default function DocumentosPage() {
    const [documentos, setDocumentos] = useState<Documento[]>([])
    const [carpetas, setCarpetas] = useState<Carpeta[]>([])
    const [carpetaSel, setCarpetaSel] = useState(0)
    const [busqueda, setBusqueda] = useState("")
    const [rol, setRol] = useState<"oficina" | "tienda">("tienda")
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState("")

    // Nueva carpeta en el explorador (oficina)
    const [creandoCarpeta, setCreandoCarpeta] = useState(false)
    const [nombreCarpeta, setNombreCarpeta] = useState("")

    // Explorador estilo Windows: menú contextual, propiedades, mover y arrastres
    const [menu, setMenu] = useState<{ x: number; y: number; tipo: "area" | "carpeta" | "doc"; doc?: Documento; carpeta?: Carpeta } | null>(null)
    const [propiedades, setPropiedades] = useState<Documento | null>(null)
    const [moverDoc, setMoverDoc] = useState<Documento | null>(null)
    const [arrastrandoPanel, setArrastrandoPanel] = useState(false)
    const [carpetaHover, setCarpetaHover] = useState(0)

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

    const crearCarpeta = async () => {
        const nombre = nombreCarpeta.trim()
        if (!nombre) return
        setError("")
        try {
            const res = await fetch("/api/documentos/carpetas", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ nombre, idPadre: carpetaSel }),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "No fue posible crear la carpeta")
            setCreandoCarpeta(false)
            setNombreCarpeta("")
            cargar(carpetaSel, busqueda.trim())
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "No fue posible crear la carpeta")
        }
    }

    const borrarCarpeta = async (c: Carpeta) => {
        if (!window.confirm(`¿Eliminar la carpeta "${c.nombre}"?`)) return
        setError("")
        try {
            const res = await fetch(`/api/documentos/carpetas?idCarpeta=${c.idCarpeta}`, { method: "DELETE" })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "No fue posible eliminar la carpeta")
            if (carpetaSel === c.idCarpeta) setCarpetaSel(0)
            cargar(carpetaSel === c.idCarpeta ? 0 : carpetaSel, busqueda.trim())
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "No fue posible eliminar la carpeta")
        }
    }

    // Mover documento a otra carpeta (arrastrándolo o desde el menú contextual)
    const mover = async (idDocumento: number, idCarpeta: number) => {
        setError("")
        try {
            const res = await fetch(`/api/documentos/${idDocumento}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ idCarpeta }),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "No fue posible mover el documento")
            cargar(carpetaSel, busqueda.trim())
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "No fue posible mover el documento")
        }
    }

    const abrirSubir = async () => {
        // Precarga la carpeta abierta como destino de la subida
        setCarpetaDestino(carpetaSel)
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

    // Árbol de carpetas: ruta actual, subcarpetas del nivel abierto y ruta completa
    const rutaActual = rutaHasta(carpetas, carpetaSel)
    const subcarpetas = carpetas.filter(c => c.idPadre === carpetaSel)
    const rutaDe = (id: number) => rutaHasta(carpetas, id).map(c => c.nombre).join(" / ")

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

            {error && (
                <div className="flex items-center gap-2 text-rose-300 text-[11px] font-black bg-rose-500/10 p-3 rounded-xl border border-rose-500/25 uppercase tracking-wider">
                    <AlertTriangle className="h-4 w-4" /> {error}
                </div>
            )}

            {/* Panel único del explorador (carpetas + archivos) al estilo Windows:
                aquí mismo se sueltan archivos para subirlos, el clic derecho abre
                el menú contextual y los archivos se arrastran a las carpetas */}
            <div
                className={cn(
                    "bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl p-4 min-h-[420px] space-y-4 transition-all",
                    arrastrandoPanel && "border-emerald-400/60 bg-emerald-500/[0.04]"
                )}
                onDragOver={e => {
                    if (rol === "oficina" && e.dataTransfer.types.includes("Files")) {
                        e.preventDefault()
                        e.stopPropagation()
                        setArrastrandoPanel(true)
                    }
                }}
                onDragLeave={e => { if (e.currentTarget === e.target) setArrastrandoPanel(false) }}
                onDrop={e => {
                    if (rol === "oficina" && e.dataTransfer.types.includes("Files")) {
                        e.preventDefault()
                        e.stopPropagation()
                        setArrastrandoPanel(false)
                        soltarEnPagina(e.dataTransfer.files)
                    }
                }}
                onContextMenu={e => {
                    e.preventDefault()
                    setMenu({ x: e.clientX, y: e.clientY, tipo: "area" })
                }}
            >
            {carpetaSel > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                    <button
                        onClick={() => cambiarCarpeta(rutaActual[rutaActual.length - 2]?.idCarpeta ?? 0)}
                        className="p-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-400 hover:text-white transition-all"
                        title="Regresar a la carpeta anterior"
                    >
                        <ArrowLeft className="h-4 w-4" />
                    </button>
                    <button
                        onClick={() => cambiarCarpeta(0)}
                        onDragOver={e => {
                            if (e.dataTransfer.types.includes("application/x-documento")) { e.preventDefault(); e.stopPropagation() }
                        }}
                        onDrop={e => {
                            if (e.dataTransfer.types.includes("application/x-documento")) {
                                e.preventDefault()
                                e.stopPropagation()
                                const id = Number(e.dataTransfer.getData("application/x-documento"))
                                if (id > 0) mover(id, 0)
                            }
                        }}
                        className="text-[12px] font-black text-slate-500 hover:text-white uppercase tracking-widest transition-colors"
                        title="Ir a la raíz — suelta aquí un archivo para moverlo a Sin carpeta"
                    >
                        Documentos
                    </button>
                    {rutaActual.map((c, i) => (
                        <span key={c.idCarpeta} className="flex items-center gap-2">
                            <ChevronRight className="h-3.5 w-3.5 text-slate-600" />
                            {i === rutaActual.length - 1 ? (
                                <span className="flex items-center gap-1.5 text-[12px] font-black text-amber-300 uppercase tracking-widest">
                                    <Folder className="h-4 w-4 fill-amber-400/25" /> {c.nombre}
                                </span>
                            ) : (
                                <button
                                    onClick={() => cambiarCarpeta(c.idCarpeta)}
                                    onDragOver={e => {
                                        if (e.dataTransfer.types.includes("application/x-documento")) { e.preventDefault(); e.stopPropagation() }
                                    }}
                                    onDrop={e => {
                                        if (e.dataTransfer.types.includes("application/x-documento")) {
                                            e.preventDefault()
                                            e.stopPropagation()
                                            const id = Number(e.dataTransfer.getData("application/x-documento"))
                                            if (id > 0) mover(id, c.idCarpeta)
                                        }
                                    }}
                                    className="text-[12px] font-black text-slate-500 hover:text-white uppercase tracking-widest transition-colors"
                                    title={`Ir a ${c.nombre} — suelta aquí un archivo para moverlo`}
                                >
                                    {c.nombre}
                                </button>
                            )}
                        </span>
                    ))}
                </div>
            )}

            {rol === "oficina" && (
                <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">
                    Arrastra archivos a esta área para subirlos a {carpetaSel > 0 ? `"${rutaDe(carpetaSel)}"` : '"Sin carpeta"'} ·
                    clic derecho para opciones · arrastra un archivo a una carpeta para moverlo
                </p>
            )}

            {loading ? (
                <div className="flex items-center justify-center py-28">
                    <Loader2 className="h-8 w-8 text-emerald-400 animate-spin" />
                </div>
            ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                    {subcarpetas.map(c => {
                        const nSub = carpetas.filter(x => x.idPadre === c.idCarpeta).length
                        return (
                            <div
                                key={c.idCarpeta}
                                className="relative group"
                                onContextMenu={e => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    setMenu({ x: e.clientX, y: e.clientY, tipo: "carpeta", carpeta: c })
                                }}
                                onDragOver={e => {
                                    if (rol === "oficina" && e.dataTransfer.types.includes("application/x-documento")) {
                                        e.preventDefault()
                                        e.stopPropagation()
                                        setCarpetaHover(c.idCarpeta)
                                    }
                                }}
                                onDragLeave={() => setCarpetaHover(h => (h === c.idCarpeta ? 0 : h))}
                                onDrop={e => {
                                    if (rol === "oficina" && e.dataTransfer.types.includes("application/x-documento")) {
                                        e.preventDefault()
                                        e.stopPropagation()
                                        setCarpetaHover(0)
                                        const id = Number(e.dataTransfer.getData("application/x-documento"))
                                        if (id > 0) mover(id, c.idCarpeta)
                                    }
                                }}
                            >
                                <button
                                    onClick={() => cambiarCarpeta(c.idCarpeta)}
                                    className={cn(
                                        "w-full flex flex-col items-center gap-1.5 p-4 rounded-2xl bg-white/[0.04] border border-white/10 hover:bg-white/[0.07] hover:border-amber-400/40 transition-all",
                                        carpetaHover === c.idCarpeta && "border-emerald-400/70 bg-emerald-500/10 scale-[1.03]"
                                    )}
                                    title={`Abrir la carpeta ${c.nombre}`}
                                >
                                    <Folder className="h-10 w-10 text-amber-400 fill-amber-400/25" />
                                    <span className="text-[12px] font-black text-slate-200 truncate w-full text-center">{c.nombre}</span>
                                    <span className="text-[10px] font-bold text-slate-500">
                                        {nSub > 0 ? `${fmtInt(nSub)} carp · ` : ""}
                                        {fmtInt(c.documentos)} doc{c.documentos !== 1 ? "s" : ""}
                                    </span>
                                </button>
                                {rol === "oficina" && (
                                    <button
                                        onClick={() => borrarCarpeta(c)}
                                        className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/50 border border-white/10 text-slate-500 hover:text-rose-300 hover:border-rose-500/40 opacity-0 group-hover:opacity-100 transition-all"
                                        title={c.documentos > 0 || nSub > 0 ? "Solo se pueden eliminar carpetas vacías" : "Eliminar carpeta"}
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                )}
                            </div>
                        )
                    })}

                    {rol === "oficina" && (creandoCarpeta ? (
                        <div className="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl bg-white/[0.02] border-2 border-dashed border-emerald-400/40">
                            <FolderPlus className="h-8 w-8 text-emerald-400" />
                            <input
                                autoFocus
                                type="text"
                                maxLength={100}
                                placeholder="Nombre..."
                                className="w-full px-2 py-1.5 bg-white/[0.05] border border-white/10 rounded-lg text-[12px] font-bold text-slate-100 text-center placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-400/25"
                                value={nombreCarpeta}
                                onChange={e => setNombreCarpeta(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === "Enter") crearCarpeta()
                                    if (e.key === "Escape") { setCreandoCarpeta(false); setNombreCarpeta("") }
                                }}
                            />
                            <div className="flex items-center gap-1.5">
                                <button
                                    onClick={crearCarpeta}
                                    disabled={!nombreCarpeta.trim()}
                                    className="p-1.5 rounded-lg bg-emerald-500 text-slate-950 hover:brightness-110 transition-all disabled:opacity-40"
                                    title="Crear carpeta (Enter)"
                                >
                                    <Check className="h-3.5 w-3.5" />
                                </button>
                                <button
                                    onClick={() => { setCreandoCarpeta(false); setNombreCarpeta("") }}
                                    className="p-1.5 rounded-lg bg-white/[0.05] border border-white/10 text-slate-400 hover:text-white transition-all"
                                    title="Cancelar (Esc)"
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        </div>
                    ) : (
                        <button
                            onClick={() => setCreandoCarpeta(true)}
                            className="flex flex-col items-center justify-center gap-2 p-4 min-h-[110px] rounded-2xl bg-white/[0.02] border-2 border-dashed border-white/15 text-slate-500 hover:text-emerald-300 hover:border-emerald-400/40 transition-all"
                        >
                            <FolderPlus className="h-8 w-8" />
                            <span className="text-[10px] font-black uppercase tracking-widest">Nueva Carpeta</span>
                        </button>
                    ))}

                    {/* Archivos en la misma cuadrícula, arrastrables a las carpetas */}
                    {documentos.map(d => (
                        <div
                            key={`doc-${d.idDocumento}`}
                            className="relative group"
                            draggable={rol === "oficina"}
                            onDragStart={e => {
                                e.dataTransfer.setData("application/x-documento", String(d.idDocumento))
                                e.dataTransfer.effectAllowed = "move"
                            }}
                            onContextMenu={e => {
                                e.preventDefault()
                                e.stopPropagation()
                                setMenu({ x: e.clientX, y: e.clientY, tipo: "doc", doc: d })
                            }}
                        >
                            <a
                                href={`/api/documentos/${d.idDocumento}/descargar`}
                                className="h-full flex flex-col items-center gap-1.5 p-4 rounded-2xl bg-white/[0.04] border border-white/10 hover:bg-white/[0.07] hover:border-emerald-400/40 transition-all"
                                title={`${d.nombre}\n${d.nombreArchivo} · ${fmtTamano(d.tamano)}${d.todasTiendas ? "" : "\nSolo tiendas específicas"}\n${d.subidoPor} · ${fmtFechaHora(d.fecha)}\nClic para descargar`}
                            >
                                <IconoArchivo nombre={d.nombreArchivo} mime={d.tipoMime} clase="h-10 w-10" />
                                <span className="text-[12px] font-black text-slate-200 w-full text-center leading-tight line-clamp-2 break-words">
                                    {d.nombre}
                                </span>
                                <span className="text-[10px] font-bold text-slate-500">{fmtTamano(d.tamano)}</span>
                            </a>
                            {/* Acciones al pasar el cursor, como el borrado de carpetas */}
                            <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                <a
                                    href={`/api/documentos/${d.idDocumento}/descargar`}
                                    className="p-1.5 rounded-lg bg-black/50 border border-white/10 text-slate-400 hover:text-emerald-300 hover:border-emerald-500/40 transition-all"
                                    title="Descargar"
                                >
                                    <Download className="h-3.5 w-3.5" />
                                </a>
                                {rol === "oficina" && (
                                    <>
                                        <button
                                            onClick={() => verAuditoria(d)}
                                            className="p-1.5 rounded-lg bg-black/50 border border-white/10 text-slate-400 hover:text-cyan-300 hover:border-cyan-500/40 transition-all"
                                            title={`${fmtInt(d.descargas)} descargas — ver quién lo ha bajado`}
                                        >
                                            <Eye className="h-3.5 w-3.5" />
                                        </button>
                                        <button
                                            onClick={() => retirar(d)}
                                            className="p-1.5 rounded-lg bg-black/50 border border-white/10 text-slate-400 hover:text-rose-300 hover:border-rose-500/40 transition-all"
                                            title="Retirar documento"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {!loading && rol !== "oficina" && subcarpetas.length === 0 && documentos.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                    <FolderOpen className="h-8 w-8 text-slate-700" />
                    <p className="text-[12px] font-bold text-slate-600 uppercase tracking-widest">
                        Carpeta vacía
                    </p>
                </div>
            )}
            </div>

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
                                        {[...carpetas]
                                            .sort((a, b) => rutaDe(a.idCarpeta).localeCompare(rutaDe(b.idCarpeta)))
                                            .map(c => (
                                                <option key={c.idCarpeta} value={c.idCarpeta} className="bg-[#0b1220]">
                                                    {rutaDe(c.idCarpeta)}
                                                </option>
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

            {/* Menú contextual (clic derecho), como el explorador de Windows */}
            {menu && (
                <MenuContextual
                    x={menu.x}
                    y={menu.y}
                    onCerrar={() => setMenu(null)}
                    opciones={((): OpcionMenu[] => {
                        if (menu.tipo === "doc" && menu.doc) {
                            const d = menu.doc
                            return [
                                { etiqueta: "Descargar", icono: <Download className="h-4 w-4" />, onClick: () => window.open(`/api/documentos/${d.idDocumento}/descargar`, "_self") },
                                { etiqueta: "Propiedades", icono: <Info className="h-4 w-4" />, onClick: () => setPropiedades(d) },
                                ...(rol === "oficina" ? [
                                    { etiqueta: "Mover a...", icono: <FolderInput className="h-4 w-4" />, onClick: () => setMoverDoc(d) },
                                    { etiqueta: "Auditoría de descargas", icono: <Eye className="h-4 w-4" />, onClick: () => verAuditoria(d) },
                                    { etiqueta: "Retirar", icono: <Trash2 className="h-4 w-4" />, peligro: true, separador: true, onClick: () => retirar(d) },
                                ] : []),
                            ]
                        }
                        if (menu.tipo === "carpeta" && menu.carpeta) {
                            const c = menu.carpeta
                            return [
                                { etiqueta: "Abrir", icono: <FolderOpen className="h-4 w-4" />, onClick: () => cambiarCarpeta(c.idCarpeta) },
                                ...(rol === "oficina" ? [
                                    { etiqueta: "Eliminar", icono: <Trash2 className="h-4 w-4" />, peligro: true, separador: true, onClick: () => borrarCarpeta(c) },
                                ] : []),
                            ]
                        }
                        return [
                            ...(rol === "oficina" ? [
                                { etiqueta: "Nueva carpeta", icono: <FolderPlus className="h-4 w-4" />, onClick: () => setCreandoCarpeta(true) },
                                { etiqueta: "Subir archivos...", icono: <Upload className="h-4 w-4" />, onClick: abrirSubir },
                            ] : []),
                            { etiqueta: "Actualizar", icono: <RefreshCw className="h-4 w-4" />, onClick: () => cargar(carpetaSel, busqueda.trim()) },
                        ]
                    })()}
                />
            )}

            {/* Propiedades del documento */}
            {propiedades && (
                <PropiedadesModal
                    doc={propiedades}
                    ruta={propiedades.idCarpeta > 0 ? rutaDe(propiedades.idCarpeta) : ""}
                    esOficina={rol === "oficina"}
                    onClose={() => setPropiedades(null)}
                />
            )}

            {/* Mover documento a otra carpeta */}
            {moverDoc && (
                <div
                    className="fixed inset-0 z-[85] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
                    onClick={() => setMoverDoc(null)}
                >
                    <div
                        className="w-full max-w-md bg-[#0d1320] border border-white/10 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden flex flex-col max-h-[80vh]"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <h3 className="text-[15px] font-black text-white">Mover a...</h3>
                                <p className="text-[12px] font-bold text-slate-400 mt-1 truncate">{moverDoc.nombre}</p>
                            </div>
                            <button
                                onClick={() => setMoverDoc(null)}
                                className="p-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-400 hover:text-white transition-all"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="overflow-auto flex-1 p-3 space-y-1">
                            <button
                                onClick={() => { mover(moverDoc.idDocumento, 0); setMoverDoc(null) }}
                                disabled={moverDoc.idCarpeta === 0}
                                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-left text-[13px] font-bold text-slate-200 hover:bg-white/[0.06] transition-colors disabled:opacity-40"
                            >
                                <FolderOpen className="h-4 w-4 text-slate-500" /> Sin carpeta
                            </button>
                            {[...carpetas]
                                .sort((a, b) => rutaDe(a.idCarpeta).localeCompare(rutaDe(b.idCarpeta)))
                                .map(c => (
                                    <button
                                        key={c.idCarpeta}
                                        onClick={() => { mover(moverDoc.idDocumento, c.idCarpeta); setMoverDoc(null) }}
                                        disabled={moverDoc.idCarpeta === c.idCarpeta}
                                        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-left text-[13px] font-bold text-slate-200 hover:bg-white/[0.06] transition-colors disabled:opacity-40"
                                    >
                                        <Folder className="h-4 w-4 text-amber-400 fill-amber-400/25" /> {rutaDe(c.idCarpeta)}
                                    </button>
                                ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
