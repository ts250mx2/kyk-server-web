"use client"

import { useCallback, useEffect, useState } from "react"
import {
    Loader2, AlertTriangle, Megaphone, X, Plus, CheckCircle2,
    ClipboardCheck, Trash2, RefreshCw, Paperclip
} from "lucide-react"
import { cn } from "@/lib/utils"
import { fmtInt, fmtFechaHora, fmtTamano } from "@/lib/format"
import { jsonSeguro } from "@/lib/http"
import { DropZone } from "@/components/dashboard/DropZone"

interface Adjunto { idAdjunto: number; nombre: string; tamano: number }

interface Comunicado {
    idComunicado: number
    titulo: string
    cuerpo: string
    urgente: boolean
    todasTiendas: boolean
    vigenteHasta: string | null
    publicadoPor: string
    fecha: string
    acusado: boolean
    fechaAcuse: string | null
    adjuntos: Adjunto[]
}

interface TiendaOption { IdTienda: number; Tienda: string }

interface AcuseTienda {
    idTienda: number
    tienda: string
    acuses: { nombre: string; fecha: string }[]
}

const lbl = "text-[10px] font-black text-slate-500 uppercase tracking-widest"
const inputCls = "block w-full px-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-400/25 focus:border-emerald-400/60 transition-all"

