"use client"

import { cn } from "@/lib/utils"
import { fmtInt } from "@/lib/format"
import { ESCALA, ESCALA_10, ETIQUETA_NO, ETIQUETA_SI, claseNps, type ClaseNps, type ResumenNps, type TipoPregunta } from "@/lib/encuestas-tipos"

// Reporte de la encuesta de clientes: NPS y promedio generales, cada pregunta
// según su tipo (NPS, escalas, opciones, sí/no, respuestas abiertas y
// seguimientos), resumen por sucursal y comentarios.

export interface PreguntaReporte {
    idPregunta: number
    pregunta: string
    tipo: TipoPregunta
    total: number
    promedio: number | null
    /** Respuestas por valor; el índice es el valor (0..10) */
    distribucion: number[]
    nps: ResumenNps | null
    opciones: { valor: number; etiqueta: string; total: number }[]
    textos: { texto: string; valor: number | null; etiqueta: string; tienda: string; fecha: string }[]
}

export interface Reporte {
    totales: { respuestas: number; nps: ResumenNps; promedio10: number | null }
    porPregunta: PreguntaReporte[]
    porTienda: { idTienda: number; tienda: string; respuestas: number; nps: ResumenNps; promedio10: number | null }[]
    comentarios: { tienda: string; comentario: string; fecha: string; nps: number | null }[]
    contactos: { tienda: string; correo: string; telefono: string; aceptaPromos: boolean; fecha: string }[]
}

const tarjeta = "bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl"
const titulo = "text-[12px] font-black text-slate-300 uppercase tracking-widest mb-3"
const COLOR_CLASE: Record<ClaseNps, string> = {
    promotor: "bg-emerald-400/70",
    pasivo: "bg-amber-400/70",
    detractor: "bg-rose-400/70",
}
const TEXTO_CLASE: Record<ClaseNps, string> = {
    promotor: "text-emerald-300",
    pasivo: "text-amber-300",
    detractor: "text-rose-300",
}
const colorEscala5 = (v: number) => (v >= 4 ? COLOR_CLASE.promotor : v === 3 ? COLOR_CLASE.pasivo : COLOR_CLASE.detractor)
const colorEscala10 = (v: number) => COLOR_CLASE[claseNps(v)]
const fmtFecha = (v: string) => String(v).slice(0, 16).replace("T", " ")
const pct = (parte: number, total: number) => (total > 0 ? Math.round((parte / total) * 100) : 0)
const colorNps = (nps: number | null) => (nps === null ? "text-slate-500" : nps >= 50 ? TEXTO_CLASE.promotor : nps >= 0 ? TEXTO_CLASE.pasivo : TEXTO_CLASE.detractor)

function Barras({ distribucion, desde, hasta, colorDe }: { distribucion: number[]; desde: number; hasta: number; colorDe: (v: number) => string }) {
    const valores = Array.from({ length: hasta - desde + 1 }, (_, i) => desde + i)
    const max = Math.max(...valores.map(v => distribucion[v] ?? 0), 1)
    return (
        <div className="mt-2 flex items-end gap-1 h-12">
            {valores.map(v => (
                <div key={v} className="flex-1 flex flex-col items-center gap-0.5">
                    <div
                        className={cn("w-full rounded-t", colorDe(v))}
                        style={{ height: `${Math.max(6, ((distribucion[v] ?? 0) / max) * 100)}%` }}
                        title={`${distribucion[v] ?? 0} respuestas de ${v}`}
                    />
                    <span className="text-[9px] font-black text-slate-600">{v}</span>
                </div>
            ))}
        </div>
    )
}

function ChipsNps({ nps }: { nps: ResumenNps }) {
    const clases: [ClaseNps, string, number][] = [
        ["promotor", "Promotores 9-10", nps.promotores],
        ["pasivo", "Pasivos 7-8", nps.pasivos],
        ["detractor", "Detractores 1-6", nps.detractores],
    ]
    return (
        <div className="flex flex-wrap gap-1.5 mt-2">
            {clases.map(([clase, nombre, cuenta]) => (
                <span key={clase} className={cn("text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-lg bg-white/[0.04] border border-white/10", TEXTO_CLASE[clase])}>
                    {nombre}: {fmtInt(cuenta)} ({pct(cuenta, nps.total)}%)
                </span>
            ))}
        </div>
    )
}

