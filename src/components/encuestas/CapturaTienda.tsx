"use client"

import { useCallback, useRef, useState } from "react"
import { AlertTriangle, Camera, CheckCircle2, Loader2, Search, Trash2, XCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { fmtFechaHora, fmtMoney } from "@/lib/format"
import { jsonSeguro } from "@/lib/http"
import { hayCamaraEnVivo, redimensionarFoto } from "@/lib/foto-cliente"
import { MAX_NOMBRE_CLIENTE_LEN, MAX_NUMERO_TICKET_LEN, avisosDeTicket, type TicketValidado } from "@/lib/encuestas-ticket"
import CamaraCliente from "@/components/encuestas/CamaraCliente"

// Bloque que ve la TIENDA (sesión de la misma sucursal) al levantar la
// encuesta con el cliente enfrente: nombre y contacto, foto con la cámara del
// dispositivo y ticket validado contra la venta real. El estado vive en la
// página; aquí se captura y se valida.

export interface DatosCaptura {
    nombre: string
    /** data-URL JPEG ya reducido, o null */
    foto: string | null
    numeroTicket: string
    total: string
}

export interface Contacto {
    telefono: string
    correo: string
    aceptaPromos: boolean
}

export const CAPTURA_VACIA: DatosCaptura = { nombre: "", foto: null, numeroTicket: "", total: "" }
export const CONTACTO_VACIO: Contacto = { telefono: "", correo: "", aceptaPromos: true }

interface CapturaTiendaProps {
    uuid: string
    tienda: string
    usuario: string
    datos: DatosCaptura
    onChange: (datos: DatosCaptura) => void
    contacto: Contacto
    onContacto: (contacto: Contacto) => void
    textoPromos: string
    ticket: TicketValidado | null
    onTicket: (ticket: TicketValidado | null) => void
}

const campo = "w-full px-3.5 py-2.5 bg-white/[0.04] border border-white/10 rounded-xl text-[14px] font-medium text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-400/50"
const etiqueta = "block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 mt-3"
const botonSecundario = "flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 text-[11px] font-black uppercase tracking-widest transition-all hover:text-white disabled:opacity-40"

function ResultadoTicket({ ticket }: { ticket: TicketValidado }) {
    const { error, advertencia } = avisosDeTicket(ticket)
    const Icono = ticket.coincide === false ? XCircle : CheckCircle2
    return (
        <div className={cn("mt-3 rounded-xl border p-3", ticket.coincide === false ? "border-rose-400/40 bg-rose-500/5" : "border-emerald-400/30 bg-emerald-500/5")}>
            <p className={cn("flex items-center gap-1.5 text-[12px] font-black", ticket.coincide === false ? "text-rose-300" : "text-emerald-300")}>
                <Icono className="h-4 w-4" />
                Ticket {ticket.numero} · {fmtFechaHora(ticket.fecha)} · {fmtMoney(ticket.total)}
            </p>
            {error && <p className="text-[12px] font-bold text-rose-300 mt-1">{error}</p>}
            {advertencia && (
                <p className="flex items-center gap-1.5 text-[12px] font-bold text-amber-300 mt-1">
                    <AlertTriangle className="h-3.5 w-3.5" /> {advertencia}
                </p>
            )}
            {ticket.partidas.length > 0 && (
                <div className="mt-2 max-h-48 overflow-y-auto">
                    <table className="w-full text-[11px]">
                        <tbody>
                            {ticket.partidas.map((p, i) => (
                                <tr key={i} className="border-t border-white/[0.06]">
                                    <td className="py-1 pr-2 text-slate-200 font-medium">{p.descripcion}</td>
                                    <td className="py-1 pr-2 text-slate-400 whitespace-nowrap text-right">{p.cantidad} {p.unidad}</td>
                                    <td className="py-1 text-slate-100 font-bold whitespace-nowrap text-right">{fmtMoney(p.importe)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    )
}

export default function CapturaTienda({ uuid, tienda, usuario, datos, onChange, contacto, onContacto, textoPromos, ticket, onTicket }: CapturaTiendaProps) {
    const [validando, setValidando] = useState(false)
    const [errorTicket, setErrorTicket] = useState("")
    const [camaraAbierta, setCamaraAbierta] = useState(false)
    const [procesandoFoto, setProcesandoFoto] = useState(false)
    const [errorFoto, setErrorFoto] = useState("")
    const archivoRef = useRef<HTMLInputElement>(null)

    // Cámara en vivo si el navegador la da; si no, el selector (que en
    // tabletas y celulares abre la app de cámara)
    const abrirCamara = () => {
        setErrorFoto("")
        if (hayCamaraEnVivo()) setCamaraAbierta(true)
        else archivoRef.current?.click()
    }

    const sinCamara = useCallback(() => {
        setCamaraAbierta(false)
        archivoRef.current?.click()
    }, [])

    const cerrarCamara = useCallback(() => setCamaraAbierta(false), [])

    const recibirFoto = (foto: string) => {
        onChange({ ...datos, foto })
        setCamaraAbierta(false)
    }

    const fotoDeArchivo = async (archivo: File | null) => {
        if (!archivo) return
        setProcesandoFoto(true)
        setErrorFoto("")
        try {
            onChange({ ...datos, foto: await redimensionarFoto(archivo) })
        } catch (err: unknown) {
            setErrorFoto(err instanceof Error ? err.message : "No se pudo procesar la foto")
        } finally {
            setProcesandoFoto(false)
            if (archivoRef.current) archivoRef.current.value = ""
        }
    }

    // Cualquier cambio en el ticket invalida la validación anterior
    const cambiarTicket = (cambios: Partial<DatosCaptura>) => {
        onChange({ ...datos, ...cambios })
        onTicket(null)
        setErrorTicket("")
    }

    const validar = async () => {
        if (validando || !datos.numeroTicket.trim()) return
        setValidando(true)
        setErrorTicket("")
        try {
            const res = await fetch(`/api/encuesta/${uuid}/ticket`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ numeroTicket: datos.numeroTicket, total: datos.total }),
            })
            const json = await jsonSeguro(res)
            if (!res.ok) throw new Error(String(json.error || "No fue posible validar el ticket"))
            onTicket(json.ticket as TicketValidado)
        } catch (err: unknown) {
            onTicket(null)
            setErrorTicket(err instanceof Error ? err.message : "No fue posible validar el ticket")
        } finally {
            setValidando(false)
        }
    }

    return (
        <section className="bg-cyan-500/[0.06] border border-cyan-400/25 rounded-2xl p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-cyan-300">
                Captura de la tienda · {tienda} · {usuario}
            </p>

            <label className={etiqueta}>Nombre del cliente</label>
            <input
                value={datos.nombre}
                onChange={e => onChange({ ...datos, nombre: e.target.value })}
                maxLength={MAX_NOMBRE_CLIENTE_LEN}
                placeholder="Nombre del cliente (opcional)"
                className={campo}
            />
            <div className="grid grid-cols-2 gap-2 mt-2">
                <input
                    value={contacto.telefono}
                    onChange={e => onContacto({ ...contacto, telefono: e.target.value })}
                    type="tel"
                    maxLength={20}
                    placeholder="Teléfono (opcional)"
                    className={campo}
                />
                <input
                    value={contacto.correo}
                    onChange={e => onContacto({ ...contacto, correo: e.target.value })}
                    type="email"
                    maxLength={255}
                    placeholder="Correo (opcional)"
                    className={campo}
                />
            </div>
            <label className="mt-2 flex items-center gap-2 text-[12px] font-bold text-slate-400">
                <input
                    type="checkbox"
                    checked={contacto.aceptaPromos}
                    onChange={e => onContacto({ ...contacto, aceptaPromos: e.target.checked })}
                    className="h-4 w-4 accent-cyan-500"
                />
                {textoPromos}
            </label>

            <label className={etiqueta}>Foto del cliente</label>
            <div className="flex items-center gap-3">
                {datos.foto && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={datos.foto} alt="Foto del cliente" className="h-20 w-20 rounded-xl object-cover border border-white/10" />
                )}
                <input
                    ref={archivoRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={e => fotoDeArchivo(e.target.files?.[0] ?? null)}
                />
                <button type="button" onClick={abrirCamara} disabled={procesandoFoto} className={botonSecundario}>
                    {procesandoFoto ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
                    {datos.foto ? "Otra foto" : "Tomar foto"}
                </button>
                {datos.foto && (
                    <button type="button" onClick={() => onChange({ ...datos, foto: null })} title="Quitar la foto" className={cn(botonSecundario, "hover:text-rose-300")}>
                        <Trash2 className="h-3.5 w-3.5" />
                    </button>
                )}
            </div>
            {errorFoto && <p className="text-[11px] font-bold text-rose-300 mt-1">{errorFoto}</p>}
            {camaraAbierta && <CamaraCliente onFoto={recibirFoto} onCerrar={cerrarCamara} onSinCamara={sinCamara} />}

            <label className={etiqueta}>Ticket de compra</label>
            <div className="grid grid-cols-2 gap-2">
                <input
                    value={datos.numeroTicket}
                    onChange={e => cambiarTicket({ numeroTicket: e.target.value })}
                    inputMode="numeric"
                    maxLength={MAX_NUMERO_TICKET_LEN}
                    placeholder="Número de ticket"
                    className={campo}
                />
                <input
                    value={datos.total}
                    onChange={e => cambiarTicket({ total: e.target.value })}
                    inputMode="decimal"
                    placeholder="Total del ticket"
                    className={campo}
                />
            </div>
            <p className="text-[10px] font-bold text-slate-500 mt-1">
                Tienda (2 dígitos) + caja (2 dígitos) + folio. El total se compara a dos decimales.
            </p>
            <button
                type="button"
                onClick={validar}
                disabled={validando || !datos.numeroTicket.trim()}
                className={cn(botonSecundario, "w-full mt-2 hover:text-cyan-300")}
            >
                {validando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                Validar ticket
            </button>
            {errorTicket && (
                <p className="flex items-center gap-1.5 text-[12px] font-bold text-rose-300 mt-2">
                    <XCircle className="h-3.5 w-3.5" /> {errorTicket}
                </p>
            )}
            {ticket && <ResultadoTicket ticket={ticket} />}
        </section>
    )
}
