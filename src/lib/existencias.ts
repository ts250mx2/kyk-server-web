import { tiendaQuery } from './tienda-db';
import { mysqlQuery } from './mysql';
import { cargarKits, familiaDetallada, resolverMaestro, type Kits } from './kits';

// Existencia de UN artículo en UNA tienda, sin recalcular todo el proveedor:
//   existencia ≈ Exi del corte nocturno (tblInventariosCostosActual del MySQL
//   central, poblada por KYKInvServices) + movimientos desde el corte, leídos
//   del MySQL de la tienda con el mismo SQL del servicio Java (ThreadMovimientos):
//   recibos, transferencias, movimientos, empacados, devoluciones y ventas.
// Si hubo un ajuste de inventario después del corte, el ajuste manda (resetea
// la base). Las devoluciones de compra apartadas hoy no se restan (se reflejan
// en el corte de mañana). Kits: los movimientos de las variantes (tblKits)
// aportan Mov/Factor al artículo consultado, igual que el servicio.
// Lo usan la API de inventarios (tienda de la sesión) y el bot de existencias
// del chat (tienda del canal).

type Row = Record<string, unknown>;
const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

// Fecha en hora LOCAL con formato SQL (toISOString la correría 6 h a UTC y
// mysql2 regresa DATE/DATETIME como objetos Date que no deben ir a String())
const p2 = (n: number) => String(n).padStart(2, '0');
const fechaSqlLocal = (d: Date): string =>
    `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
export const fechaTexto = (v: unknown): string =>
    v instanceof Date ? fechaSqlLocal(v) : String(v ?? '').split('.')[0];

export interface ExistenciaArticulo {
    articulo: {
        codigoInterno: number;
        codigoBarras: string;
        descripcion: string;
        medidaVenta: string;
        precio: number;
        ultimoCosto: number;
    };
    existencia: number;
    diasCobertura: number | null;
    pvd: number;
    corte: {
        base: number;
        origen: 'corte' | 'ajuste' | 'sin-corte';
        desde: string;
        snapshotFecha: string | null;
    };
    desdeElCorte: { entradas: number; salidas: number };
    ultimoInventarioFisico: { fecha: string; exi: number } | null;
    ultimaCaptura: string | null;
    variantesKit: number;
    variantes: { codigoInterno: number; codigoBarras: string; descripcion: string; nivel: number }[];
    varianteConsultada: { codigoInterno: number; codigoBarras: string; descripcion: string } | null;
    advertencias: string[];
}

/** Existencia estimada del artículo en la tienda; null si no existe ahí. */
export async function calcularExistencia(
    idTienda: number,
    codigoInterno: number
): Promise<ExistenciaArticulo | null> {
    // Ligas de kits de la tienda (regla recursiva del webservice): si el
    // código consultado es una variante, su existencia real vive en el
    // maestro raíz — se calcula sobre el maestro y se avisa en la respuesta.
    const kits = await cargarKits(idTienda);
    let maestro = resolverMaestro(codigoInterno, kits).maestro;

    const codigosBuscar = maestro === codigoInterno ? [codigoInterno] : [codigoInterno, maestro];
    const marcasArt = codigosBuscar.map(() => '?').join(',');
    const articulosRows = (await tiendaQuery(idTienda, `
        SELECT CodigoInterno, CodigoBarras, Descripcion, MedidaVenta, MedidaCompra, Precio, UltimoCosto, Status
        FROM tblArticulos WHERE CodigoInterno IN (${marcasArt})
    `, codigosBuscar)) as Row[];
    const porCodigo = new Map((articulosRows ?? []).map(r => [num(r.CodigoInterno), r] as [number, Row]));

    const pedido = porCodigo.get(codigoInterno);
    if (!pedido) return null;
    // Si el maestro no existe como artículo en la tienda, el consultado se queda como propio maestro
    if (!porCodigo.has(maestro)) maestro = codigoInterno;
    const articulo = porCodigo.get(maestro)!;
    const esVariante = maestro !== codigoInterno;

    const snapshots = (await mysqlQuery(`
        SELECT Exi, PVD, Costo, Fecha FROM tblInventariosCostosActual
        WHERE IdTienda = ? AND CodigoInterno = ? LIMIT 1
    `, [idTienda, maestro]).catch(() => [])) as Row[];

    // Base y fecha de corte: snapshot nocturno, o el último ajuste si es más nuevo
    const snapshot = snapshots?.[0] ?? null;
    let base = num(snapshot?.Exi);
    const pvd = num(snapshot?.PVD);
    // El snapshot se toma en la MADRUGADA de su Fecha y refleja el cierre del
    // día anterior: TODOS los movimientos del propio día del corte (ventas,
    // recibos, devoluciones, transferencias...) van encima de la base — el
    // delta arranca a las 00:00 de la Fecha del corte, no al día siguiente
    let corte = snapshot?.Fecha
        ? new Date(fechaTexto(snapshot.Fecha))
        : null;
    let baseOrigen: 'corte' | 'ajuste' | 'sin-corte' = snapshot ? 'corte' : 'sin-corte';

    const ajustes = (await tiendaQuery(idTienda, `
        SELECT D.Exi, C.FechaAjuste
        FROM tblDetalleAjustesInventarios D
        INNER JOIN tblAjustesInventarios C
                ON D.IdAjusteInventario = C.IdAjusteInventario AND D.IdTienda = C.IdTienda
        WHERE D.CodigoInterno = ? AND D.IdTienda = ?
        ORDER BY C.FechaAjuste DESC LIMIT 1
    `, [maestro, idTienda]).catch(() => [])) as Row[];
    const ajuste = ajustes?.[0];
    if (ajuste?.FechaAjuste) {
        const fechaAjuste = new Date(fechaTexto(ajuste.FechaAjuste));
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
    const desde = fechaSqlLocal(corte);

    // Familia recursiva del maestro: variantes y nietas con el Factor
    // acumulado y su nivel (p.ej. maestro → 076 → 1076), como el Java
    const familia = familiaDetallada(maestro, kits);
    const factores = new Map([...familia].map(([codigo, v]) => [codigo, v.factor]));
    const codigos = [...factores.keys()];

    // Fichas de las variantes, para listar qué incluye la familia
    const codigosVariantes = codigos.filter(c => c !== maestro);
    const fichasVariantes = new Map<number, Row>();
    if (codigosVariantes.length > 0) {
        const marcasVar = codigosVariantes.map(() => '?').join(',');
        const filasVar = (await tiendaQuery(idTienda, `
            SELECT CodigoInterno, CodigoBarras, Descripcion
            FROM tblArticulos WHERE CodigoInterno IN (${marcasVar})
        `, codigosVariantes).catch(() => [])) as Row[];
        for (const f of filasVar ?? []) fichasVariantes.set(num(f.CodigoInterno), f);
    }
    const marcas = codigos.map(() => '?').join(',');
    const advertencias: string[] = [];

    // Suma de un origen de movimientos; las tablas opcionales (POS, CEDIS,
    // SAP) pueden no existir en la tienda: se reportan y se toman como 0.
    // Esquema viejo (bodegas): si falta una columna (errno 1054) se intenta
    // sqlViejo, o se regresa 0 en silencio si el concepto no existe ahí.
    const suma = async (
        nombre: string,
        sql: string,
        params: (string | number)[],
        opciones?: { sqlViejo?: string; omitirSiFaltaColumna?: boolean }
    ): Promise<number> => {
        const sumar = (rows: Row[]) => {
            let total = 0;
            for (const r of rows ?? []) {
                total += num(r.Mov) / (factores.get(num(r.CodigoInterno)) ?? 1);
            }
            return total;
        };
        try {
            return sumar((await tiendaQuery(idTienda, sql, params)) as Row[]);
        } catch (error) {
            const faltaColumna = (error as { errno?: number }).errno === 1054;
            if (faltaColumna && opciones?.sqlViejo) {
                try {
                    return sumar((await tiendaQuery(idTienda, opciones.sqlViejo, params)) as Row[]);
                } catch { /* cae a la advertencia */ }
            }
            if (faltaColumna && opciones?.omitirSiFaltaColumna) return 0;
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
            WHERE B.Status = 0 AND A.Devolucion = 0 AND B.FechaRecibo >= ? AND A.IdTienda = ?
              AND A.CodigoInterno IN (${marcas})
            GROUP BY A.CodigoInterno
        `, [desde, idTienda, ...codigos], {
            // Devolucion vive en el DETALLE (el header nunca la tuvo); si algún
            // esquema muy viejo tampoco la tiene ahí, todos los recibos son entradas
            sqlViejo: `
                SELECT A.CodigoInterno, SUM(CASE WHEN D.IdTipo = 2 AND RecGranel > 0 THEN RecGranel
                    ELSE CASE WHEN RecGranel = 0 AND D.TipoOperacion <> 1 THEN Rec * A.CantidadCompra
                              WHEN D.TipoOperacion = 1 THEN Rec
                              ELSE RecGranel / A.CantidadCompra END END) AS Mov
                FROM tblDetalleReciboMovil A
                INNER JOIN tblReciboMovil B ON A.IdReciboMovil = B.IdReciboMovil AND A.IdTienda = B.IdTienda
                INNER JOIN tblArticulos D ON A.CodigoInterno = D.CodigoInterno
                WHERE B.Status = 0 AND B.FechaRecibo >= ? AND A.IdTienda = ?
                  AND A.CodigoInterno IN (${marcas})
                GROUP BY A.CodigoInterno
            `,
        }),
        suma('devoluciones de recibo', `
            SELECT A.CodigoInterno, SUM(Rec) AS Mov
            FROM tblDetalleReciboMovil A
            INNER JOIN tblReciboMovil B ON A.IdReciboMovil = B.IdReciboMovil AND A.IdTienda = B.IdTienda
            WHERE B.Status = 0 AND A.Devolucion = 1 AND RecGranel = 0 AND B.FechaRecibo >= ?
              AND A.IdTienda = ? AND A.CodigoInterno IN (${marcas})
            GROUP BY A.CodigoInterno
        `, [desde, idTienda, ...codigos], {
            // Esquema viejo sin Devolucion en el detalle: no existen devoluciones
            omitirSiFaltaColumna: true,
        }),
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
        // TipoMovimiento de empacados vive en el DETALLE (igual que en el Java)
        suma('empacados (entradas)', `
            SELECT A.CodigoInterno, SUM(A.Cantidad) AS Mov
            FROM tblDetalleEmpacados2 A
            INNER JOIN tblEmpacados2 B ON A.IdEmpacado = B.IdEmpacado AND A.IdTienda = B.IdTienda
            WHERE B.FechaEmpacado >= ? AND A.TipoMovimiento = 0
              AND A.IdTienda = ? AND A.CodigoInterno IN (${marcas})
            GROUP BY A.CodigoInterno
        `, [desde, idTienda, ...codigos]),
        suma('empacados (salidas)', `
            SELECT A.CodigoInterno, SUM(A.Cantidad) AS Mov
            FROM tblDetalleEmpacados2 A
            INNER JOIN tblEmpacados2 B ON A.IdEmpacado = B.IdEmpacado AND A.IdTienda = B.IdTienda
            WHERE B.FechaEmpacado >= ? AND A.TipoMovimiento = 1
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

    // Última corrección manual (captura de inventario o ajustes por movimiento):
    // son las purgas del acumulado — si están viejas, el saldo puede traer
    // arrastre de salidas/mermas no registradas
    const capturas = (await tiendaQuery(idTienda, `
        SELECT MAX(B.FechaMovimiento) AS Fecha
        FROM tblDetalleMovimientos2 A
        INNER JOIN tblMovimientos2 B ON A.IdMovimiento = B.IdMovimiento AND A.IdTienda = B.IdTienda
        WHERE B.Status = 0 AND A.IdTienda = ? AND A.CodigoInterno IN (${marcas})
          AND (B.Movimiento LIKE '%captura%' OR B.Movimiento LIKE '%AJUSTE%')
    `, [idTienda, ...codigos]).catch(() => [])) as Row[];
    const ultimaCaptura = capturas?.[0]?.Fecha
        ? fechaTexto(capturas[0].Fecha).slice(0, 10)
        : null;

    return {
        articulo: {
            codigoInterno: num(articulo.CodigoInterno),
            codigoBarras: String(articulo.CodigoBarras ?? '').trim(),
            descripcion: String(articulo.Descripcion ?? '').trim(),
            medidaVenta: String(articulo.MedidaVenta ?? '').trim(),
            precio: num(articulo.Precio),
            ultimoCosto: num(articulo.UltimoCosto),
        },
        existencia,
        diasCobertura,
        pvd,
        corte: {
            base,
            origen: baseOrigen,
            desde,
            snapshotFecha: snapshot?.Fecha ? fechaTexto(snapshot.Fecha).slice(0, 10) : null,
        },
        desdeElCorte: { entradas, salidas },
        ultimoInventarioFisico: ajuste?.FechaAjuste
            ? { fecha: fechaTexto(ajuste.FechaAjuste).slice(0, 10), exi: num(ajuste.Exi) }
            : null,
        ultimaCaptura,
        variantesKit: codigos.length - 1,
        // Cadena completa de variantes (nivel 1 = hija, 2 = nieta...)
        variantes: codigosVariantes
            .map(codigo => {
                const ficha = fichasVariantes.get(codigo);
                return {
                    codigoInterno: codigo,
                    codigoBarras: String(ficha?.CodigoBarras ?? '').trim(),
                    descripcion: String(ficha?.Descripcion ?? `Código ${codigo}`).trim(),
                    nivel: familia.get(codigo)?.nivel ?? 1,
                };
            })
            .sort((a, b) => a.nivel - b.nivel || a.descripcion.localeCompare(b.descripcion)),
        // Cuando se consulta una variante, se avisa que la cifra es del maestro
        varianteConsultada: esVariante
            ? {
                codigoInterno,
                codigoBarras: String(pedido.CodigoBarras ?? '').trim(),
                descripcion: String(pedido.Descripcion ?? '').trim(),
            }
            : null,
        advertencias,
    };
}

/** Deltas de existencia por MAESTRO de TODO el catálogo desde una fecha (los
 *  movimientos del día del corte en adelante): Map<codigoMaestro, ±unidades>
 *  con los factores de kits aplicados (Mov/Factor). Ajusta en bloque los
 *  reportes que parten del corte nocturno (Quiebres, Quiebre de Stock) sin
 *  recalcular artículo por artículo. Las tablas opcionales o con esquema
 *  viejo se omiten en silencio: son reportes, no deben tronar por eso. */
export async function deltasDesdeCorte(
    idTienda: number,
    desde: string,
    kits: Kits
): Promise<Map<number, number>> {
    const deltas = new Map<number, number>();

    const aplicar = (rows: Row[], signo: 1 | -1) => {
        for (const r of rows ?? []) {
            const codigo = num(r.CodigoInterno);
            const mov = num(r.Mov);
            if (codigo <= 0 || mov === 0) continue;
            const { maestro, factor } = resolverMaestro(codigo, kits);
            deltas.set(maestro, (deltas.get(maestro) ?? 0) + (signo * mov) / (factor || 1));
        }
    };

    const consulta = async (
        sql: string,
        params: (string | number)[],
        sqlViejo?: string
    ): Promise<Row[]> => {
        try {
            return ((await tiendaQuery(idTienda, sql, params)) as Row[]) ?? [];
        } catch (error) {
            if ((error as { errno?: number }).errno === 1054 && sqlViejo) {
                try {
                    return ((await tiendaQuery(idTienda, sqlViejo, params)) as Row[]) ?? [];
                } catch { /* esquema aún más viejo: se omite */ }
            }
            return [];
        }
    };

    const [
        ventas, ventasPos, recibos, devRecibos, transfEntradas, transfSalidas,
        movimientos2, empacados, devVenta, cedis, sap,
    ] = await Promise.all([
        consulta(`
            SELECT A.CodigoInterno, SUM(A.Cantidad) AS Mov
            FROM tblDetalleVentas A
            INNER JOIN tblVentas B ON A.IdVenta = B.IdVenta AND A.IdComputadora = B.IdComputadora
            WHERE B.FechaVenta >= ?
            GROUP BY A.CodigoInterno
        `, [desde]),
        consulta(`
            SELECT CodigoInterno, SUM(Cantidad) AS Mov
            FROM tblVentasPOS WHERE FechaVenta >= ?
            GROUP BY CodigoInterno
        `, [desde]),
        consulta(`
            SELECT A.CodigoInterno, SUM(CASE WHEN D.IdTipo = 2 AND RecGranel > 0 THEN RecGranel
                ELSE CASE WHEN RecGranel = 0 AND D.TipoOperacion <> 1 THEN Rec * A.CantidadCompra
                          WHEN D.TipoOperacion = 1 THEN Rec
                          ELSE RecGranel / A.CantidadCompra END END) AS Mov
            FROM tblDetalleReciboMovil A
            INNER JOIN tblReciboMovil B ON A.IdReciboMovil = B.IdReciboMovil AND A.IdTienda = B.IdTienda
            INNER JOIN tblArticulos D ON A.CodigoInterno = D.CodigoInterno
            WHERE B.Status = 0 AND A.Devolucion = 0 AND B.FechaRecibo >= ? AND A.IdTienda = ?
            GROUP BY A.CodigoInterno
        `, [desde, idTienda], `
            SELECT A.CodigoInterno, SUM(CASE WHEN D.IdTipo = 2 AND RecGranel > 0 THEN RecGranel
                ELSE CASE WHEN RecGranel = 0 AND D.TipoOperacion <> 1 THEN Rec * A.CantidadCompra
                          WHEN D.TipoOperacion = 1 THEN Rec
                          ELSE RecGranel / A.CantidadCompra END END) AS Mov
            FROM tblDetalleReciboMovil A
            INNER JOIN tblReciboMovil B ON A.IdReciboMovil = B.IdReciboMovil AND A.IdTienda = B.IdTienda
            INNER JOIN tblArticulos D ON A.CodigoInterno = D.CodigoInterno
            WHERE B.Status = 0 AND B.FechaRecibo >= ? AND A.IdTienda = ?
            GROUP BY A.CodigoInterno
        `),
        consulta(`
            SELECT A.CodigoInterno, SUM(Rec) AS Mov
            FROM tblDetalleReciboMovil A
            INNER JOIN tblReciboMovil B ON A.IdReciboMovil = B.IdReciboMovil AND A.IdTienda = B.IdTienda
            WHERE B.Status = 0 AND A.Devolucion = 1 AND RecGranel = 0 AND B.FechaRecibo >= ?
              AND A.IdTienda = ?
            GROUP BY A.CodigoInterno
        `, [desde, idTienda]),
        consulta(`
            SELECT A.CodigoInterno, SUM(A.Mov) AS Mov
            FROM tblDetalleTransferenciasSalidas A
            INNER JOIN tblTransferenciasSalidas B
                    ON A.IdTransferenciaSalida = B.IdTransferenciaSalida AND A.IdTienda = B.IdTienda
            WHERE B.Status = 0 AND B.IdTiendaDestino = ?
              AND (CASE WHEN B.FechaEntrada = '1980-01-01' AND DATEDIFF(Now(), B.FechaSalida) > 2
                        THEN B.FechaSalida ELSE B.FechaEntrada END) >= ?
            GROUP BY A.CodigoInterno
        `, [idTienda, desde]),
        consulta(`
            SELECT A.CodigoInterno, SUM(A.Mov) AS Mov
            FROM tblDetalleTransferenciasSalidas A
            INNER JOIN tblTransferenciasSalidas B
                    ON A.IdTransferenciaSalida = B.IdTransferenciaSalida AND A.IdTienda = B.IdTienda
            WHERE B.Status = 0 AND A.IdTienda = ? AND B.FechaSalida >= ?
            GROUP BY A.CodigoInterno
        `, [idTienda, desde]),
        consulta(`
            SELECT A.CodigoInterno,
                   SUM(CASE WHEN B.TipoMovimiento = 0 THEN A.Mov ELSE -A.Mov END) AS Mov
            FROM tblDetalleMovimientos2 A
            INNER JOIN tblMovimientos2 B ON A.IdMovimiento = B.IdMovimiento AND A.IdTienda = B.IdTienda
            WHERE B.Status = 0 AND B.FechaMovimiento >= ? AND A.IdTienda = ?
            GROUP BY A.CodigoInterno
        `, [desde, idTienda]),
        consulta(`
            SELECT A.CodigoInterno,
                   SUM(CASE WHEN A.TipoMovimiento = 0 THEN A.Cantidad ELSE -A.Cantidad END) AS Mov
            FROM tblDetalleEmpacados2 A
            INNER JOIN tblEmpacados2 B ON A.IdEmpacado = B.IdEmpacado AND A.IdTienda = B.IdTienda
            WHERE B.FechaEmpacado >= ? AND A.IdTienda = ?
            GROUP BY A.CodigoInterno
        `, [desde, idTienda]),
        consulta(`
            SELECT A.CodigoInterno, SUM(A.Cantidad) AS Mov
            FROM tblDetalleDevolucionesVenta A
            INNER JOIN tblDevolucionesVenta B
                    ON A.IdDevolucionVenta = B.IdDevolucionVenta AND A.IdTienda = B.IdTienda
            WHERE A.Cantidad > 0 AND B.FechaDevolucionVenta >= ? AND A.IdTienda = ?
            GROUP BY A.CodigoInterno
        `, [desde, idTienda]),
        consulta(`
            SELECT A.CodigoInterno, SUM(A.Cantidad * A.CantidadCompra) AS Mov
            FROM tblDetalleFacturasCedis A
            INNER JOIN tblFacturasCedis B ON A.IdFactura = B.IdFactura AND A.IdTienda = B.IdTienda
            WHERE B.Status IN (0,1,3) AND B.FechaFactura >= ? AND A.IdTienda = ?
            GROUP BY A.CodigoInterno
        `, [desde, idTienda]),
        consulta(`
            SELECT CodigoInterno, SUM(Mov) AS Mov
            FROM tblMovimientosSAP WHERE FechaMovimientoSAP >= ?
            GROUP BY CodigoInterno
        `, [desde]),
    ]);

    aplicar(ventas, -1);
    aplicar(ventasPos, -1);
    aplicar(recibos, 1);
    aplicar(devRecibos, -1);
    aplicar(transfEntradas, 1);
    aplicar(transfSalidas, -1);
    aplicar(movimientos2, 1);   // ya viene con signo por TipoMovimiento
    aplicar(empacados, 1);      // ya viene con signo por TipoMovimiento
    aplicar(devVenta, 1);
    aplicar(cedis, -1);
    aplicar(sap, 1);            // ya viene con signo

    return deltas;
}
