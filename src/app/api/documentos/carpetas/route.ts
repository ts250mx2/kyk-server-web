import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { portalQuery, esOficina } from '@/lib/portal-db';

export const dynamic = 'force-dynamic';

// Crear carpeta del repositorio de documentos (solo oficina).
export async function POST(request: Request) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    if (!(await esOficina(session.codigobarras))) {
        return NextResponse.json({ error: 'Solo el rol oficina puede crear carpetas' }, { status: 403 });
    }

    try {
        const { nombre } = await request.json();
        if (!nombre?.trim()) {
            return NextResponse.json({ error: 'Nombre de carpeta requerido' }, { status: 400 });
        }

        const resultado = await portalQuery(`
            INSERT INTO documentos_carpetas (Nombre, Status, FechaAlta) VALUES (?, 0, NOW())
        `, [String(nombre).trim().slice(0, 100)]) as unknown as { insertId: number };

        return NextResponse.json({ success: true, idCarpeta: resultado.insertId });
    } catch (error) {
        console.error('Error creando carpeta:', error);
        return NextResponse.json(
            { error: 'No fue posible crear la carpeta.' },
            { status: 502 }
        );
    }
}
