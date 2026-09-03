"use client"

import React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Store, User, LogOut, Database, Bell } from "lucide-react"
import { cn } from "@/lib/utils"
import { LigaEncuesta } from "@/components/dashboard/LigaEncuesta"

interface SessionUser {
    name: string
    tienda: string
    mysqlHost: string
    mysqlDatabase: string
}

export function Header({ isCollapsed = false }: { isCollapsed?: boolean }) {
    const router = useRouter()
    const [user, setUser] = React.useState<SessionUser | null>(null)
    const [noLeidos, setNoLeidos] = React.useState({ total: 0, urgentes: 0 })

    React.useEffect(() => {
        const fetchUser = async () => {
            try {
                const res = await fetch("/api/auth/me")
                const data = await res.json()
                if (data.user) {
                    setUser(data.user)
                }
            } catch (error) {
                console.error("Error fetching user:", error)
            }
        }
        fetchUser()
    }, [])

    // Campana de comunicados: consulta los no leídos cada minuto
    React.useEffect(() => {
        let activo = true
        const consultar = async () => {
            try {
                const res = await fetch("/api/comunicados/no-leidos")
                const data = await res.json()
                if (activo && res.ok) {
                    setNoLeidos({ total: data.total ?? 0, urgentes: data.urgentes ?? 0 })
                }
            } catch {
                // la campana no debe romper el header si el central no responde
            }
        }
        consultar()
        const intervalo = setInterval(consultar, 60_000)
        return () => { activo = false; clearInterval(intervalo) }
    }, [])

    const handleLogout = async () => {
        try {
            await fetch("/api/auth/logout", { method: "POST" })
            router.push("/login")
            router.refresh()
        } catch (error) {
            console.error("Logout failed:", error)
            router.push("/login")
        }
    }

    return (
        <header className="fixed top-0 left-0 right-0 h-16 z-50 px-4 sm:px-6 flex items-center justify-between bg-[#0a101c]/95 backdrop-blur-md border-b border-white/10 shadow-lg shadow-black/30">
            {/* Marca */}
            <div className="flex items-center gap-4 pl-10 lg:pl-0">
                <div className={cn(
                    "flex items-center gap-3 lg:pr-6 lg:border-r border-white/10 transition-all duration-300",
                    isCollapsed ? "lg:w-14" : "lg:w-60"
                )}>
                    <div className="w-10 h-10 rounded-xl bg-white/[0.05] border border-white/10 flex items-center justify-center flex-shrink-0 overflow-hidden">
                        <img
                            src="/logo.svg"
                            alt="Logo"
                            className="w-7 h-7 object-contain"
                        />
                    </div>
                    {!isCollapsed && (
                        <div className="hidden sm:flex flex-col whitespace-nowrap overflow-hidden">
                            <span className="font-black text-lg leading-none tracking-tight text-white uppercase">
                                KYK <span className="ksw-gradient-text">Server</span>
                            </span>
                            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">
                                Reportes de Tienda
                            </span>
                        </div>
                    )}
                </div>

                {/* Tienda conectada */}
                {user && (
                    <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25">
                        <Store className="h-4 w-4 text-emerald-400 flex-shrink-0" />
                        <div className="flex flex-col leading-none">
                            <span className="text-[12px] font-black text-emerald-300 tracking-tight">{user.tienda}</span>
                            <span className="hidden md:flex items-center gap-1 text-[9px] font-bold text-emerald-500/70 mt-0.5">
                                <Database className="h-2.5 w-2.5" />
                                {user.mysqlHost} · {user.mysqlDatabase}
                            </span>
                        </div>
                    </div>
                )}
            </div>

            {/* Usuario y salir */}
            <div className="flex items-center gap-3">
                {/* Encuesta de la sucursal: QR para la tableta, abrir o copiar la liga */}
                <LigaEncuesta />

                <Link
                    href="/dashboard/chat?canal=kesito"
                    className="p-2 rounded-xl bg-white/[0.05] border border-white/10 hover:border-amber-500/30 hover:bg-amber-500/10 transition-all"
                    title="Pregúntale a Kesito"
                    aria-label="Pregúntale a Kesito"
                >
                    <span className="block h-4 w-4 text-[13px] leading-4 text-center" aria-hidden>🧀</span>
                </Link>

                <Link
                    href="/dashboard/comunicados"
                    className={cn(
                        "relative p-2 rounded-xl border transition-all",
                        noLeidos.urgentes > 0
                            ? "bg-rose-500/10 border-rose-500/30 text-rose-300"
                            : "bg-white/[0.05] border-white/10 text-slate-400 hover:text-emerald-300 hover:border-emerald-500/30"
                    )}
                    title={noLeidos.total > 0 ? `${noLeidos.total} comunicados sin confirmar` : "Comunicados"}
                >
                    <Bell className={cn("h-4 w-4", noLeidos.urgentes > 0 && "animate-pulse")} />
                    {noLeidos.total > 0 && (
                        <span className={cn(
                            "absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full text-[9px] font-black flex items-center justify-center border-2 border-[#0a101c]",
                            noLeidos.urgentes > 0 ? "bg-rose-500 text-white" : "bg-emerald-500 text-slate-950"
                        )}>
                            {noLeidos.total > 99 ? "99+" : noLeidos.total}
                        </span>
                    )}
                </Link>

                <div className="hidden sm:flex flex-col text-right">
                    <p className="text-[13px] font-bold leading-none text-white">{user?.name ?? "Cargando..."}</p>
                    <p className="text-[9px] text-slate-500 mt-1 uppercase tracking-widest font-black">Sesión activa</p>
                </div>

                <div className="h-9 w-9 rounded-xl bg-white/[0.05] border border-white/10 flex items-center justify-center text-slate-300">
                    <User size={17} />
                </div>

                <button
                    onClick={handleLogout}
                    className="p-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-400 hover:text-rose-300 hover:bg-rose-500/10 hover:border-rose-500/30 transition-all flex items-center gap-2 group"
                    title="Cerrar Sesión"
                >
                    <LogOut className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
                    <span className="hidden xl:block text-[11px] font-bold uppercase tracking-wider">Salir</span>
                </button>
            </div>
        </header>
    )
}
