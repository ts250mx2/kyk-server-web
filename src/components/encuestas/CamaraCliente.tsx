"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Camera, Loader2, SwitchCamera, X } from "lucide-react"
import { fotogramaAJpeg } from "@/lib/foto-cliente"

// Cámara en vivo del dispositivo (tableta o celular de la tienda) para la foto
// del cliente: vista previa, cambio entre cámara trasera y frontal y captura
// de un fotograma ya reducido a JPEG. Si el navegador no da acceso, avisa al
// padre para que use el selector de archivos (que en tabletas abre la app de
// cámara).

type Lado = "environment" | "user"

interface CamaraClienteProps {
    onFoto: (dataUrl: string) => void
    onCerrar: () => void
    /** Debe ser estable (useCallback): reabrir la cámara depende de él */
    onSinCamara: (motivo: string) => void
}

const boton = "flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border text-[12px] font-black uppercase tracking-widest transition-all disabled:opacity-40"

export default function CamaraCliente({ onFoto, onCerrar, onSinCamara }: CamaraClienteProps) {
    const videoRef = useRef<HTMLVideoElement>(null)
    const [lado, setLado] = useState<Lado>("environment")
    const [lista, setLista] = useState(false)
    const [errorCaptura, setErrorCaptura] = useState("")

    useEffect(() => {
        let activo = true
        let flujo: MediaStream | null = null
        navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: lado } }, audio: false })
            .then(stream => {
                if (!activo) {
                    stream.getTracks().forEach(t => t.stop())
                    return
                }
                flujo = stream
                const video = videoRef.current
                if (video) {
                    video.srcObject = stream
                    video.play().catch(() => undefined)
                }
                setLista(true)
            })
            .catch((err: unknown) => {
                if (activo) onSinCamara(err instanceof Error ? err.message : "Sin acceso a la cámara")
            })
        return () => {
            activo = false
            flujo?.getTracks().forEach(t => t.stop())
        }
    }, [lado, onSinCamara])

    // Esc cierra
    useEffect(() => {
        const alTeclear = (e: KeyboardEvent) => { if (e.key === "Escape") onCerrar() }
        window.addEventListener("keydown", alTeclear)
        return () => window.removeEventListener("keydown", alTeclear)
    }, [onCerrar])

    const capturar = () => {
        const video = videoRef.current
        if (!video || !lista) return
        try {
            onFoto(fotogramaAJpeg(video))
        } catch (err: unknown) {
            setErrorCaptura(err instanceof Error ? err.message : "No se pudo tomar la foto")
        }
    }

    // En portal para que ningún ancestro con filtros o transformaciones la confine
    return createPortal(
        <div className="fixed inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center p-4" role="dialog" aria-label="Cámara">
            <button onClick={onCerrar} className="absolute top-4 right-4 p-2 rounded-xl bg-white/10 text-white" aria-label="Cerrar la cámara">
                <X className="h-5 w-5" />
            </button>
            <div className="relative w-full max-w-lg aspect-[4/3] rounded-2xl overflow-hidden bg-black border border-white/10">
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                {!lista && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <Loader2 className="h-8 w-8 text-cyan-300 animate-spin" />
                    </div>
                )}
            </div>
            {errorCaptura && <p className="text-[12px] font-bold text-rose-300 mt-3">{errorCaptura}</p>}
            <div className="flex items-center gap-2 mt-4 w-full max-w-lg">
                <button
                    onClick={() => {
                        // La vista queda en espera hasta que llegue el flujo de la otra cámara
                        setLista(false)
                        setLado(l => (l === "environment" ? "user" : "environment"))
                    }}
                    title="Cambiar entre cámara trasera y frontal"
                    className={`${boton} bg-white/[0.05] border-white/10 text-slate-300 hover:text-white`}
                >
                    <SwitchCamera className="h-4 w-4" />
                </button>
                <button
                    onClick={capturar}
                    disabled={!lista}
                    className={`${boton} flex-1 bg-cyan-500 border-cyan-400 text-slate-950 hover:brightness-110`}
                >
                    <Camera className="h-4 w-4" /> Tomar foto
                </button>
            </div>
        </div>,
        document.body
    )
}
