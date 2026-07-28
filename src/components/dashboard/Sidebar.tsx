"use client"

import React, { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
    ChevronLeft,
    ChevronRight,
    Menu,
    X,
    ChevronDown
} from "lucide-react"
import { cn } from "@/lib/utils"

type MenuItem = {
    name: string;
    emoji: string;
    href: string;
};

type MenuSection = {
    title: string;
    emoji: string;
    items: MenuItem[];
    href?: string;
};

const menuSections: MenuSection[] = [
    {
        title: "Principal",
        emoji: "📊",
        href: "/dashboard",
        items: []
    },
    {
        title: "Artículos",
        emoji: "📦",
        items: [
            { name: "Precios", emoji: "🏷️", href: "/dashboard/articulos/precios" },
            { name: "Precios Básculas", emoji: "⚖️", href: "/dashboard/articulos/precios-basculas" },
            { name: "Ofertas", emoji: "🎁", href: "/dashboard/articulos/ofertas" },
        ]
    },
    {
        title: "Inventarios",
        emoji: "🧮",
        items: [
            { name: "Por Proveedor", emoji: "🚚", href: "/dashboard/inventarios/por-proveedor" },
            { name: "Quiebres y Sobre-inventario", emoji: "📉", href: "/dashboard/inventarios/quiebres" },
        ]
    },
    {
        title: "Comunicación",
        emoji: "📢",
        items: [
            { name: "Comunicados", emoji: "📣", href: "/dashboard/comunicados" },
            { name: "Documentos", emoji: "📁", href: "/dashboard/documentos" },
            { name: "Chat", emoji: "💬", href: "/dashboard/chat" },
        ]
    },
    {
        title: "Operaciones",
        emoji: "🏢",
        items: [
            { name: "Cortes de Caja", emoji: "💸", href: "/dashboard/operaciones/cortes" },
            { name: "Facturas", emoji: "🧾", href: "/dashboard/operaciones/facturas" },
            { name: "Recibos", emoji: "📄", href: "/dashboard/recibos/reporte" },
            { name: "Transferencias", emoji: "🔄", href: "/dashboard/transferencias/reporte" },
            { name: "Otros Movimientos", emoji: "📋", href: "/dashboard/operaciones/movimientos" },
            { name: "Devoluciones de Venta", emoji: "↩️", href: "/dashboard/operaciones/devoluciones" },
            { name: "Devoluciones de Compra", emoji: "📦", href: "/dashboard/operaciones/devoluciones-compra" },
        ]
    },
];

