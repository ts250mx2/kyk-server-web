import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { portalQuery } from '@/lib/portal-db';
import { puedeVerCanal } from '@/lib/chat';
import { leerArchivo } from '@/lib/documentos-fs';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

const MIME_POR_EXTENSION: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
};

// Sirve una foto del chat validando que el mensaje pertenezca a un canal
// que la sesión puede ver.
export async function GET(
    _request: Request,
    { params }: { params: Promise<{ archivo: string }> }
) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { archivo } = await params;
    if (!archivo || archivo.includes('/') || archivo.includes('..')) {
        return NextResponse.json({ error: 'Archivo inválido' }, { status: 400 });
    }

    try {
        const rows = await portalQuery(
            `SELECT Canal FROM chat_mensajes WHERE Imagen = ? LIMIT 1`,
            [archivo]
        ) as Row[];

        const canal = rows[0]?.Canal ? String(rows[0].Canal) : '';
        if (!canal || !(await puedeVerCanal(canal, session))) {
            return NextResponse.json({ error: 'Imagen no disponible' }, { status: 403 });
        }

        const contenido = await leerArchivo(archivo, 'chat');
        const extension = archivo.split('.').pop()?.toLowerCase() ?? '';

        return new NextResponse(new Uint8Array(contenido), {
            headers: {
                'Content-Type': MIME_POR_EXTENSION[extension] ?? 'application/octet-stream',
                'Cache-Control': 'private, max-age=3600',
            },
        });
    } catch (error) {
        console.error(`Error sirviendo imagen del chat ${archivo}:`, error);
        return NextResponse.json({ error: 'Imagen no encontrada' }, { status: 404 });
    }
}
