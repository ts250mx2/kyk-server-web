import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { tiendaQuery } from '@/lib/tienda-db';
import type { MysqlParam } from '@/lib/mysql';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

const PAGE_SIZE_DEFAULT = 50;
// Tope alto para permitir exportar a PDF/Excel el resultado completo del filtro.
const PAGE_SIZE_MAX = 20000;

// Listado del catálogo de artículos (equivalente al grid de frmCatArticulosServer).
// Filtros: busqueda (Descripcion/CodigoBarras LIKE), codigoBarras (exacto),
// idProveedor (artículos del proveedor) y cambiosDesde (FechaAct >= fecha).
export async function GET(request: Request) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const busqueda = (searchParams.get('busqueda') ?? '').trim();
    const codigoBarras = (searchParams.get('codigoBarras') ?? '').trim();
    const idProveedor = num(searchParams.get('idProveedor'));
    const cambiosDesde = (searchParams.get('cambiosDesde') ?? '').trim();
    // Status = 2 en tblArticulos significa producto eliminado.
    const estado = searchParams.get('estado') ?? 'activos'; // activos | eliminados | todos
    const page = Math.max(1, num(searchParams.get('page')) || 1);
    const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, num(searchParams.get('pageSize')) || PAGE_SIZE_DEFAULT));

    const where: string[] = [];
    const params: MysqlParam[] = [];

    if (codigoBarras) {
        // El escaneo por código encuentra el artículo aunque esté eliminado (se marca en la UI).
        where.push('CodigoBarras = ?');
        params.push(codigoBarras);
    } else {
        if (estado === 'eliminados') {
            where.push('Status = 2');
        } else if (estado !== 'todos') {
            where.push('Status <> 2');
        }
        if (busqueda) {
            where.push('(Descripcion LIKE ? OR CodigoBarras LIKE ?)');
            params.push(`%${busqueda}%`, `%${busqueda}%`);
        }
        if (idProveedor > 0) {
            where.push('CodigoInterno IN (SELECT CodigoInterno FROM tblArticulosProveedor WHERE IdProveedor = ?)');
            params.push(idProveedor);
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(cambiosDesde)) {
            where.push('FechaAct >= ?');
            params.push(cambiosDesde);
        }
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const offset = (page - 1) * pageSize;

    try {
        const [totalRows, items] = await Promise.all([
            tiendaQuery(session.idTienda, `
                SELECT COUNT(*) AS total FROM tblArticulos ${whereSql}
            `, params) as Promise<Row[]>,
            tiendaQuery(session.idTienda, `
                SELECT CodigoInterno, CodigoBarras, Descripcion, Precio, PrecioOferta, Iva, IdTipo, Status
                FROM tblArticulos
                ${whereSql}
                ORDER BY Descripcion
                LIMIT ${offset}, ${pageSize}
            `, params) as Promise<Row[]>,
        ]);

        return NextResponse.json({
            total: num(totalRows[0]?.total),
            page,
            pageSize,
            items: items.map(r => ({
                codigoInterno: num(r.CodigoInterno),
                codigoBarras: r.CodigoBarras ?? '',
                descripcion: r.Descripcion ?? '',
                precio: num(r.Precio),
                precioOferta: num(r.PrecioOferta),
                idTipo: num(r.IdTipo),
                eliminado: num(r.Status) === 2,
            })),
        });
    } catch (error) {
        console.error(`Error listando artículos (tienda ${session.idTienda}):`, error);
        return NextResponse.json(
            { error: 'No fue posible consultar los artículos de la tienda.' },
            { status: 502 }
        );
    }
}
