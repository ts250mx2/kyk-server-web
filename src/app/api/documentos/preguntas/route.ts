import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { portalQuery, esOficina } from '@/lib/portal-db';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

// Bitácora de preguntas que A.D.iA.N no pudo responder con los documentos del
// portal: oficina la revisa para saber qué documento falta subir.
export async function GET() {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    if (!(await esOficina(session.codigobarras))) {
        return NextResponse.json({ error: 'Solo el rol oficina puede ver la bitácora' }, { status: 403 });
    }

    try {
        const filas = (await portalQuery(`
            SELECT IdPregunta, IdTienda, Tienda, Nombre, Pregunta, Fecha
            FROM adian_preguntas
            WHERE Status = 0
            ORDER BY Fecha DESC
            LIMIT 200
        `)) as Row[];

        return NextResponse.json({
            total: filas.length,
            preguntas: filas.map(f => ({
                idPregunta: num(f.IdPregunta),
                tienda: str(f.Tienda) || `Tienda ${num(f.IdTienda)}`,
                usuario: str(f.Nombre),
                pregunta: str(f.Pregunta),
                fecha: f.Fecha,
            })),
        });
    } catch (error) {
        console.error('Error consultando la bitácora de A.D.iA.N:', error);
        return NextResponse.json(
            { error: 'No fue posible consultar la bitácora.' },
            { status: 502 }
        );
    }
}

// Marcar una pregunta como atendida (p. ej. ya se subió el documento faltante)
export async function PATCH(request: Request) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    if (!(await esOficina(session.codigobarras))) {
        return NextResponse.json({ error: 'Solo el rol oficina puede atender la bitácora' }, { status: 403 });
    }

    try {
        const { idPregunta } = await request.json();
        const id = Number(idPregunta);
        if (!Number.isInteger(id) || id <= 0) {
            return NextResponse.json({ error: 'Pregunta inválida' }, { status: 400 });
        }
        await portalQuery('UPDATE adian_preguntas SET Status = 1 WHERE IdPregunta = ?', [id]);
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error atendiendo pregunta de la bitácora:', error);
        return NextResponse.json(
            { error: 'No fue posible atender la pregunta.' },
            { status: 502 }
        );
    }
}
