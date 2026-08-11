"use client"

import { Fragment, useEffect, useState } from "react"
import { Check, FileDown, Flag, GitBranch, Maximize2, Play, X } from "lucide-react"
import { cn } from "@/lib/utils"

// Diagrama de flujo de los agentes: renderiza el fence ```flujo como una fila
// HORIZONTAL de tarjetas numeradas conectadas por flechas →, con nodos de
// INICIO/FIN y las decisiones como tarjeta destacada con ramas Sí/No. Se puede
// maximizar a pantalla completa y exportar a PDF imprimible (lib/flujo-pdf).
// Formato (una línea por elemento):
//   titulo: Nombre corto        (opcional)
//   Un paso normal
//   ? Pregunta de decisión
//   si: camino si la respuesta es sí
//   no: camino si la respuesta es no
// Es texto plano renderizado con JSX (sin HTML crudo: sin XSS).

export interface PasoFlujo {
    tipo: "paso" | "decision"
    texto: string
    si?: string
    no?: string
}

// El borrador en streaming puede terminar a media línea DENTRO de un fence
// ```flujo abierto; esa línea parcial se pintaría como paso o decisión rota.
// Se recorta AQUÍ, sobre el texto crudo ANTES de react-markdown, porque el
// renderer agrega un \n final al contenido del fence y en el componente ya no
// se distingue si la última línea estaba completa.
export function recortarFlujoAMedias(texto: string): string {
    if (!texto || texto.endsWith("\n")) return texto
    const marcas = texto.match(/^```.*$/gm) ?? []
    if (marcas.length % 2 === 0) return texto // sin fence abierto
    if (!/^```\s*flujo/.test(marcas[marcas.length - 1])) return texto // el abierto no es flujo
    const corte = texto.lastIndexOf("\n")
    return corte < 0 ? texto : texto.slice(0, corte + 1)
}

export function parsearFlujo(fuente: string): { titulo: string; pasos: PasoFlujo[] } {
    const lineas = fuente.split("\n")
    let titulo = ""
    const pasos: PasoFlujo[] = []
    for (const cruda of lineas) {
        const linea = cruda.trim()
        if (!linea || linea === "```") continue
        if (/^t[ií]tulo\s*:/i.test(linea)) {
            titulo = linea.replace(/^t[ií]tulo\s*:/i, "").trim()
            continue
        }
        if (linea.startsWith("?") || linea.startsWith("¿")) {
            pasos.push({ tipo: "decision", texto: linea.replace(/^\?\s*/, "").trim() })
            continue
        }
        const rama = /^(si|sí|no)\s*:/i.exec(linea)
        const ultimo = pasos[pasos.length - 1]
        if (rama && ultimo?.tipo === "decision") {
            const clave = rama[1].toLowerCase().startsWith("s") ? "si" : "no"
            pasos[pasos.length - 1] = { ...ultimo, [clave]: linea.slice(rama[0].length).trim() }
            continue
        }
        pasos.push({ tipo: "paso", texto: linea })
    }
    return { titulo, pasos }
}

function Flecha({ esVioleta, grande }: { esVioleta: boolean; grande?: boolean }) {
    return (
        <div className="flex items-center px-1 shrink-0 self-center" aria-hidden>
            <div className={cn("h-px", grande ? "w-6" : "w-3", esVioleta ? "bg-violet-400/50" : "bg-amber-400/50")} />
            <svg
                width={grande ? 8 : 6}
                height={grande ? 13 : 10}
                viewBox="0 0 6 10"
                className={esVioleta ? "text-violet-400/70" : "text-amber-400/70"}
            >
                <path d="M0 0 L6 5 L0 10" fill="currentColor" />
            </svg>
        </div>
    )
}

// Nodo terminal del flujo: INICIO (verde) y FIN (neutro)
function Terminal({ tipo, grande }: { tipo: "inicio" | "fin"; grande?: boolean }) {
    const esInicio = tipo === "inicio"
    return (
        <span className={cn(
            "self-center shrink-0 inline-flex items-center gap-1 rounded-full border font-black uppercase tracking-widest",
            grande ? "px-4 py-1.5 text-[11px]" : "px-2.5 py-1 text-[9px]",
            esInicio
                ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-300"
                : "border-white/20 bg-white/[0.06] text-slate-300"
        )}>
            {esInicio
                ? <Play className={grande ? "h-3.5 w-3.5" : "h-2.5 w-2.5"} />
                : <Flag className={grande ? "h-3.5 w-3.5" : "h-2.5 w-2.5"} />}
            {esInicio ? "Inicio" : "Fin"}
        </span>
    )
}

