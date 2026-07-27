"use client"

import { useRef, useState } from "react"
import { UploadCloud } from "lucide-react"
import { cn } from "@/lib/utils"

// Zona de arrastre de archivos: soporta drag & drop y clic para seleccionar.
export function DropZone({
    onFiles,
    multiple = false,
    accept,
    mensaje = "Arrastra archivos aquí o haz clic para seleccionar",
}: {
    onFiles: (archivos: File[]) => void
    multiple?: boolean
    accept?: string
    mensaje?: string
}) {
    const [arrastrando, setArrastrando] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)

    const recibir = (lista: FileList | null) => {
        const archivos = [...(lista ?? [])]
        if (archivos.length > 0) {
            onFiles(multiple ? archivos : [archivos[0]])
        }
    }

    return (
        <div
            onDragOver={e => { e.preventDefault(); setArrastrando(true) }}
            onDragLeave={() => setArrastrando(false)}
            onDrop={e => {
                e.preventDefault()
                setArrastrando(false)
                recibir(e.dataTransfer.files)
            }}
            onClick={() => inputRef.current?.click()}
            className={cn(
                "border-2 border-dashed rounded-2xl px-6 py-8 text-center cursor-pointer transition-all select-none",
                arrastrando
                    ? "border-emerald-400 bg-emerald-500/10 scale-[1.01]"
                    : "border-white/15 bg-white/[0.02] hover:border-emerald-500/40 hover:bg-white/[0.04]"
            )}
        >
            <input
                ref={inputRef}
                type="file"
                multiple={multiple}
                accept={accept}
                className="hidden"
                onChange={e => {
                    recibir(e.target.files)
                    e.target.value = ""
                }}
            />
            <UploadCloud className={cn(
                "h-8 w-8 mx-auto mb-2 transition-colors",
                arrastrando ? "text-emerald-400" : "text-slate-500"
            )} />
            <p className="text-[12px] font-black text-slate-400 uppercase tracking-widest">
                {arrastrando ? "Suelta los archivos" : mensaje}
            </p>
        </div>
    )
}
