import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { tiendaQuery } from '@/lib/tienda-db';
import type { MysqlParam } from '@/lib/mysql';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

const LIMITE = 2000;
const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/;

// Devoluciones de compra (frmProcDevolucionesCompra): lista de mercancía a devolver
// al proveedor. No hay tabla de encabezado — las partidas pendientes viven en
// tblDetalleDevolucionesCompra (se vacía al procesarse) y el histórico en
// tblDetalleDevolucionesCompraHistorial. El importe se estima con el costo del
// proveedor (tblArticulosProveedor.Costo; respaldo: UltimoCosto del artículo).
export async function GET(request: Request) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const tipo = searchParams.get('tipo') === 'historial' ? 'historial' : 'pendientes';
    const hoy = new Date().toLocaleDateString('sv-SE');
    const fechaInicio = ES_FECHA.test(searchParams.get('fechaInicio') ?? '') ? searchParams.get('fechaInicio')! : hoy;
    const fechaFin = ES_FECHA.test(searchParams.get('fechaFin') ?? '') ? searchParams.get('fechaFin')! : hoy;
    const busqueda = (searchParams.get('busqueda') ?? '').trim().toLowerCase();

    try {
        let rows: Row[];
        if (tipo === 'pendientes') {
            rows = await tiendaQuery(session.idTienda, `
                SELECT D.IdProveedor, D.CodigoInterno, D.Dev, D.FechaAct,
                       P.Proveedor, A.CodigoBarras, A.Descripcion, A.IdTipo, A.UltimoCosto,
                       U.Usuario, AP.Costo AS CostoProveedor
                FROM tblDetalleDevolucionesCompra D
                LEFT JOIN tblProveedores P ON P.IdProveedor = D.IdProveedor
                LEFT JOIN tblArticulos A ON A.CodigoInterno = D.CodigoInterno
                LEFT JOIN tblArticulosProveedor AP
                    ON AP.CodigoInterno = D.CodigoInterno AND AP.IdProveedor = D.IdProveedor
                LEFT JOIN tblUsuarios U ON U.IdUsuario = D.IdUsuarioDevolucionCompra
                ORDER BY P.Proveedor, A.Descripcion
                LIMIT ${LIMITE}
            `) as Row[];
        } else {
            const params: MysqlParam[] = [fechaInicio, fechaFin];
            rows = await tiendaQuery(session.idTienda, `
                SELECT D.IdProveedor, D.CodigoInterno, D.Dev, D.FechaAct,
                       P.Proveedor, A.CodigoBarras, A.Descripcion, A.IdTipo, A.UltimoCosto,
                       U.Usuario, AP.Costo AS CostoProveedor
                FROM tblDetalleDevolucionesCompraHistorial D
                LEFT JOIN tblProveedores P ON P.IdProveedor = D.IdProveedor
                LEFT JOIN tblArticulos A ON A.CodigoInterno = D.CodigoInterno
                LEFT JOIN tblArticulosProveedor AP
                    ON AP.CodigoInterno = D.CodigoInterno AND AP.IdProveedor = D.IdProveedor
                LEFT JOIN tblUsuarios U ON U.IdUsuario = D.IdUsuarioDevolucionCompra
                WHERE D.FechaAct >= ? AND D.FechaAct < ? + INTERVAL 1 DAY
                ORDER BY D.FechaAct DESC
                LIMIT ${LIMITE}
            `, params) as Row[];
        }

        let partidas = rows.map(r => {
            const dev = num(r.Dev);
            const costo = num(r.CostoProveedor) > 0 ? num(r.CostoProveedor) : num(r.UltimoCosto);
            return {
                idProveedor: num(r.IdProveedor),
                proveedor: str(r.Proveedor) || `Proveedor ${num(r.IdProveedor)}`,
                codigoBarras: str(r.CodigoBarras),
                descripcion: str(r.Descripcion) || `(código ${num(r.CodigoInterno)})`,
                unidad: num(r.IdTipo) === 2 ? 'Kg' : 'Pzs',
                cantidad: dev,
                costo,
                importe: dev * costo,
                usuario: str(r.Usuario) || '—',
                fecha: r.FechaAct ?? null,
            };
        });

        if (busqueda) {
            partidas = partidas.filter(p =>
                `${p.proveedor} ${p.codigoBarras} ${p.descripcion} ${p.usuario}`.toLowerCase().includes(busqueda)
            );
        }

        const proveedores = new Set(partidas.map(p => p.idProveedor));

        return NextResponse.json({
            tipo,
            fechaInicio,
            fechaFin,
            total: partidas.length,
            truncado: rows.length === LIMITE,
            resumen: {
                partidas: partidas.length,
                proveedores: proveedores.size,
                monto: partidas.reduce((acc, p) => acc + p.importe, 0),
            },
            partidas,
        });
    } catch (error) {
        console.error(`Error listando devoluciones de compra (tienda ${session.idTienda}):`, error);
        return NextResponse.json(
            { error: 'No fue posible consultar las devoluciones de compra de la tienda.' },
            { status: 502 }
        );
    }
}
