"use client"

import { AgenteChat } from "@/components/dashboard/AgenteChat"

// A.D.iA.N: Aprendizaje Dirigido por iA Nativo — el capacitador amigable del
// portal: responde leyendo los documentos (respetando qué ve cada tienda),
// cita fuentes, dibuja procedimientos como diagrama de flujo y ofrece chips
// de seguimiento (más fácil / ejemplo / practicar) para usuarios de todo perfil.
export function AdianPanel({ claveSesion, nombre = "" }: { claveSesion: string; nombre?: string }) {
    const nombrePila = nombre.trim().split(/\s+/)[0] || ""
    return (
        <AgenteChat
            claveSesion={claveSesion}
            config={{
                nombre: "A.D.iA.N",
                emoji: "📚",
                subtitulo: "Aprendizaje Dirigido por iA Nativo",
                endpoint: "/api/chat/adian",
                prefijoStorage: "adian-conversacion",
                acento: "violeta",
                placeholder: "Pregúntale a A.D.iA.N sobre los documentos... (Enter para enviar)",
                sugerencias: [
                    "¿Qué documentos tengo disponibles?",
                    "¿Cómo se hace un ajuste de inventario?",
                    "Explícame el procedimiento de devoluciones",
                    "Resume el documento más reciente",
                ],
                vacio: (
                    <>
                        {nombrePila ? `¡Hola, ${nombrePila}! ` : "¡Hola! "}👋 Soy tu capacitador:
                        me sé los <span className="text-violet-300">documentos y manuales del portal</span> y
                        te los explico con manzanas — con pasos, ejemplos y hasta diagramas.
                        Pregúntame lo que sea.
                    </>
                ),
                chips: [
                    { etiqueta: "🙂 Más fácil", texto: "Explícame lo anterior más fácil, con palabras más sencillas" },
                    { etiqueta: "🧾 Un ejemplo", texto: "Dame un ejemplo real de cómo se hace eso en la tienda" },
                    { etiqueta: "🎯 Practicar", texto: "Hazme una pregunta para practicar lo que me explicaste" },
                    { etiqueta: "➕ Cuéntame más", texto: "Cuéntame más detalles de lo anterior" },
                ],
                chipDiagrama: true,
            }}
        />
    )
}
