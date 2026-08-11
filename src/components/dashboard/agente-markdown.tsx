import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { BookOpen } from "lucide-react"
import { cn } from "@/lib/utils"
import { DiagramaFlujo, recortarFlujoAMedias } from "@/components/dashboard/diagrama-flujo"

// El agente separa la evidencia (citas textuales, fuente y link del documento)
// bajo una línea [REFERENCIAS]: en pantalla esa parte va colapsada tras el
// botón "Ver referencias" y el TTS no la lee (textoHablable la recorta).
const MARCA_REFERENCIAS = /^\s*\[REFERENCIAS\]\s*$/m

export function separarReferencias(texto: string): { cuerpo: string; referencias: string } {
    const marca = MARCA_REFERENCIAS.exec(texto)
    if (!marca) return { cuerpo: texto, referencias: "" }
    return {
        cuerpo: texto.slice(0, marca.index).trimEnd(),
        referencias: texto.slice(marca.index + marca[0].length).trim(),
    }
}

// Render completo de una respuesta de agente: markdown del cuerpo + sección de
// referencias colapsada (<details>, sin estado). Lo comparten las burbujas del
// panel de chat y la consola Jarvis; `enVivo` marca el borrador en streaming.
export function MarkdownAgente({ texto, acento, enVivo = false }: {
    texto: string
    acento: "ambar" | "violeta"
    enVivo?: boolean
}) {
    const componentes = crearComponentesMarkdown(acento)
    // El recorte de la línea a medias va sobre el texto crudo, antes del render
    const listo = enVivo ? recortarFlujoAMedias(texto) : texto
    const { cuerpo, referencias } = separarReferencias(listo)
    return (
        <>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={componentes}>
                {cuerpo}
            </ReactMarkdown>
            {referencias && (
                <details className="mt-1.5">
                    <summary className={cn(
                        "list-none [&::-webkit-details-marker]:hidden cursor-pointer select-none",
                        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-black uppercase tracking-wider transition-all",
                        acento === "violeta"
                            ? "border-violet-400/30 text-violet-300/90 hover:bg-violet-500/10"
                            : "border-amber-400/30 text-amber-300/90 hover:bg-amber-500/10"
                    )}>
                        <BookOpen className="h-3 w-3" /> Ver referencias
                    </summary>
                    <div className="mt-2 pt-2 border-t border-white/10 space-y-1.5">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={componentes}>
                            {referencias}
                        </ReactMarkdown>
                    </div>
                </details>
            )}
        </>
    )
}

// Componentes de react-markdown para las respuestas de los agentes (markdown
// ligero: negritas, listas, tablas, citas, diagramas de flujo). react-markdown
// no interpreta HTML crudo: sin XSS.
export function crearComponentesMarkdown(acento: "ambar" | "violeta"): Components {
    const esVioleta = acento === "violeta"
    return {
        p: ({ children }) => <p className="text-[13px] font-medium text-slate-100 break-words">{children}</p>,
        strong: ({ children }) => <strong className="font-black text-white">{children}</strong>,
        em: ({ children }) => <em className="italic text-slate-200">{children}</em>,
        ul: ({ children }) => <ul className="list-disc pl-4 space-y-0.5 text-[13px] font-medium text-slate-100">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-4 space-y-0.5 text-[13px] font-medium text-slate-100">{children}</ol>,
        li: ({ children }) => <li className="break-words">{children}</li>,
        // Los bloques de código llegan como pre > code: el pre se desempaqueta
        // y code decide qué pintar según el lenguaje del fence
        pre: ({ children }) => <>{children}</>,
        code: ({ className, children }) => {
            const codigo = Array.isArray(children) ? children.join("") : String(children ?? "")
            // Fence ```flujo → diagrama de pasos con ramas Sí/No
            if (className?.includes("language-flujo")) {
                return <DiagramaFlujo fuente={codigo} acento={acento} />
            }
            // Cualquier otro bloque (con lenguaje o multilínea) → código en bloque
            if (className?.includes("language-") || codigo.includes("\n")) {
                return (
                    <pre className="overflow-x-auto rounded-lg bg-white/[0.06] p-2 my-1">
                        <code className="text-[12px] text-slate-200">{codigo}</code>
                    </pre>
                )
            }
            return (
                <code className={cn("px-1 py-0.5 rounded bg-white/[0.08] text-[12px]", esVioleta ? "text-violet-200" : "text-amber-200")}>
                    {children}
                </code>
            )
        },
        // Solo enlaces INTERNOS del portal son clickeables (documentos, fotos…):
        // un documento subido podría inyectar un enlace externo vía el agente y
        // vestirlo de oficial (phishing) — esos se muestran como texto plano
        a: ({ href, children }) => {
            const ruta = typeof href === "string" ? href : ""
            if (ruta.startsWith("/") && !ruta.startsWith("//")) {
                return (
                    <a
                        href={ruta}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn("underline", esVioleta ? "text-violet-300" : "text-amber-300")}
                    >
                        {children}
                    </a>
                )
            }
            return <span className="text-slate-300">{children}</span>
        },
        // Miniaturas de producto: SOLO imágenes servidas por el propio portal
        // (/api/...); si el producto no tiene foto, la imagen rota se oculta sola
        img: ({ src, alt }) => {
            const ruta = typeof src === "string" ? src : ""
            if (!ruta.startsWith("/api/")) return null
            return (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={ruta}
                    alt={alt ?? ""}
                    loading="lazy"
                    className="inline-block max-h-24 max-w-[8rem] rounded-lg border border-white/10 bg-white/[0.04] my-1 mr-2 align-top object-contain"
                    onError={e => { (e.target as HTMLImageElement).style.display = "none" }}
                />
            )
        },
        h1: ({ children }) => <p className="text-[13px] font-black text-white uppercase tracking-wide">{children}</p>,
        h2: ({ children }) => <p className="text-[13px] font-black text-white uppercase tracking-wide">{children}</p>,
        h3: ({ children }) => <p className="text-[13px] font-black text-white">{children}</p>,
        hr: () => <hr className="border-white/10" />,
        blockquote: ({ children }) => (
            <blockquote className={cn("border-l-2 pl-2 text-slate-300", esVioleta ? "border-violet-400/40" : "border-amber-400/40")}>
                {children}
            </blockquote>
        ),
        table: ({ children }) => (
            <div className="overflow-x-auto">
                <table className="text-[12px] border-collapse">{children}</table>
            </div>
        ),
        th: ({ children }) => (
            <th className={cn(
                "text-left font-black uppercase tracking-wider text-[10px] px-2 py-1 border-b border-white/15 whitespace-nowrap",
                esVioleta ? "text-violet-300/80" : "text-amber-300/80"
            )}>
                {children}
            </th>
        ),
        td: ({ children }) => <td className="px-2 py-1 border-b border-white/[0.06] text-slate-200">{children}</td>,
    }
}
