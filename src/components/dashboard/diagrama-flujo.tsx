import { Fragment } from "react"
import { cn } from "@/lib/utils"

// Diagrama de flujo de los agentes: renderiza el fence ```flujo como una fila
// HORIZONTAL de tarjetas numeradas conectadas por flechas →, y las decisiones
// como tarjeta destacada con ramas Sí/No apiladas. Si el proceso es largo, se
// desliza de lado dentro de la burbuja. Formato (una línea por elemento):
//   titulo: Nombre corto        (opcional)
//   Un paso normal
//   ? Pregunta de decisión
//   si: camino si la respuesta es sí
//   no: camino si la respuesta es no
// Es texto plano renderizado con JSX (sin HTML crudo: sin XSS).

interface Paso {
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

export function parsearFlujo(fuente: string): { titulo: string; pasos: Paso[] } {
    const lineas = fuente.split("\n")
    let titulo = ""
    const pasos: Paso[] = []
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

const Flecha = () => (
    <div className="flex items-center px-1 shrink-0 self-center" aria-hidden>
        <div className="w-2.5 h-px bg-white/20" />
        <svg width="6" height="10" viewBox="0 0 6 10" className="text-white/30">
            <path d="M0 0 L6 5 L0 10" fill="currentColor" />
        </svg>
    </div>
)

export function DiagramaFlujo({ fuente, acento }: {
    fuente: string
    acento: "ambar" | "violeta"
}) {
    const { titulo, pasos } = parsearFlujo(fuente)
    if (pasos.length === 0) return null
    const esVioleta = acento === "violeta"
    let numero = 0

    return (
        <div className="my-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
            {titulo && (
                <p className={cn(
                    "text-[11px] font-black uppercase tracking-widest mb-2",
                    esVioleta ? "text-violet-300" : "text-amber-300"
                )}>
                    {titulo}
                </p>
            )}
            {/* Fila horizontal: si el proceso es largo se desliza de lado */}
            <div className="flex items-stretch overflow-x-auto pb-1.5">
                {pasos.map((paso, i) => (
                    <Fragment key={i}>
                        {i > 0 && <Flecha />}
                        {paso.tipo === "paso" ? (
                            <div className="shrink-0 w-40 self-center flex items-start gap-2 rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2">
                                <span className={cn(
                                    "mt-0.5 h-5 w-5 shrink-0 rounded-full text-[11px] font-black text-slate-950 flex items-center justify-center",
                                    esVioleta ? "bg-violet-400" : "bg-amber-400"
                                )}>
                                    {++numero}
                                </span>
                                <p className="text-[12px] font-semibold text-slate-100 break-words">{paso.texto}</p>
                            </div>
                        ) : (
                            <div className={cn(
                                "shrink-0 w-52 self-center rounded-lg border px-3 py-2",
                                esVioleta ? "border-violet-400/40 bg-violet-500/10" : "border-amber-400/40 bg-amber-500/10"
                            )}>
                                <p className="text-[12px] font-black text-white break-words">{paso.texto}</p>
                                {(paso.si || paso.no) && (
                                    <div className="mt-1.5 space-y-1.5">
                                        {paso.si && (
                                            <div className="rounded-md border border-emerald-400/30 bg-emerald-500/10 px-2 py-1.5">
                                                <span className="text-[10px] font-black uppercase tracking-widest text-emerald-300">Sí</span>
                                                <p className="text-[12px] font-semibold text-slate-100 break-words">{paso.si}</p>
                                            </div>
                                        )}
                                        {paso.no && (
                                            <div className="rounded-md border border-rose-400/30 bg-rose-500/10 px-2 py-1.5">
                                                <span className="text-[10px] font-black uppercase tracking-widest text-rose-300">No</span>
                                                <p className="text-[12px] font-semibold text-slate-100 break-words">{paso.no}</p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </Fragment>
                ))}
            </div>
        </div>
    )
}
