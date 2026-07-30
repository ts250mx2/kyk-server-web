"use client"

import { useEffect } from "react"
import { X } from "lucide-react"
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
