import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { tiendaQuery } from '@/lib/tienda-db';
import { mysqlQuery } from '@/lib/mysql';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Row = Record<string, unknown>;
const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

// Existencia de UN artículo sin recalcular todo el proveedor:
//   existencia ≈ Exi del corte nocturno (tblInventariosCostosActual del MySQL
//   central, poblada por KYKInvServices) + movimientos desde el corte, leídos
//   del MySQL de la tienda con el mismo SQL del servicio Java (ThreadMovimientos):
//   recibos, transferencias, movimientos, empacados, devoluciones y ventas.
// Si hubo un ajuste de inventario después del corte, el ajuste manda (resetea
// la base). Las devoluciones de compra apartadas hoy no se restan (se reflejan
// en el corte de mañana). Kits: los movimientos de las variantes (tblKits)
// aportan Mov/Factor al artículo consultado, igual que el servicio.
export async function GET(request: Request) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const codigoInterno = Number(searchParams.get('codigoInterno'));
    if (!Number.isInteger(codigoInterno) || codigoInterno <= 0) {
        return NextResponse.json({ error: 'Artículo inválido' }, { status: 400 });
    }
    const idTienda = session.idTienda;

    try {
        // Artículo + familia de kits (variantes que descuentan al padre)
        const [articulos, kits, snapshots, marcadores] = await Promise.all([
            tiendaQuery(idTienda, `
                SELECT CodigoInterno, CodigoBarras, Descripcion, MedidaVenta, MedidaCompra, Precio, Status
                FROM tblArticulos WHERE CodigoInterno = ? LIMIT 1
            `, [codigoInterno]) as Promise<Row[]>,
            tiendaQuery(idTienda, `
                SELECT CodigoInterno, Factor FROM tblKits WHERE CodigoInterno2 = ?
            `, [codigoInterno]).catch(() => []) as Promise<Row[]>,
            mysqlQuery(`
                SELECT Exi, PVD, Costo, Fecha FROM tblInventariosCostosActual
                WHERE IdTienda = ? AND CodigoInterno = ? LIMIT 1
            `, [idTienda, codigoInterno]).catch(() => []) as Promise<Row[]>,
            mysqlQuery(`
                SELECT FechaActEstadoInventarios FROM tblActualizacionesTiendas WHERE IdTienda = ? LIMIT 1
            `, [idTienda]).catch(() => []) as Promise<Row[]>,
        ]);

        const articulo = articulos?.[0];
        if (!articulo) {
            return NextResponse.json({ error: 'Artículo no encontrado en la tienda' }, { status: 404 });
        }

        // Base y fecha de corte: snapshot nocturno, o el último ajuste si es más nuevo
        const snapshot = snapshots?.[0] ?? null;
        let base = num(snapshot?.Exi);
        const pvd = num(snapshot?.PVD);
        // El snapshot representa el cierre de su Fecha: el delta arranca al día siguiente
        let corte = snapshot?.Fecha
            ? new Date(new Date(String(snapshot.Fecha)).getTime() + 24 * 60 * 60 * 1000)
            : null;
        let baseOrigen: 'corte' | 'ajuste' | 'sin-corte' = snapshot ? 'corte' : 'sin-corte';

        const ajustes = (await tiendaQuery(idTienda, `
            SELECT D.Exi, C.FechaAjuste
            FROM tblDetalleAjustesInventarios D
            INNER JOIN tblAjustesInventarios C
                    ON D.IdAjusteInventario = C.IdAjusteInventario AND D.IdTienda = C.IdTienda
            WHERE D.CodigoInterno = ? AND D.IdTienda = ?
            ORDER BY C.FechaAjuste DESC LIMIT 1
        `, [codigoInterno, idTienda]).catch(() => [])) as Row[];
        const ajuste = ajustes?.[0];
        if (ajuste?.FechaAjuste) {
            const fechaAjuste = new Date(String(ajuste.FechaAjuste));
            if (!corte || fechaAjuste >= corte) {
                base = num(ajuste.Exi);
                corte = fechaAjuste;
                baseOrigen = 'ajuste';
            }
        }
        if (!corte) {
            // Sin corte ni ajuste: solo movimientos de los últimos 30 días sobre base 0
            corte = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        }
        const desde = corte.toISOString().slice(0, 19).replace('T', ' ');

        // Familia: el artículo (Factor 1) + sus variantes de kit (Mov/Factor)
        const factores = new Map<number, number>([[codigoInterno, 1]]);
        for (const k of kits ?? []) {
            const factor = num(k.Factor);
            factores.set(num(k.CodigoInterno), factor > 0 ? factor : 1);
        }
        const codigos = [...factores.keys()];
        const marcas = codigos.map(() => '?').join(',');
        const advertencias: string[] = [];

        // Suma de un origen de movimientos; las tablas opcionales (POS, CEDIS,
        // SAP) pueden no existir en la tienda: se reportan y se toman como 0
        const suma = async (nombre: string, sql: string, params: (string | number)[]): Promise<number> => {
            try {
                const rows = (await tiendaQuery(idTienda, sql, params)) as Row[];
                let total = 0;
                for (const r of rows ?? []) {
                    total += num(r.Mov) / (factores.get(num(r.CodigoInterno)) ?? 1);
                }
                return total;
            } catch {
                advertencias.push(nombre);
                return 0;
            }
        };

        const [
            recibos, devRecibos, transfEntradas, transfSalidas,
            movEntradas, movSalidas, empEntradas, empSalidas,
            devVenta, ventas, ventasPos, cedis, sap,
        ] = await Promise.all([
            suma('recibos', `
                SELECT A.CodigoInterno, SUM(CASE WHEN D.IdTipo = 2 AND RecGranel > 0 THEN RecGranel
                    ELSE CASE WHEN RecGranel = 0 AND D.TipoOperacion <> 1 THEN Rec * A.CantidadCompra
                              WHEN D.TipoOperacion = 1 THEN Rec
                              ELSE RecGranel / A.CantidadCompra END END) AS Mov
                FROM tblDetalleReciboMovil A
                INNER JOIN tblReciboMovil B ON A.IdReciboMovil = B.IdReciboMovil AND A.IdTienda = B.IdTienda
                INNER JOIN tblArticulos D ON A.CodigoInterno = D.CodigoInterno
                WHERE B.Status = 0 AND B.Devolucion = 0 AND B.FechaRecibo >= ? AND A.IdTienda = ?
                  AND A.CodigoInterno IN (${marcas})
                GROUP BY A.CodigoInterno
            `, [desde, idTienda, ...codigos]),
            suma('devoluciones de recibo', `
                SELECT A.CodigoInterno, SUM(Rec) AS Mov
                FROM tblDetalleReciboMovil A
                INNER JOIN tblReciboMovil B ON A.IdReciboMovil = B.IdReciboMovil AND A.IdTienda = B.IdTienda
                WHERE B.Status = 0 AND B.Devolucion = 1 AND RecGranel = 0 AND B.FechaRecibo >= ?
                  AND A.IdTienda = ? AND A.CodigoInterno IN (${marcas})
                GROUP BY A.CodigoInterno
            `, [desde, idTienda, ...codigos]),
            suma('transferencias de entrada', `
                SELECT A.CodigoInterno, SUM(A.Mov) AS Mov
                FROM tblDetalleTransferenciasSalidas A
                INNER JOIN tblTransferenciasSalidas B
                        ON A.IdTransferenciaSalida = B.IdTransferenciaSalida AND A.IdTienda = B.IdTienda
                WHERE B.Status = 0 AND B.IdTiendaDestino = ?
                  AND (CASE WHEN B.FechaEntrada = '1980-01-01' AND DATEDIFF(Now(), B.FechaSalida) > 2
                            THEN B.FechaSalida ELSE B.FechaEntrada END) >= ?
                  AND A.CodigoInterno IN (${marcas})
                GROUP BY A.CodigoInterno
            `, [idTienda, desde, ...codigos]),
            suma('transferencias de salida', `
                SELECT A.CodigoInterno, SUM(A.Mov) AS Mov
                FROM tblDetalleTransferenciasSalidas A
                INNER JOIN tblTransferenciasSalidas B
                        ON A.IdTransferenciaSalida = B.IdTransferenciaSalida AND A.IdTienda = B.IdTienda
                WHERE B.Status = 0 AND A.IdTienda = ? AND B.FechaSalida >= ?
                  AND A.CodigoInterno IN (${marcas})
                GROUP BY A.CodigoInterno
            `, [idTienda, desde, ...codigos]),
            suma('otros movimientos (entradas)', `
                SELECT A.CodigoInterno, SUM(A.Mov) AS Mov
                FROM tblDetalleMovimientos2 A
                INNER JOIN tblMovimientos2 B ON A.IdMovimiento = B.IdMovimiento AND A.IdTienda = B.IdTienda
                WHERE B.Status = 0 AND B.FechaMovimiento >= ? AND B.TipoMovimiento = 0
                  AND A.IdTienda = ? AND A.CodigoInterno IN (${marcas})
                GROUP BY A.CodigoInterno
            `, [desde, idTienda, ...codigos]),
            suma('otros movimientos (salidas)', `
                SELECT A.CodigoInterno, SUM(A.Mov) AS Mov
                FROM tblDetalleMovimientos2 A
                INNER JOIN tblMovimientos2 B ON A.IdMovimiento = B.IdMovimiento AND A.IdTienda = B.IdTienda
                WHERE B.Status = 0 AND B.FechaMovimiento >= ? AND B.TipoMovimiento = 1
                  AND A.IdTienda = ? AND A.CodigoInterno IN (${marcas})
                GROUP BY A.CodigoInterno
            `, [desde, idTienda, ...codigos]),
            suma('empacados (entradas)', `
                SELECT A.CodigoInterno, SUM(A.Cantidad) AS Mov
                FROM tblDetalleEmpacados2 A
                INNER JOIN tblEmpacados2 B ON A.IdEmpacado = B.IdEmpacado AND A.IdTienda = B.IdTienda
                WHERE B.FechaEmpacado >= ? AND B.TipoMovimiento = 0
                  AND A.IdTienda = ? AND A.CodigoInterno IN (${marcas})
                GROUP BY A.CodigoInterno
            `, [desde, idTienda, ...codigos]),
            suma('empacados (salidas)', `
                SELECT A.CodigoInterno, SUM(A.Cantidad) AS Mov
                FROM tblDetalleEmpacados2 A
                INNER JOIN tblEmpacados2 B ON A.IdEmpacado = B.IdEmpacado AND A.IdTienda = B.IdTienda
                WHERE B.FechaEmpacado >= ? AND B.TipoMovimiento = 1
                  AND A.IdTienda = ? AND A.CodigoInterno IN (${marcas})
                GROUP BY A.CodigoInterno
            `, [desde, idTienda, ...codigos]),
            suma('devoluciones de venta', `
                SELECT A.CodigoInterno, SUM(A.Cantidad) AS Mov
                FROM tblDetalleDevolucionesVenta A
                INNER JOIN tblDevolucionesVenta B
                        ON A.IdDevolucionVenta = B.IdDevolucionVenta AND A.IdTienda = B.IdTienda
                WHERE A.Cantidad > 0 AND B.FechaDevolucionVenta >= ?
                  AND A.IdTienda = ? AND A.CodigoInterno IN (${marcas})
                GROUP BY A.CodigoInterno
            `, [desde, idTienda, ...codigos]),
            suma('ventas', `
                SELECT A.CodigoInterno, SUM(A.Cantidad) AS Mov
                FROM tblDetalleVentas A
                INNER JOIN tblVentas B ON A.IdVenta = B.IdVenta AND A.IdComputadora = B.IdComputadora
                WHERE B.FechaVenta >= ? AND A.CodigoInterno IN (${marcas})
                GROUP BY A.CodigoInterno
            `, [desde, ...codigos]),
            suma('ventas POS', `
                SELECT CodigoInterno, SUM(Cantidad) AS Mov
                FROM tblVentasPOS WHERE FechaVenta >= ? AND CodigoInterno IN (${marcas})
                GROUP BY CodigoInterno
            `, [desde, ...codigos]),
            suma('facturas CEDIS', `
                SELECT A.CodigoInterno, SUM(A.Cantidad * A.CantidadCompra) AS Mov
                FROM tblDetalleFacturasCedis A
                INNER JOIN tblFacturasCedis B ON A.IdFactura = B.IdFactura AND A.IdTienda = B.IdTienda
                WHERE B.Status IN (0,1,3) AND B.FechaFactura >= ?
                  AND A.IdTienda = ? AND A.CodigoInterno IN (${marcas})
                GROUP BY A.CodigoInterno
            `, [desde, idTienda, ...codigos]),
            suma('movimientos SAP', `
                SELECT CodigoInterno, SUM(Mov) AS Mov
                FROM tblMovimientosSAP WHERE FechaMovimientoSAP >= ? AND CodigoInterno IN (${marcas})
                GROUP BY CodigoInterno
            `, [desde, ...codigos]),
        ]);

        const entradas = recibos + transfEntradas + movEntradas + empEntradas + devVenta + Math.max(sap, 0);
        const salidas = ventas + ventasPos + devRecibos + transfSalidas + movSalidas + empSalidas + cedis + Math.max(-sap, 0);
        const existencia = base + entradas - salidas;
        const diasCobertura = pvd > 0 ? existencia / pvd : null;

        return NextResponse.json({
            articulo: {
                codigoInterno: num(articulo.CodigoInterno),
                codigoBarras: String(articulo.CodigoBarras ?? '').trim(),
                descripcion: String(articulo.Descripcion ?? '').trim(),
                medidaVenta: String(articulo.MedidaVenta ?? '').trim(),
                precio: num(articulo.Precio),
            },
            existencia,
            diasCobertura,
            pvd,
            corte: {
                base,
                origen: baseOrigen,
                desde,
                snapshotFecha: snapshot?.Fecha ? String(snapshot.Fecha).slice(0, 10) : null,
                actualizadoTienda: marcadores?.[0]?.FechaActEstadoInventarios
                    ? String(marcadores[0].FechaActEstadoInventarios)
                    : null,
            },
            desdeElCorte: { entradas, salidas },
            variantesKit: codigos.length - 1,
            advertencias,
        });
    } catch (error) {
        console.error('Error al calcular existencia:', error);
        return NextResponse.json(
            { error: 'Error al calcular la existencia del artículo' },
            { status: 500 }
        );
    }
}
