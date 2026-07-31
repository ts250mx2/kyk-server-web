"use client"

import { useEffect, useRef, useState } from "react"
import { X, ExternalLink, FileQuestion, Loader2, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"
import { fmtInt, fmtFechaHora, fmtTamano } from "@/lib/format"

export interface OpcionMenu {
    etiqueta: string
    icono?: React.ReactNode
    peligro?: boolean
    separador?: boolean
    onClick: () => void
}

// Menú contextual (clic derecho) del explorador de Documentos, al estilo
// del explorador de Windows. Se cierra con clic fuera, otro clic derecho o Esc.
export function MenuContextual({ x, y, opciones, onCerrar }: {
    x: number
    y: number
    opciones: OpcionMenu[]
    onCerrar: () => void
}) {
    useEffect(() => {
        const alTeclear = (e: KeyboardEvent) => { if (e.key === "Escape") onCerrar() }
        window.addEventListener("keydown", alTeclear)
        return () => window.removeEventListener("keydown", alTeclear)
    }, [onCerrar])

    // Que el menú no se salga de la pantalla
    const ancho = 224
    const alto = opciones.length * 38 + 12
    const left = typeof window !== "undefined" ? Math.min(x, window.innerWidth - ancho - 8) : x
    const top = typeof window !== "undefined" ? Math.min(y, window.innerHeight - alto - 8) : y

    return (
        <div
            className="fixed inset-0 z-[85]"
            onClick={onCerrar}
            onContextMenu={e => { e.preventDefault(); onCerrar() }}
        >
            <div
                className="absolute w-56 py-1.5 rounded-xl bg-[#0d1320] border border-white/10 shadow-2xl shadow-black/60"
                style={{ left, top }}
                onClick={e => e.stopPropagation()}
            >
                {opciones.map((o, i) => (
                    <div key={i}>
                        {o.separador && <div className="my-1 border-t border-white/[0.08]" />}
                        <button
                            onClick={() => { onCerrar(); o.onClick() }}
                            className={cn(
                                "w-full flex items-center gap-2.5 px-3.5 py-2 text-left text-[12px] font-bold transition-colors",
                                o.peligro ? "text-rose-300 hover:bg-rose-500/10" : "text-slate-200 hover:bg-white/[0.06]"
                            )}
                        >
                            {o.icono} {o.etiqueta}
                        </button>
                    </div>
                ))}
            </div>
        </div>
    )
}

// Tipos con vista previa: los nativos del navegador (PDF, imagen, video,
// audio, texto) más Word (.docx vía docx-preview) y Excel/CSV (vía SheetJS)
export function tipoVistaPrevia(
    nombreArchivo: string,
    mime: string
): "pdf" | "imagen" | "video" | "audio" | "texto" | "word" | "excel" | null {
    const ext = nombreArchivo.split(".").pop()?.toLowerCase() ?? ""
    if (mime.includes("pdf") || ext === "pdf") return "pdf"
    if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(ext)) return "imagen"
    if (mime.startsWith("video/") || ["mp4", "webm", "mov"].includes(ext)) return "video"
    if (mime.startsWith("audio/") || ["mp3", "wav", "ogg"].includes(ext)) return "audio"
    if (ext === "docx" || mime.includes("wordprocessingml")) return "word"
    if (["xlsx", "xls", "xlsm", "csv"].includes(ext) || mime.includes("sheet") || mime.includes("excel")) return "excel"
    if (["txt", "log", "json", "xml", "html"].includes(ext)) return "texto"
    return null
}

// Word (.docx): docx-preview renderiza el documento en el navegador, sin
// mandarlo a servicios externos (los .doc viejos no tienen soporte)
function VistaWord({ url }: { url: string }) {
    const contenedorRef = useRef<HTMLDivElement>(null)
    const [cargando, setCargando] = useState(true)
    const [error, setError] = useState("")

    useEffect(() => {
        let activo = true
        ;(async () => {
            try {
                const [res, docx] = await Promise.all([fetch(url), import("docx-preview")])
                if (!res.ok) throw new Error("No fue posible obtener el documento")
                const blob = await res.blob()
                if (!activo || !contenedorRef.current) return
                contenedorRef.current.innerHTML = ""
                await docx.renderAsync(blob, contenedorRef.current, undefined, {
                    inWrapper: true,
                    ignoreLastRenderedPageBreak: true,
                })
            } catch {
                if (activo) setError("No fue posible mostrar el documento de Word")
            } finally {
                if (activo) setCargando(false)
            }
        })()
        return () => { activo = false }
    }, [url])

    return (
        <div className="w-full h-full overflow-auto rounded-xl bg-white relative">
            {cargando && (
                <div className="absolute inset-0 flex items-center justify-center bg-white">
                    <Loader2 className="h-7 w-7 text-emerald-500 animate-spin" />
                </div>
            )}
            {error && (
                <div className="p-6 flex items-center gap-2 text-rose-600 text-sm font-bold">
                    <AlertTriangle className="h-4 w-4" /> {error}
                </div>
            )}
            <div ref={contenedorRef} />
        </div>
    )
}

