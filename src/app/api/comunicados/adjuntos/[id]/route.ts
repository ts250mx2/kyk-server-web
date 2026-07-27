import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { portalQuery, esOficina } from '@/lib/portal-db';
import { leerArchivo } from '@/lib/documentos-fs';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

// Descarga de un adjunto de comunicado, validando que el comunicado sea visible
// para la tienda de la sesión.
export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { id } = await params;
    const idAdjunto = Number(id);
    if (!Number.isInteger(idAdjunto) || idAdjunto <= 0) {
        return NextResponse.json({ error: 'Adjunto inválido' }, { status: 400 });
    }

    try {
        const rows = await portalQuery(`
            SELECT A.Nombre, A.Archivo, A.TipoMime, C.IdComunicado, C.TodasTiendas, C.Status
            FROM comunicados_adjuntos A
            INNER JOIN comunicados C ON C.IdComunicado = A.IdComunicado
            WHERE A.IdAdjunto = ?
        `, [idAdjunto]) as Row[];

        const adj = rows[0];
        if (!adj || num(adj.Status) !== 0) {
            return NextResponse.json({ error: 'Adjunto no encontrado' }, { status: 404 });
        }

        if (num(adj.TodasTiendas) !== 1 && !(await esOficina(session.codigobarras))) {
            const destino = await portalQuery(`
                SELECT 1 FROM comunicados_tiendas WHERE IdComunicado = ? AND IdTienda = ?
            `, [num(adj.IdComunicado), session.idTienda]) as Row[];
            if (destino.length === 0) {
                return NextResponse.json({ error: 'Adjunto no disponible para tu tienda' }, { status: 403 });
            }
        }

        const contenido = await leerArchivo(str(adj.Archivo), 'comunicados');
        const nombre = str(adj.Nombre) || `adjunto_${idAdjunto}`;

        return new NextResponse(new Uint8Array(contenido), {
            headers: {
                'Content-Type': str(adj.TipoMime) || 'application/octet-stream',
                'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(nombre)}`,
                'Content-Length': String(contenido.length),
            },
        });
    } catch (error) {
        console.error(`Error descargando adjunto ${idAdjunto}:`, error);
        return NextResponse.json(
            { error: 'No fue posible descargar el adjunto.' },
            { status: 502 }
        );
    }
}
