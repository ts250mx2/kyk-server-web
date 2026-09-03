import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { resolverUuidTienda } from '@/lib/encuestas-clientes';
import { parseTotal } from '@/lib/encuestas-ticket';
import { ErrorTicket, validarTicket } from '@/lib/encuestas-ticket-db';
import { crearLimitador, leerJsonLimitado } from '@/lib/limites-peticion';

export const dynamic = 'force-dynamic';

// Valida el ticket que la tienda captura al levantar la encuesta con el
// cliente: requiere sesión de la MISMA sucursal que la liga (los datos de
// venta nunca se exponen al público). Regresa fecha, total, detalle y avisos.
// Cada consulta toca el MySQL del punto de venta: cuota por usuario.
const MAX_VALIDACIONES_POR_MINUTO = 30;
const MAX_CUERPO_BYTES = 4 * 1024;
const limite = crearLimitador(MAX_VALIDACIONES_POR_MINUTO, 60_000);

export async function POST(request: Request, { params }: { params: Promise<{ uuid: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Inicia sesión en la tienda para validar tickets' }, { status: 401 });

    const { uuid } = await params;
    const tienda = await resolverUuidTienda(uuid);
    if (!tienda) return NextResponse.json({ error: 'Esta encuesta no está disponible' }, { status: 404 });
    if (tienda.idTienda !== session.idTienda) {
        return NextResponse.json({ error: `La sesión es de ${session.tienda}; esta encuesta es de ${tienda.tienda}` }, { status: 403 });
    }
    if (limite.excede(session.codigobarras)) {
        return NextResponse.json({ error: 'Demasiadas validaciones seguidas; espera un momento.' }, { status: 429 });
    }

    const lectura = await leerJsonLimitado(request, MAX_CUERPO_BYTES);
    if (!lectura.ok) return NextResponse.json({ error: lectura.error }, { status: lectura.status });

    try {
        const ticket = await validarTicket(session, lectura.cuerpo.numeroTicket, parseTotal(lectura.cuerpo.total));
        return NextResponse.json({ ticket });
    } catch (error) {
        if (error instanceof ErrorTicket) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error(`Error validando ticket en tienda ${session.idTienda}:`, error);
        return NextResponse.json({ error: 'No fue posible consultar el ticket en la tienda' }, { status: 502 });
    }
}
