import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { consultarInventariosWs, ServicioInventariosError, wsNumero, wsTexto } from '@/lib/inventarios-ws';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const TIMEOUT_MOV_MS = 120_000;

// Movimientos de un artículo del inventario recién calculado (method=mov del
// servicio Java): lee el buffer de la consulta previa, por eso requiere el
// idComputadora que regresó /api/inventarios.
export async function GET(request: Request) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const codigoInterno = Number(searchParams.get('codigoInterno'));
    const idComputadora = Number(searchParams.get('idComputadora'));
    if (!Number.isInteger(codigoInterno) || codigoInterno <= 0) {
        return NextResponse.json({ error: 'Artículo inválido' }, { status: 400 });
    }
    if (!Number.isInteger(idComputadora) || idComputadora < 0) {
        return NextResponse.json({ error: 'Consulta de inventario inválida' }, { status: 400 });
    }

    try {
        const json = await consultarInventariosWs(session.idTienda, {
            method: 'mov',
            IdTienda: session.idTienda,
            IdComputadora: idComputadora,
            CodigoInterno: codigoInterno,
        }, TIMEOUT_MOV_MS);

        const filas = Array.isArray(json.Movimientos) ? json.Movimientos : [];
        const movimientos = filas.map((r: Record<string, unknown>) => {
            const usuario = wsTexto(r.Usuario);
            return {
                // El servicio manda timestamps SQL crudos ("2026-07-27 08:15:00.0")
                fecha: wsTexto(r.Fecha).split('.')[0],
                codigoBarras: wsTexto(r.CodigoBarras),
                descripcion: wsTexto(r.Descripcion),
                concepto: wsTexto(r.Concepto),
                usuario: usuario === 'null' ? '' : usuario,
                mov: wsNumero(r.Mov),
                equiv: wsNumero(r.Equiv),
                medidaVenta: wsTexto(r.MedidaVenta),
            };
        });

        return NextResponse.json({ movimientos });
    } catch (error) {
        if (error instanceof ServicioInventariosError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error('Error al consultar movimientos de inventario:', error);
        return NextResponse.json(
            { error: 'Error al consultar los movimientos del artículo' },
            { status: 502 }
        );
    }
}
