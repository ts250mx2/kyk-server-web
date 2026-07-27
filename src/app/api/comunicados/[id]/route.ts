import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { portalQuery, esOficina } from '@/lib/portal-db';

export const dynamic = 'force-dynamic';

// Retirar un comunicado (borrado suave, solo oficina).
export async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    if (!(await esOficina(session.codigobarras))) {
        return NextResponse.json({ error: 'Solo el rol oficina puede retirar comunicados' }, { status: 403 });
    }

    const { id } = await params;
    const idComunicado = Number(id);
    if (!Number.isInteger(idComunicado) || idComunicado <= 0) {
        return NextResponse.json({ error: 'Comunicado inválido' }, { status: 400 });
    }

    try {
        await portalQuery(
            `UPDATE comunicados SET Status = 1 WHERE IdComunicado = ?`,
            [idComunicado]
        );
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error(`Error retirando comunicado ${idComunicado}:`, error);
        return NextResponse.json(
            { error: 'No fue posible retirar el comunicado.' },
            { status: 502 }
        );
    }
}
