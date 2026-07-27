import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { tiendaQuery } from '@/lib/tienda-db';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

// Ticket de corte de una apertura (texto tal como lo imprimió el POS,
// guardado en tblAperturasCierres.TicketCorte — igual que kyk-dashboard).
export async function GET(request: Request) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const idApertura = num(searchParams.get('idApertura'));
    const caja = num(searchParams.get('caja'));
    if (idApertura <= 0 || caja <= 0) {
        return NextResponse.json({ error: 'Apertura inválida' }, { status: 400 });
    }

    try {
        const rows = await tiendaQuery(session.idTienda, `
            SELECT TicketCorte
            FROM tblAperturasCierres
            WHERE IdComputadora = ? AND IdApertura = ?
        `, [caja, idApertura]) as Row[];

        const ticket = rows[0]?.TicketCorte
            ? String(rows[0].TicketCorte)
            : 'TICKET DE CORTE NO DISPONIBLE';

        return NextResponse.json({ ticket });
    } catch (error) {
        console.error(`Error en ticket de corte (tienda ${session.idTienda}):`, error);
        return NextResponse.json(
            { error: 'No fue posible obtener el ticket de corte.' },
            { status: 502 }
        );
    }
}
