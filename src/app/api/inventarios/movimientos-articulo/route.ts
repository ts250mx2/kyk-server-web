import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { tiendaQuery } from '@/lib/tienda-db';
import { cargarKits, familiaDetallada, resolverMaestro } from '@/lib/kits';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Row = Record<string, unknown>;
const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

const MAX_MOVIMIENTOS = 800;

interface Movimiento {
    codigoInterno: number;
    codigoBarras: string;
    fecha: string;
    concepto: string;
    mov: number;
    equiv: number;
}

// Movimientos de un artículo SIN pasar por el Tomcat: mismo SQL de
// ThreadMovimientos (recibos con fórmula de granel, transferencias con fecha
// efectiva, otros movimientos, empacados, devoluciones, ventas agrupadas por
// día y ajustes) directo al MySQL de tienda, sobre la familia recursiva de
// kits del maestro (las variantes aportan Equiv = Mov/Factor). Alimenta el
// modal de movimientos de Quiebre de Stock y Quiebres/Sobre-inventario; el de
// Por Proveedor sigue leyendo el buffer del servicio Java (method=mov).
export async function GET(request: Request) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const codigoInterno = Number(searchParams.get('codigoInterno'));
    const dias = Math.min(Math.max(num(searchParams.get('dias')) || 30, 7), 90);
    if (!Number.isInteger(codigoInterno) || codigoInterno <= 0) {
        return NextResponse.json({ error: 'Artículo inválido' }, { status: 400 });
    }
    const idTienda = session.idTienda;

    try {
        const kits = await cargarKits(idTienda);
        const maestro = resolverMaestro(codigoInterno, kits).maestro;
        const familia = familiaDetallada(maestro, kits);
        const codigos = [...familia.keys()];
        const marcas = codigos.map(() => '?').join(',');

        const inicio = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
        const desde = `${inicio.toLocaleDateString('sv-SE')} 00:00:00`;

        const advertencias: string[] = [];
        const consulta = async (nombre: string, sql: string, params: (string | number)[]): Promise<Row[]> => {
            try {
                return ((await tiendaQuery(idTienda, sql, params)) as Row[]) ?? [];
            } catch {
                advertencias.push(nombre);
                return [];
            }
        };

        const [
            ajustes, recibos, devRecibos, transfEntradas, transfSalidas,
            movimientos2, empacados, devVenta, ventas, ventasPos, cedis, sap,
        ] = await Promise.all([
            consulta('ajustes', `
                SELECT D.CodigoInterno AS Codigo, C.FechaAjuste AS Fecha,
                       CONCAT('Ajuste de Inventario #', C.IdAjusteInventario) AS Concepto,
                       D.Exi AS Mov
                FROM tblDetalleAjustesInventarios D
                INNER JOIN tblAjustesInventarios C
                        ON D.IdAjusteInventario = C.IdAjusteInventario AND D.IdTienda = C.IdTienda
                WHERE C.FechaAjuste >= ? AND D.IdTienda = ? AND D.CodigoInterno IN (${marcas})
            `, [desde, idTienda, ...codigos]),
            consulta('recibos', `
                SELECT A.CodigoInterno AS Codigo, B.FechaRecibo AS Fecha,
                       CONCAT('Recibo Móvil #', B.FolioReciboMovil, ' ', C.Proveedor) AS Concepto,
                       CASE WHEN D.IdTipo = 2 AND RecGranel > 0 THEN RecGranel
                            ELSE CASE WHEN RecGranel = 0 AND D.TipoOperacion <> 1 THEN Rec * A.CantidadCompra
                                      WHEN D.TipoOperacion = 1 THEN Rec
                                      ELSE RecGranel / A.CantidadCompra END END AS Mov
                FROM tblDetalleReciboMovil A
                INNER JOIN tblReciboMovil B ON A.IdReciboMovil = B.IdReciboMovil AND A.IdTienda = B.IdTienda
                INNER JOIN tblProveedores C ON B.IdProveedor = C.IdProveedor
                INNER JOIN tblArticulos D ON A.CodigoInterno = D.CodigoInterno
                WHERE B.Status = 0 AND B.Devolucion = 0 AND B.FechaRecibo >= ?
                  AND A.IdTienda = ? AND A.CodigoInterno IN (${marcas})
            `, [desde, idTienda, ...codigos]),
            consulta('devoluciones de recibo', `
                SELECT A.CodigoInterno AS Codigo, B.FechaRecibo AS Fecha,
                       CONCAT('Devolución Recibo #', B.FolioReciboMovil, ' ', C.Proveedor) AS Concepto,
                       A.Rec * -1 AS Mov
                FROM tblDetalleReciboMovil A
                INNER JOIN tblReciboMovil B ON A.IdReciboMovil = B.IdReciboMovil AND A.IdTienda = B.IdTienda
                INNER JOIN tblProveedores C ON B.IdProveedor = C.IdProveedor
                WHERE B.Status = 0 AND B.Devolucion = 1 AND RecGranel = 0 AND B.FechaRecibo >= ?
                  AND A.IdTienda = ? AND A.CodigoInterno IN (${marcas})
            `, [desde, idTienda, ...codigos]),
            consulta('transferencias de entrada', `
                SELECT A.CodigoInterno AS Codigo,
                       (CASE WHEN B.FechaEntrada = '1980-01-01' AND DATEDIFF(Now(), B.FechaSalida) > 2
                             THEN B.FechaSalida ELSE B.FechaEntrada END) AS Fecha,
                       CONCAT('Transferencia Entrada #', B.FolioSalida) AS Concepto,
                       A.Mov AS Mov
                FROM tblDetalleTransferenciasSalidas A
                INNER JOIN tblTransferenciasSalidas B
                        ON A.IdTransferenciaSalida = B.IdTransferenciaSalida AND A.IdTienda = B.IdTienda
                WHERE B.Status = 0 AND B.IdTiendaDestino = ?
                  AND (CASE WHEN B.FechaEntrada = '1980-01-01' AND DATEDIFF(Now(), B.FechaSalida) > 2
                            THEN B.FechaSalida ELSE B.FechaEntrada END) >= ?
                  AND A.CodigoInterno IN (${marcas})
            `, [idTienda, desde, ...codigos]),
            consulta('transferencias de salida', `
                SELECT A.CodigoInterno AS Codigo, B.FechaSalida AS Fecha,
                       CONCAT('Transferencia Salida #', B.FolioSalida) AS Concepto,
                       A.Mov * -1 AS Mov
                FROM tblDetalleTransferenciasSalidas A
                INNER JOIN tblTransferenciasSalidas B
                        ON A.IdTransferenciaSalida = B.IdTransferenciaSalida AND A.IdTienda = B.IdTienda
                WHERE B.Status = 0 AND A.IdTienda = ? AND B.FechaSalida >= ?
                  AND A.CodigoInterno IN (${marcas})
            `, [idTienda, desde, ...codigos]),
            consulta('otros movimientos', `
                SELECT A.CodigoInterno AS Codigo, B.FechaMovimiento AS Fecha,
                       CONCAT('Movimiento #', A.IdMovimiento, ' ', B.Movimiento) AS Concepto,
                       CASE WHEN B.TipoMovimiento = 0 THEN A.Mov ELSE A.Mov * -1 END AS Mov
                FROM tblDetalleMovimientos2 A
                INNER JOIN tblMovimientos2 B ON A.IdMovimiento = B.IdMovimiento AND A.IdTienda = B.IdTienda
                WHERE B.Status = 0 AND B.FechaMovimiento >= ?
                  AND A.IdTienda = ? AND A.CodigoInterno IN (${marcas})
            `, [desde, idTienda, ...codigos]),
            consulta('empacados', `
                SELECT A.CodigoInterno AS Codigo, B.FechaEmpacado AS Fecha,
                       CONCAT('Empacado #', A.IdEmpacado, ' ', B.Concepto) AS Concepto,
                       CASE WHEN B.TipoMovimiento = 0 THEN A.Cantidad ELSE A.Cantidad * -1 END AS Mov
                FROM tblDetalleEmpacados2 A
                INNER JOIN tblEmpacados2 B ON A.IdEmpacado = B.IdEmpacado AND A.IdTienda = B.IdTienda
                WHERE B.FechaEmpacado >= ? AND A.IdTienda = ? AND A.CodigoInterno IN (${marcas})
            `, [desde, idTienda, ...codigos]),
            consulta('devoluciones de venta', `
                SELECT A.CodigoInterno AS Codigo, B.FechaDevolucionVenta AS Fecha,
                       CONCAT('Devolución Venta #', A.IdDevolucionVenta) AS Concepto,
                       A.Cantidad AS Mov
                FROM tblDetalleDevolucionesVenta A
                INNER JOIN tblDevolucionesVenta B
                        ON A.IdDevolucionVenta = B.IdDevolucionVenta AND A.IdTienda = B.IdTienda
                WHERE A.Cantidad > 0 AND B.FechaDevolucionVenta >= ?
                  AND A.IdTienda = ? AND A.CodigoInterno IN (${marcas})
            `, [desde, idTienda, ...codigos]),
            consulta('ventas', `
                SELECT A.CodigoInterno AS Codigo, DATE(B.FechaVenta) AS Fecha,
                       'Ventas del día' AS Concepto,
                       SUM(A.Cantidad) * -1 AS Mov
                FROM tblDetalleVentas A
                INNER JOIN tblVentas B ON A.IdVenta = B.IdVenta AND A.IdComputadora = B.IdComputadora
                WHERE B.FechaVenta >= ? AND A.CodigoInterno IN (${marcas})
                GROUP BY A.CodigoInterno, DATE(B.FechaVenta)
            `, [desde, ...codigos]),
            consulta('ventas POS', `
                SELECT CodigoInterno AS Codigo, DATE(FechaVenta) AS Fecha,
                       'Ventas POS del día' AS Concepto, SUM(Cantidad) * -1 AS Mov
                FROM tblVentasPOS WHERE FechaVenta >= ? AND CodigoInterno IN (${marcas})
                GROUP BY CodigoInterno, DATE(FechaVenta)
            `, [desde, ...codigos]),
            consulta('facturas CEDIS', `
                SELECT A.CodigoInterno AS Codigo, B.FechaFactura AS Fecha,
                       CONCAT('Factura CEDIS ', B.ClienteConcepto) AS Concepto,
                       A.Cantidad * A.CantidadCompra * -1 AS Mov
                FROM tblDetalleFacturasCedis A
                INNER JOIN tblFacturasCedis B ON A.IdFactura = B.IdFactura AND A.IdTienda = B.IdTienda
                WHERE B.Status IN (0,1,3) AND B.FechaFactura >= ?
                  AND A.IdTienda = ? AND A.CodigoInterno IN (${marcas})
            `, [desde, idTienda, ...codigos]),
            consulta('movimientos SAP', `
                SELECT CodigoInterno AS Codigo, FechaMovimientoSAP AS Fecha,
                       Concepto, Mov
                FROM tblMovimientosSAP WHERE FechaMovimientoSAP >= ? AND CodigoInterno IN (${marcas})
            `, [desde, ...codigos]),
        ]);

        // Códigos de barras de la familia, para etiquetar cada renglón
        const fichas = new Map<number, string>();
        const fichasRows = (await tiendaQuery(idTienda, `
            SELECT CodigoInterno, CodigoBarras FROM tblArticulos WHERE CodigoInterno IN (${marcas})
        `, codigos).catch(() => [])) as Row[];
        for (const f of fichasRows ?? []) {
            fichas.set(num(f.CodigoInterno), String(f.CodigoBarras ?? '').trim());
        }

        const todos: Movimiento[] = [];
        for (const grupo of [ajustes, recibos, devRecibos, transfEntradas, transfSalidas,
            movimientos2, empacados, devVenta, ventas, ventasPos, cedis, sap]) {
            for (const r of grupo) {
                const codigo = num(r.Codigo);
                const mov = num(r.Mov);
                if (mov === 0) continue;
                const factor = familia.get(codigo)?.factor ?? 1;
                todos.push({
                    codigoInterno: codigo,
                    codigoBarras: fichas.get(codigo) ?? String(codigo),
                    fecha: String(r.Fecha ?? '').split('.')[0],
                    concepto: String(r.Concepto ?? '').trim(),
                    mov,
                    equiv: mov / factor,
                });
            }
        }
        todos.sort((a, b) => a.fecha.localeCompare(b.fecha));

        const truncado = todos.length > MAX_MOVIMIENTOS;
        return NextResponse.json({
            maestro,
            dias,
            desde: desde.slice(0, 10),
            truncado,
            // Con truncado se conservan los MÁS RECIENTES (el modal baja al fondo)
            movimientos: truncado ? todos.slice(-MAX_MOVIMIENTOS) : todos,
            advertencias,
        });
    } catch (error) {
        console.error('Error al consultar movimientos del artículo:', error);
        return NextResponse.json(
            { error: 'Error al consultar los movimientos del artículo' },
            { status: 500 }
        );
    }
}
