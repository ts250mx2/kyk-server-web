import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { esOficina, portalQuery } from '@/lib/portal-db';
import { filtroDeReporte } from '@/lib/encuestas-clientes';
import type { PartidaTicket } from '@/lib/encuestas-ticket';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0);
const MAX_CAPTURAS = 200;

function partidasDe(crudo: unknown): PartidaTicket[] {
    if (typeof crudo !== 'string' || !crudo) return [];
    try {
        const lista = JSON.parse(crudo);
        return Array.isArray(lista) ? lista : [];
    } catch {
        return [];
    }
}

// Historial de encuestas levantadas por la tienda con el cliente enfrente
// (solo oficina): nombre, si hay foto, ticket capturado vs. ticket real,
// avisos y quién lo capturó. Mismos filtros que el reporte.
export async function GET(request: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    if (!(await esOficina(session.codigobarras))) {
        return NextResponse.json({ error: 'Solo oficina puede ver el historial' }, { status: 403 });
    }

    const { filtro, parametros } = filtroDeReporte(request.url);
    try {
        const [capturas, nombres] = await Promise.all([
            portalQuery(
                `SELECT C.IdRespuesta, C.IdTienda, C.NombreCliente,
                        (C.FotoCliente IS NOT NULL AND C.FotoCliente <> '') AS TieneFoto,
                        C.NumeroTicket, C.TotalCapturado, C.TotalTicket, C.FechaTicket, C.TicketValido, C.TicketAntiguo,
                        C.DetalleTicket, C.ErrorTicket, C.CapturadoPorNombre, C.Fecha, R.Comentario,
                        (SELECT D.Valor FROM encuestas_clientes_detalle D
                         WHERE D.IdRespuesta = C.IdRespuesta AND D.TipoPregunta = 'nps' LIMIT 1) AS Nps
                 FROM encuestas_clientes_captura C
                 JOIN encuestas_clientes_respuestas R ON R.IdRespuesta = C.IdRespuesta
                 ${filtro}
                 ORDER BY C.Fecha DESC
                 LIMIT ${MAX_CAPTURAS}`,
                parametros
            ) as Promise<Row[]>,
            portalQuery('SELECT IdTienda, Tienda FROM encuestas_clientes_qr') as Promise<Row[]>,
        ]);
        const nombreTienda = new Map(nombres.map(f => [num(f.IdTienda), String(f.Tienda)]));

        return NextResponse.json({
            capturas: capturas.map(f => ({
                idRespuesta: num(f.IdRespuesta),
                tienda: nombreTienda.get(num(f.IdTienda)) ?? `Tienda ${num(f.IdTienda)}`,
                nombre: f.NombreCliente ? String(f.NombreCliente) : '',
                tieneFoto: num(f.TieneFoto) === 1,
                numeroTicket: f.NumeroTicket ? String(f.NumeroTicket) : '',
                totalCapturado: f.TotalCapturado === null ? null : num(f.TotalCapturado),
                totalTicket: f.TotalTicket === null ? null : num(f.TotalTicket),
                fechaTicket: f.FechaTicket ? String(f.FechaTicket) : null,
                ticketValido: f.TicketValido === null ? null : num(f.TicketValido) === 1,
                ticketAntiguo: num(f.TicketAntiguo) === 1,
                errorTicket: f.ErrorTicket ? String(f.ErrorTicket) : '',
                partidas: partidasDe(f.DetalleTicket),
                capturadoPor: String(f.CapturadoPorNombre ?? ''),
                fecha: String(f.Fecha),
                nps: f.Nps === null || f.Nps === undefined ? null : num(f.Nps),
                comentario: f.Comentario ? String(f.Comentario) : '',
            })),
        });
    } catch (error) {
        console.error('Error en historial de encuestas:', error);
        return NextResponse.json({ error: 'No fue posible cargar el historial' }, { status: 502 });
    }
}