const MAX_FILAS_HOJA = 500

// Excel / CSV: SheetJS (ya usado para exportar) lee el archivo y se pinta
// como tabla, con pestañas por hoja
function VistaExcel({ url }: { url: string }) {
    const [hojas, setHojas] = useState<{ nombre: string; filas: (string | number)[][]; truncada: boolean }[]>([])
    const [hojaActiva, setHojaActiva] = useState(0)
    const [cargando, setCargando] = useState(true)
    const [error, setError] = useState("")

    useEffect(() => {
        let activo = true
        ;(async () => {
            try {
                const [res, XLSX] = await Promise.all([fetch(url), import("xlsx-js-style")])
                if (!res.ok) throw new Error("No fue posible obtener el archivo")
                const buffer = await res.arrayBuffer()
                const libro = XLSX.read(buffer, { type: "array" })
                const datos = libro.SheetNames.map(nombre => {
                    const filas = XLSX.utils.sheet_to_json(libro.Sheets[nombre], { header: 1, defval: "" }) as (string | number)[][]
                    return { nombre, filas: filas.slice(0, MAX_FILAS_HOJA), truncada: filas.length > MAX_FILAS_HOJA }
                })
                if (activo) setHojas(datos)
            } catch {
                if (activo) setError("No fue posible mostrar la hoja de cálculo")
            } finally {
                if (activo) setCargando(false)
            }
        })()
        return () => { activo = false }
    }, [url])

    if (cargando) {
        return (
            <div className="w-full h-full flex items-center justify-center">
                <Loader2 className="h-7 w-7 text-emerald-400 animate-spin" />
            </div>
        )
    }
    if (error || hojas.length === 0) {
        return (
            <div className="p-6 flex items-center gap-2 text-rose-300 text-[12px] font-bold">
                <AlertTriangle className="h-4 w-4" /> {error || "El archivo no tiene hojas"}
            </div>
        )
    }

    const hoja = hojas[Math.min(hojaActiva, hojas.length - 1)]
    return (
        <div className="w-full h-full flex flex-col gap-2">
            {hojas.length > 1 && (
                <div className="flex items-center gap-1 overflow-x-auto shrink-0">
                    {hojas.map((h, i) => (
                        <button
                            key={h.nombre}
                            onClick={() => setHojaActiva(i)}
                            className={cn(
                                "px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wider whitespace-nowrap transition-all",
                                i === hojaActiva
                                    ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                                    : "text-slate-400 hover:text-white border border-transparent"
                            )}
                        >
                            {h.nombre}
                        </button>
                    ))}
                </div>
            )}
            <div className="flex-1 overflow-auto rounded-xl border border-white/10">
                <table className="min-w-full border-collapse">
                    <tbody>
                        {hoja.filas.map((fila, i) => (
                            <tr key={i} className={i === 0 ? "bg-white/[0.06]" : i % 2 === 1 ? "bg-white/[0.02]" : ""}>
                                {fila.map((celda, j) => (
                                    <td
                                        key={j}
                                        className={cn(
                                            "px-3 py-1.5 border border-white/[0.06] whitespace-nowrap max-w-[300px] truncate",
                                            i === 0 ? "text-[11px] font-black text-emerald-300 uppercase" : "text-[12px] font-medium text-slate-200"
                                        )}
                                        title={String(celda)}
                                    >
                                        {String(celda)}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {hoja.truncada && (
                <p className="text-[10px] font-black text-amber-300 uppercase tracking-widest shrink-0">
                    Mostrando las primeras {fmtInt(MAX_FILAS_HOJA)} filas de la hoja
                </p>
            )}
        </div>
    )
}

export interface DocumentoVista {
    idDocumento: number
    nombre: string
    nombreArchivo: string
    tipoMime: string
}

// Vista previa del documento dentro del portal. La descarga como archivo
// solo se ofrece cuando permitirDescarga (rol oficina) — las tiendas
// únicamente visualizan.
export function VistaPreviaModal({ doc, permitirDescarga = false, onClose }: {
    doc: DocumentoVista
    permitirDescarga?: boolean
    onClose: () => void
}) {
    const urlVista = `/api/documentos/${doc.idDocumento}/descargar?vista=1`
    const tipo = tipoVistaPrevia(doc.nombreArchivo, doc.tipoMime)

    useEffect(() => {
        const alTeclear = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
        window.addEventListener("keydown", alTeclear)
        return () => window.removeEventListener("keydown", alTeclear)
    }, [onClose])

    return (
        <div
            className="fixed inset-0 z-[85] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={onClose}
        >
            <div
                className={cn(
                    "w-full bg-[#0d1320] border border-white/10 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden flex flex-col",
                    tipo === "excel" || tipo === "word" ? "max-w-6xl" : "max-w-5xl",
                    tipo === "audio" || tipo === null ? "max-h-[60vh]" : "h-[88vh]"
                )}
                onClick={e => e.stopPropagation()}
            >
                <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between gap-3">
                    <h3 className="text-[15px] font-black text-white truncate min-w-0">{doc.nombre}</h3>
                    <div className="flex items-center gap-2 shrink-0">
                        <a
                            href={urlVista}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-400 hover:text-cyan-300 hover:border-cyan-500/30 transition-all"
                            title="Abrir en pestaña nueva"
                        >
                            <ExternalLink className="h-4 w-4" />
                        </a>
                        <button
                            onClick={onClose}
                            className="p-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-400 hover:text-white transition-all"
                            title="Cerrar (Esc)"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-hidden p-3">
                    {tipo === "pdf" || tipo === "texto" ? (
                        <iframe src={urlVista} className="w-full h-full rounded-xl bg-white" title={doc.nombre} />
                    ) : tipo === "imagen" ? (
                        <div className="w-full h-full flex items-center justify-center">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={urlVista} alt={doc.nombre} className="max-w-full max-h-full object-contain rounded-xl" />
                        </div>
                    ) : tipo === "video" ? (
                        <video src={urlVista} controls className="w-full h-full rounded-xl bg-black" />
                    ) : tipo === "audio" ? (
                        <div className="py-10 flex justify-center">
                            <audio src={urlVista} controls className="w-full max-w-xl" />
                        </div>
                    ) : tipo === "word" ? (
                        <VistaWord url={urlVista} />
                    ) : tipo === "excel" ? (
                        <VistaExcel url={urlVista} />
                    ) : (
                        <div className="py-12 flex flex-col items-center gap-4 text-center">
                            <FileQuestion className="h-10 w-10 text-slate-600" />
                            <p className="text-[12px] font-bold text-slate-500 uppercase tracking-widest">
                                Este tipo de archivo no tiene vista previa en el navegador
                            </p>
                            <p className="text-[11px] font-bold text-slate-600">
                                {permitirDescarga
                                    ? "Usa clic derecho sobre el archivo → Descargar para obtenerlo"
                                    : "Los documentos solo se pueden visualizar en el portal"}
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

export interface DocumentoPropiedades {
    nombre: string
    nombreArchivo: string
    tamano: number
    tipoMime: string
    todasTiendas: boolean
    subidoPor: string
    fecha: string
    descargas: number
}

// Ficha de propiedades del documento (clic derecho → Propiedades)
export function PropiedadesModal({ doc, ruta, esOficina, onClose }: {
    doc: DocumentoPropiedades
    ruta: string
    esOficina: boolean
    onClose: () => void
}) {
    const extension = doc.nombreArchivo.split(".").pop()?.toUpperCase() ?? "—"
    const filas: { etiqueta: string; valor: string }[] = [
        { etiqueta: "Nombre", valor: doc.nombre },
        { etiqueta: "Archivo", valor: doc.nombreArchivo },
        { etiqueta: "Tipo", valor: `${extension}${doc.tipoMime ? ` · ${doc.tipoMime}` : ""}` },
        { etiqueta: "Tamaño", valor: fmtTamano(doc.tamano) },
        { etiqueta: "Ubicación", valor: ruta || "Sin carpeta" },
        { etiqueta: "Dirigido a", valor: doc.todasTiendas ? "Todas las tiendas" : "Tiendas específicas" },
        { etiqueta: "Subido por", valor: doc.subidoPor },
        { etiqueta: "Fecha de subida", valor: fmtFechaHora(doc.fecha) },
        ...(esOficina ? [{ etiqueta: "Descargas", valor: fmtInt(doc.descargas) }] : []),
    ]

    return (
        <div
            className="fixed inset-0 z-[85] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={onClose}
        >
            <div
                className="w-full max-w-md bg-[#0d1320] border border-white/10 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
                    <h3 className="text-[15px] font-black text-white">Propiedades</h3>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-400 hover:text-white transition-all"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
                <div className="px-6 py-4 divide-y divide-white/[0.05]">
                    {filas.map(f => (
                        <div key={f.etiqueta} className="py-2 grid grid-cols-[130px_1fr] gap-3 items-start">
                            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest pt-0.5">
                                {f.etiqueta}
                            </span>
                            <span className="text-[13px] font-bold text-slate-200 break-words min-w-0">{f.valor}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}