export default function ComunicadosPage() {
    const [comunicados, setComunicados] = useState<Comunicado[]>([])
    const [rol, setRol] = useState<"oficina" | "tienda">("tienda")
    const [historial, setHistorial] = useState(false)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState("")

    // Modal nuevo comunicado (oficina)
    const [nuevoAbierto, setNuevoAbierto] = useState(false)
    const [titulo, setTitulo] = useState("")
    const [cuerpo, setCuerpo] = useState("")
    const [urgente, setUrgente] = useState(false)
    const [vigenteHasta, setVigenteHasta] = useState("")
    const [todasTiendas, setTodasTiendas] = useState(true)
    const [tiendas, setTiendas] = useState<TiendaOption[]>([])
    const [tiendasSel, setTiendasSel] = useState<Set<number>>(new Set())
    const [archivos, setArchivos] = useState<File[]>([])
    const [publicando, setPublicando] = useState(false)

    // Modal de acuses (oficina)
    const [acusesDe, setAcusesDe] = useState<{ titulo: string; tiendas: AcuseTienda[] } | null>(null)
    const [loadingAcuses, setLoadingAcuses] = useState(false)

    const cargar = useCallback(async (verHistorial: boolean) => {
        setLoading(true)
        setError("")
        try {
            const res = await fetch(`/api/comunicados${verHistorial ? "?historial=1" : ""}`)
            if (res.status === 401) { window.location.href = "/login"; return }
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "Error al consultar comunicados")
            setComunicados(json.comunicados)
            setRol(json.rol)
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Error desconocido")
            setComunicados([])
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        cargar(false)
    }, [cargar])

    const cambiarHistorial = (v: boolean) => {
        setHistorial(v)
        cargar(v)
    }

    const acusar = async (id: number) => {
        try {
            const res = await fetch(`/api/comunicados/${id}/acuse`, { method: "POST" })
            if (res.ok) {
                setComunicados(prev => prev.map(c =>
                    c.idComunicado === id ? { ...c, acusado: true, fechaAcuse: new Date().toISOString() } : c
                ))
            }
        } catch {
            setError("No fue posible registrar el acuse")
        }
    }

    const abrirNuevo = async () => {
        setNuevoAbierto(true)
        if (tiendas.length === 0) {
            try {
                const res = await fetch("/api/auth/tiendas")
                const json = await res.json()
                if (res.ok) setTiendas(json.tiendas)
            } catch { /* el multiselect queda vacío */ }
        }
    }

    const publicar = async () => {
        if (!titulo.trim() || !cuerpo.trim()) {
            setError("Título y contenido son requeridos")
            return
        }
        setPublicando(true)
        setError("")
        try {
            const form = new FormData()
            form.set("titulo", titulo.trim())
            form.set("cuerpo", cuerpo.trim())
            form.set("urgente", urgente ? "1" : "")
            form.set("vigenteHasta", vigenteHasta || "")
            form.set("tiendas", JSON.stringify(todasTiendas ? [] : [...tiendasSel]))
            for (const a of archivos) form.append("adjuntos", a)

            const res = await fetch("/api/comunicados", { method: "POST", body: form })
            const json = await jsonSeguro(res)
            if (!res.ok) throw new Error(String(json.error || "Error al publicar"))
            setNuevoAbierto(false)
            setTitulo(""); setCuerpo(""); setUrgente(false); setVigenteHasta("")
            setTodasTiendas(true); setTiendasSel(new Set()); setArchivos([])
            cargar(historial)
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Error al publicar")
        } finally {
            setPublicando(false)
        }
    }

    const verAcuses = async (c: Comunicado) => {
        setLoadingAcuses(true)
        setAcusesDe(null)
        try {
            const res = await fetch(`/api/comunicados/${c.idComunicado}/acuses`)
            const json = await res.json()
            if (res.ok) setAcusesDe(json)
            else setError(json.error || "Error al consultar acuses")
        } catch {
            setError("Error al consultar acuses")
        } finally {
            setLoadingAcuses(false)
        }
    }

    const retirar = async (c: Comunicado) => {
        if (!window.confirm(`¿Retirar el comunicado "${c.titulo}"?`)) return
        try {
            const res = await fetch(`/api/comunicados/${c.idComunicado}`, { method: "DELETE" })
            if (res.ok) cargar(historial)
        } catch {
            setError("No fue posible retirar el comunicado")
        }
    }

    const alternarTienda = (id: number) => {
        setTiendasSel(prev => {
            const s = new Set(prev)
            if (s.has(id)) s.delete(id)
            else s.add(id)
            return s
        })
    }

    const noLeidos = comunicados.filter(c => !c.acusado).length

    return (
        <div className="space-y-4 max-w-4xl mx-auto">
            {/* Encabezado */}
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-black text-white uppercase tracking-tight">Comunicados</h1>
                    <p className="text-[12px] font-bold text-slate-500 mt-1">
                        {loading ? "Consultando..." : noLeidos > 0
                            ? `${fmtInt(noLeidos)} pendientes de confirmar`
                            : "Estás al corriente"}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/10 cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={historial}
                            onChange={e => cambiarHistorial(e.target.checked)}
                            className="accent-emerald-500 h-4 w-4"
                        />
                        <span className="text-[11px] font-black text-slate-300 uppercase tracking-widest">Incluir vencidos</span>
                    </label>
                    <button
                        onClick={() => cargar(historial)}
                        className="p-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 hover:text-emerald-300 hover:border-emerald-500/30 transition-all"
                        title="Actualizar"
                    >
                        <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                    </button>
                    {rol === "oficina" && (
                        <button
                            onClick={abrirNuevo}
                            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500 text-slate-950 font-black text-[11px] uppercase tracking-widest hover:brightness-110 transition-all"
                        >
                            <Plus className="h-4 w-4" /> Nuevo Comunicado
                        </button>
                    )}
                </div>
            </div>

            {error && (
                <div className="flex items-center gap-2 text-rose-300 text-[11px] font-black bg-rose-500/10 p-3 rounded-xl border border-rose-500/25 uppercase tracking-wider">
                    <AlertTriangle className="h-4 w-4" /> {error}
                </div>
            )}

            {/* Lista de comunicados */}
            {loading ? (
                <div className="flex items-center justify-center py-32">
                    <Loader2 className="h-8 w-8 text-emerald-400 animate-spin" />
                </div>
            ) : comunicados.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-32 gap-3 bg-white/[0.04] border border-white/10 rounded-2xl">
                    <Megaphone className="h-8 w-8 text-slate-700" />
                    <p className="text-[12px] font-bold text-slate-600 uppercase tracking-widest">
                        Sin comunicados por ahora
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {comunicados.map(c => (
                        <div
                            key={c.idComunicado}
                            className={cn(
                                "bg-white/[0.04] border rounded-2xl p-5 backdrop-blur-xl transition-all",
                                c.urgente ? "border-rose-500/40" : "border-white/10",
                                !c.acusado && "ring-1 ring-emerald-400/20"
                            )}
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <h3 className="text-[15px] font-black text-white flex items-center gap-2 flex-wrap">
                                        {c.titulo}
                                        {c.urgente && (
                                            <span className="text-[9px] font-black text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-md px-1.5 py-0.5 uppercase animate-pulse">
                                                Urgente
                                            </span>
                                        )}
                                        {!c.acusado && (
                                            <span className="text-[9px] font-black text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 rounded-md px-1.5 py-0.5 uppercase">
                                                Nuevo
                                            </span>
                                        )}
                                    </h3>
                                    <p className="text-[11px] font-bold text-slate-500 mt-1">
                                        {c.publicadoPor} · {fmtFechaHora(c.fecha)}
                                        {c.vigenteHasta ? ` · Vigente hasta ${fmtFechaHora(c.vigenteHasta)}` : ""}
                                        {!c.todasTiendas ? " · Dirigido a tiendas específicas" : ""}
                                    </p>
                                </div>
                                {rol === "oficina" && (
                                    <div className="flex items-center gap-1.5 shrink-0">
                                        <button
                                            onClick={() => verAcuses(c)}
                                            className="p-2 rounded-lg bg-white/[0.05] border border-white/10 text-slate-400 hover:text-cyan-300 hover:border-cyan-500/30 transition-all"
                                            title="Ver acuses por tienda"
                                        >
                                            <ClipboardCheck className="h-4 w-4" />
                                        </button>
                                        <button
                                            onClick={() => retirar(c)}
                                            className="p-2 rounded-lg bg-white/[0.05] border border-white/10 text-slate-400 hover:text-rose-300 hover:border-rose-500/30 transition-all"
                                            title="Retirar comunicado"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                )}
                            </div>

                            <p className="mt-3 text-[13px] font-medium text-slate-200 whitespace-pre-wrap leading-relaxed">
                                {c.cuerpo}
                            </p>

                            {c.adjuntos.length > 0 && (
                                <div className="mt-3 flex flex-wrap gap-2">
                                    {c.adjuntos.map(a => (
                                        <a
                                            key={a.idAdjunto}
                                            href={`/api/comunicados/adjuntos/${a.idAdjunto}`}
                                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-500/10 border border-cyan-500/25 text-cyan-300 text-[11px] font-black hover:bg-cyan-500/20 transition-all"
                                            title={`Descargar ${a.nombre}`}
                                        >
                                            <Paperclip className="h-3.5 w-3.5" />
                                            <span className="max-w-[220px] truncate">{a.nombre}</span>
                                            <span className="text-cyan-500/70">({fmtTamano(a.tamano)})</span>
                                        </a>
                                    ))}
                                </div>
                            )}

                            <div className="mt-4">
                                {c.acusado ? (
                                    <span className="inline-flex items-center gap-1.5 text-[11px] font-black text-emerald-400 uppercase tracking-widest">
                                        <CheckCircle2 className="h-4 w-4" />
                                        Enterado {c.fechaAcuse ? `· ${fmtFechaHora(c.fechaAcuse)}` : ""}
                                    </span>
                                ) : (
                                    <button
                                        onClick={() => acusar(c.idComunicado)}
                                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 text-slate-950 font-black text-[11px] uppercase tracking-widest hover:brightness-110 transition-all"
                                    >
                                        <CheckCircle2 className="h-4 w-4" /> Confirmar de enterado
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Modal nuevo comunicado */}
            {nuevoAbierto && (
                <div
                    className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
                    onClick={() => setNuevoAbierto(false)}
                >
                    <div
                        className="w-full max-w-2xl max-h-[90vh] bg-[#0d1320] border border-white/10 rounded-2xl shadow-2xl shadow-black/60 overflow-auto"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
                            <h3 className="text-[15px] font-black text-white">Nuevo Comunicado</h3>
                            <button
                                onClick={() => setNuevoAbierto(false)}
                                className="p-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-400 hover:text-white transition-all"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className={cn(lbl, "block mb-1.5 pl-1")}>Título</label>
                                <input
                                    type="text"
                                    className={inputCls}
                                    value={titulo}
                                    onChange={e => setTitulo(e.target.value)}
                                    maxLength={200}
                                    placeholder="Título del comunicado"
                                />
                            </div>
                            <div>
                                <label className={cn(lbl, "block mb-1.5 pl-1")}>Contenido</label>
                                <textarea
                                    className={cn(inputCls, "min-h-[160px] resize-y")}
                                    value={cuerpo}
                                    onChange={e => setCuerpo(e.target.value)}
                                    placeholder="Escribe el comunicado..."
                                />
                            </div>
                            <div>
                                <label className={cn(lbl, "block mb-1.5 pl-1")}>Archivos adjuntos (opcional, máx. 10 × 25 MB)</label>
                                <DropZone
                                    multiple
                                    onFiles={fs => setArchivos(prev => [...prev, ...fs].slice(0, 10))}
                                    mensaje="Arrastra los archivos aquí o haz clic para seleccionar"
                                />
                                {archivos.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        {archivos.map((a, i) => (
                                            <span
                                                key={`${a.name}-${i}`}
                                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 text-[11px] font-bold"
                                            >
                                                <Paperclip className="h-3.5 w-3.5 text-cyan-400" />
                                                <span className="max-w-[200px] truncate">{a.name}</span>
                                                <span className="text-slate-500">({fmtTamano(a.size)})</span>
                                                <button
                                                    onClick={() => setArchivos(prev => prev.filter((_, j) => j !== i))}
                                                    className="text-slate-500 hover:text-rose-300 transition-colors"
                                                >
                                                    <X className="h-3.5 w-3.5" />
                                                </button>
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div className="flex flex-wrap gap-3 items-center">
                                <label className="flex items-center gap-2 px-3 py-2 rounded-xl bg-rose-500/[0.06] border border-rose-500/20 cursor-pointer select-none">
                                    <input
                                        type="checkbox"
                                        checked={urgente}
                                        onChange={e => setUrgente(e.target.checked)}
                                        className="accent-rose-500 h-4 w-4"
                                    />
                                    <span className="text-[11px] font-black text-rose-300 uppercase tracking-widest">Urgente</span>
                                </label>
                                <div className="flex items-center gap-2">
                                    <span className={lbl}>Vigente hasta:</span>
                                    <input
                                        type="date"
                                        className={cn(inputCls, "[color-scheme:dark] w-40 py-2")}
                                        value={vigenteHasta}
                                        onChange={e => setVigenteHasta(e.target.value)}
                                    />
                                    <span className="text-[10px] font-bold text-slate-600">(opcional)</span>
                                </div>
                            </div>
                            <div>
                                <label className="flex items-center gap-2 cursor-pointer select-none mb-2">
                                    <input
                                        type="checkbox"
                                        checked={todasTiendas}
                                        onChange={e => setTodasTiendas(e.target.checked)}
                                        className="accent-emerald-500 h-4 w-4"
                                    />
                                    <span className="text-[11px] font-black text-slate-300 uppercase tracking-widest">Todas las tiendas</span>
                                </label>
                                {!todasTiendas && (
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 p-3 rounded-xl bg-white/[0.03] border border-white/10 max-h-48 overflow-auto">
                                        {tiendas.map(t => (
                                            <label key={t.IdTienda} className="flex items-center gap-2 cursor-pointer select-none py-0.5">
                                                <input
                                                    type="checkbox"
                                                    checked={tiendasSel.has(t.IdTienda)}
                                                    onChange={() => alternarTienda(t.IdTienda)}
                                                    className="accent-emerald-500 h-3.5 w-3.5"
                                                />
                                                <span className="text-[11px] font-bold text-slate-300 truncate">{t.Tienda}</span>
                                            </label>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="px-6 py-4 border-t border-white/10 flex justify-end gap-2">
                            <button
                                onClick={() => setNuevoAbierto(false)}
                                className="px-4 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 font-black text-[11px] uppercase tracking-widest hover:text-white transition-all"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={publicar}
                                disabled={publicando || !titulo.trim() || !cuerpo.trim() || (!todasTiendas && tiendasSel.size === 0)}
                                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 text-slate-950 font-black text-[11px] uppercase tracking-widest hover:brightness-110 transition-all disabled:opacity-50"
                            >
                                {publicando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
                                Publicar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal de acuses (oficina) */}
            {(acusesDe || loadingAcuses) && (
                <div
                    className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
                    onClick={() => { setAcusesDe(null); setLoadingAcuses(false) }}
                >
                    <div
                        className="w-full max-w-2xl max-h-[85vh] bg-[#0d1320] border border-white/10 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden flex flex-col"
                        onClick={e => e.stopPropagation()}
                    >
                        {loadingAcuses ? (
                            <div className="flex items-center justify-center py-24">
                                <Loader2 className="h-7 w-7 text-emerald-400 animate-spin" />
                            </div>
                        ) : acusesDe && (
                            <>
                                <div className="px-6 py-4 border-b border-white/10 flex items-start justify-between gap-3">
                                    <div>
                                        <h3 className="text-[15px] font-black text-white">Acuses de recibo</h3>
                                        <p className="text-[12px] font-bold text-slate-400 mt-1">{acusesDe.titulo}</p>
                                        <p className="text-[11px] font-bold text-slate-500 mt-0.5">
                                            {fmtInt(acusesDe.tiendas.filter(t => t.acuses.length > 0).length)} de {fmtInt(acusesDe.tiendas.length)} tiendas enteradas
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => setAcusesDe(null)}
                                        className="p-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-400 hover:text-white transition-all"
                                    >
                                        <X className="h-4 w-4" />
                                    </button>
                                </div>
                                <div className="overflow-auto flex-1 divide-y divide-white/[0.04]">
                                    {acusesDe.tiendas.map(t => (
                                        <div key={t.idTienda} className="px-6 py-3 flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="text-[13px] font-black text-slate-200">{t.tienda}</p>
                                                {t.acuses.length > 0 && (
                                                    <p className="text-[11px] font-bold text-slate-500 mt-0.5">
                                                        {t.acuses.map(a => `${a.nombre} (${fmtFechaHora(a.fecha)})`).join(" · ")}
                                                    </p>
                                                )}
                                            </div>
                                            <span className={cn(
                                                "shrink-0 text-[10px] font-black rounded-md px-2 py-0.5 border uppercase",
                                                t.acuses.length > 0
                                                    ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/25"
                                                    : "text-amber-300 bg-amber-500/10 border-amber-500/25"
                                            )}>
                                                {t.acuses.length > 0 ? "Enterada" : "Pendiente"}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
