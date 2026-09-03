"use client"

import { Star } from "lucide-react"
import { cn } from "@/lib/utils"
import {
    ESCALA,
    ESCALA_10,
    ETIQUETA_NO,
    ETIQUETA_SI,
    MAX_TEXTO_RESPUESTA_LEN,
    claseNps,
    requiereSeguimiento,
    type ClaseNps,
    type PreguntaEncuesta,
} from "@/lib/encuestas-tipos"

// Una pregunta de la encuesta pública dibujada según su tipo. El valor y el
// texto (respuesta abierta o seguimiento) viven en la página; aquí solo se
// pintan y se avisan los cambios.

interface PreguntaPublicaProps {
    pregunta: PreguntaEncuesta
    valor: number | undefined
    texto: string
    onValor: (valor: number) => void
    onTexto: (texto: string) => void
}

interface EleccionProps {
    pregunta: PreguntaEncuesta
    valor: number | undefined
    onValor: (valor: number) => void
}

const areaTexto = "w-full px-3.5 py-2.5 bg-white/[0.04] border border-white/10 rounded-xl text-[14px] font-medium text-slate-100 placeholder-slate-600 focus:outline-none focus:border-emerald-400/50 resize-none"
const botonBase = "rounded-xl border text-[13px] font-black transition-all active:scale-95"
const botonInactivo = "bg-white/[0.03] border-white/10 text-slate-300 hover:border-white/25"
const botonPositivo = "bg-emerald-500/25 border-emerald-400/60 text-emerald-200"
const botonNegativo = "bg-rose-500/25 border-rose-400/60 text-rose-200"

const COLOR_NPS: Record<ClaseNps, string> = {
    promotor: botonPositivo,
    pasivo: "bg-amber-500/25 border-amber-400/60 text-amber-200",
    detractor: botonNegativo,
}

/** Escala 1-10 en dos filas de cinco; la NPS pinta el color de promotor/pasivo/detractor. */
function Escala10({ pregunta, valor, onValor }: EleccionProps) {
    const [extremoBajo, extremoAlto] = pregunta.etiquetas
    const colorActivo = (v: number) => (pregunta.tipo === "nps" ? COLOR_NPS[claseNps(v)] : botonPositivo)
    return (
        <div className="mt-3">
            <div className="grid grid-cols-5 gap-1.5">
                {Array.from({ length: ESCALA_10 }, (_, i) => i + 1).map(v => (
                    <button
                        key={v}
                        type="button"
                        onClick={() => onValor(v)}
                        aria-label={`${v} de ${ESCALA_10}`}
                        aria-pressed={valor === v}
                        className={cn(botonBase, "py-2.5", valor === v ? colorActivo(v) : botonInactivo)}
                    >
                        {v}
                    </button>
                ))}
            </div>
            {(extremoBajo || extremoAlto) && (
                <div className="flex justify-between mt-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500">
                    <span>1 · {extremoBajo}</span>
                    <span>{extremoAlto} · {ESCALA_10}</span>
                </div>
            )}
        </div>
    )
}

function Estrellas({ pregunta, valor, onValor }: EleccionProps) {
    const etiqueta = valor ? pregunta.etiquetas[valor - 1] : ""
    return (
        <div className="mt-3">
            <div className="flex justify-center gap-2">
                {Array.from({ length: ESCALA }, (_, i) => i + 1).map(v => (
                    <button
                        key={v}
                        type="button"
                        onClick={() => onValor(v)}
                        className="p-1 transition-transform active:scale-90"
                        aria-label={`${v} de ${ESCALA}`}
                        aria-pressed={valor === v}
                    >
                        <Star className={cn("h-9 w-9 transition-colors", (valor ?? 0) >= v ? "text-amber-400 fill-amber-400" : "text-slate-700")} />
                    </button>
                ))}
            </div>
            {etiqueta && <p className="text-center text-[12px] font-black text-amber-300 mt-1.5">{etiqueta}</p>}
        </div>
    )
}

/** Opciones de mejor a peor: la primera vale más. */
function Opciones({ pregunta, valor, onValor }: EleccionProps) {
    return (
        <div className="mt-3 space-y-1.5">
            {pregunta.etiquetas.map((etiqueta, i) => {
                const v = pregunta.etiquetas.length - i
                return (
                    <button
                        key={i}
                        type="button"
                        onClick={() => onValor(v)}
                        aria-pressed={valor === v}
                        className={cn(botonBase, "w-full text-left px-4 py-2.5", valor === v ? botonPositivo : botonInactivo)}
                    >
                        {etiqueta}
                    </button>
                )
            })}
        </div>
    )
}

function SiNo({ valor, onValor }: EleccionProps) {
    const opciones: [number, string, string][] = [[1, ETIQUETA_SI, botonPositivo], [0, ETIQUETA_NO, botonNegativo]]
    return (
        <div className="mt-3 grid grid-cols-2 gap-2">
            {opciones.map(([v, etiqueta, colorActivo]) => (
                <button
                    key={v}
                    type="button"
                    onClick={() => onValor(v)}
                    aria-pressed={valor === v}
                    className={cn(botonBase, "py-2.5", valor === v ? colorActivo : botonInactivo)}
                >
                    {etiqueta}
                </button>
            ))}
        </div>
    )
}

function Eleccion(props: EleccionProps) {
    switch (props.pregunta.tipo) {
        case "nps":
        case "escala10":
            return <Escala10 {...props} />
        case "sino":
            return <SiNo {...props} />
        case "opciones":
            return <Opciones {...props} />
        default:
            return <Estrellas {...props} />
    }
}

export default function PreguntaPublica({ pregunta, valor, texto, onValor, onTexto }: PreguntaPublicaProps) {
    const esAbierta = pregunta.tipo === "texto"
    const pideSeguimiento =
        !esAbierta && Boolean(pregunta.seguimiento) && valor !== undefined &&
        requiereSeguimiento(pregunta.tipo, pregunta.etiquetas, valor)

    return (
        <section className="bg-white/[0.05] border border-white/10 rounded-2xl p-4">
            <p className="text-[14px] font-black text-white leading-snug">{pregunta.pregunta}</p>
            {esAbierta ? (
                <textarea
                    value={texto}
                    onChange={e => onTexto(e.target.value)}
                    maxLength={MAX_TEXTO_RESPUESTA_LEN}
                    rows={2}
                    placeholder="Escribe aquí..."
                    className={cn(areaTexto, "mt-3")}
                />
            ) : (
                <Eleccion pregunta={pregunta} valor={valor} onValor={onValor} />
            )}
            {pideSeguimiento && (
                <div className="mt-3 border-t border-white/10 pt-3">
                    <p className="text-[13px] font-black text-amber-300">{pregunta.seguimiento}</p>
                    <textarea
                        value={texto}
                        onChange={e => onTexto(e.target.value)}
                        maxLength={MAX_TEXTO_RESPUESTA_LEN}
                        rows={2}
                        placeholder="Cuéntanos..."
                        className={cn(areaTexto, "mt-2")}
                    />
                </div>
            )}
        </section>
    )
}
