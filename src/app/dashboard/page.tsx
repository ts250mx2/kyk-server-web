"use client"

import { useCallback, useEffect, useState } from "react"
import { RefreshCw, Loader2, AlertTriangle, Clock } from "lucide-react"
import { cn } from "@/lib/utils"
import { fmtMoney, fmtInt, fmtHora, fmtFechaLarga } from "@/lib/format"

const REFRESH_INTERVAL_MS = 60_000

interface VentaHora { hora: number; tickets: number; total: number }
interface ReciboDia { folio: string; numero: string; fecha: string; total: number; proveedor: string }
interface TransferenciaEntrada { folio: string; fecha: string; descripcion: string | null; origen: string | null; total: number }
interface TransferenciaSalida { folio: string; fecha: string; descripcion: string | null; destino: string | null; total: number }
interface FacturaDia {
    factura: number; serie: string; fecha: string; cliente: string; rfc: string;
    total: number; metodoPago: string; esGlobal: boolean; status: number
}

interface PrincipalData {
    tienda: { idTienda: number; nombre: string }
    ahora: string | null
    fechaNegocio: string
    esDiaAnterior: boolean
    ventas: { total: number; tickets: number; ticketPromedio: number; porHora: VentaHora[] }
    recibos: { recibos: number; total: number; devoluciones: number; detalle: ReciboDia[] }
    transferencias: {
        entradas: number; salidas: number;
        detalleEntradas: TransferenciaEntrada[]; detalleSalidas: TransferenciaSalida[]
    }
    facturas: { facturas: number; total: number; iva: number; detalle: FacturaDia[] }
}

function KpiCard({ emoji, title, value, subs, accent }: {
    emoji: string
    title: string
    value: string
    subs: string[]
    accent: "emerald" | "cyan" | "violet" | "amber"
}) {
    const accents = {
        emerald: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
        cyan: "border-cyan-500/25 bg-cyan-500/10 text-cyan-300",
        violet: "border-violet-500/25 bg-violet-500/10 text-violet-300",
        amber: "border-amber-500/25 bg-amber-500/10 text-amber-300",
    }
    return (
        <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-5 backdrop-blur-xl">
            <div className="flex items-center gap-3 mb-4">
                <div className={cn("w-10 h-10 rounded-xl border flex items-center justify-center text-xl", accents[accent])}>
                    {emoji}
                </div>
                <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest leading-tight">{title}</p>
            </div>
            <p className="text-2xl xl:text-3xl font-black text-white tracking-tight">{value}</p>
            <div className="mt-2 space-y-0.5">
                {subs.map((s, i) => (
                    <p key={i} className="text-[11px] font-bold text-slate-500">{s}</p>
                ))}
            </div>
        </div>
    )
}

function TableCard({ title, emoji, count, children, empty }: {
    title: string
    emoji: string
    count: number
    children: React.ReactNode
    empty: string
}) {
    return (
        <div className="bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
                <h3 className="flex items-center gap-2 text-[12px] font-black text-slate-300 uppercase tracking-widest">
                    <span className="text-base">{emoji}</span> {title}
                </h3>
                <span className="text-[11px] font-black text-slate-500 bg-white/[0.05] border border-white/10 rounded-lg px-2 py-1">
                    {fmtInt(count)}
                </span>
            </div>
            {count === 0 ? (
                <p className="py-10 text-center text-[12px] font-bold text-slate-600 uppercase tracking-widest">{empty}</p>
            ) : (
                <div className="overflow-x-auto">
                    {children}
                </div>
            )}
        </div>
    )
}

const th = "px-4 py-2.5 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest whitespace-nowrap"
const td = "px-4 py-2.5 text-[13px] font-bold text-slate-200 whitespace-nowrap"
const tdMuted = "px-4 py-2.5 text-[12px] font-bold text-slate-400 whitespace-nowrap"

