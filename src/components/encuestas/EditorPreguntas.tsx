"use client"

import { ChevronDown, ChevronUp, ClipboardList, Plus, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import {
    MAX_PREGUNTA_LEN,
    MAX_PREGUNTAS,
    MAX_SECCION_LEN,
    NOMBRES_TIPO,
    PLANTILLA_KYK,
    TIPOS_PREGUNTA,
    type DefinicionPregunta,
    type TipoPregunta,
} from "@/lib/encuestas-tipos"

// Editor de las preguntas de la encuesta (solo oficina). Las preguntas nuevas
// no traen id; al guardar, las que ya no estén se desactivan (el histórico de
// respuestas se conserva). "Cargar plantilla" deja en el editor la plantilla
// oficial de Kesos y Kosas: se aplica hasta que oficina guarda.

export type PreguntaEditable = DefinicionPregunta & { idPregunta?: number }

interface EditorPreguntasProps {
    preguntas: PreguntaEditable[]
    onChange: (preguntas: PreguntaEditable[]) => void
    onAviso: (texto: string) => void
}

const campo = "w-full px-3.5 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-[13px] font-medium text-slate-100 placeholder-slate-600 focus:outline-none focus:border-emerald-400/50"
const botonIcono = "p-2 rounded-lg bg-white/[0.05] border border-white/10 text-slate-500 transition-all disabled:opacity-30"

const PISTA_ETIQUETAS: Partial<Record<TipoPregunta, string>> = {
    estrellas: "Etiquetas 1..5 separadas por coma (opcional)",
    opciones: "Opciones de MEJOR a peor, separadas por coma",
    nps: "Extremos: bajo, alto (ej. Nada probable, Muy probable)",
    escala10: "Extremos: bajo, alto (ej. Mala, Excelente)",
}

const PREGUNTA_NUEVA: PreguntaEditable = { pregunta: "", tipo: "estrellas", etiquetas: [], seccion: null, seguimiento: null }

export default function EditorPreguntas({ preguntas, onChange, onAviso }: EditorPreguntasProps) {
    const cambiar = (i: number, cambios: Partial<PreguntaEditable>) => {
        onChange(preguntas.map((p, j) => (j === i ? { ...p, ...cambios } : p)))
    }

    const mover = (i: number, delta: number) => {
        const j = i + delta
        if (j < 0 || j >= preguntas.length) return
        onChange(preguntas.map((p, k) => (k === i ? preguntas[j] : k === j ? preguntas[i] : p)))
    }

    const cargarPlantilla = () => {
        const hayCambios = preguntas.length > 0
        if (hayCambios && !window.confirm("¿Reemplazar las preguntas actuales por la plantilla de Kesos y Kosas? Se aplica al guardar.")) return
        onChange(PLANTILLA_KYK.map(p => ({ ...p, etiquetas: [...p.etiquetas] })))
        onAviso("Plantilla cargada: guarda para aplicarla")
    }

    return (
        <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[12px] font-black text-slate-300 uppercase tracking-widest">Preguntas</h3>
                <div className="flex gap-1.5">
                    <button
                        onClick={cargarPlantilla}
                        title="Deja en el editor la plantilla oficial de Kesos y Kosas (NPS, trato, tiempo de espera, calidad, limpieza...)"
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.05] border border-white/10 text-slate-300 hover:text-cyan-300 text-[10px] font-black uppercase tracking-widest transition-all"
                    >
                        <ClipboardList className="h-3 w-3" /> Cargar plantilla
                    </button>
                    <button
                        onClick={() => onChange([...preguntas, PREGUNTA_NUEVA])}
                        disabled={preguntas.length >= MAX_PREGUNTAS}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[10px] font-black uppercase tracking-widest transition-all hover:bg-emerald-500/25 disabled:opacity-40"
                    >
                        <Plus className="h-3 w-3" /> Agregar
                    </button>
                </div>
            </div>

            <div className="space-y-3 mt-3">
                {preguntas.map((p, i) => (
                    <div key={p.idPregunta ?? `nueva-${i}`} className="border border-white/[0.06] rounded-xl p-3">
                        <div className="flex items-start gap-2">
                            <span className="mt-2 text-[11px] font-black text-slate-600">{i + 1}.</span>
                            <div className="flex-1 space-y-2">
                                <input
                                    value={p.pregunta}
                                    maxLength={MAX_PREGUNTA_LEN}
                                    placeholder="Texto de la pregunta"
                                    onChange={e => cambiar(i, { pregunta: e.target.value })}
                                    className={campo}
                                />
                                <div className="flex flex-wrap gap-2">
                                    <select
                                        value={p.tipo}
                                        onChange={e => cambiar(i, { tipo: e.target.value as TipoPregunta, etiquetas: [] })}
                                        className={cn(campo, "w-52")}
                                    >
                                        {TIPOS_PREGUNTA.map(t => (
                                            // Solo una pregunta NPS: de ella sale el indicador del reporte
                                            <option key={t} value={t} disabled={t === "nps" && p.tipo !== "nps" && preguntas.some(o => o.tipo === "nps")}>
                                                {NOMBRES_TIPO[t]}
                                            </option>
                                        ))}
                                    </select>
                                    {PISTA_ETIQUETAS[p.tipo] && (
                                        <input
                                            value={p.etiquetas.join(", ")}
                                            onChange={e => cambiar(i, { etiquetas: e.target.value.split(",").map(s => s.trim()) })}
                                            placeholder={PISTA_ETIQUETAS[p.tipo]}
                                            className={cn(campo, "flex-1 min-w-48")}
                                        />
                                    )}
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <input
                                        value={p.seccion ?? ""}
                                        maxLength={MAX_SECCION_LEN}
                                        onChange={e => cambiar(i, { seccion: e.target.value || null })}
                                        placeholder="Encabezado de sección (opcional; agrupa preguntas seguidas)"
                                        className={cn(campo, "flex-1 min-w-48")}
                                    />
                                    {p.tipo !== "texto" && (
                                        <input
                                            value={p.seguimiento ?? ""}
                                            maxLength={MAX_PREGUNTA_LEN}
                                            onChange={e => cambiar(i, { seguimiento: e.target.value || null })}
                                            placeholder="Pregunta abierta si la respuesta no fue la mejor (opcional)"
                                            className={cn(campo, "flex-1 min-w-48")}
                                        />
                                    )}
                                </div>
                            </div>
                            <div className="flex flex-col gap-1">
                                <button onClick={() => mover(i, -1)} disabled={i === 0} title="Subir" className={cn(botonIcono, "hover:text-white")}>
                                    <ChevronUp className="h-3.5 w-3.5" />
                                </button>
                                <button onClick={() => mover(i, 1)} disabled={i === preguntas.length - 1} title="Bajar" className={cn(botonIcono, "hover:text-white")}>
                                    <ChevronDown className="h-3.5 w-3.5" />
                                </button>
                                <button
                                    onClick={() => onChange(preguntas.filter((_, j) => j !== i))}
                                    title="Quitar pregunta (el histórico de respuestas se conserva)"
                                    className={cn(botonIcono, "hover:text-rose-300")}
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
                {preguntas.length === 0 && (
                    <p className="text-[11px] font-bold text-slate-600 py-4 text-center">Sin preguntas: agrega una o carga la plantilla</p>
                )}
            </div>
        </div>
    )
}
