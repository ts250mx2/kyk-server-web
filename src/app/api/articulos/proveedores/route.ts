import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { tiendaQuery } from '@/lib/tienda-db';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

// Catálogo de proveedores con artículos, para el filtro por proveedor
// (equivalente a la búsqueda por proveedor de frmCatArticulosServer).
export async function GET() {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    try {
        const rows = await tiendaQuery(session.idTienda, `
            SELECT P.IdProveedor, P.Proveedor
            FROM tblProveedores P
            WHERE P.IdProveedor IN (SELECT DISTINCT IdProveedor FROM tblArticulosProveedor)
            ORDER BY P.Proveedor
        `) as Row[];

        return NextResponse.json({
            proveedores: rows.map(r => ({
                idProveedor: Number(r.IdProveedor),
                proveedor: r.Proveedor ?? '',
            })),
        });
    } catch (error) {
        console.error(`Error listando proveedores (tienda ${session.idTienda}):`, error);
        return NextResponse.json(
            { error: 'No fue posible consultar los proveedores de la tienda.' },
            { status: 502 }
        );
    }
}
