"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import QRCode from "qrcode"
import { ClipboardCheck, Copy, ExternalLink, X } from "lucide-react"
import { cn } from "@/lib/utils"

// Acceso del encabezado a la encuesta de la sucursal en sesión: abre una
// ventana con el QR grande (para escanearlo con la tableta o el celular de la
// tienda) y las opciones de abrir la encuesta aquí mismo o copiar la liga.
// La ventana se monta en <body> con un portal: el encabezado tiene
// backdrop-filter y eso convierte a sus hijos "fixed" en relativos a él, con lo
// que el QR quedaba recortado a la franja del encabezado.

interface Liga {
    uuid: string
    activa: boolean
    tienda: string
}

const AVISO_MS = 2000

export function LigaEncuesta() {
    const [liga, setLiga] = useState<Liga | null>(null)
    const [abierto, setAbierto] = useState(false)
    const [qr, setQr] = useState("")
    const [aviso, setAviso] = useState("")

    useEffect(() => {
        let activo = true
        fetch("/api/encuestas-clientes/mi-liga")
            .then(r => (r.ok ? r.json() : null))
            .then(json => {
                if (activo && json?.uuid) setLiga({ uuid: json.uuid, activa: Boolean(json.activa), tienda: String(json.tienda ?? "") })
            })
            .catch(() => { /* sin liga no se muestra el acceso */ })
        return () => { activo = false }
    }, [])

    // El QR se genera en el navegador al abrir la ventana
    useEffect(() => {
        if (!abierto || !liga) return
        let activo = true
        QRCode.toDataURL(`${window.location.origin}/encuesta/${liga.uuid}`, {
            width: 640, margin: 2, color: { dark: "#0a0e14", light: "#ffffff" },
        })
            .then(url => { if (activo) setQr(url) })
            .catch(() => { if (activo) setQr("") })
        return () => { activo = false }
    }, [abierto, liga])

    useEffect(() => {
        if (!abierto) return
        const alTeclear = (e: KeyboardEvent) => { if (e.key === "Escape") setAbierto(false) }
        window.addEventListener("keydown", alTeclear)
        return () => window.removeEventListener("keydown", alTeclear)
    }, [abierto])

    if (!liga) return null

    const ruta = `/encuesta/${liga.uuid}`
    const copiar = () => {
        navigator.clipboard?.writeText(`${window.location.origin}${ruta}`)
            .then(() => setAviso("Liga copiada"))
            .catch(() => setAviso("No se pudo copiar"))
        setTimeout(() => setAviso(""), AVISO_MS)
    }

    return (
        <>
            <button
                onClick={() => setAbierto(true)}
                className={cn(
                    "flex items-center gap-2 px-2.5 py-2 rounded-xl border transition-all",
                    liga.activa
                        ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/20"
                        : "bg-white/[0.05] border-white/10 text-slate-500"
                )}
                title={liga.activa
                    ? `Encuesta de ${liga.tienda}: ver el QR o abrirla con el cliente enfrente`
                    : "La encuesta de esta sucursal está desactivada"}
            >
                <ClipboardCheck className="h-4 w-4" />
                <span className="hidden lg:block text-[11px] font-bold uppercase tracking-wider">Encuesta</span>
            </button>

            {abierto && createPortal(
                <div className="fixed inset-0 z-[100] bg-black/85 flex items-center justify-center p-4 overflow-y-auto" onClick={() => setAbierto(false)}>
                    <div
                        className="w-full max-w-md bg-[#0a101c] border border-white/10 rounded-3xl p-6 text-center shadow-2xl"
                        onClick={e => e.stopPropagation()}
                        role="dialog"
                        aria-label={`Encuesta de ${liga.tienda}`}
                    >
                        <div className="flex items-center justify-between">
                            <div className="text-left">
                                <p className="text-[10px] font-black uppercase tracking-widest text-cyan-300">Encuesta de clientes</p>
                                <p className="text-[15px] font-black text-white">{liga.tienda}</p>
                            </div>
                            <button onClick={() => setAbierto(false)} className="p-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-400 hover:text-white" aria-label="Cerrar">
                                <X className="h-4 w-4" />
                            </button>
                        </div>

                        {qr ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                src={qr}
                                alt={`QR de la encuesta de ${liga.tienda}`}
                                className="block w-[min(75vw,360px)] h-auto aspect-square mx-auto rounded-2xl bg-white p-3 mt-4"
                            />
                        ) : (
                            <div className="w-[min(75vw,360px)] aspect-square mx-auto rounded-2xl bg-white/[0.04] mt-4" />
                        )}
                        <p className="text-[11px] font-bold text-slate-400 mt-3">
                            Escanéalo con la tableta o el celular de la tienda para abrir la encuesta ahí.
                        </p>
                        {!liga.activa && (
                            <p className="text-[11px] font-black text-rose-300 mt-1">La encuesta de esta sucursal está desactivada.</p>
                        )}

                        <div className="grid grid-cols-2 gap-2 mt-4">
                            <a
                                href={ruta}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-cyan-500 text-slate-950 text-[11px] font-black uppercase tracking-widest hover:brightness-110 transition-all"
                            >
                                <ExternalLink className="h-3.5 w-3.5" /> Abrir aquí
                            </a>
                            <button
                                onClick={copiar}
                                className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 text-[11px] font-black uppercase tracking-widest hover:text-white transition-all"
                            >
                                <Copy className="h-3.5 w-3.5" /> {aviso || "Copiar liga"}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </>
    )
}
