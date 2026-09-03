import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { esOficina, portalQuery } from '@/lib/portal-db';
import {
    ESCALA_10,
    NPS_DETRACTOR_HASTA,
    NPS_PROMOTOR_DESDE,
    calcularNps,
    filtroDeReporte,
    normalizarTipo,
    type FiltroReporte,
    type ResumenNps,
    type TipoPregunta,
} from '@/lib/encuestas-clientes';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0);
const decimal = (v: unknown, decimales: number) => (v === null || v === undefined ? null : Number(num(v).toFixed(decimales)));

const MAX_TEXTOS = 300;
const MAX_COMENTARIOS = 100;
const MAX_CONTACTOS = 300;

// Fragmentos SQL con constantes propias (nunca texto del cliente). El NPS sale
// SOLO de la pregunta tipo 'nps'; el promedio en escala de 10 junta las
// preguntas numéricas (estrellas ×2); opciones, sí/no y texto no entran.
const SQL_NPS = `
    SUM(D.TipoPregunta = 'nps' AND D.Valor >= ${NPS_PROMOTOR_DESDE}) AS Promotores,
    SUM(D.TipoPregunta = 'nps' AND D.Valor > ${NPS_DETRACTOR_HASTA} AND D.Valor < ${NPS_PROMOTOR_DESDE}) AS Pasivos,
    SUM(D.TipoPregunta = 'nps' AND D.Valor <= ${NPS_DETRACTOR_HASTA}) AS Detractores`;
const SQL_PROMEDIO10 = `
    AVG(CASE WHEN D.TipoPregunta IN ('nps', 'escala10') THEN D.Valor
             WHEN D.TipoPregunta = 'estrellas' THEN D.Valor * 2 END) AS Promedio10`;
const SQL_DISTRIBUCION = Array.from({ length: ESCALA_10 + 1 }, (_, v) => `SUM(D.Valor = ${v}) AS V${v}`).join(', ');

function npsDeFila(f: Row | undefined): ResumenNps {
    return calcularNps(num(f?.Promotores), num(f?.Pasivos), num(f?.Detractores));
}

interface PreguntaReporte {
    idPregunta: number;
    pregunta: string;
    tipo: TipoPregunta;
    total: number;
    promedio: number | null;
    /** Cuántas respuestas por valor; el índice es el valor (0..10) */
    distribucion: number[];
    nps: ResumenNps | null;
    opciones: { valor: number; etiqueta: string; total: number }[];
    textos: { texto: string; valor: number | null; etiqueta: string; tienda: string; fecha: string }[];
}

async function consultar(f: FiltroReporte) {
    const { filtro, parametros, donde } = f;
    const desdeDetalle = `FROM encuestas_clientes_detalle D
        JOIN encuestas_clientes_respuestas R ON R.IdRespuesta = D.IdRespuesta`;
    return Promise.all([
        portalQuery(
            `SELECT COUNT(DISTINCT R.IdRespuesta) AS Respuestas, ${SQL_NPS}, ${SQL_PROMEDIO10}
             FROM encuestas_clientes_respuestas R
             LEFT JOIN encuestas_clientes_detalle D ON D.IdRespuesta = R.IdRespuesta ${filtro}`,
            parametros
        ) as Promise<Row[]>,
        portalQuery(
            `SELECT D.IdPregunta, D.Pregunta, D.TipoPregunta, COUNT(*) AS Total,
                    AVG(CASE WHEN D.TipoPregunta <> 'texto' THEN D.Valor END) AS Promedio,
                    ${SQL_NPS}, ${SQL_DISTRIBUCION}
             ${desdeDetalle}
             LEFT JOIN encuestas_clientes_preguntas P ON P.IdPregunta = D.IdPregunta
             ${filtro}
             GROUP BY D.IdPregunta, D.Pregunta, D.TipoPregunta
             ORDER BY MIN(COALESCE(P.Orden, 999)), MIN(D.IdDetalle)`,
            parametros
        ) as Promise<Row[]>,
        portalQuery(
            `SELECT D.IdPregunta, D.Valor, D.Etiqueta, COUNT(*) AS Total
             ${desdeDetalle} ${donde("D.TipoPregunta = 'opciones'")}
             GROUP BY D.IdPregunta, D.Valor, D.Etiqueta
             ORDER BY D.IdPregunta, D.Valor DESC`,
            parametros
        ) as Promise<Row[]>,
        portalQuery(
            `SELECT D.IdPregunta, D.TipoPregunta, D.Valor, D.Etiqueta, D.Texto, R.IdTienda, R.Fecha
             ${desdeDetalle} ${donde("D.Texto IS NOT NULL AND D.Texto <> ''")}
             ORDER BY R.Fecha DESC, D.IdDetalle
             LIMIT ${MAX_TEXTOS}`,
            parametros
        ) as Promise<Row[]>,
        portalQuery(
            `SELECT R.IdTienda, COUNT(DISTINCT R.IdRespuesta) AS Respuestas, ${SQL_NPS}, ${SQL_PROMEDIO10}
             FROM encuestas_clientes_respuestas R
             JOIN encuestas_clientes_detalle D ON D.IdRespuesta = R.IdRespuesta
             ${filtro}
             GROUP BY R.IdTienda`,
            parametros
        ) as Promise<Row[]>,
        portalQuery(
            `SELECT R.IdTienda, R.Comentario, R.Fecha,
                    (SELECT D.Valor FROM encuestas_clientes_detalle D
                     WHERE D.IdRespuesta = R.IdRespuesta AND D.TipoPregunta = 'nps' LIMIT 1) AS Nps
             FROM encuestas_clientes_respuestas R
             ${donde("R.Comentario IS NOT NULL AND R.Comentario <> ''")}
             ORDER BY R.Fecha DESC
             LIMIT ${MAX_COMENTARIOS}`,
            parametros
        ) as Promise<Row[]>,
        portalQuery(
            `SELECT R.IdTienda, R.Correo, R.Telefono, R.AceptaPromos, R.Fecha
             FROM encuestas_clientes_respuestas R
             ${donde('(R.Correo IS NOT NULL OR R.Telefono IS NOT NULL)')}
             ORDER BY R.Fecha DESC
             LIMIT ${MAX_CONTACTOS}`,
            parametros
        ) as Promise<Row[]>,
        portalQuery('SELECT IdTienda, Tienda FROM encuestas_clientes_qr') as Promise<Row[]>,
    ]);
}

