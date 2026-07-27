import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { tiendaQuery } from '@/lib/tienda-db';
import type { MysqlParam } from '@/lib/mysql';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

const LIMITE = 1000;

// Reporte de ofertas de frmCatArticulosServer, adaptado al MySQL de tienda:
// - internas:   en tienda NO se usa tblArticulos.PrecioOferta (siempre NULL); las ofertas
//               internas viven en tblSesionesOfertas (vigencia) + tblDetalleSesionesOfertas
//               (CodigoInterno, PrecioOferta).
// - publicadas: tblOfertasPublicas (CodigoInterno, PrecioOfertaPublica, FechaInicioPublica,
//               FechaFinPublica).
// El % de descuento se calcula como en frmCatOfertasPublicas: 1 - (Oferta / Precio).
export async function GET(request: Request) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const tipo = searchParams.get('tipo') === 'publicadas' ? 'publicadas' : 'internas';
    const busqueda = (searchParams.get('busqueda') ?? '').trim();
    const soloVigentes = searchParams.get('soloVigentes') !== '0';

    const params: MysqlParam[] = [];
    const filtroBusqueda = busqueda ? ' AND (A.Descripcion LIKE ? OR A.CodigoBarras LIKE ?)' : '';
    if (busqueda) {
        params.push(`%${busqueda}%`, `%${busqueda}%`);
    }

    let sql: string;
    if (tipo === 'internas') {
        sql = `
            SELECT A.CodigoInterno, A.CodigoBarras, A.Descripcion, A.Precio, A.IdTipo,
                   D.PrecioOferta AS Oferta, S.FechaInicio, S.FechaFin,
                   (S.FechaInicio <= NOW() AND S.FechaFin >= NOW()) AS Vigente,
                   (S.FechaInicio > NOW()) AS PorIniciar
            FROM tblDetalleSesionesOfertas D
            INNER JOIN tblSesionesOfertas S ON S.IdSesionOferta = D.IdSesionOferta
            INNER JOIN tblArticulos A ON A.CodigoInterno = D.CodigoInterno
            WHERE D.PrecioOferta > 0
              ${soloVigentes ? 'AND S.FechaFin >= NOW()' : ''}
              ${filtroBusqueda}
            ORDER BY A.Descripcion
            LIMIT ${LIMITE}
        `;
    } else {
        sql = `
            SELECT A.CodigoInterno, A.CodigoBarras, A.Descripcion, A.Precio, A.IdTipo,
                   O.PrecioOfertaPublica AS Oferta, O.FechaInicioPublica AS FechaInicio, O.FechaFinPublica AS FechaFin,
                   (O.FechaInicioPublica <= NOW() AND O.FechaFinPublica >= NOW()) AS Vigente,
                   (O.FechaInicioPublica > NOW()) AS PorIniciar
            FROM tblOfertasPublicas O
            INNER JOIN tblArticulos A ON A.CodigoInterno = O.CodigoInterno
            WHERE O.PrecioOfertaPublica > 0
              ${soloVigentes ? 'AND O.FechaFinPublica >= NOW()' : ''}
              ${filtroBusqueda}
            ORDER BY A.Descripcion
            LIMIT ${LIMITE}
        `;
    }

    try {
        const rows = await tiendaQuery(session.idTienda, sql, params) as Row[];

        return NextResponse.json({
            tipo,
            total: rows.length,
            truncado: rows.length === LIMITE,
            ofertas: rows.map(r => {
                const precio = num(r.Precio);
                const oferta = num(r.Oferta);
                return {
                    codigoInterno: num(r.CodigoInterno),
                    codigoBarras: r.CodigoBarras ?? '',
                    descripcion: r.Descripcion ?? '',
                    unidad: num(r.IdTipo) === 2 ? 'Kg' : 'Pzs',
                    precio,
                    precioOferta: oferta,
                    descuento: precio > 0 ? 1 - oferta / precio : 0,
                    fechaInicio: r.FechaInicio,
                    fechaFin: r.FechaFin,
                    estado: num(r.Vigente) === 1 ? 'vigente' : (num(r.PorIniciar) === 1 ? 'porIniciar' : 'vencida'),
                };
            }),
        });
    } catch (error) {
        console.error(`Error listando ofertas ${tipo} (tienda ${session.idTienda}):`, error);
        return NextResponse.json(
            { error: 'No fue posible consultar las ofertas de la tienda.' },
            { status: 502 }
        );
    }
}
