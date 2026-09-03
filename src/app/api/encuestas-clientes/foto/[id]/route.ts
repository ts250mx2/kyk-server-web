import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { esOficina, portalQuery } from '@/lib/portal-db';

export const dynamic = 'force-dynamic';

// Foto del cliente capturada por la tienda al levantar la encuesta (solo
// oficina, desde el historial). Vive en base como JPEG en base64.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    if (!(await esOficina(session.codigobarras))) {
        return NextResponse.json({ error: 'Solo oficina puede ver las fotos' }, { status: 403 });
    }

    const { id } = await params;
    const idRespuesta = Number(id);
    if (!Number.isInteger(idRespuesta) || idRespuesta <= 0) {
        return NextResponse.json({ error: 'Respuesta inválida' }, { status: 400 });
    }

    try {
        const filas = (await portalQuery(
            'SELECT FotoCliente FROM encuestas_clientes_captura WHERE IdRespuesta = ? LIMIT 1',
            [idRespuesta]
        )) as { FotoCliente?: string | null }[];
        const base64 = filas[0]?.FotoCliente;
        if (!base64) return NextResponse.json({ error: 'Sin foto' }, { status: 404 });
        return new Response(new Uint8Array(Buffer.from(base64, 'base64')), {
            headers: {
                'Content-Type': 'image/jpeg',
                'X-Content-Type-Options': 'nosniff',
                'Cache-Control': 'private, max-age=86400',
            },
        });
    } catch (error) {
        console.error(`Error sirviendo foto de la respuesta ${idRespuesta}:`, error);
        return NextResponse.json({ error: 'Sin foto' }, { status: 404 });
    }
}