export function Sidebar({
    isCollapsed,
    onToggle
}: {
    isCollapsed: boolean;
    onToggle: () => void;
}) {
    const [isMobileOpen, setIsMobileOpen] = useState(false)
    const [openSections, setOpenSections] = useState<Record<string, boolean>>({})

    const pathname = usePathname()

    const toggleSection = (title: string, hasActiveChild: boolean) => {
        setOpenSections(prev => {
            const current = prev[title] !== undefined ? prev[title] : hasActiveChild;
            return { ...prev, [title]: !current };
        });
    }

    // Bloquear scroll del body con el menú móvil abierto
    React.useEffect(() => {
        if (isMobileOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [isMobileOpen]);

    return (
        <>
            {/* Botón menú móvil */}
            <button
                onClick={() => setIsMobileOpen(!isMobileOpen)}
                className="lg:hidden fixed top-3 left-3 z-[70] p-2 bg-emerald-500 text-slate-950 rounded-xl shadow-lg"
            >
                {isMobileOpen ? <X size={20} /> : <Menu size={20} />}
            </button>

            {isMobileOpen && (
                <div
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[55] lg:hidden"
                    onClick={() => setIsMobileOpen(false)}
                />
            )}

            {/* Contenedor del Sidebar */}
            <aside className={cn(
                "fixed left-0 top-16 h-[calc(100vh-4rem)] transition-all duration-300 z-[60] flex flex-col shadow-2xl shadow-black/50 overflow-hidden",
                "bg-[#0a101c] border-r border-white/10 text-slate-200",
                isCollapsed ? "w-[80px]" : "w-72",
                isMobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
            )}>

                {/* Menú de navegación */}
                <nav className="flex-1 px-3 py-6 space-y-2 overflow-y-auto">
                    {menuSections.map((section) => {
                        const hasActiveChild = section.items.some(item => pathname === item.href)

                        if (section.href) {
                            const isSectionActive = pathname === section.href;
                            return (
                                <Link
                                    key={section.title}
                                    href={section.href}
                                    onClick={() => setIsMobileOpen(false)}
                                    className={cn(
                                        "w-full flex items-center gap-3 py-2.5 transition-all rounded-xl",
                                        isCollapsed ? "justify-center" : "px-3 justify-between",
                                        isSectionActive
                                            ? "bg-emerald-500/15 text-emerald-300 font-bold border border-emerald-500/30"
                                            : "text-slate-400 hover:bg-white/[0.06] hover:text-white border border-transparent"
                                    )}
                                    title={isCollapsed ? section.title : ""}
                                >
                                    <div className="flex items-center gap-3">
                                        <span className="text-xl drop-shadow-md">{section.emoji}</span>
                                        {!isCollapsed && (
                                            <span className="text-[13px] font-black uppercase tracking-widest leading-none">
                                                {section.title}
                                            </span>
                                        )}
                                    </div>
                                </Link>
                            );
                        }

                        const explicitToggle = openSections[section.title];
                        const effectiveOpen = explicitToggle !== undefined ? explicitToggle : hasActiveChild;

                        return (
                            <div key={section.title} className="space-y-1">
                                <button
                                    onClick={() => !isCollapsed && toggleSection(section.title, hasActiveChild)}
                                    className={cn(
                                        "w-full flex items-center gap-3 py-2.5 transition-all rounded-xl",
                                        isCollapsed ? "justify-center" : "px-3 justify-between",
                                        !isCollapsed && "hover:bg-white/[0.06]",
                                        hasActiveChild && !effectiveOpen && "bg-white/[0.06] border border-white/10"
                                    )}
                                    title={isCollapsed ? section.title : ""}
                                >
                                    <div className="flex items-center gap-3">
                                        <span className="text-xl drop-shadow-md">{section.emoji}</span>
                                        {!isCollapsed && (
                                            <span className="text-[13px] font-black uppercase tracking-widest text-slate-400">
                                                {section.title}
                                            </span>
                                        )}
                                    </div>
                                    {!isCollapsed && (
                                        <ChevronDown className={cn(
                                            "h-3.5 w-3.5 text-slate-500 transition-transform duration-300",
                                            effectiveOpen ? "rotate-180" : ""
                                        )} />
                                    )}
                                </button>

                                <div className={cn(
                                    "space-y-1 overflow-hidden transition-all duration-300",
                                    (effectiveOpen && !isCollapsed) ? "max-h-[1000px] opacity-100 mt-1" : "max-h-0 opacity-0"
                                )}>
                                    {section.items.map((item) => {
                                        const isActive = pathname === item.href
                                        return (
                                            <Link
                                                key={item.name}
                                                href={item.href}
                                                onClick={() => setIsMobileOpen(false)}
                                                className={cn(
                                                    "flex items-center gap-3 py-2.5 rounded-xl transition-all ml-3",
                                                    isCollapsed ? "justify-center ml-0" : "pl-6 pr-4",
                                                    isActive
                                                        ? "bg-emerald-500/15 text-emerald-300 font-bold border border-emerald-500/30"
                                                        : "text-slate-400 hover:bg-white/[0.06] hover:text-white border border-transparent"
                                                )}
                                            >
                                                <span className="text-lg">{item.emoji}</span>
                                                {!isCollapsed && (
                                                    <span className="text-sm tracking-tight">{item.name}</span>
                                                )}
                                            </Link>
                                        )
                                    })}
                                </div>
                            </div>
                        )
                    })}
                </nav>

                {/* Contraer panel */}
                <div className="p-4 border-t border-white/10">
                    <button
                        onClick={onToggle}
                        className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-white/[0.06] transition-all text-slate-500 hover:text-white"
                    >
                        <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center">
                            {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
                        </div>
                        {!isCollapsed && <span className="text-sm font-bold tracking-tight">Contraer Panel</span>}
                    </button>
                </div>
            </aside>
        </>
    )
}