function FilaFlujo({ pasos, esVioleta, grande }: {
    pasos: PasoFlujo[]
    esVioleta: boolean
    grande?: boolean
}) {
    let numero = 0
    return (
        <div className="flex items-stretch overflow-x-auto pb-1.5">
            <Terminal tipo="inicio" grande={grande} />
            {pasos.map((paso, i) => (
                <Fragment key={i}>
                    <Flecha esVioleta={esVioleta} grande={grande} />
                    {paso.tipo === "paso" ? (
                        <div className={cn(
                            "shrink-0 self-center flex items-start gap-2 rounded-xl border border-white/10",
                            "bg-gradient-to-b from-white/[0.09] to-white/[0.03] shadow-lg shadow-black/20",
                            grande ? "w-60 px-4 py-3" : "w-40 px-3 py-2"
                        )}>
                            <span className={cn(
                                "mt-0.5 shrink-0 rounded-full font-black text-slate-950 flex items-center justify-center ring-2",
                                grande ? "h-7 w-7 text-[13px]" : "h-5 w-5 text-[11px]",
                                esVioleta
                                    ? "bg-violet-400 ring-violet-300/30 shadow-[0_0_10px_rgba(167,139,250,0.45)]"
                                    : "bg-amber-400 ring-amber-300/30 shadow-[0_0_10px_rgba(251,191,36,0.45)]"
                            )}>
                                {++numero}
                            </span>
                            <p className={cn("font-semibold text-slate-100 break-words", grande ? "text-[15px]" : "text-[12px]")}>
                                {paso.texto}
                            </p>
                        </div>
                    ) : (
                        <div className={cn(
                            "shrink-0 self-center rounded-xl border shadow-lg shadow-black/20",
                            grande ? "w-80 px-4 py-3" : "w-52 px-3 py-2",
                            esVioleta
                                ? "border-violet-400/50 bg-gradient-to-b from-violet-500/25 to-violet-500/[0.06]"
                                : "border-amber-400/50 bg-gradient-to-b from-amber-500/25 to-amber-500/[0.06]"
                        )}>
                            <p className={cn(
                                "font-black text-white break-words flex items-start gap-1.5",
                                grande ? "text-[15px]" : "text-[12px]"
                            )}>
                                <GitBranch className={cn(
                                    "mt-0.5 shrink-0",
                                    grande ? "h-4 w-4" : "h-3 w-3",
                                    esVioleta ? "text-violet-300" : "text-amber-300"
                                )} />
                                {paso.texto}
                            </p>
                            {(paso.si || paso.no) && (
                                <div className="mt-1.5 space-y-1.5">
                                    {paso.si && (
                                        <div className="flex items-start gap-1.5 rounded-md border border-emerald-400/30 bg-emerald-500/10 px-2 py-1.5">
                                            <Check className={cn("mt-0.5 shrink-0 text-emerald-300", grande ? "h-4 w-4" : "h-3 w-3")} />
                                            <div className="min-w-0">
                                                <span className={cn("block font-black uppercase tracking-widest text-emerald-300", grande ? "text-[11px]" : "text-[9px]")}>Sí</span>
                                                <p className={cn("font-semibold text-slate-100 break-words", grande ? "text-[14px]" : "text-[12px]")}>{paso.si}</p>
                                            </div>
                                        </div>
                                    )}
                                    {paso.no && (
                                        <div className="flex items-start gap-1.5 rounded-md border border-rose-400/30 bg-rose-500/10 px-2 py-1.5">
                                            <X className={cn("mt-0.5 shrink-0 text-rose-300", grande ? "h-4 w-4" : "h-3 w-3")} />
                                            <div className="min-w-0">
                                                <span className={cn("block font-black uppercase tracking-widest text-rose-300", grande ? "text-[11px]" : "text-[9px]")}>No</span>
                                                <p className={cn("font-semibold text-slate-100 break-words", grande ? "text-[14px]" : "text-[12px]")}>{paso.no}</p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </Fragment>
            ))}
            <Flecha esVioleta={esVioleta} grande={grande} />
            <Terminal tipo="fin" grande={grande} />
        </div>
    )
}

export function DiagramaFlujo({ fuente, acento }: {
    fuente: string
    acento: "ambar" | "violeta"
}) {
    const [maximizado, setMaximizado] = useState(false)

    // Esc cierra la vista maximizada
    useEffect(() => {
        if (!maximizado) return
        const alTeclear = (e: KeyboardEvent) => { if (e.key === "Escape") setMaximizado(false) }
        window.addEventListener("keydown", alTeclear)
        return () => window.removeEventListener("keydown", alTeclear)
    }, [maximizado])

    const { titulo, pasos } = parsearFlujo(fuente)
    if (pasos.length === 0) return null
    const esVioleta = acento === "violeta"

    // jspdf se carga solo cuando alguien exporta (no viaja en el bundle del chat)
    const exportarPdf = async () => {
        const { generarPdfFlujo } = await import("@/lib/flujo-pdf")
        generarPdfFlujo(titulo, pasos, acento)
    }

    const botonAccion = cn(
        "p-1.5 rounded-lg bg-white/[0.05] border border-white/10 text-slate-400 transition-all",
        esVioleta ? "hover:text-violet-300 hover:border-violet-500/30" : "hover:text-amber-300 hover:border-amber-500/30"
    )

    return (
        <div className="my-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
                <p className={cn(
                    "min-w-0 truncate text-[11px] font-black uppercase tracking-widest flex items-center gap-1.5",
                    esVioleta ? "text-violet-300" : "text-amber-300"
                )}>
                    <GitBranch className="h-3.5 w-3.5 shrink-0" />
                    {titulo || "Diagrama de flujo"}
                </p>
                <div className="flex items-center gap-1 shrink-0">
                    <button onClick={exportarPdf} className={botonAccion} title="Exportar a PDF para imprimir" aria-label="Exportar el diagrama a PDF">
                        <FileDown className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => setMaximizado(true)} className={botonAccion} title="Ver en grande" aria-label="Maximizar el diagrama">
                        <Maximize2 className="h-3.5 w-3.5" />
                    </button>
                </div>
            </div>
            <FilaFlujo pasos={pasos} esVioleta={esVioleta} />

            {/* Vista maximizada: overlay a pantalla completa (Esc o clic afuera cierran) */}
            {maximizado && (
                <div
                    className="fixed inset-0 z-[97] bg-[#090d16]/95 backdrop-blur-sm flex flex-col p-5 sm:p-8"
                    onClick={() => setMaximizado(false)}
                >
                    <div className="flex items-center justify-between gap-3 mb-6" onClick={e => e.stopPropagation()}>
                        <h3 className={cn(
                            "min-w-0 truncate text-base sm:text-lg font-black uppercase tracking-widest flex items-center gap-2",
                            esVioleta ? "text-violet-300" : "text-amber-300"
                        )}>
                            <GitBranch className="h-5 w-5 shrink-0" />
                            {titulo || "Diagrama de flujo"}
                        </h3>
                        <div className="flex items-center gap-2 shrink-0">
                            <button
                                onClick={exportarPdf}
                                className={cn(
                                    "inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-black text-slate-950 hover:brightness-110 transition-all",
                                    esVioleta ? "bg-violet-400" : "bg-amber-400"
                                )}
                                title="Exportar a PDF para imprimir"
                            >
                                <FileDown className="h-4 w-4" /> PDF
                            </button>
                            <button
                                onClick={() => setMaximizado(false)}
                                className="p-2 rounded-xl bg-white/[0.05] border border-white/15 text-slate-300 hover:text-white transition-all"
                                title="Cerrar (Esc)"
                                aria-label="Cerrar la vista maximizada"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                    </div>
                    <div className="flex-1 min-h-0 overflow-auto flex items-center" onClick={e => e.stopPropagation()}>
                        <FilaFlujo pasos={pasos} esVioleta={esVioleta} grande />
                    </div>
                </div>
            )}
        </div>
    )
}
