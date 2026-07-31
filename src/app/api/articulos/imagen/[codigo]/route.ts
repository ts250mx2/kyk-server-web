import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { esOficina } from '@/lib/portal-db';
import {
    codigoImagenValido, descargarImagenExterna, eliminarImagenProducto,
    guardarImagenProducto, obtenerImagenProducto,
} from '@/lib/imagenes-productos';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_SUBIDA = 3 * 1024 * 1024;

// GET: imagen del producto (caché en base → Open Food Facts perezoso → 404).
// La usan las miniaturas de los agentes y el detalle de Precios.
export async function GET(
    _request: Request,
    { params }: { params: Promise<{ codigo: string }> }
) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    const { codigo } = await params;
    if (!codigoImagenValido(codigo)) {
        return NextResponse.json({ error: 'Código inválido' }, { status: 400 });
    }

    try {
        const imagen = await obtenerImagenProducto(codigo);
        if (!imagen) {
            return NextResponse.json({ error: 'Sin imagen' }, { status: 404 });
        }
        return new Response(new Uint8Array(imagen.datos), {
            headers: {
                'Content-Type': imagen.tipoMime,
                // La UI rompe el caché con ?v= al reemplazar la imagen
                'Cache-Control': 'private, max-age=86400',
            },
        });
    } catch (error) {
        console.error(`Error sirviendo imagen de ${codigo}:`, error);
        return NextResponse.json({ error: 'Sin imagen' }, { status: 404 });
    }
}

// POST (oficina): asigna la imagen del producto — archivo subido (multipart,
// campo "imagen") o una URL de sugerencia de Open Food Facts (JSON {url}).
export async function POST(
    request: Request,
    { params }: { params: Promise<{ codigo: string }> }
) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    if (!(await esOficina(session.codigobarras))) {
        return NextResponse.json({ error: 'Solo oficina puede cambiar imágenes' }, { status: 403 });
    }
    const { codigo } = await params;
    if (!codigoImagenValido(codigo)) {
        return NextResponse.json({ error: 'Código inválido' }, { status: 400 });
    }

    try {
        const tipoContenido = request.headers.get('content-type') ?? '';

        if (tipoContenido.includes('multipart/form-data')) {
            const form = await request.formData();
            const archivo = form.get('imagen');
            if (!(archivo instanceof File) || archivo.size === 0) {
                return NextResponse.json({ error: 'Imagen requerida' }, { status: 400 });
            }
            if (!archivo.type.startsWith('image/')) {
                return NextResponse.json({ error: 'El archivo debe ser una imagen' }, { status: 400 });
            }
            if (archivo.size > MAX_SUBIDA) {
                return NextResponse.json({ error: 'La imagen excede el límite de 3 MB' }, { status: 400 });
            }
            const base64 = Buffer.from(await archivo.arrayBuffer()).toString('base64');
            await guardarImagenProducto(codigo, archivo.type, base64, 'manual');
            return NextResponse.json({ success: true });
        }

        const cuerpo = await request.json().catch(() => ({}));
        const url = String(cuerpo?.url ?? '');
        const imagen = await descargarImagenExterna(url);
        if (!imagen) {
            return NextResponse.json(
                { error: 'La imagen sugerida no está disponible (solo se aceptan imágenes de Open Food Facts)' },
                { status: 400 }
            );
        }
        await guardarImagenProducto(codigo, imagen.tipoMime, imagen.base64, 'off');
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error(`Error guardando imagen de ${codigo}:`, error);
        return NextResponse.json({ error: 'No fue posible guardar la imagen.' }, { status: 502 });
    }
}

// DELETE (oficina): quita la imagen (la próxima consulta vuelve a intentar
// resolverla por código de barras en Open Food Facts).
export async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ codigo: string }> }
) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    if (!(await esOficina(session.codigobarras))) {
        return NextResponse.json({ error: 'Solo oficina puede quitar imágenes' }, { status: 403 });
    }
    const { codigo } = await params;
    if (!codigoImagenValido(codigo)) {
        return NextResponse.json({ error: 'Código inválido' }, { status: 400 });
    }

    try {
        await eliminarImagenProducto(codigo);
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error(`Error quitando imagen de ${codigo}:`, error);
        return NextResponse.json({ error: 'No fue posible quitar la imagen.' }, { status: 502 });
    }
}
