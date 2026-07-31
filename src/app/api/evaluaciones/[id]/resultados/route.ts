import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { portalQuery, esOficina } from '@/lib/portal-db';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

// Resultados de una evaluación (solo oficina): quién la presentó, de qué
// tienda, con qué calificación y cuándo.
export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    if (!(await esOficina(session.codigobarras))) {
        return NextResponse.json({ error: 'Solo oficina puede ver los resultados' }, { status: 403 });
    }

    const { id } = await params;
    const idEvaluacion = Number(id);
    if (!Number.isInteger(idEvaluacion) || idEvaluacion <= 0) {
        return NextResponse.json({ error: 'Evaluación inválida' }, { status: 400 });
    }

    try {
        const [encabezados, filas] = await Promise.all([
            portalQuery(
                `SELECT Titulo FROM evaluaciones WHERE IdEvaluacion = ?`, [idEvaluacion]
            ) as Promise<Row[]>,
            portalQuery(`
                SELECT IdTienda, CodigoBarras, Nombre, Aciertos, TotalPreguntas, Calificacion, FechaFin
                FROM evaluaciones_resultados
                WHERE IdEvaluacion = ?
                ORDER BY FechaFin DESC
                LIMIT 500
            `, [idEvaluacion]) as Promise<Row[]>,
        ]);

        return NextResponse.json({
            titulo: str(encabezados[0]?.Titulo),
            resultados: filas.map(f => ({
                idTienda: num(f.IdTienda),
                codigo: str(f.CodigoBarras),
                nombre: str(f.Nombre),
                aciertos: num(f.Aciertos),
                total: num(f.TotalPreguntas),
                calificacion: num(f.Calificacion),
                fecha: f.FechaFin,
            })),
        });
    } catch (error) {
        console.error('Error consultando resultados de la evaluación:', error);
        return NextResponse.json(
            { error: 'No fue posible consultar los resultados.' },
            { status: 502 }
        );
    }
}
