import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { esOficina, portalQuery } from '@/lib/portal-db';
import { getTiendasReportes } from '@/lib/tiendas';
import { obtenerConfig } from '@/lib/encuestas-clientes';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

// Panorama del módulo para la pantalla de administración (solo oficina):
// config, preguntas activas y el QR de CADA sucursal (el UUID se estrena aquí
// de forma perezosa para las tiendas que aún no tienen).
export async function GET() {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    if (!(await esOficina(session.codigobarras))) {
        return NextResponse.json({ error: 'Solo oficina puede administrar las encuestas' }, { status: 403 });
    }

    try {
        const config = await obtenerConfig();
        const preguntas = (await portalQuery(
            'SELECT IdPregunta, Pregunta, TipoPregunta, Etiquetas, Orden FROM encuestas_clientes_preguntas WHERE Activa = 1 ORDER BY Orden, IdPregunta'
        )) as Row[];

        const tiendas = await getTiendasReportes();
        const existentes = (await portalQuery('SELECT IdTienda, Uuid, Activa FROM encuestas_clientes_qr')) as Row[];
        const porTienda = new Map(existentes.map(f => [Number(f.IdTienda), f]));

        const lista = [];
        for (const t of tiendas) {
            let fila = porTienda.get(t.IdTienda);
            if (!fila) {
                const uuid = crypto.randomUUID();
                await portalQuery(
                    'INSERT IGNORE INTO encuestas_clientes_qr (IdTienda, Tienda, Uuid, Activa, FechaAct) VALUES (?, ?, ?, 1, NOW())',
                    [t.IdTienda, t.Tienda, uuid]
                );
                fila = { IdTienda: t.IdTienda, Uuid: uuid, Activa: 1 };
            }
            lista.push({
                idTienda: t.IdTienda,
                tienda: t.Tienda,
                uuid: String(fila.Uuid),
                activa: Number(fila.Activa) === 1,
            });
        }

        return NextResponse.json({
            config,
            preguntas: preguntas.map(p => ({
                idPregunta: Number(p.IdPregunta),
                pregunta: String(p.Pregunta),
                tipo: p.TipoPregunta === 'opciones' ? 'opciones' : 'estrellas',
                etiquetas: (() => { try { const e = JSON.parse(String(p.Etiquetas ?? '[]')); return Array.isArray(e) ? e : []; } catch { return []; } })(),
            })),
            tiendas: lista,
        });
    } catch (error) {
        console.error('Error cargando administración de encuestas:', error);
        return NextResponse.json({ error: 'No fue posible cargar el módulo de encuestas' }, { status: 502 });
    }
}
