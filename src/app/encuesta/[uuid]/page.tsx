"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { AlertTriangle, CheckCircle2, Loader2, RotateCcw, Send } from "lucide-react"
import { cn } from "@/lib/utils"
import PreguntaPublica from "@/components/encuestas/PreguntaPublica"
import CapturaTienda, { CAPTURA_VACIA, CONTACTO_VACIO, type Contacto, type DatosCaptura } from "@/components/encuestas/CapturaTienda"
import { esRespuestaBaja, type ConfigEncuesta, type PreguntaEncuesta } from "@/lib/encuestas-tipos"
import type { TicketValidado } from "@/lib/encuestas-ticket"

// Encuesta PÚBLICA de satisfacción: el cliente llega escaneando el QR de su
// sucursal (la URL identifica a la tienda por UUID, sin login). Móvil primero:
// escala 1-10 de recomendación (NPS), Sí/No de un toque, respuestas abiertas,
// comentario si algo salió mal y captura opcional de contacto para promociones.
// Si la abre la TIENDA con su sesión (liga del encabezado del panel), además
// captura nombre, foto y ticket del cliente, y puede encadenar encuestas.

interface RespuestaEnviada {
    idPregunta: number
    valor?: number
    texto?: string
}

interface ResultadoCaptura {
    ticketValido: boolean | null
    ticketAntiguo: boolean
    errorTicket: string | null
}

/** Arma lo que se manda al servidor: solo preguntas contestadas. */
function armarRespuestas(preguntas: PreguntaEncuesta[], valores: Record<number, number>, textos: Record<number, string>): RespuestaEnviada[] {
    return preguntas.flatMap<RespuestaEnviada>(p => {
        const texto = textos[p.idPregunta]?.trim() || undefined
        if (p.tipo === "texto") return texto ? [{ idPregunta: p.idPregunta, texto }] : []
        const valor = valores[p.idPregunta]
        return valor === undefined ? [] : [{ idPregunta: p.idPregunta, valor, texto }]
    })
}

