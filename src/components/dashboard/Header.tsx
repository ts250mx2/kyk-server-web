"use client"

import React from "react"
import { useRouter } from "next/navigation"
import { Store, User, LogOut, Database } from "lucide-react"
import { cn } from "@/lib/utils"

interface SessionUser {
    name: string
    tienda: string
    mysqlHost: string
    mysqlDatabase: string
}

export function Header({ isCollapsed = false }: { isCollapsed?: boolean }) {
    const router = useRouter()
    const [user, setUser] = React.useState<SessionUser | null>(null)

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