function ListaOpciones({ opciones, total }: { opciones: PreguntaReporte["opciones"]; total: number }) {
    return (
        <div className="mt-2 space-y-1.5">
            {opciones.map(o => (
                <div key={`${o.valor}-${o.etiqueta}`} className="flex items-center gap-2">
                    <span className="w-36 shrink-0 truncate text-[12px] font-bold text-slate-200" title={o.etiqueta}>{o.etiqueta || `Opción ${o.valor}`}</span>
                    <div className="flex-1 h-2.5 rounded bg-white/[0.05] overflow-hidden">
                        <div className="h-full rounded bg-emerald-400/70" style={{ width: `${pct(o.total, total)}%` }} />
                    </div>
                    <span className="w-20 shrink-0 text-right text-[11px] font-black text-slate-400">{fmtInt(o.total)} · {pct(o.total, total)}%</span>
                </div>
            ))}
        </div>
    )
}

function BarraSiNo({ si, no }: { si: number; no: number }) {
    const total = si + no
    return (
        <div className="mt-2">
            <div className="flex h-2.5 rounded overflow-hidden bg-white/[0.05]">
                <div className={COLOR_CLASE.promotor} style={{ width: `${pct(si, total)}%` }} />
                <div className={COLOR_CLASE.detractor} style={{ width: `${pct(no, total)}%` }} />
            </div>
            <div className="flex justify-between mt-1 text-[10px] font-black uppercase tracking-wider">
                <span className={TEXTO_CLASE.promotor}>{ETIQUETA_SI}: {fmtInt(si)}</span>
                <span className={TEXTO_CLASE.detractor}>{ETIQUETA_NO}: {fmtInt(no)}</span>
            </div>
        </div>
    )
}

function ListaTextos({ textos, esAbierta }: { textos: PreguntaReporte["textos"]; esAbierta: boolean }) {
    return (
        <div className="mt-2">
            {!esAbierta && <p className="text-[10px] font-black text-amber-300/80 uppercase tracking-widest mb-1">Seguimiento</p>}
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                {textos.map((t, i) => (
                    <div key={i} className="border border-white/[0.06] rounded-lg px-3 py-2">
                        <p className="text-[12px] font-medium text-slate-200 whitespace-pre-wrap">{t.texto}</p>
                        <p className="text-[10px] font-black text-slate-600 mt-0.5 uppercase tracking-wider">
                            {t.tienda}
                            {t.valor !== null && ` · ${t.etiqueta || `${t.valor}/${ESCALA_10}`}`}
                            {` · ${fmtFecha(t.fecha)}`}
                        </p>
                    </div>
                ))}
            </div>
        </div>
    )
}

/** Cifra que resume la pregunta según su tipo. */
function resumenDe(p: PreguntaReporte): { texto: string; color: string } {
    switch (p.tipo) {
        case "nps":
            return { texto: `NPS ${p.nps?.nps ?? "—"}`, color: colorNps(p.nps?.nps ?? null) }
        case "escala10":
            return { texto: `${p.promedio ?? "—"} / ${ESCALA_10}`, color: "text-amber-300" }
        case "estrellas":
            return { texto: `${p.promedio ?? "—"} ★`, color: "text-amber-300" }
        case "sino":
            return { texto: `${pct(p.distribucion[1] ?? 0, p.total)}% ${ETIQUETA_SI}`, color: TEXTO_CLASE.promotor }
        case "opciones": {
            const top = p.opciones.reduce<PreguntaReporte["opciones"][number] | null>((m, o) => (!m || o.total > m.total ? o : m), null)
            return { texto: top ? `${top.etiqueta || `Opción ${top.valor}`} ${pct(top.total, p.total)}%` : "—", color: "text-slate-200" }
        }
        default:
            return { texto: `${fmtInt(p.total)} respuestas`, color: "text-slate-400" }
    }
}

function CuerpoPregunta({ p }: { p: PreguntaReporte }) {
    switch (p.tipo) {
        case "nps":
            return (
                <>
                    {p.nps && <ChipsNps nps={p.nps} />}
                    <Barras distribucion={p.distribucion} desde={1} hasta={ESCALA_10} colorDe={colorEscala10} />
                </>
            )
        case "escala10":
            return <Barras distribucion={p.distribucion} desde={1} hasta={ESCALA_10} colorDe={colorEscala10} />
        case "estrellas":
            return <Barras distribucion={p.distribucion} desde={1} hasta={ESCALA} colorDe={colorEscala5} />
        case "opciones":
            return <ListaOpciones opciones={p.opciones} total={p.total} />
        case "sino":
            return <BarraSiNo si={p.distribucion[1] ?? 0} no={p.distribucion[0] ?? 0} />
        default:
            return null
    }
}

