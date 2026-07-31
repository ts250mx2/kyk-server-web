import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { portalQuery } from '@/lib/portal-db';
import { getTiendasReportes } from '@/lib/tiendas';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

// Directorio para iniciar chats directos: usuarios que han entrado al portal
// (portal_presencia), con su tienda y si están en línea (activos < 2 min).
export async function GET() {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    try {
        const [filas, tiendas] = await Promise.all([
            portalQuery(`
                SELECT CodigoBarras, Nombre, IdTienda,
                       (UltimaVez >= DATE_SUB(NOW(), INTERVAL 2 MINUTE)) AS EnLinea,
                       UltimaVez
                FROM portal_presencia
                WHERE CodigoBarras <> ?
                ORDER BY EnLinea DESC, Nombre
                LIMIT 300
            `, [session.codigobarras]) as Promise<Row[]>,
            getTiendasReportes().catch(() => []),
        ]);
        const nombreTienda = new Map(tiendas.map(t => [t.IdTienda, t.Tienda]));

        return NextResponse.json({
            usuarios: filas.map(f => ({
                codigo: str(f.CodigoBarras),
                nombre: str(f.Nombre) || str(f.CodigoBarras),
                idTienda: num(f.IdTienda),
                tienda: nombreTienda.get(num(f.IdTienda)) ?? (num(f.IdTienda) === 0 ? 'Oficina' : ''),
                enLinea: num(f.EnLinea) === 1,
                ultimaVez: f.UltimaVez,
            })),
        });
    } catch (error) {
        console.error('Error listando usuarios del chat:', error);
        return NextResponse.json(
            { error: 'No fue posible consultar los usuarios.' },
            { status: 502 }
        );
    }
}
