"use client"

import { useEffect } from "react"
import { X, ExternalLink, FileQuestion } from "lucide-react"
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

// Tipos que el navegador puede mostrar en la vista previa
export function tipoVistaPrevia(nombreArchivo: string, mime: string): "pdf" | "imagen" | "video" | "audio" | "texto" | null {
    const ext = nombreArchivo.split(".").pop()?.toLowerCase() ?? ""
    if (mime.includes("pdf") || ext === "pdf") return "pdf"
    if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(ext)) return "imagen"
    if (mime.startsWith("video/") || ["mp4", "webm", "mov"].includes(ext)) return "video"
    if (mime.startsWith("audio/") || ["mp3", "wav", "ogg"].includes(ext)) return "audio"
    if (["txt", "log", "csv", "json", "xml", "html"].includes(ext)) return "texto"
    return null
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
                    "w-full max-w-5xl bg-[#0d1320] border border-white/10 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden flex flex-col",
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
