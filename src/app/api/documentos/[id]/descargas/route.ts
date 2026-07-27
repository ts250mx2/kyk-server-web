import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { portalQuery, esOficina } from '@/lib/portal-db';
import { getTiendasReportes } from '@/lib/tiendas';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

// Auditoría de descargas de un documento (solo oficina): quién lo bajó y cuándo.
export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    if (!(await esOficina(session.codigobarras))) {
        return NextResponse.json({ error: 'Solo el rol oficina puede ver las descargas' }, { status: 403 });
    }

    const { id } = await params;
    const idDocumento = Number(id);
    if (!Number.isInteger(idDocumento) || idDocumento <= 0) {
        return NextResponse.json({ error: 'Documento inválido' }, { status: 400 });
    }

    try {
        const [docs, descargas, tiendas] = await Promise.all([
            portalQuery(`SELECT Nombre FROM documentos WHERE IdDocumento = ?`, [idDocumento]) as Promise<Row[]>,
            portalQuery(`
                SELECT IdTienda, Nombre, FechaDescarga
                FROM documentos_descargas
                WHERE IdDocumento = ?
                ORDER BY FechaDescarga DESC
                LIMIT 500
            `, [idDocumento]) as Promise<Row[]>,
            getTiendasReportes(),
        ]);

        if (!docs[0]) {
            return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });
        }

        const nombreTienda = new Map(tiendas.map(t => [t.IdTienda, t.Tienda]));

        return NextResponse.json({
            nombre: str(docs[0].Nombre),
            total: descargas.length,
            descargas: descargas.map(d => ({
                tienda: nombreTienda.get(num(d.IdTienda)) ?? `Tienda ${num(d.IdTienda)}`,
                usuario: str(d.Nombre),
                fecha: d.FechaDescarga,
            })),
        });
    } catch (error) {
        console.error(`Error consultando descargas del documento ${idDocumento}:`, error);
        return NextResponse.json(
            { error: 'No fue posible consultar las descargas.' },
            { status: 502 }
        );
    }
}
