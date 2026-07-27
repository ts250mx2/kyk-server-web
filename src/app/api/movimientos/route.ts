import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { tiendaQuery } from '@/lib/tienda-db';
import type { MysqlParam } from '@/lib/mysql';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

const LIMITE = 1000;
const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/;

// Otros movimientos de inventario (ajustes, mermas, consumos internos, cortesías...):
// tblMovimientos2 (encabezado, TipoMovimiento 0 = entrada / 1 = salida) +
// tblDetalleMovimientos2 (partidas). El Total del encabezado suele venir en null,
// así que el monto se calcula del detalle (SUM(Mov × Costo)), igual que transferencias.
export async function GET(request: Request) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const tipo = searchParams.get('tipo') === 'salidas' ? 1 : 0;
    const hoy = new Date().toLocaleDateString('sv-SE');
    const fechaInicio = ES_FECHA.test(searchParams.get('fechaInicio') ?? '') ? searchParams.get('fechaInicio')! : hoy;
    const fechaFin = ES_FECHA.test(searchParams.get('fechaFin') ?? '') ? searchParams.get('fechaFin')! : hoy;
    const busqueda = (searchParams.get('busqueda') ?? '').trim().toLowerCase();

    try {
        const params: MysqlParam[] = [tipo, fechaInicio, fechaFin];
        const movimientos = await tiendaQuery(session.idTienda, `
            SELECT M.IdMovimiento, M.IdTienda, M.Movimiento, M.FolioMovimiento, M.FechaMovimiento,
                   M.TipoMovimiento, M.Status, M.IdProveedor,
                   U.Usuario, P.Proveedor
            FROM tblMovimientos2 M
            LEFT JOIN tblUsuarios U ON U.IdUsuario = M.IdUsuarioMovimiento
            LEFT JOIN tblProveedores P ON P.IdProveedor = M.IdProveedor
            WHERE M.TipoMovimiento = ?
              AND M.FechaMovimiento >= ? AND M.FechaMovimiento < ? + INTERVAL 1 DAY
            ORDER BY M.FechaMovimiento DESC
            LIMIT ${LIMITE}
        `, params) as Row[];

        // Montos por movimiento desde el detalle (una sola pasada con IN de tuplas)
        const montos = new Map<string, { monto: number; partidas: number }>();
        if (movimientos.length > 0) {
            const tuplas = movimientos
                .map(m => `(${num(m.IdMovimiento)},${num(m.IdTienda)})`)
                .join(',');
            try {
                const rows = await tiendaQuery(session.idTienda, `
                    SELECT IdMovimiento, IdTienda,
                           SUM(Mov * Costo) AS Monto, COUNT(*) AS Partidas
                    FROM tblDetalleMovimientos2
                    WHERE (IdMovimiento, IdTienda) IN (${tuplas})
                    GROUP BY IdMovimiento, IdTienda
                `) as Row[];
                for (const r of rows) {
                    montos.set(`${num(r.IdMovimiento)}|${num(r.IdTienda)}`, {
                        monto: num(r.Monto),
                        partidas: num(r.Partidas),
                    });
                }
            } catch (e) {
                console.warn('No fue posible calcular montos de movimientos:', e);
            }
        }

        let lista = movimientos.map(m => {
            const monto = montos.get(`${num(m.IdMovimiento)}|${num(m.IdTienda)}`);
            return {
                idMovimiento: num(m.IdMovimiento),
                idTienda: num(m.IdTienda),
                folio: str(m.FolioMovimiento),
                fecha: m.FechaMovimiento,
                concepto: str(m.Movimiento),
                usuario: str(m.Usuario) || '—',
                proveedor: num(m.IdProveedor) > 0 ? str(m.Proveedor) : '',
                monto: monto?.monto ?? 0,
                partidas: monto?.partidas ?? 0,
                cancelado: num(m.Status) !== 0,
            };
        });

        if (busqueda) {
            lista = lista.filter(m =>
                `${m.folio} ${m.concepto} ${m.usuario} ${m.proveedor}`.toLowerCase().includes(busqueda)
            );
        }

        return NextResponse.json({
            tipo: tipo === 0 ? 'entradas' : 'salidas',
            fechaInicio,
            fechaFin,
            total: lista.length,
            truncado: movimientos.length === LIMITE,
            resumen: {
                movimientos: lista.length,
                monto: lista.reduce((acc, m) => acc + m.monto, 0),
                cancelados: lista.filter(m => m.cancelado).length,
            },
            movimientos: lista,
        });
    } catch (error) {
        console.error(`Error listando movimientos (tienda ${session.idTienda}):`, error);
        return NextResponse.json(
            { error: 'No fue posible consultar los movimientos de la tienda.' },
            { status: 502 }
        );
    }
}
