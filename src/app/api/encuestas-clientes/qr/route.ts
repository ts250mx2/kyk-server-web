import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { esOficina, portalQuery } from '@/lib/portal-db';

export const dynamic = 'force-dynamic';

// Acciones sobre el QR de una sucursal (solo oficina): rotar invalida la liga
// repartida y estrena UUID; activar/desactivar prende o apaga la encuesta de
// esa sucursal sin cambiar la liga.
export async function POST(request: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    if (!(await esOficina(session.codigobarras))) {
        return NextResponse.json({ error: 'Solo oficina puede administrar las encuestas' }, { status: 403 });
    }

    let cuerpo: Record<string, unknown>;
    try {
        cuerpo = await request.json();
    } catch {
        return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
    }

    const idTienda = Number(cuerpo.idTienda);
    const accion = String(cuerpo.accion ?? '');
    if (!Number.isInteger(idTienda) || idTienda <= 0) {
        return NextResponse.json({ error: 'Tienda inválida' }, { status: 400 });
    }

    try {
        if (accion === 'rotar') {
            const uuid = crypto.randomUUID();
            await portalQuery('UPDATE encuestas_clientes_qr SET Uuid = ?, FechaAct = NOW() WHERE IdTienda = ?', [uuid, idTienda]);
            return NextResponse.json({ ok: true, uuid });
        }
        if (accion === 'activar' || accion === 'desactivar') {
            await portalQuery(
                'UPDATE encuestas_clientes_qr SET Activa = ?, FechaAct = NOW() WHERE IdTienda = ?',
                [accion === 'activar' ? 1 : 0, idTienda]
            );
            return NextResponse.json({ ok: true });
        }
        return NextResponse.json({ error: 'Acción desconocida' }, { status: 400 });
    } catch (error) {
        console.error('Error en QR de encuestas:', error);
        return NextResponse.json({ error: 'No fue posible aplicar el cambio' }, { status: 502 });
    }
}
