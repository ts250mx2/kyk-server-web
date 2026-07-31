import { type Components } from "react-markdown"
import { cn } from "@/lib/utils"

// Componentes de react-markdown para las respuestas de los agentes (markdown
// ligero: negritas, listas, tablas, citas). Compartidos por el panel de chat
// y la consola Jarvis. react-markdown no interpreta HTML crudo: sin XSS.
export function crearComponentesMarkdown(acento: "ambar" | "violeta"): Components {
    const esVioleta = acento === "violeta"
    return {
        p: ({ children }) => <p className="text-[13px] font-medium text-slate-100 break-words">{children}</p>,
        strong: ({ children }) => <strong className="font-black text-white">{children}</strong>,
        em: ({ children }) => <em className="italic text-slate-200">{children}</em>,
        ul: ({ children }) => <ul className="list-disc pl-4 space-y-0.5 text-[13px] font-medium text-slate-100">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-4 space-y-0.5 text-[13px] font-medium text-slate-100">{children}</ol>,
        li: ({ children }) => <li className="break-words">{children}</li>,
        code: ({ children }) => (
            <code className={cn("px-1 py-0.5 rounded bg-white/[0.08] text-[12px]", esVioleta ? "text-violet-200" : "text-amber-200")}>
                {children}
            </code>
        ),
        a: ({ href, children }) => (
            <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className={cn("underline", esVioleta ? "text-violet-300" : "text-amber-300")}
            >
                {children}
            </a>
        ),
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
