import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { tiendaQuery } from '@/lib/tienda-db';
import type { MysqlParam } from '@/lib/mysql';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

const LIMITE = 2000;
const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/;

// Versión web de frmProcRecibos: recibos de mercancía (tblReciboMovil) por rango de
// fechas con proveedor. Búsqueda igual que el VB6: número → IdReciboMovil (y folio),
// texto → RFC/Proveedor LIKE, UUID o FolioReciboMovil exactos.
export async function GET(request: Request) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const hoy = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD local
    const fechaInicio = ES_FECHA.test(searchParams.get('fechaInicio') ?? '') ? searchParams.get('fechaInicio')! : hoy;
    const fechaFin = ES_FECHA.test(searchParams.get('fechaFin') ?? '') ? searchParams.get('fechaFin')! : hoy;
    const busqueda = (searchParams.get('busqueda') ?? '').trim();

    const where: string[] = ['A.FechaRecibo >= ?', 'A.FechaRecibo < ? + INTERVAL 1 DAY'];
    const params: MysqlParam[] = [fechaInicio, fechaFin];

    if (busqueda) {
        if (/^\d+$/.test(busqueda)) {
            where.push('(A.IdReciboMovil = ? OR A.FolioReciboMovil = ?)');
            params.push(Number(busqueda), busqueda);
        } else {
            where.push('(B.RFC LIKE ? OR B.Proveedor LIKE ? OR A.UUID = ? OR A.FolioReciboMovil = ?)');
            params.push(`%${busqueda}%`, `%${busqueda}%`, busqueda, busqueda);
        }
    }

    const whereSql = where.join(' AND ');

    try {
        const [recibos, resumenRows] = await Promise.all([
            tiendaQuery(session.idTienda, `
                SELECT A.IdReciboMovil, A.FolioReciboMovil, A.FechaRecibo, A.Numero, A.Status,
                       A.SubtotalRecibo, A.DescuentosRecibo, A.IVARecibo, A.TotalRecibo,
                       A.TotalDevoluciones, A.DescuentosFinancieros, A.TotalPagar, A.TotalIEPS,
                       A.UUID, B.Proveedor, B.RFC
                FROM tblReciboMovil A
                INNER JOIN tblProveedores B ON A.IdProveedor = B.IdProveedor
                WHERE ${whereSql}
                ORDER BY A.FechaRecibo DESC
                LIMIT ${LIMITE}
            `, params) as Promise<Row[]>,
            tiendaQuery(session.idTienda, `
                SELECT COUNT(*) AS n,
                       COALESCE(SUM(A.TotalRecibo), 0) AS totalRecibo,
                       COALESCE(SUM(A.TotalDevoluciones), 0) AS totalDevoluciones,
                       COALESCE(SUM(A.TotalPagar), 0) AS totalPagar
                FROM tblReciboMovil A
                INNER JOIN tblProveedores B ON A.IdProveedor = B.IdProveedor
                WHERE ${whereSql}
            `, params) as Promise<Row[]>,
        ]);

        const resumen = resumenRows[0] ?? {};

        // TotalDevoluciones del encabezado solo se actualiza cuando el webservice Java
        // "imprime" el recibo; puede venir en 0 aunque haya partidas de devolución.
        // Se detectan directo del detalle (consulta plana con IN, rápida en el MySQL viejo).
        const devolucionesMap = new Map<number, number>();
        if (recibos.length > 0) {
            const ids = recibos.map(r => num(r.IdReciboMovil)).filter(n => n > 0);
            try {
                const devRows = await tiendaQuery(session.idTienda, `
                    SELECT IdReciboMovil, SUM(Rec * Costo) AS Monto
                    FROM tblDetalleReciboMovil
                    WHERE Devolucion = 1 AND IdReciboMovil IN (${ids.join(',')})
                    GROUP BY IdReciboMovil
                `) as Row[];
                for (const d of devRows) {
                    devolucionesMap.set(num(d.IdReciboMovil), num(d.Monto));
                }
            } catch (e) {
                console.warn('No fue posible detectar devoluciones desde el detalle:', e);
            }
        }
        const devolucionesEfectivas = (r: Row): number => {
            const encabezado = num(r.TotalDevoluciones);
            if (encabezado > 0) return encabezado;
            return devolucionesMap.get(num(r.IdReciboMovil)) ?? 0;
        };
        const totalDevolucionesEfectivo = recibos.reduce((acc, r) => acc + devolucionesEfectivas(r), 0);

        return NextResponse.json({
            fechaInicio,
            fechaFin,
            total: num(resumen.n),
            truncado: recibos.length === LIMITE,
            resumen: {
                recibos: num(resumen.n),
                totalRecibo: num(resumen.totalRecibo),
                totalDevoluciones: totalDevolucionesEfectivo,
                totalPagar: num(resumen.totalPagar),
            },
            recibos: recibos.map(r => ({
                idReciboMovil: num(r.IdReciboMovil),
                folio: r.FolioReciboMovil ?? '',
                fecha: r.FechaRecibo,
                proveedor: r.Proveedor ?? '',
                rfc: r.RFC ?? '',
                numero: r.Numero ?? '',
                subtotal: num(r.SubtotalRecibo),
                descuentos: num(r.DescuentosRecibo),
                iva: num(r.IVARecibo),
                ieps: num(r.TotalIEPS),
                totalRecibo: num(r.TotalRecibo),
                devoluciones: devolucionesEfectivas(r),
                totalPagar: num(r.TotalPagar),
                cancelado: num(r.Status) !== 0,
            })),
        });
    } catch (error) {
        console.error(`Error listando recibos (tienda ${session.idTienda}):`, error);
        return NextResponse.json(
            { error: 'No fue posible consultar los recibos de la tienda.' },
            { status: 502 }
        );
    }
}
