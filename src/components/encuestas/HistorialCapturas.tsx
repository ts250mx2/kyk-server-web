"use client"

import { useState } from "react"
import { createPortal } from "react-dom"
import { AlertTriangle, ChevronDown, ChevronUp, User, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { fmtFechaHora, fmtMoney } from "@/lib/format"
import { ESCALA_10 } from "@/lib/encuestas-tipos"
import type { PartidaTicket } from "@/lib/encuestas-ticket"

// Historial de encuestas levantadas por la tienda con el cliente enfrente:
// quién fue, su foto, el ticket capturado contra el real y sus avisos.

export interface CapturaHistorial {
    idRespuesta: number
    tienda: string
    nombre: string
    tieneFoto: boolean
    numeroTicket: string
    totalCapturado: number | null
    totalTicket: number | null
    fechaTicket: string | null
    ticketValido: boolean | null
    ticketAntiguo: boolean
    errorTicket: string
    partidas: PartidaTicket[]
    capturadoPor: string
    fecha: string
    nps: number | null
    comentario: string
}

const tarjeta = "bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl"
const chip = "inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-lg border"

function EstadoTicket({ c }: { c: CapturaHistorial }) {
    if (!c.numeroTicket) return <span className={cn(chip, "border-white/10 text-slate-500")}>Sin ticket</span>
    if (c.errorTicket) return <span className={cn(chip, "border-rose-400/40 text-rose-300")} title={c.errorTicket}>Error: {c.errorTicket}</span>
    if (c.ticketValido === true) return <span className={cn(chip, "border-emerald-400/40 text-emerald-300")}>Total coincide</span>
    if (c.ticketValido === false) return <span className={cn(chip, "border-rose-400/40 text-rose-300")}>Total no coincide</span>
    return <span className={cn(chip, "border-amber-400/40 text-amber-300")}>Ticket sin total capturado</span>
}

function Partidas({ partidas }: { partidas: PartidaTicket[] }) {
    return (
        <table className="w-full text-[11px] mt-2">
            <tbody>
                {partidas.map((p, i) => (
                    <tr key={i} className="border-t border-white/[0.06]">
                        <td className="py-1 pr-2 text-slate-200 font-medium">{p.descripcion}</td>
                        <td className="py-1 pr-2 text-slate-400 whitespace-nowrap text-right">{p.cantidad} {p.unidad}</td>
                        <td className="py-1 text-slate-100 font-bold whitespace-nowrap text-right">{fmtMoney(p.importe)}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    )
}

function TarjetaCaptura({ c, onAmpliar }: { c: CapturaHistorial; onAmpliar: (id: number) => void }) {
    const [abierta, setAbierta] = useState(false)
    return (
        <div className="border border-white/[0.06] rounded-xl p-3">
            <div className="flex items-start gap-3">
                {c.tieneFoto ? (
                    <button onClick={() => onAmpliar(c.idRespuesta)} className="shrink-0 cursor-zoom-in" title="Ver la foto en grande">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/encuestas-clientes/foto/${c.idRespuesta}`} alt={c.nombre || "Cliente"} className="h-14 w-14 rounded-xl object-cover border border-white/10" />
                    </button>
                ) : (
                    <div className="shrink-0 h-14 w-14 rounded-xl border border-white/10 bg-white/[0.03] flex items-center justify-center">
                        <User className="h-5 w-5 text-slate-600" />
                    </div>
                )}
                <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[13px] font-black text-white truncate">{c.nombre || "Cliente sin nombre"}</p>
                        {c.nps !== null && (
                            <span className={cn(chip, "border-white/10", c.nps >= 9 ? "text-emerald-300" : c.nps >= 7 ? "text-amber-300" : "text-rose-300")}>
                                Recomendación {c.nps}/{ESCALA_10}
                            </span>
                        )}
                    </div>
                    <p className="text-[10px] font-black text-slate-600 uppercase tracking-wider mt-0.5">
                        {c.tienda} · {fmtFechaHora(c.fecha)} · capturó {c.capturadoPor || "—"}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        <EstadoTicket c={c} />
                        {c.ticketAntiguo && (
                            <span className={cn(chip, "border-amber-400/40 text-amber-300")}>
                                <AlertTriangle className="h-3 w-3" /> Más de un mes
                            </span>
                        )}
                    </div>
                    {c.numeroTicket && (
                        <p className="text-[12px] font-bold text-slate-300 mt-1.5">
                            Ticket {c.numeroTicket}
                            {c.fechaTicket && ` · ${fmtFechaHora(c.fechaTicket)}`}
                            {c.totalCapturado !== null && ` · capturado ${fmtMoney(c.totalCapturado)}`}
                            {c.totalTicket !== null && ` · real ${fmtMoney(c.totalTicket)}`}
                        </p>
                    )}
                    {c.comentario && <p className="text-[12px] font-medium text-slate-400 mt-1 whitespace-pre-wrap">{c.comentario}</p>}
                    {c.partidas.length > 0 && (
                        <>
                            <button onClick={() => setAbierta(a => !a)} className="mt-1.5 flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-cyan-300/80 hover:text-cyan-200">
                                {abierta ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                {abierta ? "Ocultar detalle" : `Ver detalle (${c.partidas.length} partidas)`}
                            </button>
                            {abierta && <Partidas partidas={c.partidas} />}
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}

export default function HistorialCapturas({ capturas }: { capturas: CapturaHistorial[] }) {
    const [ampliada, setAmpliada] = useState<number | null>(null)
    return (
        <div className={cn(tarjeta, "p-5")}>
            <h3 className="text-[12px] font-black text-slate-300 uppercase tracking-widest mb-3">
                Encuestas levantadas en tienda
            </h3>
            <div className="space-y-2">
                {capturas.map(c => <TarjetaCaptura key={c.idRespuesta} c={c} onAmpliar={setAmpliada} />)}
                {capturas.length === 0 && (
                    <p className="text-[11px] font-bold text-slate-600 py-4 text-center">
                        Sin capturas en el rango. La tienda las levanta desde la liga de su encabezado.
                    </p>
                )}
            </div>
            {/* En portal: la tarjeta tiene backdrop-blur y confinaría la ventana fija */}
            {ampliada !== null && createPortal(
                <div className="fixed inset-0 z-[100] bg-black/85 flex items-center justify-center p-6" onClick={() => setAmpliada(null)}>
                    <button className="absolute top-4 right-4 p-2 rounded-xl bg-white/10 text-white" aria-label="Cerrar">
                        <X className="h-5 w-5" />
                    </button>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/encuestas-clientes/foto/${ampliada}`} alt="Foto del cliente" className="max-h-full max-w-full rounded-2xl" />
                </div>,
                document.body
            )}
        </div>
    )
}
