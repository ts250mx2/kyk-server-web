import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { portalQuery } from '@/lib/portal-db';
import { canalesDe } from '@/lib/chat';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

// Canales del chat visibles para la sesión, con conteo de mensajes no leídos
// (mensajes de otros posteriores a la última lectura del usuario).
export async function GET() {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    try {
        const canales = await canalesDe(session);

        // Los nombres de canal se construyen en el servidor (general / tienda-<int>)
        const lista = canales.map(c => `'${c.canal}'`).join(',');
        const noLeidos = new Map<string, number>();
        try {
            const rows = await portalQuery(`
                SELECT M.Canal, COUNT(*) AS N
                FROM chat_mensajes M
                LEFT JOIN chat_lecturas L ON L.Canal = M.Canal AND L.CodigoBarras = ?
                WHERE M.Canal IN (${lista})
                  AND M.IdMensaje > COALESCE(L.UltimoLeido, 0)
                  AND M.CodigoBarras <> ?
                GROUP BY M.Canal
            `, [session.codigobarras, session.codigobarras]) as Row[];
            for (const r of rows) {
                noLeidos.set(String(r.Canal), num(r.N));
            }
        } catch { /* badges en cero si falla */ }

        return NextResponse.json({
            canales: canales.map(c => ({
                ...c,
                noLeidos: noLeidos.get(c.canal) ?? 0,
            })),
        });
    } catch (error) {
        console.error('Error listando canales del chat:', error);
        return NextResponse.json(
            { error: 'No fue posible consultar los canales.' },
            { status: 502 }
        );
    }
}
