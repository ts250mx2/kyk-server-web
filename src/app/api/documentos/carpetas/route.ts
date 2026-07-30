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
        const { nombre, idPadre } = await request.json();
        if (!nombre?.trim()) {
            return NextResponse.json({ error: 'Nombre de carpeta requerido' }, { status: 400 });
        }
        const padre = Number(idPadre) || 0;
        if (padre > 0) {
            const existe = (await portalQuery(
                'SELECT IdCarpeta FROM documentos_carpetas WHERE IdCarpeta = ? AND Status = 0 LIMIT 1',
                [padre]
            )) as { IdCarpeta: unknown }[];
            if (!existe || existe.length === 0) {
                return NextResponse.json({ error: 'La carpeta padre no existe' }, { status: 400 });
            }
        }

        const resultado = await portalQuery(`
            INSERT INTO documentos_carpetas (Nombre, IdCarpetaPadre, Status, FechaAlta) VALUES (?, ?, 0, NOW())
        `, [String(nombre).trim().slice(0, 100), padre]) as unknown as { insertId: number };

        return NextResponse.json({ success: true, idCarpeta: resultado.insertId });
    } catch (error) {
        console.error('Error creando carpeta:', error);
        return NextResponse.json(
            { error: 'No fue posible crear la carpeta.' },
            { status: 502 }
        );
    }
}

// Eliminar carpeta (solo oficina): retiro suave y únicamente si está vacía —
// si tiene documentos activos se rechaza para no dejar archivos huérfanos.
export async function DELETE(request: Request) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    if (!(await esOficina(session.codigobarras))) {
        return NextResponse.json({ error: 'Solo el rol oficina puede eliminar carpetas' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const idCarpeta = Number(searchParams.get('idCarpeta'));
    if (!Number.isInteger(idCarpeta) || idCarpeta <= 0) {
        return NextResponse.json({ error: 'Carpeta inválida' }, { status: 400 });
    }

    try {
        const [docs, subcarpetas] = await Promise.all([
            portalQuery(
                'SELECT COUNT(*) AS N FROM documentos WHERE IdCarpeta = ? AND Status = 0',
                [idCarpeta]
            ) as Promise<{ N: unknown }[]>,
            portalQuery(
                'SELECT COUNT(*) AS N FROM documentos_carpetas WHERE IdCarpetaPadre = ? AND Status = 0',
                [idCarpeta]
            ) as Promise<{ N: unknown }[]>,
        ]);
        const n = Number(docs?.[0]?.N ?? 0);
        if (n > 0) {
            return NextResponse.json(
                { error: `La carpeta tiene ${n} documento${n > 1 ? 's' : ''} — retíralos o muévelos antes de eliminarla` },
                { status: 409 }
            );
        }
        const nSub = Number(subcarpetas?.[0]?.N ?? 0);
        if (nSub > 0) {
            return NextResponse.json(
                { error: `La carpeta tiene ${nSub} subcarpeta${nSub > 1 ? 's' : ''} — elimínalas primero` },
                { status: 409 }
            );
        }

        await portalQuery('UPDATE documentos_carpetas SET Status = 1 WHERE IdCarpeta = ?', [idCarpeta]);
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error eliminando carpeta:', error);
        return NextResponse.json(
            { error: 'No fue posible eliminar la carpeta.' },
            { status: 502 }
        );
    }
}
