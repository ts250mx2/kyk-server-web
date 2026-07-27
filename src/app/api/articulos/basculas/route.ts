import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { tiendaQuery } from '@/lib/tienda-db';
import { redondearMas } from '@/lib/articulos';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

// Versión web de vlArticulosBasculas (frmRepBasculas, "Códigos para Básculas").
// La vista original: graneles (IdTipo=2) que no son variante rebanada (CodigoInterno3=0),
// con LEFT JOIN a su variante rebanada y códigos de báscula 00-/10-/20-.
// En el MySQL de tienda no existen CodigoInterno3 ni IdTipoGranel, así que:
//  - la variante rebanada se detecta por el patrón de código: rebanado = '1' + código base
//    (p.ej. 207 → 1207 "Jamon Virginia Reb"), verificado contra los datos de tienda;
//  - el "Tipo de Granel" se sustituye por el departamento (tblDeptos).
// El precio actual respeta la prioridad del VB6: oferta pública > oferta interna > precio.
// Nota de rendimiento: se hacen 3 consultas planas y el cruce se resuelve aquí; las
// subconsultas correlacionadas tardaban ~18 s en el MySQL viejo de tienda.
export async function GET(request: Request) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const idDepto = num(searchParams.get('idDepto'));
    const busqueda = (searchParams.get('busqueda') ?? '').trim().toLowerCase();

    try {
        const [graneles, publicas, internas] = await Promise.all([
            tiendaQuery(session.idTienda, `
                SELECT A.CodigoInterno, A.CodigoBarras, A.Descripcion, A.IdDepto, D.Depto,
                       A.Precio, A.Descuento0, A.Descuento1, A.EscalaSuperior0, A.EscalaSuperior1
                FROM tblArticulos A
                LEFT JOIN tblDeptos D ON A.IdDepto = D.IdDepto
                WHERE A.Status <> 2 AND A.IdTipo = 2 AND A.CodigoBarras REGEXP '^[0-9]+$'
                ORDER BY A.Descripcion
            `) as Promise<Row[]>,
            tiendaQuery(session.idTienda, `
                SELECT CodigoInterno, PrecioOfertaPublica, FechaInicioPublica
                FROM tblOfertasPublicas
                WHERE PrecioOfertaPublica > 0
                  AND FechaInicioPublica <= NOW() AND FechaFinPublica >= NOW()
            `) as Promise<Row[]>,
            tiendaQuery(session.idTienda, `
                SELECT DS.CodigoInterno, DS.PrecioOferta, S.FechaInicio
                FROM tblDetalleSesionesOfertas DS
                INNER JOIN tblSesionesOfertas S ON S.IdSesionOferta = DS.IdSesionOferta
                WHERE DS.PrecioOferta > 0
                  AND S.FechaInicio <= NOW() AND S.FechaFin >= NOW()
            `) as Promise<Row[]>,
        ]);

        // Oferta vigente por artículo (si hay varias, gana la sesión más reciente)
        const construirMapa = (rows: Row[], campoPrecio: string, campoFecha: string) => {
            const mapa = new Map<number, { precio: number; fecha: number }>();
            for (const r of rows) {
                const codigo = num(r.CodigoInterno);
                const fecha = new Date(String(r[campoFecha])).getTime() || 0;
                const previa = mapa.get(codigo);
                if (!previa || fecha > previa.fecha) {
                    mapa.set(codigo, { precio: num(r[campoPrecio]), fecha });
                }
            }
            return mapa;
        };
        const mapaPublicas = construirMapa(publicas, 'PrecioOfertaPublica', 'FechaInicioPublica');
        const mapaInternas = construirMapa(internas, 'PrecioOferta', 'FechaInicio');

        const precioActual = (codigoInterno: number, precio: number): number =>
            mapaPublicas.get(codigoInterno)?.precio
            ?? mapaInternas.get(codigoInterno)?.precio
            ?? precio;

        // Índices por código de barras para detectar variantes rebanadas ('1' + código base)
        const porCodigo = new Map<string, Row>();
        const codigos = new Set<string>();
        for (const r of graneles) {
            const codigo = String(r.CodigoBarras);
            porCodigo.set(codigo, r);
            codigos.add(codigo);
        }
        const esVariante = (codigo: string) =>
            codigo.startsWith('1') && codigo.length > 1 && codigos.has(codigo.slice(1));

        const articulos = [];
        const deptosMapa = new Map<number, string>();

        for (const r of graneles) {
            const codigo = String(r.CodigoBarras);
            if (esVariante(codigo)) continue; // las variantes rebanadas no son fila base

            if (r.IdDepto != null && r.Depto) {
                deptosMapa.set(num(r.IdDepto), String(r.Depto));
            }

            // Filtros (sobre las filas base, como la vista original)
            if (idDepto > 0 && num(r.IdDepto) !== idDepto) continue;
            if (busqueda) {
                const texto = `${String(r.Descripcion ?? '')} ${codigo}`.toLowerCase();
                if (!texto.includes(busqueda)) continue;
            }

            const precio = num(r.Precio);
            const actual = precioActual(num(r.CodigoInterno), precio);
            const escala0 = num(r.EscalaSuperior0);
            const escala1 = num(r.EscalaSuperior1);
            const precioDesc0 = escala0 > 0 ? redondearMas(precio * (1 - num(r.Descuento0))) : 0;
            const precioDesc1 = escala1 > 0 ? redondearMas(precio * (1 - num(r.Descuento1))) : 0;

            const reb = porCodigo.get(`1${codigo}`);

            articulos.push({
                codigoInterno: num(r.CodigoInterno),
                codigoBarras: codigo,
                descripcion: r.Descripcion ?? '',
                depto: r.Depto ?? 'Sin departamento',
                precio: actual,
                enOferta: actual !== precio,
                codigo0: `00-${codigo}`,
                codigo1: precioDesc0 > 0 ? `10-${codigo} (${escala0})` : null,
                precioDesc0,
                codigo2: precioDesc1 > 0 ? `20-${codigo} (${escala1})` : null,
                precioDesc1,
                codigoReb: reb ? `0${String(reb.CodigoBarras).slice(0, 1)}-${String(reb.CodigoBarras).slice(-3)}` : null,
                descripcionReb: reb ? reb.Descripcion ?? null : null,
                precioReb: reb ? precioActual(num(reb.CodigoInterno), num(reb.Precio)) : 0,
            });
        }

        const deptos = [...deptosMapa.entries()]
            .map(([id, depto]) => ({ idDepto: id, depto }))
            .sort((a, b) => a.depto.localeCompare(b.depto, 'es'));

        return NextResponse.json({
            total: articulos.length,
            deptos,
            articulos,
        });
    } catch (error) {
        console.error(`Error listando precios básculas (tienda ${session.idTienda}):`, error);
        return NextResponse.json(
            { error: 'No fue posible consultar los precios de básculas de la tienda.' },
            { status: 502 }
        );
    }
}
