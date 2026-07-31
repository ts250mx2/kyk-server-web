import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { portalQuery } from '@/lib/portal-db';
import { canalesDe, otroDelDm } from '@/lib/chat';
import { getTiendasReportes } from '@/lib/tiendas';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

// Canales del chat visibles para la sesión (grupales + directos), con conteo
// de no leídos. Cada consulta actualiza además la presencia del usuario
// (portal_presencia), que alimenta el directorio y el indicador "en línea".
export async function GET() {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    try {
        // Presencia: este poll corre cada ~15 s desde la página del chat
        await portalQuery(`
            INSERT INTO portal_presencia (CodigoBarras, Nombre, IdTienda, UltimaVez)
            VALUES (?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE Nombre = VALUES(Nombre), IdTienda = VALUES(IdTienda), UltimaVez = NOW()
        `, [session.codigobarras, session.name, session.idTienda]).catch(() => { /* no crítica */ });

        const canales = await canalesDe(session);

        // Conversaciones directas existentes del usuario (con o sin leer)
        const dms = (await portalQuery(`
            SELECT Canal, MAX(IdMensaje) AS UltimoId
            FROM chat_mensajes
            WHERE Canal LIKE 'dm-%' AND (Canal LIKE ? OR Canal LIKE ?)
            GROUP BY Canal
            ORDER BY UltimoId DESC
            LIMIT 50
        `, [`dm-${session.codigobarras}-%`, `%-${session.codigobarras}`]).catch(() => [])) as Row[];

        // Ficha del otro participante de cada directo (nombre/tienda/en línea)
        const otros = dms
            .map(d => otroDelDm(str(d.Canal), session.codigobarras))
            .filter(Boolean);
        const fichas = new Map<string, Row>();
        if (otros.length > 0) {
            const marcas = otros.map(() => '?').join(',');
            const filas = (await portalQuery(`
                SELECT CodigoBarras, Nombre, IdTienda,
                       (UltimaVez >= DATE_SUB(NOW(), INTERVAL 2 MINUTE)) AS EnLinea
                FROM portal_presencia WHERE CodigoBarras IN (${marcas})
            `, otros).catch(() => [])) as Row[];
            for (const f of filas) fichas.set(str(f.CodigoBarras), f);
        }
        const tiendas = await getTiendasReportes().catch(() => []);
        const nombreTienda = new Map(tiendas.map(t => [t.IdTienda, t.Tienda]));

        // No leídos de todos los canales del usuario (grupales + directos)
        const todosCanales = [...canales.map(c => c.canal), ...dms.map(d => str(d.Canal))];
        const noLeidos = new Map<string, number>();
        if (todosCanales.length > 0) {
            const marcas = todosCanales.map(() => '?').join(',');
            try {
                const rows = await portalQuery(`
                    SELECT M.Canal, COUNT(*) AS N
                    FROM chat_mensajes M
                    LEFT JOIN chat_lecturas L ON L.Canal = M.Canal AND L.CodigoBarras = ?
                    WHERE M.Canal IN (${marcas})
                      AND M.IdMensaje > COALESCE(L.UltimoLeido, 0)
                      AND M.CodigoBarras <> ?
                    GROUP BY M.Canal
                `, [session.codigobarras, ...todosCanales, session.codigobarras]) as Row[];
                for (const r of rows) {
                    noLeidos.set(String(r.Canal), num(r.N));
                }
            } catch { /* badges en cero si falla */ }
        }

        return NextResponse.json({
            canales: canales.map(c => ({
                ...c,
                noLeidos: noLeidos.get(c.canal) ?? 0,
            })),
            directos: dms.map(d => {
                const canal = str(d.Canal);
                const codigo = otroDelDm(canal, session.codigobarras);
                const ficha = fichas.get(codigo);
                return {
                    canal,
                    codigo,
                    nombre: str(ficha?.Nombre) || codigo,
                    tienda: nombreTienda.get(num(ficha?.IdTienda)) ?? '',
                    enLinea: num(ficha?.EnLinea) === 1,
                    noLeidos: noLeidos.get(canal) ?? 0,
                };
            }),
        });
    } catch (error) {
        console.error('Error listando canales del chat:', error);
        return NextResponse.json(
            { error: 'No fue posible consultar los canales.' },
            { status: 502 }
        );
    }
}
