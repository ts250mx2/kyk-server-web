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

// Devoluciones de venta (frmProcDevolucionesVenta, versión de consulta):
// tblDevolucionesVenta = encabezado con cliente, concepto (motivo), empleado, valor y
// estado de canje (IdComputadoraCanje > 0 = el vale ya se canjeó en caja).
export async function GET(request: Request) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const hoy = new Date().toLocaleDateString('sv-SE');
    const fechaInicio = ES_FECHA.test(searchParams.get('fechaInicio') ?? '') ? searchParams.get('fechaInicio')! : hoy;
    const fechaFin = ES_FECHA.test(searchParams.get('fechaFin') ?? '') ? searchParams.get('fechaFin')! : hoy;
    const busqueda = (searchParams.get('busqueda') ?? '').trim().toLowerCase();

    try {
        const params: MysqlParam[] = [fechaInicio, fechaFin];
        const rows = await tiendaQuery(session.idTienda, `
            SELECT D.IdDevolucionVenta, D.FechaDevolucionVenta, D.Valor, D.Status,
                   D.IdComputadoraCanje, D.FechaCanje, D.ClaveDevolucion, D.Cliente,
                   D.Concepto, D.Empleado, D.IdFactura, U.Usuario
            FROM tblDevolucionesVenta D
            LEFT JOIN tblUsuarios U ON U.IdUsuario = D.IdUsuario
            WHERE D.FechaDevolucionVenta >= ? AND D.FechaDevolucionVenta < ? + INTERVAL 1 DAY
            ORDER BY D.FechaDevolucionVenta DESC
            LIMIT ${LIMITE}
        `, params) as Row[];

        let devoluciones = rows.map(r => ({
            idDevolucionVenta: num(r.IdDevolucionVenta),
            clave: str(r.ClaveDevolucion),
            fecha: r.FechaDevolucionVenta,
            cliente: str(r.Cliente),
            concepto: str(r.Concepto),
            empleado: str(r.Empleado) || str(r.Usuario) || '—',
            usuario: str(r.Usuario) || '—',
            valor: num(r.Valor),
            canjeada: num(r.IdComputadoraCanje) > 0,
            fechaCanje: num(r.IdComputadoraCanje) > 0 ? r.FechaCanje : null,
            cajaCanje: num(r.IdComputadoraCanje),
            notaCredito: num(r.IdFactura) > 0 ? num(r.IdFactura) : null,
            cancelada: num(r.Status) !== 0,
        }));

        if (busqueda) {
            devoluciones = devoluciones.filter(d =>
                `${d.clave} ${d.idDevolucionVenta} ${d.cliente} ${d.concepto} ${d.empleado} ${d.usuario}`
                    .toLowerCase().includes(busqueda)
            );
        }

        return NextResponse.json({
            fechaInicio,
            fechaFin,
            total: devoluciones.length,
            truncado: rows.length === LIMITE,
            resumen: {
                devoluciones: devoluciones.length,
                valor: devoluciones.reduce((acc, d) => acc + d.valor, 0),
                canjeadas: devoluciones.filter(d => d.canjeada).length,
                pendientes: devoluciones.filter(d => !d.canjeada && !d.cancelada).length,
            },
            devoluciones,
        });
    } catch (error) {
        console.error(`Error listando devoluciones de venta (tienda ${session.idTienda}):`, error);
        return NextResponse.json(
            { error: 'No fue posible consultar las devoluciones de venta de la tienda.' },
            { status: 502 }
        );
    }
}