export default function PrincipalPage() {
    const [data, setData] = useState<PrincipalData | null>(null)
    const [error, setError] = useState("")
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [updatedAt, setUpdatedAt] = useState<Date | null>(null)

    const load = useCallback(async (silent = false) => {
        if (silent) setRefreshing(true)
        else setLoading(true)
        try {
            const res = await fetch("/api/dashboard/principal")
            if (res.status === 401) {
                window.location.href = "/login"
                return
            }
            const json = await res.json()
            if (!res.ok) {
                throw new Error(json.error || "Error al consultar la tienda")
            }
            setData(json)
            setError("")
            setUpdatedAt(new Date())
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Error desconocido")
        } finally {
            setLoading(false)
            setRefreshing(false)
        }
    }, [])

    useEffect(() => {
        load()
        const interval = setInterval(() => load(true), REFRESH_INTERVAL_MS)
        return () => clearInterval(interval)
    }, [load])

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-32 gap-4">
                <Loader2 className="h-8 w-8 text-emerald-400 animate-spin" />
                <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest">
                    Consultando servidor de la tienda...
                </p>
            </div>
        )
    }

    if (error && !data) {
        return (
            <div className="flex flex-col items-center justify-center py-32 gap-4 text-center">
                <div className="w-14 h-14 rounded-2xl bg-rose-500/10 border border-rose-500/25 flex items-center justify-center">
                    <AlertTriangle className="h-6 w-6 text-rose-400" />
                </div>
                <p className="text-sm font-bold text-rose-300 max-w-md">{error}</p>
                <button
                    onClick={() => load()}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 text-slate-950 font-black text-[12px] uppercase tracking-widest hover:brightness-110 transition-all"
                >
                    <RefreshCw className="h-4 w-4" /> Reintentar
                </button>
            </div>
        )
    }

    if (!data) return null

    const maxHora = Math.max(...data.ventas.porHora.map(h => h.total), 1)

    return (
        <div className="space-y-6">
            {/* Encabezado */}
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-black text-white uppercase tracking-tight">Principal</h1>
                    <p className="text-[12px] font-bold text-slate-500 mt-1">
                        {fmtFechaLarga(data.fechaNegocio)} · Movimientos del día en <span className="text-emerald-400">{data.tienda.nombre}</span>
                    </p>
                    {data.esDiaAnterior && (
                        <span className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-300 text-[10px] font-black uppercase tracking-widest">
                            🌙 Mostrando el día anterior (antes de las 4:00 AM)
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    {updatedAt && (
                        <span className="flex items-center gap-1.5 text-[10px] font-black text-slate-600 uppercase tracking-widest">
                            <Clock className="h-3 w-3" /> Actualizado {updatedAt.toLocaleTimeString("es-MX")}
                        </span>
                    )}
                    <button
                        onClick={() => load(true)}
                        disabled={refreshing}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 hover:text-emerald-300 hover:border-emerald-500/30 font-black text-[11px] uppercase tracking-widest transition-all disabled:opacity-60"
                    >
                        <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
                        Actualizar
                    </button>
                </div>
            </div>

            {error && (
                <div className="text-rose-300 text-[11px] font-black bg-rose-500/10 p-3 rounded-xl border border-rose-500/25 uppercase tracking-wider">
                    {error} — mostrando última información disponible
                </div>
            )}

            {/* KPIs del día */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <KpiCard
                    emoji="💰"
                    title="Ventas del día"
                    value={fmtMoney(data.ventas.total)}
                    subs={[
                        `${fmtInt(data.ventas.tickets)} tickets`,
                        `Ticket promedio: ${fmtMoney(data.ventas.ticketPromedio)}`,
                    ]}
                    accent="emerald"
                />
                <KpiCard
                    emoji="🧾"
                    title="Recibos del día"
                    value={fmtMoney(data.recibos.total)}
                    subs={[
                        `${fmtInt(data.recibos.recibos)} recibos de mercancía`,
                        data.recibos.devoluciones > 0
                            ? `Devoluciones: ${fmtMoney(data.recibos.devoluciones)}`
                            : "Sin devoluciones",
                    ]}
                    accent="cyan"
                />
                <KpiCard
                    emoji="🔄"
                    title="Transferencias del día"
                    value={fmtInt(data.transferencias.entradas + data.transferencias.salidas)}
                    subs={[
                        `${fmtInt(data.transferencias.entradas)} entradas`,
                        `${fmtInt(data.transferencias.salidas)} salidas`,
                    ]}
                    accent="violet"
                />
                <KpiCard
                    emoji="📄"
                    title="Facturación del día"
                    value={fmtMoney(data.facturas.total)}
                    subs={[
                        `${fmtInt(data.facturas.facturas)} facturas emitidas`,
                        `IVA: ${fmtMoney(data.facturas.iva)}`,
                    ]}
                    accent="amber"
                />
            </div>

            {/* Ventas por hora */}
            {data.ventas.porHora.length > 0 && (
                <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-5 backdrop-blur-xl">
                    <h3 className="text-[12px] font-black text-slate-300 uppercase tracking-widest mb-4">
                        ⏰ Ventas por hora
                    </h3>
                    <div className="flex items-end gap-1.5 h-28">
                        {data.ventas.porHora.map(h => (
                            <div
                                key={h.hora}
                                className="flex-1 flex flex-col items-center gap-1 min-w-0"
                                title={`${h.hora}:00 hrs — ${fmtMoney(h.total)} (${fmtInt(h.tickets)} tickets)`}
                            >
                                <div className="w-full flex items-end h-20">
                                    <div
                                        className="w-full rounded-t-md bg-gradient-to-t from-emerald-600 to-cyan-400 hover:brightness-125 transition-all"
                                        style={{ height: `${Math.max((h.total / maxHora) * 100, 4)}%` }}
                                    />
                                </div>
                                <span className="text-[9px] font-black text-slate-500">{h.hora}h</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Detalle en tablas */}
            <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4">
                <TableCard
                    title="Recibos del día"
                    emoji="🧾"
                    count={data.recibos.detalle.length}
                    empty="Sin recibos registrados hoy"
                >
                    <table className="w-full">
                        <thead className="bg-white/[0.02]">
                            <tr>
                                <th className={th}>Folio</th>
                                <th className={th}>Proveedor</th>
                                <th className={th}>Factura/Remisión</th>
                                <th className={th}>Hora</th>
                                <th className={cn(th, "text-right")}>Total</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.04]">
                            {data.recibos.detalle.map((r, i) => (
                                <tr key={i} className="hover:bg-white/[0.03] transition-colors">
                                    <td className={tdMuted}>{r.folio}</td>
                                    <td className={td}>{r.proveedor}</td>
                                    <td className={tdMuted}>{r.numero}</td>
                                    <td className={tdMuted}>{fmtHora(r.fecha)}</td>
                                    <td className={cn(td, "text-right text-cyan-300")}>{fmtMoney(r.total)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </TableCard>

                <TableCard
                    title="Transferencias del día"
                    emoji="🔄"
                    count={data.transferencias.detalleEntradas.length + data.transferencias.detalleSalidas.length}
                    empty="Sin transferencias registradas hoy"
                >
                    <table className="w-full">
                        <thead className="bg-white/[0.02]">
                            <tr>
                                <th className={th}>Tipo</th>
                                <th className={th}>Folio</th>
                                <th className={th}>Tienda</th>
                                <th className={th}>Descripción</th>
                                <th className={th}>Hora</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.04]">
                            {data.transferencias.detalleEntradas.map((t, i) => (
                                <tr key={`e${i}`} className="hover:bg-white/[0.03] transition-colors">
                                    <td className={td}>
                                        <span className="text-[10px] font-black text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 rounded-md px-2 py-0.5 uppercase">Entrada</span>
                                    </td>
                                    <td className={tdMuted}>{t.folio}</td>
                                    <td className={td}>{t.origen ?? "—"}</td>
                                    <td className={cn(tdMuted, "max-w-[280px] truncate")} title={t.descripcion ?? ""}>{t.descripcion ?? "—"}</td>
                                    <td className={tdMuted}>{fmtHora(t.fecha)}</td>
                                </tr>
                            ))}
                            {data.transferencias.detalleSalidas.map((t, i) => (
                                <tr key={`s${i}`} className="hover:bg-white/[0.03] transition-colors">
                                    <td className={td}>
                                        <span className="text-[10px] font-black text-violet-300 bg-violet-500/10 border border-violet-500/25 rounded-md px-2 py-0.5 uppercase">Salida</span>
                                    </td>
                                    <td className={tdMuted}>{t.folio}</td>
                                    <td className={td}>{t.destino ?? "—"}</td>
                                    <td className={cn(tdMuted, "max-w-[280px] truncate")} title={t.descripcion ?? ""}>{t.descripcion ?? "—"}</td>
                                    <td className={tdMuted}>{fmtHora(t.fecha)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </TableCard>
            </div>

            <TableCard
                title="Facturación del día"
                emoji="📄"
                count={data.facturas.detalle.length}
                empty="Sin facturas emitidas hoy"
            >
                <table className="w-full">
                    <thead className="bg-white/[0.02]">
                        <tr>
                            <th className={th}>Factura</th>
                            <th className={th}>Cliente / Concepto</th>
                            <th className={th}>RFC</th>
                            <th className={th}>Forma de pago</th>
                            <th className={th}>Tipo</th>
                            <th className={th}>Hora</th>
                            <th className={cn(th, "text-right")}>Total</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.04]">
                        {data.facturas.detalle.map((f, i) => (
                            <tr key={i} className="hover:bg-white/[0.03] transition-colors">
                                <td className={td}>{f.serie ? `${f.serie}-` : ""}{f.factura}</td>
                                <td className={cn(td, "max-w-[260px] truncate")} title={f.cliente}>{f.cliente}</td>
                                <td className={tdMuted}>{f.rfc || "—"}</td>
                                <td className={tdMuted}>{f.metodoPago || "—"}</td>
                                <td className={td}>
                                    {f.esGlobal ? (
                                        <span className="text-[10px] font-black text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-md px-2 py-0.5 uppercase">Global</span>
                                    ) : (
                                        <span className="text-[10px] font-black text-slate-400 bg-white/[0.05] border border-white/10 rounded-md px-2 py-0.5 uppercase">Cliente</span>
                                    )}
                                </td>
                                <td className={tdMuted}>{fmtHora(f.fecha)}</td>
                                <td className={cn(td, "text-right text-amber-300")}>{fmtMoney(f.total)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </TableCard>
        </div>
    )
}
