"use client"

import { useCallback, useEffect, useState } from "react"
import {
    AlertTriangle, FileText, Lightbulb, Loader2, RefreshCw, Sparkles, Target, TrendingUp, X
} from "lucide-react"
import { cn } from "@/lib/utils"

// Contexto que cada página arma con sus datos ya agregados (KPIs, tops y
// anomalías en texto) — mismo contrato que el Análisis Profundo de kyk-dashboard.
export interface PageSummaryContext {
    pageContext: string
    period: { fechaInicio: string; fechaFin: string }
    scope: string
    kpis: Record<string, number>
    highlights?: {
        topStores?: { name: string; value: number }[]
        topItems?: { name: string; value: number }[]
        anomalies?: string[]
    }
}

interface Analisis {
    executiveSummary: string
    keyInsights: string[]
    opportunities: string[]
    risks: string[]
    recommendedActions: string[]
}

// Mini-markdown de una línea: solo **negritas**, *cursivas* y `código`
function InlineMarkdown({ texto }: { texto: string }) {
    const partes = texto.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g)
    return (
        <>
            {partes.map((p, i) => {
                if (p.startsWith("**") && p.endsWith("**")) {
                    return <strong key={i} className="font-black text-white">{p.slice(2, -2)}</strong>
                }
                if (p.startsWith("*") && p.endsWith("*") && p.length > 2) {
                    return <em key={i} className="italic">{p.slice(1, -1)}</em>
                }
                if (p.startsWith("`") && p.endsWith("`")) {
                    return <code key={i} className="px-1 rounded bg-white/[0.08] text-amber-200 text-[12px]">{p.slice(1, -1)}</code>
                }
                return <span key={i}>{p}</span>
            })}
        </>
    )
}

function Seccion({ icono, titulo, color, children }: {
    icono: React.ReactNode
    titulo: string
    color: string
    children: React.ReactNode
}) {
    return (
        <div className="space-y-2">
            <h4 className={cn("flex items-center gap-2 text-[11px] font-black uppercase tracking-widest", color)}>
                {icono} {titulo}
            </h4>
            {children}
        </div>
    )
}

function Lista({ items }: { items: string[] }) {
    return (
        <ul className="space-y-1.5">
            {items.map((item, i) => (
                <li key={i} className="flex gap-2 text-[13px] font-medium text-slate-200 leading-relaxed">
                    <span className="text-slate-600 shrink-0 mt-0.5">•</span>
                    <span><InlineMarkdown texto={item} /></span>
                </li>
            ))}
        </ul>
    )
}

// Modal de Análisis Profundo IA — mismo flujo que kyk-dashboard: al abrir manda
// el contexto de la página a /api/analisis-profundo y pinta las 5 secciones.
// El contenido se monta fresco en cada apertura: así el análisis se genera una
// vez por apertura sin resets síncronos de estado en efectos.
export function AnalisisProfundoModal({ open, onClose, context }: {
    open: boolean
    onClose: () => void
    context: PageSummaryContext
}) {
    if (!open) return null
    return <ContenidoAnalisis onClose={onClose} context={context} />
}

