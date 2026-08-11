"use client"

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import {
    ChevronDown, Gauge, Keyboard, Maximize2, Mic, MicOff, Minimize2, Play,
    Repeat, Sparkles, Square, Volume2, X,
} from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "@/lib/utils"
import { crearComponentesMarkdown } from "@/components/dashboard/agente-markdown"
import { recortarFlujoAMedias } from "@/components/dashboard/diagrama-flujo"
import {
    cancelarPregunta,
    ESTADO_CONVERSACION_VACIO,
    estadoConversacion,
    preguntarAgente,
    suscribirConversacion,
} from "@/lib/agente-conversacion"
import { modeloElegido } from "@/lib/modelos-agentes"
import {
    CLAVE_VOZ_RATE, CLAVE_VOZ_URI, elegirVoz, errorVoz, esVozEspanol, esVozNatural,
    nombreVoz, obtenerReconocimiento, rateGuardado, textoHablable, type ReconocimientoVoz,
} from "@/lib/voz"
import type { ConfigAgente } from "@/components/dashboard/AgenteChat"

// Consola de voz "Jarvis" (port del Modo Voz de kyk-dashboard): overlay a
// pantalla completa con orbe reactivo, dictado es-MX, respuesta hablada con
// selector de voces naturales, velocidad y conversación continua. La
// conversación vive en el store agente-conversacion (la misma del panel): si
// se cierra la consola a media pregunta, la respuesta sigue en segundo plano.

type Estado = "idle" | "listening" | "thinking" | "speaking" | "error"

const ETIQUETA_ESTADO: Record<Estado, string> = {
    idle: "Toca el orbe para hablar",
    listening: "Escuchando…",
    thinking: "Pensando…",
    speaking: "Hablando…",
    error: "Hubo un problema",
}

// Clases por acento que el CSS del orbe no cubre (chips, botones, texto)
const TEMAS = {
    ambar: {
        texto: "text-amber-300",
        chipIdle: "border-amber-400/40 text-amber-300 bg-amber-500/10",
        botonPrincipal: "bg-amber-400 text-[#1f1303] shadow-[0_0_28px_rgba(251,191,36,0.55)] hover:bg-amber-300",
        continuoActivo: "border-amber-400/50 text-amber-300 bg-amber-500/10",
        sugerencia: "hover:bg-amber-500/15 hover:border-amber-400/50",
        focoInput: "focus:border-amber-500/50",
        acentoSlider: "accent-amber-400",
        vozActiva: "bg-amber-500/15 ring-1 ring-amber-400/30",
        vozTexto: "text-amber-200",
        botonPreview: "text-amber-300 hover:bg-amber-500/20",
    },
    violeta: {
        texto: "text-violet-300",
        chipIdle: "border-violet-400/40 text-violet-300 bg-violet-500/10",
        botonPrincipal: "bg-violet-400 text-[#150b2e] shadow-[0_0_28px_rgba(167,139,250,0.55)] hover:bg-violet-300",
        continuoActivo: "border-violet-400/50 text-violet-300 bg-violet-500/10",
        sugerencia: "hover:bg-violet-500/15 hover:border-violet-400/50",
        focoInput: "focus:border-violet-500/50",
        acentoSlider: "accent-violet-400",
        vozActiva: "bg-violet-500/15 ring-1 ring-violet-400/30",
        vozTexto: "text-violet-200",
        botonPreview: "text-violet-300 hover:bg-violet-500/20",
    },
} as const

const MAX_MENSAJE = 2000

