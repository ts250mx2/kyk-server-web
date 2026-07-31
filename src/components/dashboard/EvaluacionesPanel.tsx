"use client"

import { useCallback, useEffect, useState } from "react"
import {
    Award, CheckCircle2, ChevronLeft, ClipboardList, Download, FileSpreadsheet,
    FileText, GraduationCap, Loader2, RefreshCw, Sparkles, UserRound, Users, X, XCircle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { fmtFechaHora } from "@/lib/format"
import { generarPdfResultado } from "@/lib/evaluacion-pdf"
import { exportarPdf, exportarExcel, sufijoArchivo, type ColumnaExport } from "@/lib/export"

// Evaluaciones de capacitación: cuestionarios de opción múltiple generados con
// IA a partir de cada documento del portal. El usuario elige un documento,
// contesta y el SERVIDOR califica (las respuestas correctas nunca viajan al
// navegador antes de enviar). Oficina ve quién presentó y con qué calificación
// y puede regenerar el cuestionario.

interface DocumentoEvaluable {
    idDocumento: number
    nombre: string
    archivo: string
    fecha: string
    evaluacion: { idEvaluacion: number; titulo: string; totalPreguntas: number } | null
    mio: { intentos: number; mejor: number; ultima: string } | null
    resultados: { presentados: number; promedio: number } | null
}

interface Quiz {
    idEvaluacion: number
    titulo: string
    preguntas: { pregunta: string; opciones: string[] }[]
}

interface Calificacion {
    aciertos: number
    total: number
    calificacion: number
    detalle: { correcta: number; elegida: number; acerto: boolean; explicacion: string }[]
}

interface ResultadoFila {
    idTienda: number
    codigo: string
    nombre: string
    aciertos: number
    total: number
    calificacion: number
    fecha: string
}

interface ReporteFila {
    idEvaluacion: number
    evaluacion: string
    documento: string
    idTienda: number
    codigo: string
    nombre: string
    aciertos: number
    total: number
    calificacion: number
    fecha: string
}

const LETRAS = ["A", "B", "C", "D"]

const colorCalificacion = (c: number) =>
    c >= 80 ? "text-emerald-300" : c >= 60 ? "text-amber-300" : "text-rose-300"

export function EvaluacionesPanel() {
    const [documentos, setDocumentos] = useState<DocumentoEvaluable[]>([])
    const [rol, setRol] = useState("tienda")
    const [cargando, setCargando] = useState(true)
    const [error, setError] = useState("")

    const [vista, setVista] = useState<"lista" | "quiz" | "calificada" | "reporte">("lista")
    const [quiz, setQuiz] = useState<Quiz | null>(null)
    const [respuestas, setRespuestas] = useState<(number | null)[]>([])
    const [generando, setGenerando] = useState(0)     // idDocumento en proceso
    const [enviando, setEnviando] = useState(false)
    const [calificacion, setCalificacion] = useState<Calificacion | null>(null)
    const [fechaCalificada, setFechaCalificada] = useState<Date | null>(null)
    const [docActual, setDocActual] = useState<DocumentoEvaluable | null>(null)

    // Quién presenta (nombre y tienda de la sesión): visible en el panel y en el PDF
    const [usuario, setUsuario] = useState("")
    const [tiendaSesion, setTiendaSesion] = useState("")

    // Reporte general (oficina)
    const [reporte, setReporte] = useState<ReporteFila[] | null>(null)
    const [cargandoReporte, setCargandoReporte] = useState(false)
    const [filtroEval, setFiltroEval] = useState(0)
    const [filtroTexto, setFiltroTexto] = useState("")

    // Modal de resultados (oficina)
    const [resultados, setResultados] = useState<{ titulo: string; filas: ResultadoFila[] } | null>(null)
    const [cargandoResultados, setCargandoResultados] = useState(false)
    const [tiendas, setTiendas] = useState<Map<number, string>>(new Map())

    const cargar = useCallback(async () => {
        try {
            const res = await fetch("/api/evaluaciones")
            if (res.status === 401) { window.location.href = "/login"; return }
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "Error al consultar")
            setDocumentos(json.documentos)
            setRol(json.rol)
            setError("")
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "No fue posible consultar las evaluaciones")
        } finally {
            setCargando(false)
        }
    }, [])

    useEffect(() => {
        cargar()
        fetch("/api/auth/tiendas")
            .then(r => r.json())
            .then(d => setTiendas(new Map((d.tiendas ?? []).map(
                (t: { IdTienda: number; Tienda: string }) => [t.IdTienda, t.Tienda]
            ))))
            .catch(() => { /* nombres de tienda opcionales */ })
        fetch("/api/auth/me")
            .then(r => r.json())
            .then(d => {
                setUsuario(d.user?.name ?? "")
                setTiendaSesion(d.user?.tienda ?? "")
            })
            .catch(() => { /* sin nombre, el PDF sale con guion */ })
    }, [cargar])

    const presentar = async (doc: DocumentoEvaluable, regenerar = false) => {
        if (generando) return
        setGenerando(doc.idDocumento)
        setError("")
        try {
            const res = await fetch("/api/evaluaciones", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ idDocumento: doc.idDocumento, regenerar }),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "No fue posible preparar la evaluación")
            setQuiz(json)
            setDocActual(doc)
            setRespuestas(new Array(json.preguntas.length).fill(null))
            setCalificacion(null)
            setVista("quiz")
            if (regenerar) cargar()
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "No fue posible preparar la evaluación")
        } finally {
            setGenerando(0)
        }
    }

    const enviar = async () => {
        if (!quiz || enviando || respuestas.some(r => r === null)) return
        setEnviando(true)
        setError("")
        try {
            const res = await fetch(`/api/evaluaciones/${quiz.idEvaluacion}/responder`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ respuestas }),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "No fue posible calificar")
            setCalificacion(json)
            setFechaCalificada(new Date())
            setVista("calificada")
            cargar()
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "No fue posible calificar")
        } finally {
            setEnviando(false)
        }
    }

    const verResultados = async (doc: DocumentoEvaluable) => {
        if (!doc.evaluacion || cargandoResultados) return
        setCargandoResultados(true)
        try {
            const res = await fetch(`/api/evaluaciones/${doc.evaluacion.idEvaluacion}/resultados`)
            const json = await res.json()
            if (res.ok) setResultados({ titulo: json.titulo, filas: json.resultados })
        } catch { /* modal simplemente no abre */ } finally {
            setCargandoResultados(false)
        }
    }

    const reintentar = () => {
        if (!quiz) return
        setRespuestas(new Array(quiz.preguntas.length).fill(null))
        setCalificacion(null)
        setVista("quiz")
    }

    const descargarPdf = () => {
        if (!quiz || !calificacion) return
        generarPdfResultado({
            titulo: quiz.titulo,
            documento: docActual?.nombre ?? "",
            usuario,
            tienda: tiendaSesion,
            aciertos: calificacion.aciertos,
            total: calificacion.total,
            calificacion: calificacion.calificacion,
            fecha: fechaCalificada ?? new Date(),
            preguntas: quiz.preguntas,
            detalle: calificacion.detalle,
        })
    }

    // ── Reporte general (oficina) ──
    const abrirReporte = async () => {
        setVista("reporte")
        setFiltroEval(0)
        setFiltroTexto("")
        setCargandoReporte(true)
        try {
            const res = await fetch("/api/evaluaciones/reporte")
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "No fue posible consultar el reporte")
            setReporte(json.resultados)
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "No fue posible consultar el reporte")
        } finally {
            setCargandoReporte(false)
        }
    }

    const filasReporte = (reporte ?? []).filter(r =>
        (!filtroEval || r.idEvaluacion === filtroEval)
        && (!filtroTexto.trim()
            || `${r.nombre} ${r.codigo} ${tiendas.get(r.idTienda) ?? ""}`.toLowerCase().includes(filtroTexto.trim().toLowerCase())))
    const evaluacionesDelReporte = [...new Map((reporte ?? []).map(r => [r.idEvaluacion, r.evaluacion]))]
    const promedioReporte = filasReporte.length
        ? Math.round(filasReporte.reduce((s, r) => s + r.calificacion, 0) / filasReporte.length * 10) / 10
        : 0

    const COLUMNAS_REPORTE: ColumnaExport[] = [
        { header: "Evaluación" },
        { header: "Usuario" },
        { header: "Tienda" },
        { header: "Aciertos", align: "center" },
        { header: "Calificación", align: "right" },
        { header: "Fecha" },
    ]
    const filasExport = () => filasReporte.map(r => [
        r.evaluacion,
        r.nombre || r.codigo,
        tiendas.get(r.idTienda) ?? String(r.idTienda),
        `${r.aciertos}/${r.total}`,
        String(r.calificacion),
        fmtFechaHora(r.fecha),
    ])
    const exportarReportePdf = () => exportarPdf({
        titulo: "Reporte de Evaluaciones",
        subtitulo: filtroEval
            ? evaluacionesDelReporte.find(([id]) => id === filtroEval)?.[1]
            : "Todas las evaluaciones",
        columnas: COLUMNAS_REPORTE,
        filas: filasExport(),
        nombreArchivo: `reporte_evaluaciones_${sufijoArchivo()}`,
        orientacion: "landscape",
    })
    const exportarReporteExcel = () => exportarExcel({
        titulo: "Reporte de Evaluaciones",
        subtitulo: filtroEval
            ? evaluacionesDelReporte.find(([id]) => id === filtroEval)?.[1]
            : "Todas las evaluaciones",
        columnas: COLUMNAS_REPORTE,
        filas: filasExport(),
        nombreArchivo: `reporte_evaluaciones_${sufijoArchivo()}`,
        hoja: "Evaluaciones",
    })

    const contestadas = respuestas.filter(r => r !== null).length

    return (
        <div className="flex-1 min-w-0 bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl flex flex-col overflow-hidden">
            {/* Encabezado */}
            <div className="px-5 py-3 border-b border-white/[0.06] bg-cyan-500/[0.06] flex items-center gap-3">
                <div className="h-8 w-8 rounded-xl border bg-cyan-400/15 border-cyan-400/30 flex items-center justify-center shrink-0">
                    <GraduationCap className="h-4 w-4 text-cyan-300" />
                </div>
                <div className="flex-1 min-w-0">
                    <h2 className="text-[13px] font-black text-white tracking-widest leading-none flex items-center gap-1.5">
                        EVALUACIONES <Sparkles className="h-3 w-3 text-cyan-400" />
                    </h2>
                    <p className="text-[9px] font-bold uppercase tracking-widest mt-1 text-cyan-400/70">
                        Cuestionarios de capacitación por documento · calificados al instante
                    </p>
                </div>
                {usuario && (
                    <span
                        className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black border border-cyan-400/30 bg-cyan-500/10 text-cyan-200"
                        title={`Los intentos quedan a nombre de ${usuario}`}
                    >
                        <UserRound className="h-3 w-3" /> {usuario}
                    </span>
                )}
                {rol === "oficina" && vista === "lista" && (
                    <button
                        onClick={abrirReporte}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-bold bg-white/[0.05] border border-white/10 text-slate-300 hover:text-cyan-300 hover:border-cyan-500/30 transition-all"
                        title="Resultados de todas las evaluaciones"
                    >
                        <ClipboardList className="h-3.5 w-3.5" /> Reporte
                    </button>
                )}
                {vista !== "lista" && (
                    <button
                        onClick={() => setVista("lista")}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-bold bg-white/[0.05] border border-white/10 text-slate-300 hover:text-white transition-all"
                    >
                        <ChevronLeft className="h-3.5 w-3.5" /> Documentos
                    </button>
                )}
            </div>

            {error && (
                <p className="px-5 pt-2 text-[10px] font-black text-rose-300 uppercase tracking-wider">{error}</p>
            )}

            <div className="flex-1 overflow-y-auto px-4 py-4">
                {/* ── Lista de documentos evaluables ── */}
                {vista === "lista" && (
                    cargando ? (
                        <div className="h-full flex items-center justify-center">
                            <Loader2 className="h-7 w-7 text-cyan-400 animate-spin" />
                        </div>
                    ) : documentos.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
                            <GraduationCap className="h-8 w-8 text-slate-700" />
                            <p className="text-[12px] font-bold text-slate-600">
                                No hay documentos disponibles para evaluar — cuando oficina suba documentos, aquí aparecerán sus cuestionarios.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {documentos.map(d => (
                                <div key={d.idDocumento} className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 flex items-center gap-3 flex-wrap">
                                    <FileText className="h-4 w-4 text-cyan-400/70 shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[13px] font-bold text-slate-100 truncate">{d.nombre}</p>
                                        <p className="text-[10px] font-bold text-slate-500 mt-0.5">
                                            {d.evaluacion
                                                ? `${d.evaluacion.totalPreguntas} preguntas`
                                                : "Aún sin cuestionario — se genera con IA al presentarla"}
                                            {d.mio && (
                                                <span className={cn("ml-2", colorCalificacion(d.mio.mejor))}>
                                                    · tu mejor: {d.mio.mejor} ({d.mio.intentos} intento{d.mio.intentos === 1 ? "" : "s"})
                                                </span>
                                            )}
                                        </p>
                                    </div>
                                    {rol === "oficina" && d.evaluacion && (
                                        <>
                                            <button
                                                onClick={() => verResultados(d)}
                                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-bold bg-white/[0.05] border border-white/10 text-slate-300 hover:text-cyan-300 hover:border-cyan-500/30 transition-all"
                                                title="Quién la ha presentado y con qué calificación"
                                            >
                                                <Users className="h-3.5 w-3.5" />
                                                {d.resultados ? d.resultados.presentados : 0}
                                                {d.resultados && d.resultados.presentados > 0 && (
                                                    <span className="text-slate-500">· prom {d.resultados.promedio}</span>
                                                )}
                                            </button>
                                            <button
                                                onClick={() => presentar(d, true)}
                                                disabled={generando !== 0}
                                                className="p-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-400 hover:text-amber-300 hover:border-amber-500/30 transition-all disabled:opacity-40"
                                                title="Regenerar el cuestionario con IA (retira el actual)"
                                            >
                                                <RefreshCw className={cn("h-3.5 w-3.5", generando === d.idDocumento && "animate-spin")} />
                                            </button>
                                        </>
                                    )}
                                    <button
                                        onClick={() => presentar(d)}
                                        disabled={generando !== 0}
                                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-black bg-cyan-400 text-slate-950 hover:brightness-110 transition-all disabled:opacity-40"
                                    >
                                        {generando === d.idDocumento
                                            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {d.evaluacion ? "Abriendo..." : "Generando con IA..."}</>
                                            : <><Award className="h-3.5 w-3.5" /> Presentar</>}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )
                )}

                {/* ── Presentando el cuestionario ── */}
                {vista === "quiz" && quiz && (
                    <div className="max-w-2xl mx-auto space-y-4">
                        <div>
                            <h3 className="text-[15px] font-black text-white">{quiz.titulo}</h3>
                            {usuario && (
                                <p className="text-[11px] font-bold text-cyan-300/90 mt-1 flex items-center gap-1.5">
                                    <UserRound className="h-3.5 w-3.5" />
                                    Evaluando a: {usuario}{tiendaSesion ? ` · ${tiendaSesion}` : ""}
                                </p>
                            )}
                            <p className="text-[11px] font-bold text-slate-500 mt-1">
                                {contestadas} de {quiz.preguntas.length} contestadas — elige una opción por pregunta
                            </p>
                        </div>
                        {quiz.preguntas.map((p, i) => (
                            <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                                <p className="text-[13px] font-bold text-slate-100 mb-3">
                                    <span className="text-cyan-300 mr-1.5">{i + 1}.</span>{p.pregunta}
                                </p>
                                <div className="space-y-1.5">
                                    {p.opciones.map((o, j) => (
                                        <button
                                            key={j}
                                            onClick={() => setRespuestas(prev => prev.map((r, k) => k === i ? j : r))}
                                            className={cn(
                                                "w-full text-left px-3 py-2 rounded-xl border text-[13px] font-medium transition-all flex items-start gap-2",
                                                respuestas[i] === j
                                                    ? "bg-cyan-500/15 border-cyan-400/50 text-cyan-100"
                                                    : "bg-white/[0.02] border-white/10 text-slate-300 hover:border-white/25"
                                            )}
                                        >
                                            <span className={cn(
                                                "shrink-0 w-5 h-5 rounded-md border text-[10px] font-black flex items-center justify-center",
                                                respuestas[i] === j
                                                    ? "bg-cyan-400 text-slate-950 border-cyan-400"
                                                    : "border-white/20 text-slate-500"
                                            )}>
                                                {LETRAS[j]}
                                            </span>
                                            {o}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                        <button
                            onClick={enviar}
                            disabled={enviando || contestadas < quiz.preguntas.length}
                            className="w-full py-3 rounded-2xl bg-cyan-400 text-slate-950 text-[13px] font-black hover:brightness-110 transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                        >
                            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Award className="h-4 w-4" />}
                            {contestadas < quiz.preguntas.length
                                ? `Responde las ${quiz.preguntas.length - contestadas} que faltan`
                                : "Calificar evaluación"}
                        </button>
                    </div>
                )}

                {/* ── Resultado calificado ── */}
                {vista === "calificada" && quiz && calificacion && (
                    <div className="max-w-2xl mx-auto space-y-4">
                        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center">
                            {usuario && (
                                <p className="text-[13px] font-black text-slate-200 flex items-center justify-center gap-1.5">
                                    <UserRound className="h-4 w-4 text-cyan-300" />
                                    {usuario}{tiendaSesion ? ` · ${tiendaSesion}` : ""}
                                </p>
                            )}
                            <p className={cn("text-5xl font-black mt-2", colorCalificacion(calificacion.calificacion))}>
                                {calificacion.calificacion}
                            </p>
                            <p className="text-[12px] font-bold text-slate-400 mt-2">
                                {calificacion.aciertos} de {calificacion.total} correctas — {quiz.titulo}
                            </p>
                            <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
                                <button
                                    onClick={descargarPdf}
                                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-black bg-emerald-500 text-slate-950 hover:brightness-110 transition-all"
                                    title="Constancia en PDF con el repaso y líneas de firma"
                                >
                                    <Download className="h-3.5 w-3.5" /> Imprimir PDF
                                </button>
                                <button
                                    onClick={reintentar}
                                    className="px-3 py-2 rounded-xl text-[11px] font-bold bg-white/[0.05] border border-white/10 text-slate-300 hover:text-white transition-all"
                                >
                                    Reintentar
                                </button>
                                <button
                                    onClick={() => setVista("lista")}
                                    className="px-3 py-2 rounded-xl text-[11px] font-black bg-cyan-400 text-slate-950 hover:brightness-110 transition-all"
                                >
                                    Volver a documentos
                                </button>
                            </div>
                        </div>
                        {quiz.preguntas.map((p, i) => {
                            const d = calificacion.detalle[i]
                            return (
                                <div key={i} className={cn(
                                    "rounded-2xl border p-4",
                                    d.acerto ? "border-emerald-500/25 bg-emerald-500/[0.05]" : "border-rose-500/25 bg-rose-500/[0.05]"
                                )}>
                                    <p className="text-[13px] font-bold text-slate-100 flex items-start gap-2">
                                        {d.acerto
                                            ? <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                                            : <XCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />}
                                        <span><span className="mr-1.5">{i + 1}.</span>{p.pregunta}</span>
                                    </p>
                                    <div className="mt-2 pl-6 space-y-1 text-[12px] font-medium">
                                        {!d.acerto && (
                                            <p className="text-rose-300">
                                                Tu respuesta: {LETRAS[d.elegida]}. {p.opciones[d.elegida]}
                                            </p>
                                        )}
                                        <p className="text-emerald-300">
                                            Correcta: {LETRAS[d.correcta]}. {p.opciones[d.correcta]}
                                        </p>
                                        {d.explicacion && <p className="text-slate-400">{d.explicacion}</p>}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}

                {/* ── Reporte general (oficina) ── */}
                {vista === "reporte" && (
                    cargandoReporte ? (
                        <div className="h-full flex items-center justify-center">
                            <Loader2 className="h-7 w-7 text-cyan-400 animate-spin" />
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {/* Filtros + exportación */}
                            <div className="flex items-center gap-2 flex-wrap">
                                <select
                                    value={filtroEval}
                                    onChange={e => setFiltroEval(Number(e.target.value))}
                                    className="px-3 py-2 bg-[#0d1320] border border-white/10 rounded-xl text-[12px] font-bold text-slate-200 focus:outline-none focus:border-cyan-400/60 max-w-[280px]"
                                >
                                    <option value={0}>Todas las evaluaciones</option>
                                    {evaluacionesDelReporte.map(([id, titulo]) => (
                                        <option key={id} value={id}>{titulo}</option>
                                    ))}
                                </select>
                                <input
                                    value={filtroTexto}
                                    onChange={e => setFiltroTexto(e.target.value)}
                                    placeholder="Buscar usuario o tienda..."
                                    className="flex-1 min-w-[160px] px-3 py-2 bg-white/[0.03] border border-white/10 rounded-xl text-[12px] font-medium text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-400/60"
                                />
                                <button
                                    onClick={exportarReportePdf}
                                    disabled={filasReporte.length === 0}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-[11px] font-bold bg-white/[0.05] border border-white/10 text-slate-300 hover:text-rose-300 hover:border-rose-500/30 transition-all disabled:opacity-40"
                                    title="Exportar a PDF"
                                >
                                    <Download className="h-3.5 w-3.5" /> PDF
                                </button>
                                <button
                                    onClick={exportarReporteExcel}
                                    disabled={filasReporte.length === 0}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-[11px] font-bold bg-white/[0.05] border border-white/10 text-slate-300 hover:text-emerald-300 hover:border-emerald-500/30 transition-all disabled:opacity-40"
                                    title="Exportar a Excel"
                                >
                                    <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
                                </button>
                            </div>

                            {/* Resumen */}
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="px-3 py-1.5 rounded-full text-[11px] font-black border border-white/10 bg-white/[0.03] text-slate-300">
                                    {filasReporte.length} intento{filasReporte.length === 1 ? "" : "s"}
                                </span>
                                {filasReporte.length > 0 && (
                                    <span className={cn(
                                        "px-3 py-1.5 rounded-full text-[11px] font-black border border-white/10 bg-white/[0.03]",
                                        colorCalificacion(promedioReporte)
                                    )}>
                                        Promedio: {promedioReporte}
                                    </span>
                                )}
                            </div>

                            {filasReporte.length === 0 ? (
                                <p className="text-[12px] font-bold text-slate-600 text-center py-10">
                                    Sin intentos registrados{filtroEval || filtroTexto ? " con estos filtros" : " todavía"}.
                                </p>
                            ) : (
                                <div className="space-y-1.5">
                                    {filasReporte.map((r, i) => (
                                        <div key={i} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[12px] font-bold text-slate-200 truncate">{r.nombre || r.codigo}</p>
                                                <p className="text-[10px] font-bold text-slate-500 truncate">
                                                    {tiendas.get(r.idTienda) ?? `Tienda ${r.idTienda}`} · {r.evaluacion}
                                                </p>
                                            </div>
                                            <p className="text-[10px] font-bold text-slate-500 shrink-0 hidden sm:block">{fmtFechaHora(r.fecha)}</p>
                                            <p className="text-[11px] font-bold text-slate-500 shrink-0">{r.aciertos}/{r.total}</p>
                                            <p className={cn("text-[15px] font-black w-12 text-right shrink-0", colorCalificacion(r.calificacion))}>
                                                {r.calificacion}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )
                )}
            </div>

            {/* Modal de resultados (oficina) */}
            {resultados && (
                <div
                    className="fixed inset-0 z-[85] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
                    onClick={() => setResultados(null)}
                >
                    <div
                        className="w-full max-w-2xl max-h-[85vh] bg-[#0d1320] border border-white/10 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden flex flex-col"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="px-6 py-4 border-b border-white/10 bg-cyan-500/[0.06] flex items-center justify-between gap-3">
                            <div>
                                <h3 className="text-[15px] font-black text-white flex items-center gap-2">
                                    <Users className="h-4 w-4 text-cyan-300" /> Resultados
                                </h3>
                                <p className="text-[11px] font-bold text-slate-500 mt-1">{resultados.titulo}</p>
                            </div>
                            <button
                                onClick={() => setResultados(null)}
                                className="p-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-400 hover:text-white transition-all"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4">
                            {resultados.filas.length === 0 ? (
                                <p className="text-[12px] font-bold text-slate-600 text-center py-8">
                                    Nadie la ha presentado todavía.
                                </p>
                            ) : (
                                <div className="space-y-1.5">
                                    {resultados.filas.map((f, i) => (
                                        <div key={i} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[12px] font-bold text-slate-200 truncate">{f.nombre || f.codigo}</p>
                                                <p className="text-[10px] font-bold text-slate-500">
                                                    {tiendas.get(f.idTienda) ?? `Tienda ${f.idTienda}`} · {fmtFechaHora(f.fecha)}
                                                </p>
                                            </div>
                                            <p className="text-[11px] font-bold text-slate-500">{f.aciertos}/{f.total}</p>
                                            <p className={cn("text-[15px] font-black w-12 text-right", colorCalificacion(f.calificacion))}>
                                                {f.calificacion}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
