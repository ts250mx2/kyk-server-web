import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { portalQuery } from '@/lib/portal-db';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

// Conteo de comunicados vigentes sin acuse del usuario actual (para la campana
// del header y el banner de urgentes en Principal). Se consulta cada minuto.
export async function GET() {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    try {
        const rows = await portalQuery(`
            SELECT COUNT(*) AS Total, COALESCE(SUM(C.Prioridad = 1), 0) AS Urgentes
            FROM comunicados C
            LEFT JOIN comunicados_acuses A
                ON A.IdComunicado = C.IdComunicado
               AND A.CodigoBarras = ? AND A.IdTienda = ?
            WHERE C.Status = 0
              AND A.IdComunicado IS NULL
              AND (C.VigenteHasta IS NULL OR C.VigenteHasta >= NOW())
              AND (C.TodasTiendas = 1 OR EXISTS (
                  SELECT 1 FROM comunicados_tiendas T
                  WHERE T.IdComunicado = C.IdComunicado AND T.IdTienda = ?
              ))
        `, [session.codigobarras, session.idTienda, session.idTienda]) as Row[];

        return NextResponse.json({
            total: num(rows[0]?.Total),
            urgentes: num(rows[0]?.Urgentes),
        });
    } catch (error) {
        console.error('Error contando comunicados no leídos:', error);
        // La campana no debe tumbar la UI si el central está caído
        return NextResponse.json({ total: 0, urgentes: 0 });
    }
}
