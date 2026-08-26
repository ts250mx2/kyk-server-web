import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { calcularExistencia } from '@/lib/existencias';
import { getTiendasReportes } from '@/lib/tiendas';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Cada tienda vive en su propio MySQL y algunas cuelgan de un enlace lento:
// se consultan en paralelo y con tope individual para que una caída no
// arrastre a las demás.
const TIMEOUT_POR_TIENDA_MS = 20000;

type MotivoSinCifra = 'sin-conexion' | 'no-catalogo' | null;

interface ExistenciaEnTienda {
    idTienda: number;
    tienda: string;
    existencia: number | null;
    diasCobertura: number | null;
    medidaVenta: string;
    precio: number | null;
    /** Texto para el usuario cuando no hay cifra (sin conexión, no existe ahí...). */
    nota: string | null;
    /** Motivo tipado: la UI decide por él, no por el texto de `nota`. */
    motivo: MotivoSinCifra;
}

function conTimeout<T>(promesa: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
        promesa,
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Tiempo agotado')), ms)
        ),
    ]);
}

/**
 * Existencia de UN artículo en TODAS las tiendas. Reusa el mismo cálculo que
 * la pantalla de inventarios y el bot del chat (corte nocturno + movimientos
 * del día + kits), solo que repetido por tienda.
 */
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
        const tiendas = await getTiendasReportes();

        const resultados: ExistenciaEnTienda[] = await Promise.all(
            tiendas.map(async (t): Promise<ExistenciaEnTienda> => {
                const base = {
                    idTienda: t.IdTienda,
                    tienda: t.Tienda,
                    existencia: null,
                    diasCobertura: null,
                    medidaVenta: '',
                    precio: null,
                };
                try {
                    const r = await conTimeout(
                        calcularExistencia(t.IdTienda, codigoInterno),
                        TIMEOUT_POR_TIENDA_MS
                    );
                    if (!r) return { ...base, nota: 'No está en el catálogo', motivo: 'no-catalogo' };
                    return {
                        idTienda: t.IdTienda,
                        tienda: t.Tienda,
                        existencia: r.existencia,
                        diasCobertura: r.diasCobertura,
                        medidaVenta: r.articulo.medidaVenta,
                        precio: r.articulo.precio,
                        nota: null,
                        motivo: null,
                    };
                } catch (e) {
                    console.warn(`Existencia de ${codigoInterno} en ${t.Tienda}:`, e);
                    return { ...base, nota: 'Sin conexión con la tienda', motivo: 'sin-conexion' };
                }
            })
        );

        // La tienda de la sesión primero; el resto por nombre.
        resultados.sort((a, b) => {
            if (a.idTienda === session.idTienda) return -1;
            if (b.idTienda === session.idTienda) return 1;
            return a.tienda.localeCompare(b.tienda, 'es');
        });

        return NextResponse.json({ codigoInterno, idTiendaSesion: session.idTienda, tiendas: resultados });
    } catch (error) {
        console.error('Error al calcular existencias por tienda:', error);
        return NextResponse.json(
            { error: 'No fue posible consultar las existencias por tienda.' },
            { status: 502 }
        );
    }
}
