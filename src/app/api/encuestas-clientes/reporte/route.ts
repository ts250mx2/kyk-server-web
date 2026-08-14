import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { esOficina, portalQuery } from '@/lib/portal-db';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0);

// Reporte de las encuestas de clientes (solo oficina): totales, promedio por
// pregunta con su distribución 1..5, resumen por sucursal, comentarios y
// contactos capturados. Filtros: rango de fechas y sucursal.
export async function GET(request: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    if (!(await esOficina(session.codigobarras))) {
        return NextResponse.json({ error: 'Solo oficina puede ver el reporte' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const fechaInicio = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('fechaInicio') ?? '')
        ? searchParams.get('fechaInicio') : null;
    const fechaFin = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('fechaFin') ?? '')
        ? searchParams.get('fechaFin') : null;
    const idTienda = Number(searchParams.get('idTienda')) || 0;

    // Filtro común armado con parámetros (nunca texto del cliente en el SQL)
    const condiciones: string[] = [];
    const parametros: (string | number)[] = [];
    if (fechaInicio) { condiciones.push('R.Fecha >= ?'); parametros.push(`${fechaInicio} 00:00:00`); }
    if (fechaFin) { condiciones.push('R.Fecha <= ?'); parametros.push(`${fechaFin} 23:59:59`); }
    if (idTienda > 0) { condiciones.push('R.IdTienda = ?'); parametros.push(idTienda); }
    const filtro = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

    try {
        const [totales, porPregunta, porTienda, comentarios, contactos, nombres] = await Promise.all([
            portalQuery(
                `SELECT COUNT(DISTINCT R.IdRespuesta) AS Respuestas,
                        (SELECT AVG(D.Valor) FROM encuestas_clientes_detalle D
                         JOIN encuestas_clientes_respuestas R ON R.IdRespuesta = D.IdRespuesta ${filtro}) AS Promedio
                 FROM encuestas_clientes_respuestas R ${filtro}`,
                [...parametros, ...parametros]
            ) as Promise<Row[]>,
            portalQuery(
                `SELECT D.IdPregunta, D.Pregunta, D.TipoPregunta,
                        COUNT(*) AS Total, AVG(D.Valor) AS Promedio,
                        SUM(D.Valor = 1) AS V1, SUM(D.Valor = 2) AS V2, SUM(D.Valor = 3) AS V3,
                        SUM(D.Valor = 4) AS V4, SUM(D.Valor = 5) AS V5
                 FROM encuestas_clientes_detalle D
                 JOIN encuestas_clientes_respuestas R ON R.IdRespuesta = D.IdRespuesta
                 ${filtro}
                 GROUP BY D.IdPregunta, D.Pregunta, D.TipoPregunta
                 ORDER BY MIN(D.IdDetalle)`,
                parametros
            ) as Promise<Row[]>,
            portalQuery(
                `SELECT R.IdTienda, COUNT(DISTINCT R.IdRespuesta) AS Respuestas, AVG(D.Valor) AS Promedio
                 FROM encuestas_clientes_respuestas R
                 JOIN encuestas_clientes_detalle D ON D.IdRespuesta = R.IdRespuesta
                 ${filtro}
                 GROUP BY R.IdTienda
                 ORDER BY Promedio DESC`,
                parametros
            ) as Promise<Row[]>,
            portalQuery(
                `SELECT R.IdTienda, R.Comentario, R.Fecha,
                        (SELECT AVG(D.Valor) FROM encuestas_clientes_detalle D WHERE D.IdRespuesta = R.IdRespuesta) AS Promedio
                 FROM encuestas_clientes_respuestas R
                 ${filtro ? `${filtro} AND` : 'WHERE'} R.Comentario IS NOT NULL AND R.Comentario <> ''
                 ORDER BY R.Fecha DESC
                 LIMIT 100`,
                parametros
            ) as Promise<Row[]>,
            portalQuery(
                `SELECT R.IdTienda, R.Correo, R.Telefono, R.AceptaPromos, R.Fecha
                 FROM encuestas_clientes_respuestas R
                 ${filtro ? `${filtro} AND` : 'WHERE'} (R.Correo IS NOT NULL OR R.Telefono IS NOT NULL)
                 ORDER BY R.Fecha DESC
                 LIMIT 300`,
                parametros
            ) as Promise<Row[]>,
            portalQuery('SELECT IdTienda, Tienda FROM encuestas_clientes_qr') as Promise<Row[]>,
        ]);

        const nombreTienda = new Map(nombres.map(f => [num(f.IdTienda), String(f.Tienda)]));
        const conNombre = (id: unknown) => nombreTienda.get(num(id)) ?? `Tienda ${num(id)}`;

        return NextResponse.json({
            totales: {
                respuestas: num(totales[0]?.Respuestas),
                promedio: totales[0]?.Promedio === null ? null : Number(num(totales[0]?.Promedio).toFixed(2)),
            },
            porPregunta: porPregunta.map(f => ({
                idPregunta: num(f.IdPregunta),
                pregunta: String(f.Pregunta),
                tipo: String(f.TipoPregunta),
                total: num(f.Total),
                promedio: Number(num(f.Promedio).toFixed(2)),
                distribucion: [num(f.V1), num(f.V2), num(f.V3), num(f.V4), num(f.V5)],
            })),
            porTienda: porTienda.map(f => ({
                idTienda: num(f.IdTienda),
                tienda: conNombre(f.IdTienda),
                respuestas: num(f.Respuestas),
                promedio: Number(num(f.Promedio).toFixed(2)),
            })),
            comentarios: comentarios.map(f => ({
                tienda: conNombre(f.IdTienda),
                comentario: String(f.Comentario),
                fecha: String(f.Fecha),
                promedio: Number(num(f.Promedio).toFixed(1)),
            })),
            contactos: contactos.map(f => ({
                tienda: conNombre(f.IdTienda),
                correo: f.Correo ? String(f.Correo) : '',
                telefono: f.Telefono ? String(f.Telefono) : '',
                aceptaPromos: num(f.AceptaPromos) === 1,
                fecha: String(f.Fecha),
            })),
        });
    } catch (error) {
        console.error('Error en reporte de encuestas:', error);
        return NextResponse.json({ error: 'No fue posible generar el reporte' }, { status: 502 });
    }
}
