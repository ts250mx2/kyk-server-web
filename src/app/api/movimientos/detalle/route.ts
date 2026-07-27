import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { tiendaQuery } from '@/lib/tienda-db';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

// Detalle de un movimiento de inventario: encabezado + partidas de
// tblDetalleMovimientos2 (importe = Mov × Costo).
export async function GET(request: Request) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const idMovimiento = num(searchParams.get('idMovimiento'));
    const idTienda = num(searchParams.get('idTienda'));
    if (idMovimiento <= 0 || idTienda <= 0) {
        return NextResponse.json({ error: 'Movimiento inválido' }, { status: 400 });
    }

    try {
        const [encabezados, partidasRows] = await Promise.all([
            tiendaQuery(session.idTienda, `
                SELECT M.*, U.Usuario, P.Proveedor
                FROM tblMovimientos2 M
                LEFT JOIN tblUsuarios U ON U.IdUsuario = M.IdUsuarioMovimiento
                LEFT JOIN tblProveedores P ON P.IdProveedor = M.IdProveedor
                WHERE M.IdMovimiento = ? AND M.IdTienda = ?
            `, [idMovimiento, idTienda]) as Promise<Row[]>,
            tiendaQuery(session.idTienda, `
                SELECT D.CodigoInterno, D.Mov, D.Costo, D.IVA,
                       A.CodigoBarras, A.Descripcion, A.IdTipo, A.MedidaCompra
                FROM tblDetalleMovimientos2 D
                LEFT JOIN tblArticulos A ON A.CodigoInterno = D.CodigoInterno
                WHERE D.IdMovimiento = ? AND D.IdTienda = ?
                ORDER BY A.Descripcion
            `, [idMovimiento, idTienda]) as Promise<Row[]>,
        ]);

        const enc = encabezados[0];
        if (!enc) {
            return NextResponse.json({ error: 'Movimiento no encontrado' }, { status: 404 });
        }

        let monto = 0;
        const partidas = partidasRows.map(p => {
            const mov = num(p.Mov);
            const costo = num(p.Costo);
            const importe = mov * costo;
            monto += importe;
            return {
                codigoInterno: num(p.CodigoInterno),
                codigoBarras: str(p.CodigoBarras),
                descripcion: str(p.Descripcion) || `(código ${num(p.CodigoInterno)})`,
                medida: num(p.IdTipo) === 2 ? 'Kg' : str(p.MedidaCompra) || 'Pzs',
                mov,
                costo,
                iva: num(p.IVA),
                importe,
            };
        });

        return NextResponse.json({
            movimiento: {
                idMovimiento,
                folio: str(enc.FolioMovimiento),
                concepto: str(enc.Movimiento),
                fecha: enc.FechaMovimiento,
                tipo: num(enc.TipoMovimiento) === 0 ? 'ENTRADA' : 'SALIDA',
                usuario: str(enc.Usuario) || '—',
                proveedor: num(enc.IdProveedor) > 0 ? str(enc.Proveedor) : '',
                cancelado: num(enc.Status) !== 0,
                monto,
            },
            partidas,
        });
    } catch (error) {
        console.error(`Error en detalle de movimiento ${idMovimiento} (tienda ${session.idTienda}):`, error);
        return NextResponse.json(
            { error: 'No fue posible consultar el detalle del movimiento.' },
            { status: 502 }
        );
    }
}
