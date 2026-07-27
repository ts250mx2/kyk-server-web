import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { portalQuery, esOficina } from '@/lib/portal-db';

export const dynamic = 'force-dynamic';

// Retirar un documento (borrado suave, solo oficina). El archivo físico se
// conserva en disco por auditoría.
export async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    if (!(await esOficina(session.codigobarras))) {
        return NextResponse.json({ error: 'Solo el rol oficina puede retirar documentos' }, { status: 403 });
    }

    const { id } = await params;
    const idDocumento = Number(id);
    if (!Number.isInteger(idDocumento) || idDocumento <= 0) {
        return NextResponse.json({ error: 'Documento inválido' }, { status: 400 });
    }

    try {
        await portalQuery(`UPDATE documentos SET Status = 1 WHERE IdDocumento = ?`, [idDocumento]);
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error(`Error retirando documento ${idDocumento}:`, error);
        return NextResponse.json(
            { error: 'No fue posible retirar el documento.' },
            { status: 502 }
        );
    }
}