function TarjetaPregunta({ p }: { p: PreguntaReporte }) {
    const resumen = resumenDe(p)
    return (
        <div className="border border-white/[0.06] rounded-xl p-3">
            <div className="flex items-start justify-between gap-3">
                <p className="text-[13px] font-bold text-slate-100">{p.pregunta}</p>
                <span className={cn("shrink-0 text-[14px] font-black", resumen.color)}>{resumen.texto}</span>
            </div>
            <CuerpoPregunta p={p} />
            {p.textos.length > 0 && <ListaTextos textos={p.textos} esAbierta={p.tipo === "texto"} />}
            <p className="text-[10px] font-bold text-slate-600 mt-1">{fmtInt(p.total)} respuestas</p>
        </div>
    )
}

export default function ReporteEncuestas({ reporte }: { reporte: Reporte }) {
    const { totales } = reporte
    return (
        <>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className={cn(tarjeta, "p-5")}>
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Respuestas</p>
                    <p className="text-3xl font-black text-white mt-1">{fmtInt(totales.respuestas)}</p>
                </div>
                <div className={cn(tarjeta, "p-5")}>
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">NPS · recomendación</p>
                    <p className={cn("text-3xl font-black mt-1", colorNps(totales.nps.nps))}>{totales.nps.nps ?? "—"}</p>
                    <p className="text-[10px] font-bold text-slate-600 mt-1">
                        {fmtInt(totales.nps.promotores)} promotores · {fmtInt(totales.nps.pasivos)} pasivos · {fmtInt(totales.nps.detractores)} detractores
                    </p>
                </div>
                <div className={cn(tarjeta, "p-5")}>
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Promedio 1-10</p>
                    <p className="text-3xl font-black text-amber-300 mt-1">{totales.promedio10 ?? "—"}</p>
                    <p className="text-[10px] font-bold text-slate-600 mt-1">Recomendación, calidad y limpieza</p>
                </div>
                <div className={cn(tarjeta, "p-5")}>
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Contactos capturados</p>
                    <p className="text-3xl font-black text-emerald-300 mt-1">{fmtInt(reporte.contactos.length)}</p>
                </div>
            </div>

            <div className={cn(tarjeta, "p-5")}>
                <h3 className={titulo}>Por pregunta</h3>
                <div className="space-y-3">
                    {reporte.porPregunta.map((p, i) => <TarjetaPregunta key={`${p.idPregunta}-${i}`} p={p} />)}
                    {reporte.porPregunta.length === 0 && (
                        <p className="text-[11px] font-bold text-slate-600 py-4 text-center">Sin respuestas todavía</p>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className={cn(tarjeta, "p-5")}>
                    <h3 className={titulo}>Por sucursal</h3>
                    <div className="space-y-1.5">
                        {reporte.porTienda.map(t => (
                            <div key={t.idTienda} className="flex items-center justify-between gap-3 border border-white/[0.06] rounded-xl px-3 py-2">
                                <span className="text-[13px] font-bold text-slate-100">{t.tienda}</span>
                                <span className="text-[12px] font-black text-slate-400 text-right">
                                    {fmtInt(t.respuestas)} resp · <span className={colorNps(t.nps.nps)}>NPS {t.nps.nps ?? "—"}</span>
                                    {t.promedio10 !== null && <> · <span className="text-amber-300">{t.promedio10}/{ESCALA_10}</span></>}
                                </span>
                            </div>
                        ))}
                        {reporte.porTienda.length === 0 && (
                            <p className="text-[11px] font-bold text-slate-600 py-4 text-center">Sin respuestas todavía</p>
                        )}
                    </div>
                </div>
                <div className={cn(tarjeta, "p-5")}>
                    <h3 className={titulo}>Comentarios recientes</h3>
                    <div className="space-y-2 max-h-80 overflow-y-auto">
                        {reporte.comentarios.map((c, i) => (
                            <div key={i} className="border border-white/[0.06] rounded-xl px-3 py-2">
                                <p className="text-[12px] font-medium text-slate-200 whitespace-pre-wrap">{c.comentario}</p>
                                <p className="text-[10px] font-black text-slate-600 mt-1 uppercase tracking-wider">
                                    {c.tienda}{c.nps !== null && ` · recomendación ${c.nps}/${ESCALA_10}`} · {fmtFecha(c.fecha)}
                                </p>
                            </div>
                        ))}
                        {reporte.comentarios.length === 0 && (
                            <p className="text-[11px] font-bold text-slate-600 py-4 text-center">Sin comentarios en el rango</p>
                        )}
                    </div>
                </div>
            </div>
        </>
    )
}
