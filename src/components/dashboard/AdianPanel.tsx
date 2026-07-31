"use client"

import { AgenteChat } from "@/components/dashboard/AgenteChat"

// A.D.iA.N: Asistente Documental con IA — responde leyendo los documentos
// subidos al portal (respetando qué puede ver cada tienda) y cita sus fuentes.
export function AdianPanel({ claveSesion }: { claveSesion: string }) {
    return (
        <AgenteChat
            claveSesion={claveSesion}
            config={{
                nombre: "A.D.iA.N",
                emoji: "📚",
                subtitulo: "Asistente Documental · responde con los documentos del portal",
                endpoint: "/api/chat/adian",
                prefijoStorage: "adian-conversacion",
                acento: "violeta",
                placeholder: "Pregúntale a A.D.iA.N sobre los documentos... (Enter para enviar)",
                sugerencias: [
                    "¿Qué documentos tengo disponibles?",
                    "Resume el documento más reciente",
                    "¿En qué documento se explica cómo hacer un ajuste?",
                ],
                vacio: (
                    <>
                        Pregúntame sobre los <span className="text-violet-300">documentos subidos al portal</span> —
                        los leo (PDF, Word, Excel, texto) y te respondo citando la fuente.
                    </>
                ),
            }}
        />
    )
}
