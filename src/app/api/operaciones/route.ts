import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { tiendaQuery } from '@/lib/tienda-db';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/;

// Monitor de operaciones / cortes de caja del día (adaptación de la página de
// Operaciones de kyk-dashboard a una sola tienda, sobre el MySQL local):
// aperturas por terminal (tblAperturasCierres + cajero/supervisor), ventas por
// apertura (tblVentas), cancelaciones (tblCancelaciones + detalle) y cierres con
// montos declarados.
export async function GET(request: Request) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const hoy = new Date().toLocaleDateString('sv-SE');
    const fecha = ES_FECHA.test(searchParams.get('fecha') ?? '') ? searchParams.get('fecha')! : hoy;

    try {
        const [aperturas, ventas, cancelaciones] = await Promise.all([
            tiendaQuery(session.idTienda, `
                SELECT A.IdApertura, A.IdComputadora, A.FechaApertura, A.FechaCierre,
                       A.EfectivoInicio, A.Efectivo, A.Cheques, A.Tarjeta, A.Dolares,
                       C.Usuario AS Cajero, D.Usuario AS Supervisor
                FROM tblAperturasCierres A
                LEFT JOIN tblUsuarios C ON A.IdCajero = C.IdUsuario
                LEFT JOIN tblUsuarios D ON A.IdSupervisorCierre = D.IdUsuario
                WHERE A.FechaApertura >= ? AND A.FechaApertura < ? + INTERVAL 1 DAY
                ORDER BY A.IdComputadora, A.FechaApertura
            `, [fecha, fecha]) as Promise<Row[]>,
            tiendaQuery(session.idTienda, `
                SELECT IdApertura, IdComputadora, SUM(Total) AS Total, COUNT(*) AS Operaciones
                FROM tblVentas
                WHERE FechaVenta >= ? AND FechaVenta < ? + INTERVAL 1 DAY
                GROUP BY IdApertura, IdComputadora
            `, [fecha, fecha]) as Promise<Row[]>,
            tiendaQuery(session.idTienda, `
                SELECT A.IdApertura, A.IdComputadora, COUNT(*) AS Cantidad,
                       SUM(B.PrecioVenta * B.Cantidad) AS Monto
                FROM tblCancelaciones A
                INNER JOIN tblDetalleCancelaciones B
                    ON A.IdComputadora = B.IdComputadora AND A.IdCancelacion = B.IdCancelacion
                WHERE A.FechaCancelacion >= ? AND A.FechaCancelacion < ? + INTERVAL 1 DAY
                GROUP BY A.IdApertura, A.IdComputadora
            `, [fecha, fecha]) as Promise<Row[]>,
        ]);

        const ventasMap = new Map<string, Row>(
            ventas.map(v => [`${num(v.IdApertura)}|${num(v.IdComputadora)}`, v])
        );
        const cancelacionesMap = new Map<string, Row>(
            cancelaciones.map(c => [`${num(c.IdApertura)}|${num(c.IdComputadora)}`, c])
        );

        const cortes = aperturas.map(a => {
            const clave = `${num(a.IdApertura)}|${num(a.IdComputadora)}`;
            const v = ventasMap.get(clave);
            const c = cancelacionesMap.get(clave);
            const total = num(v?.Total);
            const operaciones = num(v?.Operaciones);
            return {
                idApertura: num(a.IdApertura),
                caja: num(a.IdComputadora),
                z: `${num(a.IdComputadora)}-${num(a.IdApertura)}`,
                fechaApertura: a.FechaApertura,
                fechaCierre: a.FechaCierre ?? null,
                cajero: str(a.Cajero) || '—',
                supervisor: str(a.Supervisor) || null,
                cerrada: Boolean(a.FechaCierre && str(a.Supervisor)),
                efectivoInicio: num(a.EfectivoInicio),
                declarado: {
                    efectivo: num(a.Efectivo),
                    cheques: num(a.Cheques),
                    tarjeta: num(a.Tarjeta),
                    dolares: num(a.Dolares),
                },
                ventas: total,
                operaciones,
                ticketPromedio: operaciones > 0 ? total / operaciones : 0,
                cancelaciones: num(c?.Cantidad),
                cancelacionesMonto: num(c?.Monto),
            };
        });

        const totalVentas = cortes.reduce((acc, o) => acc + o.ventas, 0);
        const totalOperaciones = cortes.reduce((acc, o) => acc + o.operaciones, 0);

        return NextResponse.json({
            fecha,
            tienda: session.tienda,
            resumen: {
                aperturas: cortes.length,
                ventas: totalVentas,
                operaciones: totalOperaciones,
                ticketPromedio: totalOperaciones > 0 ? totalVentas / totalOperaciones : 0,
                cancelaciones: cortes.reduce((acc, o) => acc + o.cancelaciones, 0),
                cancelacionesMonto: cortes.reduce((acc, o) => acc + o.cancelacionesMonto, 0),
                cierres: cortes.filter(o => o.cerrada).length,
            },
            cortes,
        });
    } catch (error) {
        console.error(`Error en cortes de caja (tienda ${session.idTienda}):`, error);
        return NextResponse.json(
            { error: 'No fue posible consultar los cortes de caja de la tienda.' },
            { status: 502 }
        );
    }
}
