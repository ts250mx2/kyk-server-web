import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { portalQuery, esOficina } from '@/lib/portal-db';
import { leerArchivo } from '@/lib/documentos-fs';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

// Descarga o vista previa de un documento con auditoría: valida que la tienda
// tenga acceso, registra el acceso y regresa el archivo. Con ?vista=1 se sirve
// inline para que el navegador lo muestre (PDF, imágenes, video, audio, texto).
export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { id } = await params;
    const idDocumento = Number(id);
    if (!Number.isInteger(idDocumento) || idDocumento <= 0) {
        return NextResponse.json({ error: 'Documento inválido' }, { status: 400 });
    }

    try {
        const docs = await portalQuery(`
            SELECT IdDocumento, Nombre, NombreArchivo, Archivo, TipoMime, TodasTiendas, Status
            FROM documentos WHERE IdDocumento = ?
        `, [idDocumento]) as Row[];

        const doc = docs[0];
        if (!doc || num(doc.Status) !== 0) {
            return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });
        }

        // Visibilidad: todas las tiendas, dirigida a la de la sesión, u oficina
        if (num(doc.TodasTiendas) !== 1 && !(await esOficina(session.codigobarras))) {
            const destino = await portalQuery(`
                SELECT 1 FROM documentos_tiendas WHERE IdDocumento = ? AND IdTienda = ?
            `, [idDocumento, session.idTienda]) as Row[];
            if (destino.length === 0) {
                return NextResponse.json({ error: 'Documento no disponible para tu tienda' }, { status: 403 });
            }
        }

        const contenido = await leerArchivo(str(doc.Archivo));

        // Auditoría de descarga (no bloquea la entrega si falla)
        portalQuery(`
            INSERT INTO documentos_descargas (IdDocumento, IdTienda, CodigoBarras, Nombre, FechaDescarga)
            VALUES (?, ?, ?, ?, NOW())
        `, [idDocumento, session.idTienda, session.codigobarras, session.name])
            .catch(err => console.warn('No se registró la descarga:', err));

        const enLinea = new URL(request.url).searchParams.get('vista') === '1';
        const nombreDescarga = str(doc.NombreArchivo) || `documento_${idDocumento}`;
        return new NextResponse(new Uint8Array(contenido), {
            headers: {
                'Content-Type': str(doc.TipoMime) || 'application/octet-stream',
                'Content-Disposition': `${enLinea ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(nombreDescarga)}`,
                'Content-Length': String(contenido.length),
            },
        });
    } catch (error) {
        console.error(`Error descargando documento ${idDocumento}:`, error);
        return NextResponse.json(
            { error: 'No fue posible descargar el documento.' },
            { status: 502 }
        );
    }
}