/** Junta por pregunta su distribución, sus opciones y sus textos (abiertos y de seguimiento). */
function armarPorPregunta(filas: Row[], opciones: Row[], textos: Row[], conNombre: (id: unknown) => string): PreguntaReporte[] {
    const porId = new Map<number, PreguntaReporte>();
    const lista = filas.map(f => {
        const tipo = normalizarTipo(f.TipoPregunta);
        const entrada: PreguntaReporte = {
            idPregunta: num(f.IdPregunta),
            pregunta: String(f.Pregunta),
            tipo,
            total: num(f.Total),
            promedio: tipo === 'texto' || tipo === 'sino' ? null : decimal(f.Promedio, 2),
            distribucion: Array.from({ length: ESCALA_10 + 1 }, (_, v) => num(f[`V${v}`])),
            nps: tipo === 'nps' ? npsDeFila(f) : null,
            opciones: [],
            textos: [],
        };
        // Si la pregunta se editó hay dos snapshots: opciones y textos van al primero
        if (!porId.has(entrada.idPregunta)) porId.set(entrada.idPregunta, entrada);
        return entrada;
    });
    for (const o of opciones) {
        porId.get(num(o.IdPregunta))?.opciones.push({ valor: num(o.Valor), etiqueta: String(o.Etiqueta ?? ''), total: num(o.Total) });
    }
    for (const t of textos) {
        porId.get(num(t.IdPregunta))?.textos.push({
            texto: String(t.Texto),
            valor: normalizarTipo(t.TipoPregunta) === 'texto' ? null : num(t.Valor),
            etiqueta: t.Etiqueta ? String(t.Etiqueta) : '',
            tienda: conNombre(t.IdTienda),
            fecha: String(t.Fecha),
        });
    }
    return lista;
}

// Reporte de las encuestas de clientes (solo oficina): NPS y promedio
// generales, detalle por pregunta según su tipo, resumen por sucursal,
// comentarios y contactos capturados. Filtros: rango de fechas y sucursal.
export async function GET(request: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    if (!(await esOficina(session.codigobarras))) {
        return NextResponse.json({ error: 'Solo oficina puede ver el reporte' }, { status: 403 });
    }

    try {
        const [totales, porPregunta, opciones, textos, porTienda, comentarios, contactos, nombres] =
            await consultar(filtroDeReporte(request.url));

        const nombreTienda = new Map(nombres.map(f => [num(f.IdTienda), String(f.Tienda)]));
        const conNombre = (id: unknown) => nombreTienda.get(num(id)) ?? `Tienda ${num(id)}`;
        const ordenNps = (a: { nps: ResumenNps }, b: { nps: ResumenNps }) => (b.nps.nps ?? -101) - (a.nps.nps ?? -101);

        return NextResponse.json({
            totales: {
                respuestas: num(totales[0]?.Respuestas),
                nps: npsDeFila(totales[0]),
                promedio10: decimal(totales[0]?.Promedio10, 1),
            },
            porPregunta: armarPorPregunta(porPregunta, opciones, textos, conNombre),
            porTienda: porTienda
                .map(f => ({
                    idTienda: num(f.IdTienda),
                    tienda: conNombre(f.IdTienda),
                    respuestas: num(f.Respuestas),
                    nps: npsDeFila(f),
                    promedio10: decimal(f.Promedio10, 1),
                }))
                .sort(ordenNps),
            comentarios: comentarios.map(f => ({
                tienda: conNombre(f.IdTienda),
                comentario: String(f.Comentario),
                fecha: String(f.Fecha),
                nps: f.Nps === null || f.Nps === undefined ? null : num(f.Nps),
            })),
            contactos: contactos.map(f => ({
                tienda: conNombre(f.IdTienda),
                correo: f.Correo ? String(f.Correo) : '',
                telefono: f.Telefono ? String(f.Telefono) : '',
                aceptaPromos: num(f.AceptaPromos) === 1,
                fecha: String(f.Fecha),
            })),
        });
    } catch (error) {
        console.error('Error en reporte de encuestas:', error);
        return NextResponse.json({ error: 'No fue posible generar el reporte' }, { status: 502 });
    }
}
