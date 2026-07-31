import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { portalQuery, esOficina } from '@/lib/portal-db';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

// Reporte general de evaluaciones (solo oficina): todos los intentos de todas
// las evaluaciones, con evaluación/documento, usuario, tienda y calificación.
export async function GET() {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    if (!(await esOficina(session.codigobarras))) {
        return NextResponse.json({ error: 'Solo oficina puede ver el reporte' }, { status: 403 });
    }

    try {
        const filas = (await portalQuery(`
            SELECT R.IdEvaluacion, E.Titulo, E.IdDocumento, D.Nombre AS Documento,
                   R.IdTienda, R.CodigoBarras, R.Nombre, R.Aciertos, R.TotalPreguntas,
                   R.Calificacion, R.FechaFin
            FROM evaluaciones_resultados R
            INNER JOIN evaluaciones E ON E.IdEvaluacion = R.IdEvaluacion
            LEFT JOIN documentos D ON D.IdDocumento = E.IdDocumento
            ORDER BY R.FechaFin DESC
            LIMIT 2000
        `)) as Row[];

        return NextResponse.json({
            resultados: filas.map(f => ({
                idEvaluacion: num(f.IdEvaluacion),
                evaluacion: str(f.Titulo),
                documento: str(f.Documento),
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
        console.error('Error en reporte de evaluaciones:', error);
        return NextResponse.json(
            { error: 'No fue posible consultar el reporte.' },
            { status: 502 }
        );
    }
}
