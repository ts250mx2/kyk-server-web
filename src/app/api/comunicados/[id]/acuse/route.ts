import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { portalQuery } from '@/lib/portal-db';

export const dynamic = 'force-dynamic';

// Acuse de recibo: el usuario confirma "de enterado" del comunicado para su tienda.
export async function POST(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { id } = await params;
    const idComunicado = Number(id);
    if (!Number.isInteger(idComunicado) || idComunicado <= 0) {
        return NextResponse.json({ error: 'Comunicado inválido' }, { status: 400 });
    }

    try {
        await portalQuery(`
            INSERT IGNORE INTO comunicados_acuses
                (IdComunicado, IdTienda, CodigoBarras, Nombre, FechaAcuse)
            VALUES (?, ?, ?, ?, NOW())
        `, [idComunicado, session.idTienda, session.codigobarras, session.name]);

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error(`Error registrando acuse del comunicado ${idComunicado}:`, error);
        return NextResponse.json(
            { error: 'No fue posible registrar el acuse.' },
            { status: 502 }
        );
    }
}
