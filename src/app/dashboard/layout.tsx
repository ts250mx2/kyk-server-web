"use client"

import React, { useState } from "react"
import { Sidebar } from "@/components/dashboard/Sidebar"
import { Header } from "@/components/dashboard/Header"
import { KesitoChat } from "@/components/dashboard/KesitoChat"
import { cn } from "@/lib/utils"

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const [isCollapsed, setIsCollapsed] = useState(false)

    return (
        <div className="min-h-screen bg-[#060a12] flex flex-col">
            {/* Header fijo de ancho completo */}
            <Header isCollapsed={isCollapsed} />

            <div className="flex flex-1 pt-16">
                {/* Sidebar fijo debajo del Header */}
                <Sidebar
                    isCollapsed={isCollapsed}
                    onToggle={() => setIsCollapsed(!isCollapsed)}
                />

                {/* Área de contenido principal */}
                <main className={cn(
                    "flex-1 transition-all duration-300 min-w-0",
                    isCollapsed ? "lg:pl-[80px]" : "lg:pl-72"
                )}>
                    <div className="p-4 sm:p-6 md:p-8 max-w-[1600px] mx-auto">
                        {children}
                    </div>
                </main>
            </div>

            {/* Kesito: agente de la tienda, disponible en todo el dashboard */}
            <KesitoChat />
        </div>
    )
}
