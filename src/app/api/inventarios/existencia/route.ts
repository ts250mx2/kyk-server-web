import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { calcularExistencia } from '@/lib/existencias';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Existencia de UN artículo en la tienda de la sesión. El cálculo completo
// (corte nocturno + movimientos del día + kits) vive en src/lib/existencias.ts,
// compartido con el bot de existencias del chat.
export async function GET(request: Request) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const codigoInterno = Number(searchParams.get('codigoInterno'));
    if (!Number.isInteger(codigoInterno) || codigoInterno <= 0) {
        return NextResponse.json({ error: 'Artículo inválido' }, { status: 400 });
    }

    try {
        const resultado = await calcularExistencia(session.idTienda, codigoInterno);
        if (!resultado) {
            return NextResponse.json({ error: 'Artículo no encontrado en la tienda' }, { status: 404 });
        }
        return NextResponse.json(resultado);
    } catch (error) {
        console.error('Error al calcular existencia:', error);
        return NextResponse.json(
            { error: 'Error al calcular la existencia del artículo' },
            { status: 500 }
        );
    }
}
