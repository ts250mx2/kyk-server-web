import { NextResponse } from 'next/server';
import { getTiendasReportes } from '@/lib/tiendas';

export const dynamic = 'force-dynamic';

// Lista de tiendas para el drilldown del login. Solo expone id y nombre;
// las credenciales MySQL de cada tienda se quedan del lado del servidor.
export async function GET() {
    try {
        const tiendas = await getTiendasReportes();
        return NextResponse.json({
            tiendas: tiendas.map(t => ({
                IdTienda: t.IdTienda,
                Tienda: t.Tienda,
                Abr: t.Abr,
            })),
        });
    } catch (error) {
        console.error('Error obteniendo tiendas:', error);
        return NextResponse.json(
            { error: 'No fue posible obtener el catálogo de tiendas' },
            { status: 500 }
        );
    }
}
