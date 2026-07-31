import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { portalQuery, esOficina } from '@/lib/portal-db';
import type { PreguntaEvaluacion } from '@/lib/evaluaciones';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

// Calificar una evaluación: las respuestas correctas viven solo en el servidor,
// así que la calificación se hace aquí y hasta entonces se revela el detalle
// (correcta + explicación por pregunta). Cada envío queda como un intento en
// evaluaciones_resultados (visible para oficina).
export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { id } = await params;
    const idEvaluacion = Number(id);
    if (!Number.isInteger(idEvaluacion) || idEvaluacion <= 0) {
        return NextResponse.json({ error: 'Evaluación inválida' }, { status: 400 });
    }

    try {
        const cuerpo = await request.json().catch(() => ({}));
        const respuestas: number[] = Array.isArray(cuerpo?.respuestas)
            ? cuerpo.respuestas.map(Number)
            : [];

        const oficina = await esOficina(session.codigobarras);
        const filas = (await portalQuery(`
            SELECT E.IdEvaluacion, E.Titulo, E.Preguntas
            FROM evaluaciones E
            INNER JOIN documentos D ON D.IdDocumento = E.IdDocumento AND D.Status = 0
            WHERE E.IdEvaluacion = ? AND E.Status = 0
              ${oficina ? '' : `AND (D.TodasTiendas = 1 OR EXISTS (
                  SELECT 1 FROM documentos_tiendas T
                  WHERE T.IdDocumento = D.IdDocumento AND T.IdTienda = ${session.idTienda}
              ))`}
        `, [idEvaluacion])) as Row[];
        const evaluacion = filas[0];
        if (!evaluacion) {
            return NextResponse.json({ error: 'Evaluación no encontrada o no disponible' }, { status: 404 });
        }

        const preguntas = JSON.parse(str(evaluacion.Preguntas)) as PreguntaEvaluacion[];
        if (respuestas.length !== preguntas.length
            || respuestas.some(r => !Number.isInteger(r) || r < 0 || r > 3)) {
            return NextResponse.json({ error: 'Responde todas las preguntas' }, { status: 400 });
        }

        const aciertos = preguntas.reduce(
            (total, p, i) => total + (respuestas[i] === p.correcta ? 1 : 0), 0
        );
        const calificacion = Math.round((aciertos / preguntas.length) * 1000) / 10;

        await portalQuery(`
            INSERT INTO evaluaciones_resultados
                (IdEvaluacion, IdTienda, CodigoBarras, Nombre, Respuestas,
                 Aciertos, TotalPreguntas, Calificacion, FechaFin)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `, [
            idEvaluacion,
            session.idTienda,
            session.codigobarras,
            session.name,
            JSON.stringify(respuestas),
            aciertos,
            preguntas.length,
            calificacion,
        ]);

        return NextResponse.json({
            aciertos,
            total: preguntas.length,
            calificacion,
            detalle: preguntas.map((p, i) => ({
                correcta: p.correcta,
                elegida: respuestas[i],
                acerto: respuestas[i] === p.correcta,
                explicacion: p.explicacion,
            })),
        });
    } catch (error) {
        console.error('Error calificando evaluación:', error);
        return NextResponse.json(
            { error: 'No fue posible calificar la evaluación.' },
            { status: 502 }
        );
    }
}
