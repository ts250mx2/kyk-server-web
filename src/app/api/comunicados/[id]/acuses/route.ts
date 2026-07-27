import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { portalQuery, esOficina } from '@/lib/portal-db';
import { getTiendasReportes } from '@/lib/tiendas';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

// Tablero de acuses de un comunicado (solo oficina): qué tiendas ya confirmaron
// de enterado (y quién) y cuáles siguen pendientes.
export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    if (!(await esOficina(session.codigobarras))) {
        return NextResponse.json({ error: 'Solo el rol oficina puede ver los acuses' }, { status: 403 });
    }

    const { id } = await params;
    const idComunicado = Number(id);
    if (!Number.isInteger(idComunicado) || idComunicado <= 0) {
        return NextResponse.json({ error: 'Comunicado inválido' }, { status: 400 });
    }

    try {
        const [encabezados, acuses, destinosRows, tiendas] = await Promise.all([
            portalQuery(`
                SELECT Titulo, TodasTiendas FROM comunicados WHERE IdComunicado = ? AND Status = 0
            `, [idComunicado]) as Promise<Row[]>,
            portalQuery(`
                SELECT IdTienda, CodigoBarras, Nombre, FechaAcuse
                FROM comunicados_acuses
                WHERE IdComunicado = ?
                ORDER BY FechaAcuse
            `, [idComunicado]) as Promise<Row[]>,
            portalQuery(`
                SELECT IdTienda FROM comunicados_tiendas WHERE IdComunicado = ?
            `, [idComunicado]) as Promise<Row[]>,
            getTiendasReportes(),
        ]);

        const enc = encabezados[0];
        if (!enc) {
            return NextResponse.json({ error: 'Comunicado no encontrado' }, { status: 404 });
        }

        const nombreTienda = new Map(tiendas.map(t => [t.IdTienda, t.Tienda]));
        const destinos = num(enc.TodasTiendas) === 1
            ? tiendas.map(t => t.IdTienda)
            : destinosRows.map(d => num(d.IdTienda));

        const acusesPorTienda = new Map<number, Array<{ nombre: string; fecha: unknown }>>();
        for (const a of acuses) {
            const idTienda = num(a.IdTienda);
            const lista = acusesPorTienda.get(idTienda) ?? [];
            lista.push({ nombre: str(a.Nombre) || str(a.CodigoBarras), fecha: a.FechaAcuse });
            acusesPorTienda.set(idTienda, lista);
        }

        return NextResponse.json({
            titulo: str(enc.Titulo),
            tiendas: destinos.map(idTienda => ({
                idTienda,
                tienda: nombreTienda.get(idTienda) ?? `Tienda ${idTienda}`,
                acuses: acusesPorTienda.get(idTienda) ?? [],
            })).sort((a, b) => a.tienda.localeCompare(b.tienda, 'es')),
        });
    } catch (error) {
        console.error(`Error consultando acuses del comunicado ${idComunicado}:`, error);
        return NextResponse.json(
            { error: 'No fue posible consultar los acuses.' },
            { status: 502 }
        );
    }
}