export default function EncuestaPublicaPage() {
    const { uuid } = useParams<{ uuid: string }>()
    const [tienda, setTienda] = useState("")
    // Usuario de la tienda cuando la encuesta se abre con sesión de la misma sucursal
    const [modoTienda, setModoTienda] = useState<{ usuario: string } | null>(null)
    const [sesionOtraTienda, setSesionOtraTienda] = useState("")
    const [config, setConfig] = useState<ConfigEncuesta | null>(null)
    const [preguntas, setPreguntas] = useState<PreguntaEncuesta[]>([])
    const [noDisponible, setNoDisponible] = useState(false)

    const [valores, setValores] = useState<Record<number, number>>({})
    const [textos, setTextos] = useState<Record<number, string>>({})
    const [comentario, setComentario] = useState("")
    // Contacto para promociones: al final para el público, junto al nombre en modo tienda
    const [contacto, setContacto] = useState<Contacto>(CONTACTO_VACIO)
    const [captura, setCaptura] = useState<DatosCaptura>(CAPTURA_VACIA)
    const [ticket, setTicket] = useState<TicketValidado | null>(null)
    const [resultadoCaptura, setResultadoCaptura] = useState<ResultadoCaptura | null>(null)
    const [enviando, setEnviando] = useState(false)
    const [enviada, setEnviada] = useState(false)
    const [error, setError] = useState("")

    useEffect(() => {
        let activo = true
        fetch(`/api/encuesta/${uuid}`)
            .then(r => r.json().then(json => ({ ok: r.ok, json })))
            .then(({ ok, json }) => {
                if (!activo) return
                if (!ok) { setNoDisponible(true); return }
                setTienda(json.tienda ?? "")
                setConfig(json.config)
                setPreguntas(json.preguntas ?? [])
                setModoTienda(json.modoTienda?.usuario !== undefined ? { usuario: String(json.modoTienda.usuario) } : null)
                setSesionOtraTienda(json.sesionOtraTienda ? String(json.sesionOtraTienda) : "")
            })
            .catch(() => { if (activo) setNoDisponible(true) })
        return () => { activo = false }
    }, [uuid])

    const respuestas = armarRespuestas(preguntas, valores, textos)
    const contestadas = respuestas.length

    // El comentario se pide cuando alguna respuesta cae en el umbral o debajo
    const hayBaja = config
        ? preguntas.some(p => valores[p.idPregunta] !== undefined && esRespuestaBaja(p.tipo, p.etiquetas, valores[p.idPregunta], config.umbralComentario))
        : false

    const enviar = async () => {
        if (enviando || contestadas === 0) return
        setEnviando(true)
        setError("")
        try {
            const res = await fetch(`/api/encuesta/${uuid}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    respuestas,
                    comentario: comentario || undefined,
                    correo: contacto.correo || undefined,
                    telefono: contacto.telefono || undefined,
                    aceptaPromos: contacto.aceptaPromos,
                    captura: modoTienda ? captura : undefined,
                }),
            })
            const json = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(json.error || "No fue posible enviar tu respuesta")
            setResultadoCaptura(json.captura ?? null)
            setEnviada(true)
            window.scrollTo({ top: 0 })
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "No fue posible enviar tu respuesta")
        } finally {
            setEnviando(false)
        }
    }

    // Modo tienda: siguiente cliente sin recargar
    const nuevaEncuesta = () => {
        setValores({})
        setTextos({})
        setComentario("")
        setContacto(CONTACTO_VACIO)
        setCaptura(CAPTURA_VACIA)
        setTicket(null)
        setResultadoCaptura(null)
        setError("")
        setEnviada(false)
        window.scrollTo({ top: 0 })
    }

    const tarjeta = "bg-white/[0.05] border border-white/10 rounded-2xl p-4"

    if (noDisponible) {
        return (
            <main className="min-h-screen bg-[#060a12] flex items-center justify-center p-6">
                <p className="text-[14px] font-bold text-slate-400 text-center max-w-sm">
                    Esta encuesta no está disponible. Pide en la tienda el código QR más reciente.
                </p>
            </main>
        )
    }

    if (!config) {
        return (
            <main className="min-h-screen bg-[#060a12] flex items-center justify-center">
                <Loader2 className="h-8 w-8 text-emerald-400 animate-spin" />
            </main>
        )
    }

    if (enviada) {
        const avisoTicket = resultadoCaptura?.errorTicket
            ? `El ticket no se pudo validar: ${resultadoCaptura.errorTicket}`
            : resultadoCaptura?.ticketValido === false
                ? "El total capturado no coincidió con el del ticket; quedó registrado así en el historial."
                : resultadoCaptura?.ticketAntiguo
                    ? "El ticket tiene más de un mes; quedó registrado con esa advertencia."
                    : ""
        return (
            <main className="min-h-screen bg-[#060a12] flex items-center justify-center p-6">
                <div className="text-center max-w-md">
                    <CheckCircle2 className="h-16 w-16 text-emerald-400 mx-auto" />
                    <h1 className="text-2xl font-black text-white mt-4">{config.tituloGracias}</h1>
                    {config.textoGracias && (
                        <p className="text-[14px] font-medium text-slate-400 mt-2">{config.textoGracias}</p>
                    )}
                    <p className="text-[11px] font-black uppercase tracking-widest text-emerald-400/80 mt-6">
                        KYK · {tienda}
                    </p>
                    {modoTienda && (
                        <div className="mt-8 space-y-3">
                            {avisoTicket && (
                                <p className="flex items-center justify-center gap-1.5 text-[12px] font-bold text-amber-300">
                                    <AlertTriangle className="h-4 w-4 shrink-0" /> {avisoTicket}
                                </p>
                            )}
                            <button
                                onClick={nuevaEncuesta}
                                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-cyan-500 text-slate-950 font-black text-[14px] uppercase tracking-widest hover:brightness-110 transition-all"
                            >
                                <RotateCcw className="h-5 w-5" /> Nueva encuesta
                            </button>
                        </div>
                    )}
                </div>
            </main>
        )
    }

    return (
        <main className="min-h-screen bg-[#060a12] text-slate-100">
            <div className="max-w-lg mx-auto px-4 py-8 space-y-4">
                {/* Encabezado */}
                <header className="text-center mb-2">
                    <p className="text-[11px] font-black uppercase tracking-[0.3em] text-emerald-400">
                        KYK · {tienda}
                    </p>
                    <h1 className="text-2xl font-black text-white mt-2 leading-tight">{config.titulo}</h1>
                    {config.subtitulo && (
                        <p className="text-[13px] font-medium text-slate-400 mt-1.5">{config.subtitulo}</p>
                    )}
                    {config.subtitulo2 && (
                        <p className="text-[12px] font-bold text-slate-500 mt-0.5">{config.subtitulo2}</p>
                    )}
                </header>

                {/* Captura de la tienda (solo con sesión de la misma sucursal) */}
                {modoTienda && (
                    <CapturaTienda
                        uuid={uuid}
                        tienda={tienda}
                        usuario={modoTienda.usuario}
                        datos={captura}
                        onChange={setCaptura}
                        contacto={contacto}
                        onContacto={setContacto}
                        textoPromos={config.textoPromos}
                        ticket={ticket}
                        onTicket={setTicket}
                    />
                )}
                {sesionOtraTienda && (
                    <p className="text-[11px] font-bold text-amber-300/90 text-center">
                        Tu sesión es de {sesionOtraTienda}; esta encuesta es de {tienda}. La captura de cliente y ticket no está disponible.
                    </p>
                )}

                {/* Preguntas; el encabezado de sección se pinta una vez por bloque */}
                {preguntas.map((p, i) => (
                    <div key={p.idPregunta} className="space-y-4">
                        {p.seccion && p.seccion !== preguntas[i - 1]?.seccion && (
                            <h2 className="text-[13px] font-black text-emerald-300 uppercase tracking-widest pt-2">{p.seccion}</h2>
                        )}
                        <PreguntaPublica
                            pregunta={p}
                            valor={valores[p.idPregunta]}
                            texto={textos[p.idPregunta] ?? ""}
                            onValor={valor => setValores(prev => ({ ...prev, [p.idPregunta]: valor }))}
                            onTexto={texto => setTextos(prev => ({ ...prev, [p.idPregunta]: texto }))}
                        />
                    </div>
                ))}

                {/* Comentario cuando algo salió mal */}
                {hayBaja && (
                    <section className={cn(tarjeta, "border-amber-400/30")}>
                        <p className="text-[14px] font-black text-amber-300">{config.tituloComentario}</p>
                        {config.textoComentario && (
                            <p className="text-[12px] font-medium text-slate-400 mt-1">{config.textoComentario}</p>
                        )}
                        <textarea
                            value={comentario}
                            onChange={e => setComentario(e.target.value)}
                            maxLength={1000}
                            rows={3}
                            placeholder="Escríbenos aquí..."
                            className="mt-2.5 w-full px-3.5 py-2.5 bg-white/[0.04] border border-white/10 rounded-xl text-[14px] font-medium text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-400/50 resize-none"
                        />
                    </section>
                )}

                {/* Contacto para promociones (en modo tienda va junto al nombre del cliente) */}
                {config.regaloActivo && !modoTienda && (
                    <section className={cn(tarjeta, "border-emerald-400/25")}>
                        <p className="text-[14px] font-black text-emerald-300">{config.tituloRegalo}</p>
                        {config.textoRegalo && (
                            <p className="text-[12px] font-medium text-slate-400 mt-1">{config.textoRegalo}</p>
                        )}
                        <input
                            value={contacto.telefono}
                            onChange={e => setContacto({ ...contacto, telefono: e.target.value })}
                            type="tel"
                            maxLength={20}
                            placeholder="Tu teléfono (opcional)"
                            className="mt-2.5 w-full px-3.5 py-2.5 bg-white/[0.04] border border-white/10 rounded-xl text-[14px] font-medium text-slate-100 placeholder-slate-600 focus:outline-none focus:border-emerald-400/50"
                        />
                        <input
                            value={contacto.correo}
                            onChange={e => setContacto({ ...contacto, correo: e.target.value })}
                            type="email"
                            maxLength={255}
                            placeholder="Tu correo (opcional)"
                            className="mt-2 w-full px-3.5 py-2.5 bg-white/[0.04] border border-white/10 rounded-xl text-[14px] font-medium text-slate-100 placeholder-slate-600 focus:outline-none focus:border-emerald-400/50"
                        />
                        <label className="mt-2.5 flex items-center gap-2 text-[12px] font-bold text-slate-400">
                            <input
                                type="checkbox"
                                checked={contacto.aceptaPromos}
                                onChange={e => setContacto({ ...contacto, aceptaPromos: e.target.checked })}
                                className="h-4 w-4 accent-emerald-500"
                            />
                            {config.textoPromos}
                        </label>
                    </section>
                )}

                {error && (
                    <p className="text-[12px] font-black text-rose-300 text-center">{error}</p>
                )}

                <button
                    onClick={enviar}
                    disabled={enviando || contestadas === 0}
                    className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-emerald-500 text-slate-950 font-black text-[14px] uppercase tracking-widest hover:brightness-110 transition-all disabled:opacity-40"
                >
                    {enviando ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                    {config.textoBotonEnviar}
                </button>
                <p className="text-center text-[10px] font-bold text-slate-600 pb-6">
                    {contestadas === 0 ? "Contesta al menos una pregunta para enviar" : `${contestadas} de ${preguntas.length} preguntas contestadas`}
                </p>
            </div>
        </main>
    )
}
