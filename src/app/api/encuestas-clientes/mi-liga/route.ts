import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { asegurarQrTienda } from '@/lib/encuestas-clientes';

export const dynamic = 'force-dynamic';

// Liga de la encuesta de la sucursal en sesión (cualquier usuario logueado):
// el encabezado del panel la muestra para levantar encuestas con el cliente
// enfrente sin tener que buscar el QR.
export async function GET() {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    try {
        const qr = await asegurarQrTienda(session.idTienda, session.tienda);
        return NextResponse.json({ idTienda: session.idTienda, tienda: session.tienda, uuid: qr.uuid, activa: qr.activa });
    } catch (error) {
        console.error('Error obteniendo la liga de encuesta de la tienda:', error);
        return NextResponse.json({ error: 'No fue posible obtener la liga' }, { status: 502 });
    }
}
