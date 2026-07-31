"use client"

import { AgenteChat } from "@/components/dashboard/AgenteChat"

// Kesito: agente de datos de la tienda (precios, ventas, inventario...).
// El panel genérico vive en AgenteChat; aquí solo su configuración.
export function KesitoPanel({ claveSesion }: { claveSesion: string }) {
    return (
        <AgenteChat
            claveSesion={claveSesion}
            config={{
                // En mayúsculas explícitas: el panel ya no aplica `uppercase` por
                // CSS (para respetar la i minúscula de A.D.iA.N)
                nombre: "KESITO",
                emoji: "🧀",
                subtitulo: "Agente de tu tienda · conversación privada",
                modelo: "Claude Sonnet 5",
                endpoint: "/api/chat/kesito",
                prefijoStorage: "kesito-conversacion",
                acento: "ambar",
                placeholder: "Pregúntale a Kesito... (Enter para enviar)",
                sugerencias: [
                    "¿Cómo van las ventas de hoy?",
                    "¿Qué ofertas están vigentes?",
                    "¿Qué recibos de mercancía llegaron hoy?",
                    "¿Hay devoluciones de compra pendientes?",
                ],
                vacio: (
                    <>
                        Pregúntame por precios, ofertas, ventas del día, cortes, recibos,
                        transferencias, facturas o devoluciones de <span className="text-amber-300">tu tienda</span>.
                    </>
                ),
            }}
        />
    )
}
