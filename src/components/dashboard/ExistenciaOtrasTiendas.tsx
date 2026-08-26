"use client"

import { useEffect, useState } from "react"
import { Loader2, Store, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"
import { fmtMoney, fmtInt } from "@/lib/format"

interface ExistenciaTienda {
    idTienda: number
    tienda: string
    existencia: number | null
    diasCobertura: number | null
    medidaVenta: string
    precio: number | null
    /** Texto para el usuario cuando no hay cifra (sin conexión, no está en su catálogo...) */
    nota: string | null
    /** Motivo tipado por el endpoint; la UI decide por él, no por el texto */
    motivo: "sin-conexion" | "no-catalogo" | null
}

interface Respuesta {
    codigoInterno: number
    idTiendaSesion: number
    tiendas: ExistenciaTienda[]
    error?: string
}

const lbl = "text-[10px] font-black text-slate-500 uppercase tracking-widest"
const decFmt = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDec = (n: number) => decFmt.format(n || 0)

const COBERTURA_CRITICA_DIAS = 3
const COBERTURA_BAJA_DIAS = 7

const colorCobertura = (dias: number | null) =>
    dias === null ? "text-slate-500"
        : dias <= COBERTURA_CRITICA_DIAS ? "text-rose-300"
            : dias <= COBERTURA_BAJA_DIAS ? "text-amber-300" : "text-emerald-300"

// Si el servidor contesta HTML (404/500 de Next, proxy caído, dev server sin
// la ruta), `res.json()` truena con "Unexpected token '<'": mejor un mensaje
// que diga qué pasó.
async function leerRespuesta(res: Response): Promise<Respuesta> {
    const tipo = res.headers.get("content-type") ?? ""
    if (!tipo.includes("application/json")) {
        throw new Error(
            `El servidor respondió HTTP ${res.status} sin datos (ruta no disponible). ` +
            "Si acabas de actualizar la aplicación, reinicia el servidor."
        )
    }
    const json: Respuesta = await res.json()
    if (!res.ok) throw new Error(json.error || "Error al consultar las sucursales")
    return json
}

// Existencia del artículo en TODAS las sucursales. Cada tienda vive en su
// propio MySQL y el enlace puede ser lento (hasta 20 s por tienda), así que
// este panel carga aparte para no frenar la existencia de la tienda local.
// El padre lo monta con key={codigoInterno}: al cambiar de artículo se
// remonta con el estado inicial (cargando) y el efecto solo hace el fetch.
export function ExistenciaOtrasTiendas({ codigoInterno }: { codigoInterno: number }) {
    const [tiendas, setTiendas] = useState<ExistenciaTienda[]>([])
    const [idTiendaSesion, setIdTiendaSesion] = useState(0)
    const [cargando, setCargando] = useState(true)
    const [error, setError] = useState("")

    useEffect(() => {
        const controlador = new AbortController()
        fetch(`/api/inventarios/existencia/tiendas?codigoInterno=${codigoInterno}`, { signal: controlador.signal })
            .then(async res => {
                if (res.status === 401) { window.location.href = "/login"; return }
                const json = await leerRespuesta(res)
                setTiendas(json.tiendas)
                setIdTiendaSesion(json.idTiendaSesion)
            })
            .catch((err: unknown) => {
                if (controlador.signal.aborted) return
                setError(err instanceof Error ? err.message : "Error al consultar las sucursales")
            })
            .finally(() => {
                if (!controlador.signal.aborted) setCargando(false)
            })
        return () => controlador.abort()
    }, [codigoInterno])

    const conCifra = tiendas.filter(t => t.existencia !== null)
    const totalRed = conCifra.reduce((suma, t) => suma + (t.existencia ?? 0), 0)
    const tiendasConStock = conCifra.filter(t => (t.existencia ?? 0) > 0).length
    const sinRespuesta = tiendas.length - conCifra.length
    // Cada tienda tiene su propio catálogo: si el artículo está en PZA en una y
    // en KG en otra, sumar sería mezclar unidades — el total solo se muestra
    // cuando todas coinciden.
    const medidas = new Set(conCifra.map(t => t.medidaVenta))
    const medida = medidas.size === 1 ? (conCifra[0]?.medidaVenta ?? "") : null

    return (
        <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-5 backdrop-blur-xl">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <h3 className="flex items-center gap-2 text-[12px] font-black text-slate-300 uppercase tracking-widest">
                    <Store className="h-4 w-4 text-cyan-300" /> Existencia en todas las sucursales
                </h3>
                {!cargando && !error && conCifra.length > 0 && (
                    <p className="text-[11px] font-bold text-slate-400">
                        {medida !== null ? (
                            <>
                                Total en la red: <span className={cn("font-black", totalRed <= 0 ? "text-rose-300" : "text-emerald-300")}>
                                    {fmtDec(totalRed)} {medida}
                                </span>
                                {" · "}
                            </>
                        ) : (
                            <span className="text-amber-300/80" title="El artículo tiene distinta medida de venta según la tienda; no se suma">
                                Unidades distintas entre tiendas ·{" "}
                            </span>
                        )}
                        {fmtInt(tiendasConStock)} de {fmtInt(conCifra.length)} sucursales con stock
                        {sinRespuesta > 0 && <span className="text-amber-300/80"> · {fmtInt(sinRespuesta)} sin dato</span>}
                    </p>
                )}
            </div>

            {cargando ? (
                <div className="flex items-center justify-center gap-3 py-10">
                    <Loader2 className="h-5 w-5 text-emerald-400 animate-spin" />
                    <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">
                        Consultando las sucursales... puede tardar unos segundos
                    </p>
                </div>
            ) : error ? (
                <div className="flex items-center gap-2 text-rose-300 text-[11px] font-black bg-rose-500/10 p-3 rounded-xl border border-rose-500/25 uppercase tracking-wider">
                    <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
                </div>
            ) : tiendas.length === 0 ? (
                <p className="text-[11px] font-bold text-slate-600 uppercase tracking-widest text-center py-8">
                    Sin sucursales configuradas
                </p>
            ) : (
                <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
                    <table className="w-full">
                        <thead className="bg-[#10151f] shadow-[0_1px_0_rgba(255,255,255,0.08)]">
                            <tr>
                                <th className={cn(lbl, "px-4 py-2.5 text-left")}>Sucursal</th>
                                <th className={cn(lbl, "px-4 py-2.5 text-right")}>Existencia</th>
                                <th className={cn(lbl, "px-4 py-2.5 text-right")}>Cobertura</th>
                                <th className={cn(lbl, "px-4 py-2.5 text-right")}>Precio</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.04]">
                            {tiendas.map(t => (
                                <FilaTienda key={t.idTienda} tienda={t} esLaMia={t.idTienda === idTiendaSesion} />
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    )
}

function FilaTienda({ tienda: t, esLaMia }: { tienda: ExistenciaTienda; esLaMia: boolean }) {
    return (
        <tr className={cn(esLaMia ? "bg-emerald-500/[0.06]" : "hover:bg-white/[0.03]")}>
            <td className="px-4 py-2.5 whitespace-nowrap">
                <span className={cn("text-[13px] font-bold", esLaMia ? "text-emerald-200" : "text-slate-100")}>
                    {t.tienda}
                </span>
                {esLaMia && (
                    <span className="ml-2 text-[9px] font-black text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 rounded-md px-1.5 py-0.5 uppercase tracking-wider">
                        Tu tienda
                    </span>
                )}
            </td>
            {t.existencia === null ? (
                <td colSpan={3} className="px-4 py-2.5 text-right">
                    <span className={cn(
                        "text-[11px] font-bold",
                        t.motivo === "sin-conexion" ? "text-amber-300/80" : "text-slate-500"
                    )}>
                        {t.nota ?? "Sin dato"}
                    </span>
                </td>
            ) : (
                <>
                    <td className={cn(
                        "px-4 py-2.5 text-right text-[14px] font-black whitespace-nowrap",
                        t.existencia <= 0 ? "text-rose-300" : "text-emerald-300"
                    )}>
                        {fmtDec(t.existencia)}
                        <span className="text-[10px] font-bold text-slate-500 ml-1">{t.medidaVenta}</span>
                    </td>
                    <td className={cn("px-4 py-2.5 text-right text-[12px] font-black whitespace-nowrap", colorCobertura(t.diasCobertura))}>
                        {t.diasCobertura === null ? "Sin venta" : `~${fmtDec(t.diasCobertura)} días`}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[12px] font-black text-slate-300 whitespace-nowrap">
                        {t.precio === null ? "—" : fmtMoney(t.precio)}
                    </td>
                </>
            )}
        </tr>
    )
}
