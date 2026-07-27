"use client"

import { useEffect, useState } from "react"
import { Store, User, Lock, ChevronDown, Eye, EyeOff, Loader2, ArrowRight, RefreshCw, Database } from "lucide-react"
import { cn } from "@/lib/utils"

interface TiendaOption {
    IdTienda: number
    Tienda: string
    Abr: string | null
}

export default function LoginPage() {
    const [tiendas, setTiendas] = useState<TiendaOption[]>([])
    const [loadingTiendas, setLoadingTiendas] = useState(true)
    const [tiendasError, setTiendasError] = useState("")
    const [idTienda, setIdTienda] = useState("")
    const [codigobarras, setCodigobarras] = useState("")
    const [password, setPassword] = useState("")
    const [showPassword, setShowPassword] = useState(false)
    const [error, setError] = useState("")
    const [loading, setLoading] = useState(false)

    const loadTiendas = async () => {
        setLoadingTiendas(true)
        setTiendasError("")
        try {
            const res = await fetch("/api/auth/tiendas")
            const data = await res.json()
            if (!res.ok) {
                throw new Error(data.error || "Error al obtener tiendas")
            }
            setTiendas(data.tiendas || [])
        } catch (err: unknown) {
            setTiendasError(err instanceof Error ? err.message : "No fue posible cargar las tiendas")
        } finally {
            setLoadingTiendas(false)
        }
    }

    useEffect(() => {
        loadTiendas()
    }, [])

    const tiendaSeleccionada = tiendas.find(t => String(t.IdTienda) === idTienda)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError("")

        if (!idTienda) {
            setError("Selecciona la tienda a la que vas a conectarte")
            return
        }

        setLoading(true)
        try {
            const res = await fetch("/api/auth/login", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ codigobarras, password, idTienda: Number(idTienda) }),
            })

            const data = await res.json()

            if (!res.ok) {
                throw new Error(data.error || "Error al iniciar sesión")
            }

            window.location.href = "/dashboard"
        } catch (err: unknown) {
            if (err instanceof Error) {
                setError(err.message)
            } else {
                setError("Ocurrió un error desconocido")
            }
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="ksw-stage min-h-screen flex flex-col items-center justify-center px-4 py-10">
            {/* Auroras de fondo */}
            <div className="ksw-aurora w-[420px] h-[420px] -top-32 -left-24 bg-emerald-500/25" />
            <div className="ksw-aurora w-[380px] h-[380px] -bottom-28 -right-20 bg-cyan-500/20 [animation-delay:-7s]" />

            <div className="relative w-full max-w-md">
                {/* Marca */}
                <div className="flex flex-col items-center mb-8 text-center">
                    <div className="relative w-[4.5rem] h-[4.5rem] mb-5 rounded-2xl bg-white/[0.05] border border-white/10 backdrop-blur-xl flex items-center justify-center shadow-lg shadow-emerald-500/10">
                        <img
                            src="/logo.svg"
                            alt="KYK Server Web"
                            className="w-12 h-12 object-contain"
                        />
                        <span className="absolute -bottom-1.5 -right-1.5 flex h-4 w-4">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                            <span className="relative inline-flex rounded-full h-4 w-4 bg-emerald-500 border-2 border-[#060a12]" />
                        </span>
                    </div>
                    <h1 className="text-4xl font-black tracking-tighter uppercase">
                        KYK <span className="ksw-gradient-text">Server</span>
                    </h1>
                    <p className="mt-2 text-[11px] font-black text-slate-500 uppercase tracking-[0.35em]">
                        Reportes Operativos de Tienda
                    </p>
                </div>

                {/* Tarjeta de login */}
                <div className="relative bg-white/[0.045] backdrop-blur-2xl rounded-3xl border border-white/10 shadow-2xl shadow-black/60 overflow-hidden">
                    <div className="ksw-card-accent absolute top-0 inset-x-0 h-px" />

                    <div className="p-8">
                        <div className="mb-7">
                            <h2 className="text-xl font-black text-white leading-none">Conexión a tienda</h2>
                            <p className="text-[11px] font-bold text-slate-500 mt-2 uppercase tracking-widest">
                                Elige tu tienda e inicia sesión
                            </p>
                        </div>

                        <form className="space-y-5" onSubmit={handleSubmit}>
                            {/* Drilldown de tienda */}
                            <div className="space-y-1.5">
                                <label htmlFor="tienda" className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] pl-1">
                                    Tienda
                                </label>
                                <div className="relative group">
                                    <Store className="absolute top-1/2 -translate-y-1/2 left-4 h-5 w-5 text-slate-500 group-focus-within:text-emerald-400 transition-colors pointer-events-none" />
                                    <select
                                        id="tienda"
                                        name="tienda"
                                        required
                                        disabled={loadingTiendas || !!tiendasError}
                                        className="appearance-none block w-full pl-12 pr-11 py-4 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-bold text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-400/25 focus:border-emerald-400/60 transition-all disabled:opacity-60 disabled:cursor-wait [color-scheme:dark]"
                                        value={idTienda}
                                        onChange={(e) => setIdTienda(e.target.value)}
                                    >
                                        <option value="" className="bg-[#0b1220] text-slate-400">
                                            {loadingTiendas ? "CARGANDO TIENDAS..." : "SELECCIONA TU TIENDA"}
                                        </option>
                                        {tiendas.map((t) => (
                                            <option key={t.IdTienda} value={t.IdTienda} className="bg-[#0b1220] text-slate-100">
                                                {t.Tienda}
                                            </option>
                                        ))}
                                    </select>
                                    {loadingTiendas ? (
                                        <Loader2 className="absolute top-1/2 -translate-y-1/2 right-4 h-4 w-4 text-emerald-400 animate-spin pointer-events-none" />
                                    ) : (
                                        <ChevronDown className="absolute top-1/2 -translate-y-1/2 right-4 h-4 w-4 text-slate-500 pointer-events-none" />
                                    )}
                                </div>
                                {tiendasError && (
                                    <button
                                        type="button"
                                        onClick={loadTiendas}
                                        className="w-full flex items-center justify-center gap-2 text-[11px] font-black text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-xl p-2.5 uppercase tracking-wider hover:bg-amber-500/15 transition-colors"
                                    >
                                        <RefreshCw className="h-3.5 w-3.5" />
                                        {tiendasError} — Reintentar
                                    </button>
                                )}
                                {tiendaSeleccionada && (
                                    <p className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-400/80 uppercase tracking-wider pl-1">
                                        <Database className="h-3 w-3" />
                                        Los reportes se consultarán en {tiendaSeleccionada.Tienda}
                                    </p>
                                )}
                            </div>

                            {/* Usuario */}
                            <div className="space-y-1.5">
                                <label htmlFor="codigobarras" className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] pl-1">
                                    Usuario
                                </label>
                                <div className="relative group">
                                    <User className="absolute top-1/2 -translate-y-1/2 left-4 h-5 w-5 text-slate-500 group-focus-within:text-emerald-400 transition-colors" />
                                    <input
                                        id="codigobarras"
                                        name="codigobarras"
                                        type="text"
                                        required
                                        autoComplete="username"
                                        className="block w-full px-12 py-4 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-400/25 focus:border-emerald-400/60 transition-all"
                                        placeholder="USUARIO"
                                        value={codigobarras}
                                        onChange={(e) => setCodigobarras(e.target.value)}
                                    />
                                </div>
                            </div>

                            {/* Contraseña */}
                            <div className="space-y-1.5">
                                <label htmlFor="password" className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] pl-1">
                                    Contraseña
                                </label>
                                <div className="relative group">
                                    <Lock className="absolute top-1/2 -translate-y-1/2 left-4 h-5 w-5 text-slate-500 group-focus-within:text-emerald-400 transition-colors" />
                                    <input
                                        id="password"
                                        name="password"
                                        type={showPassword ? "text" : "password"}
                                        required
                                        autoComplete="current-password"
                                        className="block w-full pl-12 pr-12 py-4 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-400/25 focus:border-emerald-400/60 transition-all"
                                        placeholder="CONTRASEÑA"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                    />
                                    <button
                                        type="button"
                                        tabIndex={-1}
                                        onClick={() => setShowPassword(v => !v)}
                                        className="absolute top-1/2 -translate-y-1/2 right-4 text-slate-500 hover:text-emerald-400 transition-colors"
                                        aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                                    >
                                        {showPassword ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                                    </button>
                                </div>
                            </div>

                            {error && (
                                <div className="ksw-shake text-rose-300 text-[11px] font-black text-center bg-rose-500/10 p-3 rounded-xl border border-rose-500/25 uppercase tracking-wider">
                                    {error}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={loading || loadingTiendas}
                                className={cn(
                                    "group relative w-full flex items-center justify-between py-4 px-7 rounded-xl font-black overflow-hidden",
                                    "bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 text-slate-950",
                                    "shadow-xl shadow-emerald-500/20 hover:shadow-emerald-400/30 hover:brightness-110",
                                    "transition-all duration-300 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed",
                                    loading && "opacity-70"
                                )}
                            >
                                <span className="text-[13px] uppercase tracking-[0.2em] relative z-10 flex items-center gap-2">
                                    {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                                    {loading ? "Conectando a tienda..." : "Iniciar Sesión"}
                                </span>
                                <ArrowRight className="h-5 w-5 relative z-10 group-hover:translate-x-1 transition-transform" />
                                <div className="absolute top-0 -left-[100%] w-[50%] h-full bg-white/25 skew-x-[-30deg] group-hover:left-[120%] transition-all duration-700 ease-in-out" />
                            </button>
                        </form>
                    </div>

                    <div className="px-8 py-4 bg-black/25 border-t border-white/[0.06] text-center">
                        <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">
                            © {new Date().getFullYear()} KYK Server Web · Todos los derechos reservados
                        </p>
                    </div>
                </div>
            </div>
        </div>
    )
}
