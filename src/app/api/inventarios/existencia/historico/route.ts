import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { mysqlQuery } from '@/lib/mysql';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;
const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

// Histórico diario de existencia de un artículo, del corte nocturno consolidado
// en el MySQL central (tblInventariosCostos de KYKInvServices). Alimenta la
// gráfica de la pantalla de Existencias: ahí se ven los quiebres recurrentes.
export async function GET(request: Request) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const codigoInterno = Number(searchParams.get('codigoInterno'));
    const dias = Math.min(Math.max(num(searchParams.get('dias')) || 90, 7), 365);
    if (!Number.isInteger(codigoInterno) || codigoInterno <= 0) {
        return NextResponse.json({ error: 'Artículo inválido' }, { status: 400 });
    }

    try {
        const rows = (await mysqlQuery(`
            SELECT Fecha, Exi, PVD FROM tblInventariosCostos
            WHERE IdTienda = ? AND CodigoInterno = ?
              AND Fecha >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
            ORDER BY Fecha
        `, [session.idTienda, codigoInterno, dias])) as Row[];

        return NextResponse.json({
            dias,
            historico: (rows ?? []).map(r => ({
                fecha: String(r.Fecha ?? '').slice(0, 10),
                exi: num(r.Exi),
                pvd: num(r.PVD),
            })),
        });
    } catch (error) {
        console.error('Error al consultar histórico de existencia:', error);
        return NextResponse.json(
            { error: 'Error al consultar el histórico del artículo' },
            { status: 500 }
        );
    }
}
