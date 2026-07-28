import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { tiendaQuery } from '@/lib/tienda-db';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

// Proveedores con artículos surtidos a la tienda, para el combo de Inventarios.
// Misma consulta que ObtenerProveedoresJSON del servicio Java (KYKInventariosWeb),
// pero directa al MySQL de la tienda: incluye los DiasPedido por tienda
// (tblProveedoresTiendasDias) con respaldo al DiasPedido general del proveedor.
export async function GET() {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    try {
        const rows = (await tiendaQuery(session.idTienda, `
            SELECT DISTINCT A.IdProveedor, A.Proveedor,
                   CASE WHEN D.DiasPedido IS NULL THEN A.DiasPedido ELSE D.DiasPedido END AS DiasPedido
            FROM tblProveedores A
            INNER JOIN tblArticulosProveedor B ON A.IdProveedor = B.IdProveedor
            INNER JOIN tblArticulos C ON B.CodigoInterno = C.CodigoInterno
            LEFT JOIN tblProveedoresTiendasDias D
                   ON A.IdProveedor = D.IdProveedor AND D.IdTienda = ?
            ORDER BY A.Proveedor
        `, [session.idTienda])) as Row[];

        const proveedores = rows.map(r => ({
            idProveedor: Number(r.IdProveedor),
            proveedor: String(r.Proveedor ?? '').trim(),
            diasPedido: Number(r.DiasPedido) || 0,
        }));

        return NextResponse.json({ proveedores });
    } catch (error) {
        console.error('Error al consultar proveedores de inventarios:', error);
        return NextResponse.json(
            { error: 'Error al consultar los proveedores de la tienda' },
            { status: 500 }
        );
    }
}
