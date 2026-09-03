import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { esOficina } from '@/lib/portal-db';
import { getTiendasReportes } from '@/lib/tiendas';
import { asegurarQrTienda, obtenerConfig, obtenerPreguntasActivas } from '@/lib/encuestas-clientes';

export const dynamic = 'force-dynamic';

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
        const preguntas = await obtenerPreguntasActivas();

        const lista = [];
        for (const t of await getTiendasReportes()) {
            const qr = await asegurarQrTienda(t.IdTienda, t.Tienda);
            lista.push({ idTienda: t.IdTienda, tienda: t.Tienda, uuid: qr.uuid, activa: qr.activa });
        }

        return NextResponse.json({ config, preguntas, tiendas: lista });
    } catch (error) {
        console.error('Error cargando administración de encuestas:', error);
        return NextResponse.json({ error: 'No fue posible cargar el módulo de encuestas' }, { status: 502 });
    }
}