export function VozJarvis({ config, claveConversacion, onCerrar }: {
    config: ConfigAgente
    claveConversacion: string
    onCerrar: () => void
}) {
    const tema = TEMAS[config.acento]
    const componentesMarkdown = crearComponentesMarkdown(config.acento)

    // Conversación compartida con el panel, observada desde el store
    const conversacion = useSyncExternalStore(
        avisar => suscribirConversacion(claveConversacion, avisar),
        () => estadoConversacion(claveConversacion),
        () => ESTADO_CONVERSACION_VACIO
    )
    const mensajes = conversacion.mensajes
    const borrador = conversacion.borrador
    const fase = conversacion.fase

    const [estado, setEstado] = useState<Estado>("idle")
    const [interim, setInterim] = useState("")
    const [errorMsg, setErrorMsg] = useState("")
    const [textoEscrito, setTextoEscrito] = useState("")
    const [orbeChico, setOrbeChico] = useState(false)
    const [continuo, setContinuo] = useState(false)

    const [soportado] = useState(() => Boolean(obtenerReconocimiento()))
    // La consola solo se monta en el cliente (jarvisAbierto), sin riesgo de SSR
    const [seguro, setSeguro] = useState(() => typeof window === "undefined" || window.isSecureContext !== false)
    const [voces, setVoces] = useState<SpeechSynthesisVoice[]>([])
    const [vozURI, setVozURI] = useState("")
    const [sinNaturales, setSinNaturales] = useState(false)
    const [menuVoces, setMenuVoces] = useState(false)
    const [rate, setRate] = useState(() => rateGuardado())

    const reconocimientoRef = useRef<ReconocimientoVoz | null>(null)
    const escuchandoRef = useRef(false)
    const finalRef = useRef("")
    const orbRef = useRef<HTMLDivElement | null>(null)
    const finListaRef = useRef<HTMLDivElement | null>(null)
    const menuVocesRef = useRef<HTMLDivElement | null>(null)
    const rafRef = useRef<number | null>(null)
    const ampRef = useRef(0)
    const estadoRef = useRef<Estado>("idle")
    const continuoRef = useRef(false)
    const iniciarRef = useRef<() => void>(() => { })
    const menuVocesAbiertoRef = useRef(false)
    // La respuesta puede llegar con la consola ya cerrada: en ese caso el panel
    // la muestra y aquí no se habla ni se reabre el micrófono
    const montadoRef = useRef(true)
    // Prop del padre fijada en ref: el padre la recrea en cada render y si
    // entrara a deps de un efecto con limpieza, cada mensaje nuevo la dispararía
    const onCerrarRef = useRef(onCerrar)

    const ponerEstado = (e: Estado) => { estadoRef.current = e; setEstado(e) }
    useEffect(() => { continuoRef.current = continuo }, [continuo])
    useEffect(() => { menuVocesAbiertoRef.current = menuVoces }, [menuVoces])
    useEffect(() => { onCerrarRef.current = onCerrar })

    // ── Voces de síntesis (español; Chrome dispara la lista vacía primero) ──
    useEffect(() => {
        if (typeof window === "undefined" || !("speechSynthesis" in window)) return
        const cargar = () => {
            const todas = window.speechSynthesis.getVoices()
            if (!todas.length) return
            const espanol = todas.filter(esVozEspanol)
            setVoces(espanol)
            setSinNaturales(espanol.length > 0 && !espanol.some(esVozNatural))
            setVozURI(previa => {
                if (previa && espanol.some(v => v.voiceURI === previa)) return previa
                return elegirVoz(espanol)?.voiceURI ?? ""
            })
        }
        cargar()
        window.speechSynthesis.onvoiceschanged = cargar
        return () => {
            try { window.speechSynthesis.onvoiceschanged = null } catch { /* limpieza opcional */ }
        }
    }, [])


    // ── Bucle de animación del orbe (amplitud sintética por estado) ──
    useEffect(() => {
        let t = 0
        const tick = () => {
            t += 0.016
            let objetivo = 0
            const st = estadoRef.current
            if (st === "listening") {
                objetivo = 0.32 + 0.26 * Math.abs(Math.sin(t * 9)) + 0.1 * Math.abs(Math.sin(t * 5))
            } else if (st === "speaking") {
                objetivo = 0.45 + 0.35 * Math.abs(Math.sin(t * 7)) + 0.12 * Math.abs(Math.sin(t * 13))
            } else if (st === "thinking") {
                objetivo = 0.28 + 0.18 * (0.5 + 0.5 * Math.sin(t * 4))
            } else {
                objetivo = 0.06 + 0.05 * (0.5 + 0.5 * Math.sin(t * 1.6))
            }
            ampRef.current += (objetivo - ampRef.current) * 0.18
            orbRef.current?.style.setProperty("--amp", ampRef.current.toFixed(3))
            rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)
        return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
    }, [])

    useEffect(() => {
        finListaRef.current?.scrollIntoView({ behavior: "smooth" })
    }, [mensajes, borrador, interim])

    // En cuanto empieza a llegar respuesta, el orbe se hace chico para leerla
    // (ajuste durante el render, sin efecto: el borrador viene del store)
    const [borradorPrevio, setBorradorPrevio] = useState("")
    if (borrador !== borradorPrevio) {
        setBorradorPrevio(borrador)
        if (borrador.trim()) setOrbeChico(true)
    }

    // Menú de voces: clic afuera o Escape lo cierran (Escape sin menú cierra la consola)
    useEffect(() => {
        const alPresionar = (e: MouseEvent) => {
            if (menuVocesRef.current && !menuVocesRef.current.contains(e.target as Node)) setMenuVoces(false)
        }
        document.addEventListener("mousedown", alPresionar)
        return () => document.removeEventListener("mousedown", alPresionar)
    }, [])

    // ── Síntesis de voz ──
    const hablar = useCallback((texto: string) => {
        const alTerminar = () => {
            ponerEstado("idle")
            if (continuoRef.current && montadoRef.current) {
                setTimeout(() => { if (estadoRef.current === "idle" && montadoRef.current) iniciarRef.current() }, 450)
            }
        }
        if (typeof window === "undefined" || !("speechSynthesis" in window)) { alTerminar(); return }
        const limpio = textoHablable(texto)
        if (!limpio) { alTerminar(); return }
        try {
            window.speechSynthesis.cancel()
            const locucion = new SpeechSynthesisUtterance(limpio.slice(0, 4000))
            const voz = voces.find(v => v.voiceURI === vozURI)
            if (voz) { locucion.voice = voz; locucion.lang = voz.lang } else { locucion.lang = "es-MX" }
            locucion.rate = rate
            locucion.pitch = 1
            ponerEstado("speaking")
            locucion.onend = alTerminar
            locucion.onerror = alTerminar
            window.speechSynthesis.speak(locucion)
        } catch { alTerminar() }
    }, [voces, vozURI, rate])

    // Previsualiza una voz sin tocar el flujo de conversación
    const probarVoz = useCallback((uri?: string) => {
        if (typeof window === "undefined" || !("speechSynthesis" in window)) return
        const voz = voces.find(v => v.voiceURI === (uri || vozURI))
        if (!voz) return
        try {
            window.speechSynthesis.cancel()
            const locucion = new SpeechSynthesisUtterance(
                `Hola, soy ${config.nombre}. Así sueno cuando te respondo.`
            )
            locucion.voice = voz
            locucion.lang = voz.lang
            locucion.rate = rate
            window.speechSynthesis.speak(locucion)
        } catch { /* sin síntesis */ }
    }, [voces, vozURI, rate, config.nombre])

    const seleccionarVoz = (uri: string) => {
        setVozURI(uri)
        try { localStorage.setItem(CLAVE_VOZ_URI, uri) } catch { /* sin persistencia */ }
        probarVoz(uri)
    }

    // ── Envío al agente (la consulta corre en el store del módulo: si se
    // cierra la consola a media respuesta, sigue en segundo plano) ──
    const enviar = useCallback(async (pregunta: string) => {
        const limpia = pregunta.trim().slice(0, MAX_MENSAJE)
        if (!limpia) { ponerEstado("idle"); return }

        setInterim("")
        setErrorMsg("")
        ponerEstado("thinking")

        const resultado = await preguntarAgente(claveConversacion, config.endpoint, limpia, modeloElegido())
        // Consola cerrada a media respuesta: el panel la muestra; aquí ya no se habla
        if (!montadoRef.current) return
        if (!resultado) { ponerEstado("idle"); return }
        if (resultado.sesionExpirada) { window.location.href = "/login"; return }
        if (!resultado.ok) setErrorMsg(resultado.texto)
        hablar(resultado.texto || "No pude completar la consulta, intenta preguntarlo de otra forma.")
    }, [claveConversacion, config.endpoint, hablar])

    // ── Reconocimiento de voz ──
    const iniciarEscucha = useCallback(() => {
        const SR = obtenerReconocimiento()
        if (!SR) return
        if (typeof window !== "undefined" && !window.isSecureContext) {
            setSeguro(false)
            setErrorMsg("El micrófono necesita HTTPS o localhost. Escríbele abajo y te responde por voz.")
            ponerEstado("error")
            return
        }
        if (escuchandoRef.current) return
        try { window.speechSynthesis?.cancel() } catch { /* barge-in */ }
        setErrorMsg("")
        setOrbeChico(false)

        const rec = new SR()
        rec.lang = "es-MX"
        rec.interimResults = true
        rec.continuous = false
        rec.maxAlternatives = 1
        finalRef.current = ""

        rec.onstart = () => ponerEstado("listening")
        rec.onresult = e => {
            let parcial = ""
            let final = ""
            for (let i = e.resultIndex; i < e.results.length; i++) {
                const t = e.results[i][0].transcript
                if (e.results[i].isFinal) final += t
                else parcial += t
            }
            if (final) finalRef.current += final
            setInterim(finalRef.current + parcial)
        }
        rec.onerror = e => {
            const codigo = String(e.error ?? "")
            const mensaje = errorVoz(codigo)
            if (mensaje) setErrorMsg(mensaje)
            if (codigo && codigo !== "no-speech" && codigo !== "aborted") ponerEstado("error")
        }
        rec.onend = () => {
            escuchandoRef.current = false
            reconocimientoRef.current = null
            const dicho = finalRef.current.trim()
            if (dicho) {
                enviar(dicho)
            } else {
                setInterim("")
                if (estadoRef.current !== "error") ponerEstado("idle")
            }
        }

        reconocimientoRef.current = rec
        escuchandoRef.current = true
        setInterim("")
        ponerEstado("listening")
        try {
            rec.start()
        } catch {
            escuchandoRef.current = false
            ponerEstado("idle")
        }
    }, [enviar])

    useEffect(() => { iniciarRef.current = iniciarEscucha }, [iniciarEscucha])

    const detenerEscucha = useCallback(() => {
        try { reconocimientoRef.current?.stop() } catch { /* ya detenido */ }
    }, [])

    // Detener explícito (botón del orbe): SÍ corta la pregunta en curso
    const pararTodo = useCallback(() => {
        cancelarPregunta(claveConversacion)
        try { reconocimientoRef.current?.stop() } catch { /* ya detenido */ }
        try { window.speechSynthesis?.cancel() } catch { /* sin síntesis */ }
        escuchandoRef.current = false
        setInterim("")
        ponerEstado("idle")
    }, [claveConversacion])

    // Cerrar la consola NO corta la pregunta: sigue en segundo plano y el
    // panel del chat la muestra al terminar — solo se apagan micrófono y voz
    const cerrar = useCallback(() => {
        try { reconocimientoRef.current?.stop() } catch { /* ya detenido */ }
        try { window.speechSynthesis?.cancel() } catch { /* sin síntesis */ }
        escuchandoRef.current = false
        onCerrarRef.current()
    }, [])

    // Limpieza SOLO al desmontar — nunca en re-renders. La consulta en curso
    // NO se aborta: vive en el store y termina en segundo plano
    useEffect(() => {
        montadoRef.current = true
        return () => {
            montadoRef.current = false
            try { reconocimientoRef.current?.stop() } catch { /* ya detenido */ }
            try { window.speechSynthesis?.cancel() } catch { /* sin síntesis */ }
        }
    }, [])

    // Escape: cierra el menú de voces si está abierto; si no, la consola
    useEffect(() => {
        const alTeclear = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return
            if (menuVocesAbiertoRef.current) setMenuVoces(false)
            else cerrar()
        }
        window.addEventListener("keydown", alTeclear)
        return () => window.removeEventListener("keydown", alTeclear)
    }, [cerrar])

    const accionOrbe = () => {
        if (estado === "listening") { detenerEscucha(); return }
        if (estado === "thinking" || estado === "speaking") { pararTodo(); return }
        iniciarEscucha()
    }

    const alEnviarTexto = (e: React.FormEvent) => {
        e.preventDefault()
        const t = textoEscrito.trim()
        if (!t || estado === "thinking" || estado === "listening") return
        setTextoEscrito("")
        enviar(t)
    }

    const ocupado = estado === "thinking" || estado === "speaking"
    const conPulso = estado === "listening" || estado === "speaking"
    const claseIcono = cn(orbeChico ? "w-5 h-5" : "w-9 h-9", "text-[#0a0e14]")

    // Voces: México primero, luego LatAm/US, después por nombre
    const pesoIdioma = (v: SpeechSynthesisVoice) =>
        /es[-_]MX/i.test(v.lang) ? 0 : /es[-_](419|US)/i.test(v.lang) ? 1 : 2
    const vocesOrdenadas = [...voces].sort((a, b) =>
        pesoIdioma(a) - pesoIdioma(b) || nombreVoz(a).localeCompare(nombreVoz(b)))
    const naturales = vocesOrdenadas.filter(esVozNatural)
    const estandar = vocesOrdenadas.filter(v => !esVozNatural(v))
    const conGrupos = naturales.length > 0 && estandar.length > 0
    const vozSeleccionada = voces.find(v => v.voiceURI === vozURI) ?? null

    return (
        <div className="fixed inset-0 z-[95] jarvis-stage flex flex-col font-mono text-slate-200" data-acento={config.acento}>
            {/* Encabezado */}
            <header className="relative z-10 flex items-center justify-between px-5 py-3 border-b border-white/10 bg-[#0d1320]/60 backdrop-blur-md shrink-0">
                <div className="flex items-center gap-3">
                    <div className="relative w-9 h-9 rounded-xl bg-white/[0.06] border border-white/15 flex items-center justify-center">
                        <span className="text-xl" aria-hidden>{config.emoji}</span>
                        <span className={cn("absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#0d1320]", config.acento === "ambar" ? "bg-amber-400" : "bg-violet-400")} />
                    </div>
                    <div className="leading-tight">
                        <h1 className="jarvis-title text-lg font-black tracking-[0.18em]">{config.nombre}</h1>
                        <p className="text-[10px] text-slate-500 tracking-[0.25em] uppercase">Modo Voz · Asistente IA</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <span className={cn(
                        "hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] uppercase tracking-widest border",
                        estado === "listening" ? "border-cyan-400/40 text-cyan-300 bg-cyan-500/10"
                            : estado === "thinking" ? "border-amber-400/40 text-amber-300 bg-amber-500/10"
                            : estado === "speaking" ? "border-indigo-400/40 text-indigo-300 bg-indigo-500/10"
                            : tema.chipIdle
                    )}>
                        <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                        {estado === "idle" ? "En línea" : ETIQUETA_ESTADO[estado]}
                    </span>
                    {/* Regreso explícito al chat de texto (la conversación es la misma) */}
                    <button
                        onClick={cerrar}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-bold bg-white/[0.05] border border-white/15 text-slate-300 hover:text-white hover:border-white/30 transition-all"
                        title="Regresar al chat de texto — la conversación continúa ahí (Esc)"
                    >
                        <Keyboard className="w-3.5 h-3.5" /> Modo texto
                    </button>
                    <button
                        onClick={cerrar}
                        className="p-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-400 hover:text-white transition-all"
                        title="Volver al chat (Esc)"
                        aria-label="Cerrar consola de voz"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            </header>

            {/* Aviso crítico: sin HTTPS/localhost o navegador sin voz */}
            {(!seguro || !soportado) && (
                <div className="relative z-10 px-4 py-2 text-center text-[12px] bg-amber-500/10 border-b border-amber-400/30 text-amber-200 shrink-0">
                    {!seguro
                        ? `⚠️ El reconocimiento de voz requiere HTTPS o http://localhost — mientras tanto, escríbele a ${config.nombre} abajo y te responde por voz.`
                        : `⚠️ Tu navegador no soporta reconocimiento de voz. Usa Chrome o Edge — abajo puedes escribirle a ${config.nombre} y te responde por voz.`}
                </div>
            )}

            {/* Escenario del orbe */}
            <div className={cn(
                "relative z-10 flex-1 min-h-0 flex flex-col items-center justify-center px-4 transition-all duration-500",
                orbeChico ? "py-3 gap-2" : "py-6 gap-6"
            )}>
                <button
                    onClick={() => setOrbeChico(c => !c)}
                    title={orbeChico ? "Mostrar el orbe" : "Ocultar el orbe para ver más respuesta"}
                    className="absolute top-2 right-3 z-20 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border border-white/15 text-slate-400 hover:text-white bg-[#0d1320]/60 backdrop-blur-sm transition-colors"
                >
                    {orbeChico ? <><Maximize2 className="w-3 h-3" /> Orbe</> : <><Minimize2 className="w-3 h-3" /> Ocultar</>}
                </button>

                {/* Orbe */}
                <div
                    ref={orbRef}
                    className="jarvis-orb shrink-0 transition-[width,height] duration-500 ease-in-out"
                    data-status={estado}
                    onClick={accionOrbe}
                    role="button"
                    aria-label={`Activar voz de ${config.nombre}`}
                    style={{ ["--orb" as string]: orbeChico ? "clamp(76px, 12vh, 108px)" : "clamp(200px, 32vh, 320px)" } as React.CSSProperties}
                >
                    <div className="jarvis-aura" />
                    <div className="jarvis-ring jarvis-ring--dashed" />
                    <div className="jarvis-ring jarvis-ring--1" />
                    <div className="jarvis-ring jarvis-ring--2" />
                    {conPulso && <div className="jarvis-pulse" />}
                    <div className="jarvis-core" />
                    <div className="jarvis-orbit"><span /></div>
                    <div className="jarvis-orbit jarvis-orbit--rev"><span /></div>
                    <div className="relative z-10 pointer-events-none drop-shadow-[0_0_10px_rgba(10,14,20,0.6)]">
                        {estado === "listening" ? <Mic className={claseIcono} />
                            : estado === "thinking" ? <Sparkles className={cn(claseIcono, "animate-pulse")} />
                            : estado === "speaking" ? <Volume2 className={claseIcono} />
                            : <Mic className={claseIcono} />}
                    </div>
                </div>

                {/* Estado + transcripción en vivo (solo con el orbe expandido) */}
                {!orbeChico && (
                    <div className="text-center min-h-[2.5rem] max-w-2xl">
                        <p className={cn("text-[12px] uppercase tracking-[0.3em]", tema.texto)}>
                            {fase && ocupado ? fase : ETIQUETA_ESTADO[estado]}
                        </p>
                        {(interim || estado === "listening") && (
                            <p className="mt-2 text-lg text-sky-200/90 italic">{interim || "…"}</p>
                        )}
                    </div>
                )}
                {errorMsg && (
                    <p className="text-[13px] text-rose-300/90 max-w-md mx-auto text-center leading-snug">{errorMsg}</p>
                )}

                {/* Conversación (compacta, desplazable, compartida con el chat) */}
                <div className="w-full max-w-2xl flex-1 min-h-0 overflow-y-auto space-y-2.5 px-1">
                    {mensajes.slice(-8).map((m, i) => (
                        m.rol === "user" ? (
                            <div key={i} className="flex justify-end">
                                <div className="max-w-[85%] rounded-2xl rounded-br-sm px-3.5 py-2 text-[13px] leading-relaxed border bg-sky-500/10 border-sky-400/25 text-sky-100">
                                    {m.texto}
                                </div>
                            </div>
                        ) : (
                            <div key={i} className="flex justify-start">
                                <div className="max-w-[85%] rounded-2xl rounded-bl-sm px-3.5 py-2 text-[13px] leading-relaxed border bg-white/5 border-white/15 space-y-1.5">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={componentesMarkdown}>
                                        {m.texto}
                                    </ReactMarkdown>
                                </div>
                            </div>
                        )
                    ))}
                    {/* Respuesta en streaming (aún no confirmada como turno) */}
                    {conversacion.cargando && borrador && (
                        <div className="flex justify-start">
                            <div className="max-w-[85%] rounded-2xl rounded-bl-sm px-3.5 py-2 text-[13px] leading-relaxed border bg-white/5 border-white/15 space-y-1.5">
                                {/* Recorta la línea a medias de un fence flujo abierto */}
                                <ReactMarkdown remarkPlugins={[remarkGfm]} components={componentesMarkdown}>
                                    {recortarFlujoAMedias(borrador)}
                                </ReactMarkdown>
                                <span className={cn("inline-block w-1.5 h-4 align-middle animate-pulse", config.acento === "ambar" ? "bg-amber-400/80" : "bg-violet-400/80")} />
                            </div>
                        </div>
                    )}
                    <div ref={finListaRef} />
                </div>

                {/* Sugerencias al empezar */}
                {mensajes.length === 0 && estado === "idle" && (
                    <div className="w-full max-w-2xl flex flex-wrap gap-2 justify-center">
                        {config.sugerencias.slice(0, 4).map(s => (
                            <button
                                key={s}
                                onClick={() => enviar(s)}
                                className={cn("px-3 py-1.5 rounded-full text-[12px] bg-white/5 border border-white/15 text-slate-300 transition-colors", tema.sugerencia)}
                            >
                                {s}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Panel de control */}
            <div className="relative z-10 shrink-0 border-t border-white/10 bg-[#0d1320]/80 backdrop-blur-md px-4 py-3">
                <div className="flex items-center justify-center gap-4 flex-wrap">
                    <button
                        onClick={accionOrbe}
                        disabled={!soportado && estado === "idle"}
                        className={cn(
                            "relative inline-flex items-center justify-center w-16 h-16 rounded-full transition-all active:scale-95 disabled:opacity-40",
                            estado === "listening" ? "bg-cyan-500 text-[#04121a] shadow-[0_0_30px_rgba(34,211,238,0.6)]"
                                : ocupado ? "bg-rose-500/90 text-white shadow-[0_0_24px_rgba(244,63,94,0.5)]"
                                : tema.botonPrincipal
                        )}
                        title={ocupado ? "Detener" : estado === "listening" ? "Terminar de hablar" : "Hablar"}
                    >
                        {estado === "listening" ? <MicOff className="w-7 h-7" />
                            : ocupado ? <Square className="w-6 h-6" />
                            : <Mic className="w-7 h-7" />}
                        {estado === "listening" && <span className="absolute inset-0 rounded-full border-2 border-cyan-300/60 animate-ping" />}
                    </button>
                </div>

                {/* Selectores */}
                <div className="mt-3 flex items-center justify-center gap-x-5 gap-y-2 flex-wrap text-[11px] text-slate-400">
                    {/* Voz: panel desplegable con ▶ por cada voz (solo español) */}
                    <div className="inline-flex items-center gap-1.5">
                        <Volume2 className={cn("w-3.5 h-3.5", tema.texto)} />
                        <span className="text-slate-500">Voz</span>
                        <div className="relative" ref={menuVocesRef}>
                            <button
                                type="button"
                                onClick={() => setMenuVoces(o => !o)}
                                className="inline-flex items-center gap-1.5 bg-[#0a0e14] border border-white/15 rounded-lg pl-2.5 pr-2 py-1.5 text-slate-200 hover:border-white/30 transition-colors max-w-[230px]"
                            >
                                <span className="truncate">{vozSeleccionada ? nombreVoz(vozSeleccionada) : "(sin voces)"}</span>
                                {vozSeleccionada && esVozNatural(vozSeleccionada) && <span className="shrink-0">✨</span>}
                                <ChevronDown className={cn("w-3.5 h-3.5 text-slate-500 shrink-0 transition-transform", menuVoces && "rotate-180")} />
                            </button>

                            {menuVoces && (
                                <div className="absolute bottom-full right-0 mb-2 w-72 max-h-72 overflow-y-auto rounded-xl border border-white/15 bg-[#0d1320] shadow-2xl shadow-black/50 p-1.5 z-30">
                                    {vocesOrdenadas.length === 0 && (
                                        <div className="px-3 py-3 text-slate-500 text-[12px] text-center">
                                            No hay voces en español instaladas en este equipo.
                                        </div>
                                    )}
                                    {([["Naturales ✨", naturales], ["Estándar", estandar]] as const).map(([titulo, lista]) =>
                                        lista.length === 0 ? null : (
                                            <div key={titulo} className="mb-1 last:mb-0">
                                                {conGrupos && (
                                                    <div className="px-2 pt-1.5 pb-1 text-[9px] font-bold uppercase tracking-widest text-slate-500">{titulo}</div>
                                                )}
                                                {lista.map(v => {
                                                    const activa = v.voiceURI === vozURI
                                                    return (
                                                        <div key={v.voiceURI}
                                                            className={cn("group flex items-center gap-1 rounded-lg", activa ? tema.vozActiva : "hover:bg-white/5")}>
                                                            <button type="button" onClick={() => seleccionarVoz(v.voiceURI)}
                                                                className="flex-1 min-w-0 text-left px-2 py-1.5">
                                                                <span className={cn("block truncate text-[12px]", activa ? tema.vozTexto : "text-slate-200")}>
                                                                    {nombreVoz(v)} {esVozNatural(v) && <span>✨</span>}
                                                                </span>
                                                                <span className="block text-[10px] text-slate-500">
                                                                    {v.lang}{esVozNatural(v) ? " · natural" : " · estándar"}
                                                                </span>
                                                            </button>
                                                            <button type="button" title="Escuchar esta voz"
                                                                onClick={e => { e.stopPropagation(); probarVoz(v.voiceURI) }}
                                                                className={cn("shrink-0 p-2 mr-0.5 rounded-md transition-colors", tema.botonPreview)}>
                                                                <Play className="w-3.5 h-3.5" />
                                                            </button>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        )
                                    )}
                                </div>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={() => probarVoz()}
                            disabled={!vozURI}
                            title="Escuchar la voz seleccionada"
                            className={cn("inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-white/15 disabled:opacity-40 transition-colors", tema.botonPreview)}
                        >
                            <Play className="w-3 h-3" /> Probar
                        </button>
                    </div>

                    {/* Velocidad */}
                    <label className="inline-flex items-center gap-1.5">
                        <Gauge className="w-3.5 h-3.5 text-cyan-400/80" />
                        <span className="text-slate-500">Velocidad</span>
                        <input
                            type="range" min={0.7} max={1.4} step={0.05} value={rate}
                            onChange={e => {
                                const r = parseFloat(e.target.value)
                                setRate(r)
                                try { localStorage.setItem(CLAVE_VOZ_RATE, String(r)) } catch { /* sin persistencia */ }
                            }}
                            className={cn("w-24 cursor-pointer", tema.acentoSlider)}
                        />
                        <span className="tabular-nums text-slate-400 w-8">{rate.toFixed(2)}x</span>
                    </label>

                    {/* Conversación continua */}
                    <button
                        onClick={() => setContinuo(c => !c)}
                        className={cn(
                            "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-colors",
                            continuo ? tema.continuoActivo : "border-white/15 text-slate-400 hover:text-slate-200"
                        )}
                        title="Vuelve a escuchar automáticamente al terminar de responder"
                    >
                        <Repeat className="w-3.5 h-3.5" />
                        Continua
                    </button>
                </div>

                {/* Tip: el equipo no tiene voces naturales en español */}
                {sinNaturales && (
                    <p className="mt-2 text-center text-[10px] text-amber-300/80">
                        Sólo encontré voces estándar de español. Para voces naturales usa <b>Microsoft Edge</b> o
                        instálalas en Windows: Configuración → Hora e idioma → Voz → Agregar voces (Natural).
                    </p>
                )}

                {/* Entrada de texto (respaldo / cuando no quieres hablar) */}
                <form onSubmit={alEnviarTexto} className="mt-3 mx-auto max-w-2xl flex items-center gap-2">
                    <input
                        value={textoEscrito}
                        onChange={e => setTextoEscrito(e.target.value)}
                        maxLength={MAX_MENSAJE}
                        placeholder={`…o escríbele a ${config.nombre} y te responde por voz`}
                        className={cn(
                            "flex-1 bg-[#0a0e14] border border-white/15 rounded-full px-4 py-2 text-[13px] text-slate-200 outline-none placeholder:text-slate-600",
                            tema.focoInput
                        )}
                    />
                    <button
                        type="submit"
                        disabled={!textoEscrito.trim() || estado === "thinking" || estado === "listening"}
                        className="px-4 py-2 rounded-full bg-white/10 hover:bg-white/15 text-slate-200 text-[13px] font-bold disabled:opacity-40 transition-colors"
                    >
                        Enviar
                    </button>
                </form>
            </div>
        </div>
    )
}