function ContenidoAnalisis({ onClose, context }: {
    onClose: () => void
    context: PageSummaryContext
}) {
    const [data, setData] = useState<Analisis | null>(null)
    const [cargando, setCargando] = useState(true)
    const [error, setError] = useState("")

    // Sin setState síncrono: el estado inicial ya es "cargando"
    const solicitar = useCallback(() => (
        fetch("/api/analisis-profundo", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(context),
        })
            .then(res => res.json().then(json => ({ ok: res.ok, json })))
            .then(({ ok, json }) => {
                if (!ok) throw new Error(json.error || "Error generando el análisis")
                setData(json)
            })
            .catch((err: unknown) => {
                setError(err instanceof Error ? err.message : "Error generando el análisis")
            })
            .finally(() => setCargando(false))
    ), [context])

    useEffect(() => {
        solicitar()
    }, [solicitar])

    useEffect(() => {
        const alTeclear = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
        window.addEventListener("keydown", alTeclear)
        return () => window.removeEventListener("keydown", alTeclear)
    }, [onClose])

    const regenerar = () => {
        setCargando(true)
        setError("")
        setData(null)
        solicitar()
    }

    return (
        <div
            className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={onClose}
        >
            <div
                className="w-full max-w-3xl max-h-[88vh] bg-[#0d1320] border border-white/10 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden flex flex-col"
                onClick={e => e.stopPropagation()}
            >
                {/* Encabezado */}
                <div className="px-6 py-4 border-b border-white/10 bg-violet-500/[0.06] flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h3 className="text-[15px] font-black text-white flex items-center gap-2">
                            <Sparkles className="h-4 w-4 text-violet-300" /> Análisis Profundo IA
                        </h3>
                        <p className="text-[11px] font-bold text-slate-500 mt-1 truncate">
                            {context.scope} · {context.period.fechaInicio === context.period.fechaFin
                                ? context.period.fechaInicio
                                : `${context.period.fechaInicio} → ${context.period.fechaFin}`}
                        </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <button
                            onClick={regenerar}
                            disabled={cargando}
                            className="p-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-400 hover:text-violet-300 hover:border-violet-500/30 transition-all disabled:opacity-40"
                            title="Regenerar análisis"
                        >
                            <RefreshCw className={cn("h-3.5 w-3.5", cargando && "animate-spin")} />
                        </button>
                        <button
                            onClick={onClose}
                            className="p-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-400 hover:text-white transition-all"
                            title="Cerrar (Esc)"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                </div>

                {/* Contenido */}
                <div className="overflow-y-auto flex-1 px-6 py-5">
                    {cargando ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-3">
                            <Loader2 className="h-7 w-7 text-violet-300 animate-spin" />
                            <p className="text-[12px] font-bold text-slate-500 uppercase tracking-widest">Generando análisis profundo...</p>
                            <p className="text-[11px] font-bold text-slate-600">Esto puede tardar 5-10 segundos</p>
                        </div>
                    ) : error ? (
                        <div className="flex items-center gap-2 text-rose-300 text-[11px] font-black bg-rose-500/10 p-3 rounded-xl border border-rose-500/25 uppercase tracking-wider">
                            <AlertTriangle className="h-4 w-4" /> {error}
                        </div>
                    ) : data && (
                        <div className="space-y-6">
                            {data.executiveSummary && (
                                <Seccion icono={<FileText className="h-3.5 w-3.5" />} titulo="Resumen Ejecutivo" color="text-slate-300">
                                    <p className="text-[13px] font-medium text-slate-200 leading-relaxed">
                                        <InlineMarkdown texto={data.executiveSummary} />
                                    </p>
                                </Seccion>
                            )}
                            {data.keyInsights.length > 0 && (
                                <Seccion icono={<Lightbulb className="h-3.5 w-3.5" />} titulo="Hallazgos Clave" color="text-amber-300">
                                    <Lista items={data.keyInsights} />
                                </Seccion>
                            )}
                            {data.opportunities.length > 0 && (
                                <Seccion icono={<TrendingUp className="h-3.5 w-3.5" />} titulo="Oportunidades" color="text-emerald-300">
                                    <Lista items={data.opportunities} />
                                </Seccion>
                            )}
                            {data.risks.length > 0 && (
                                <Seccion icono={<AlertTriangle className="h-3.5 w-3.5" />} titulo="Riesgos / Alertas" color="text-rose-300">
                                    <Lista items={data.risks} />
                                </Seccion>
                            )}
                            {data.recommendedActions.length > 0 && (
                                <Seccion icono={<Target className="h-3.5 w-3.5" />} titulo="Acciones Recomendadas" color="text-violet-300">
                                    <Lista items={data.recommendedActions} />
                                </Seccion>
                            )}
                        </div>
                    )}
                </div>

                <div className="px-6 py-3 border-t border-white/10 flex items-center justify-between">
                    <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">
                        Generado por Kesito IA · <span className="normal-case">Claude Sonnet 5</span>
                    </p>
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 hover:text-white font-black text-[11px] uppercase tracking-widest transition-all"
                    >
                        Cerrar
                    </button>
                </div>
            </div>
        </div>
    )
}

// Botón estándar para abrir el análisis desde el encabezado de una página
export function BotonAnalisisProfundo({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-violet-500/15 border border-violet-500/30 text-violet-300 hover:bg-violet-500/25 font-black text-[11px] uppercase tracking-widest transition-all disabled:opacity-40"
            title="Análisis profundo con IA de los datos visibles"
        >
            <Sparkles className="h-4 w-4" />
            <span className="hidden sm:inline">Análisis Profundo IA</span>
        </button>
    )
}
