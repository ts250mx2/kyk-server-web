import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { esOficina } from '@/lib/portal-db';
import { sugerenciasPorDescripcion } from '@/lib/imagenes-productos';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Candidatas de imagen por DESCRIPCIÓN (búsqueda de texto en Open Food Facts),
// para cuando el código de barras no arrojó nada. Solo oficina, y la elección
// siempre es humana: por texto puede salir un producto parecido pero ajeno.
export async function GET(request: Request) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    if (!(await esOficina(session.codigobarras))) {
        return NextResponse.json({ error: 'Solo oficina puede buscar sugerencias' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const busqueda = (searchParams.get('busqueda') ?? '').trim();
    if (!busqueda) {
        return NextResponse.json({ error: 'Búsqueda vacía' }, { status: 400 });
    }

    try {
        const sugerencias = await sugerenciasPorDescripcion(busqueda);
        return NextResponse.json({ sugerencias });
    } catch (error) {
        console.error('Error buscando sugerencias de imagen:', error);
        return NextResponse.json(
            { error: 'No fue posible consultar Open Food Facts, intenta de nuevo.' },
            { status: 502 }
        );
    }
}
