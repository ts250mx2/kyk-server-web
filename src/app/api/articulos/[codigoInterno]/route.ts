import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { tiendaQuery } from '@/lib/tienda-db';
import { redondearMas, calculaCostoReal } from '@/lib/articulos';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

// Detalle de un artículo: pestañas Venta y Compra de frmCatArticulosServer.
export async function GET(
    _request: Request,
    { params }: { params: Promise<{ codigoInterno: string }> }
) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { codigoInterno } = await params;
    const codigo = Number(codigoInterno);
    if (!Number.isInteger(codigo) || codigo <= 0) {
        return NextResponse.json({ error: 'Código inválido' }, { status: 400 });
    }

    const idTienda = session.idTienda;

    try {
        const articulos = await tiendaQuery(idTienda, `
            SELECT A.*, D.Proveedor AS ProveedorDefault
            FROM tblArticulos A
            LEFT JOIN tblProveedores D ON A.IdProveedorDefault = D.IdProveedor
            WHERE A.CodigoInterno = ?
        `, [codigo]) as Row[];

        const art = articulos[0];
        if (!art) {
            return NextResponse.json({ error: 'Artículo no encontrado' }, { status: 404 });
        }

        // Los costos/proveedores se consultan con el código padre (CodigoInterno2),
        // igual que la rutina valoriza del formulario VB6.
        const codigoCostos = num(art.CodigoInterno2) > 0 ? num(art.CodigoInterno2) : codigo;

        // Oferta pública vigente (tblOfertasPublicas); tolerante si la tabla no existe en la tienda.
        let ofertaPublica: Row | null = null;
        try {
            const ofertas = await tiendaQuery(idTienda, `
                SELECT PrecioOfertaPublica, FechaInicioPublica, FechaFinPublica
                FROM tblOfertasPublicas
                WHERE CodigoInterno = ? AND FechaFinPublica >= NOW()
                ORDER BY FechaInicioPublica DESC
                LIMIT 1
            `, [codigoCostos]) as Row[];
            ofertaPublica = ofertas[0] ?? null;
        } catch {
            ofertaPublica = null;
        }

        const PROVEEDORES_SQL = `
            SELECT AP.*, P.Proveedor
            FROM tblArticulosProveedor AP
            INNER JOIN tblProveedores P ON AP.IdProveedor = P.IdProveedor
            WHERE AP.CodigoInterno = ?
            ORDER BY P.Proveedor
        `;
        let proveedores = await tiendaQuery(idTienda, PROVEEDORES_SQL, [codigoCostos]) as Row[];
        // Respaldo: si el código padre no tiene proveedores, busca con el código propio
        // (el VB6 usa CodigoInterno2 para costos y CodigoInterno para la lista de proveedores).
        if (proveedores.length === 0 && codigoCostos !== codigo) {
            proveedores = await tiendaQuery(idTienda, PROVEEDORES_SQL, [codigo]) as Row[];
        }

        const precio = num(art.Precio);
        const precioOfertaPublica = ofertaPublica ? num(ofertaPublica.PrecioOfertaPublica) : 0;

        // Descuento Mayoreo: escalas 0-3 con PrecioDesc = Precio * (1 - Descuento),
        // redondeado hacia arriba; una oferta pública menor lo sustituye (lógica de valoriza).
        const mayoreo = [0, 1, 2, 3].map(n => {
            const escala = num(art[`EscalaSuperior${n}`]);
            const descuento = num(art[`Descuento${n}`]);
            let precioDesc = escala > 0 ? redondearMas(precio * (1 - descuento)) : 0;
            if (precioOfertaPublica > 0 && precioOfertaPublica < precioDesc) {
                precioDesc = precioOfertaPublica;
            }
            return { escala, descuento, precioDesc };
        });

        const idTipo = num(art.IdTipo);

        return NextResponse.json({
            articulo: {
                codigoInterno: codigo,
                codigoBarras: art.CodigoBarras ?? '',
                descripcion: art.Descripcion ?? '',
                idTipo,
                unidad: idTipo === 2 ? 'Kg' : 'Pzs',
                eliminado: num(art.Status) === 2,
                precio,
                iva: num(art.Iva),
                ieps: num(art.IEPS),
                precioOferta: num(art.PrecioOferta),
                ofertaPublica: ofertaPublica ? {
                    precio: precioOfertaPublica,
                    fechaInicio: ofertaPublica.FechaInicioPublica,
                    fechaFin: ofertaPublica.FechaFinPublica,
                } : null,
                ultimaActualizacion: art.FechaAct ?? null,
                categoria: art.Categoria ?? '',
                familia: art.Familia ?? '',
                medidaVenta: art.MedidaVenta ?? '',
                proveedorDefault: art.ProveedorDefault ?? null,
                mayoreo,
            },
            proveedores: proveedores.map(p => {
                const costo = num(p.Costo);
                const cantidadCompra = num(p.CantidadCompra);
                const descuentos = [0, 1, 2, 3, 4].map(n => num(p[`Desc${n}`]));
                return {
                    idProveedor: num(p.IdProveedor),
                    proveedor: p.Proveedor ?? '',
                    esDefault: num(art.IdProveedorDefault) === num(p.IdProveedor),
                    costoCaja: costo,
                    cantidadCaja: cantidadCompra,
                    costoUnitario: cantidadCompra > 0 ? costo / cantidadCompra : costo,
                    descuentos,
                    costoReal: calculaCostoReal(costo, descuentos, idTipo, cantidadCompra),
                    cambioCosto: p.FechaAct ?? null,
                    codigoCompra: p.CodigoCompra ?? '',
                    descripcionCompra: p.DescripcionCompra ?? '',
                };
            }),
        });
    } catch (error) {
        console.error(`Error en detalle de artículo ${codigo} (tienda ${idTienda}):`, error);
        return NextResponse.json(
            { error: 'No fue posible consultar el detalle del artículo.' },
            { status: 502 }
        );
    }
}
