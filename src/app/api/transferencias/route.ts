import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { tiendaQuery } from '@/lib/tienda-db';
import type { MysqlParam } from '@/lib/mysql';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

const LIMITE = 1000;
const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/;

// Reporte de transferencias de la tienda (similar al de recibos):
// - entradas: tblTransferenciasEntradas + su salida ligada (FolioEntrada) para conocer
//   origen, descripción y monto. El join por FolioEntrada no tiene índice en el MySQL
//   viejo de tienda, así que se hace con consultas planas + cruce en JS.
// - salidas: tblTransferenciasSalidas propias (IdTienda de la sesión) con tienda destino.
// El Total del encabezado casi siempre viene en 0; el monto se calcula del detalle
// (SUM(Mov × Costo) por transferencia).
export async function GET(request: Request) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const tipo = searchParams.get('tipo') === 'salidas' ? 'salidas' : 'entradas';
    const hoy = new Date().toLocaleDateString('sv-SE');
    const fechaInicio = ES_FECHA.test(searchParams.get('fechaInicio') ?? '') ? searchParams.get('fechaInicio')! : hoy;
    const fechaFin = ES_FECHA.test(searchParams.get('fechaFin') ?? '') ? searchParams.get('fechaFin')! : hoy;
    const busqueda = (searchParams.get('busqueda') ?? '').trim().toLowerCase();

    try {
        const tiendasRows = await tiendaQuery(session.idTienda, `
            SELECT IdTienda, Tienda FROM tblTiendas
        `) as Row[];
        const tiendas = new Map<number, string>(
            tiendasRows.map(t => [num(t.IdTienda), str(t.Tienda)])
        );

        // Montos por transferencia desde el detalle (una sola pasada con IN de tuplas)
        const cargarMontos = async (claves: Array<{ idSalida: number; idTienda: number }>) => {
            const montos = new Map<string, { monto: number; partidas: number }>();
            if (claves.length === 0) return montos;
            const tuplas = claves.map(c => `(${c.idSalida},${c.idTienda})`).join(',');
            try {
                const rows = await tiendaQuery(session.idTienda, `
                    SELECT IdTransferenciaSalida, IdTienda,
                           SUM(Mov * Costo) AS Monto, COUNT(*) AS Partidas
                    FROM tblDetalleTransferenciasSalidas
                    WHERE (IdTransferenciaSalida, IdTienda) IN (${tuplas})
                    GROUP BY IdTransferenciaSalida, IdTienda
                `) as Row[];
                for (const r of rows) {
                    montos.set(`${num(r.IdTransferenciaSalida)}|${num(r.IdTienda)}`, {
                        monto: num(r.Monto),
                        partidas: num(r.Partidas),
                    });
                }
            } catch (e) {
                console.warn('No fue posible calcular montos de transferencias:', e);
            }
            return montos;
        };

        let transferencias: Row[] = [];

        if (tipo === 'entradas') {
            const params: MysqlParam[] = [fechaInicio, fechaFin];
            const entradas = await tiendaQuery(session.idTienda, `
                SELECT IdTransferenciaEntrada, FolioEntrada, FechaEntrada, Status
                FROM tblTransferenciasEntradas
                WHERE FechaEntrada >= ? AND FechaEntrada < ? + INTERVAL 1 DAY
                ORDER BY FechaEntrada DESC
                LIMIT ${LIMITE}
            `, params) as Row[];

            // Salidas ligadas por folio (una sola pasada)
            const folios = [...new Set(entradas.map(e => str(e.FolioEntrada)).filter(Boolean))];
            const salidasMap = new Map<string, Row>();
            if (folios.length > 0) {
                const enLista = folios.map(f => `'${f.replace(/'/g, '')}'`).join(',');
                const salidas = await tiendaQuery(session.idTienda, `
                    SELECT IdTransferenciaSalida, IdTienda, FolioEntrada, FolioSalida,
                           TransferenciaSalida, FechaSalida, Status
                    FROM tblTransferenciasSalidas
                    WHERE FolioEntrada IN (${enLista}) AND Status = 0
                `) as Row[];
                for (const s of salidas) {
                    salidasMap.set(str(s.FolioEntrada), s);
                }
            }

            const claves = [...salidasMap.values()].map(s => ({
                idSalida: num(s.IdTransferenciaSalida),
                idTienda: num(s.IdTienda),
            }));
            const montos = await cargarMontos(claves);

            transferencias = entradas.map(e => {
                const salida = salidasMap.get(str(e.FolioEntrada));
                const clave = salida ? `${num(salida.IdTransferenciaSalida)}|${num(salida.IdTienda)}` : '';
                const monto = montos.get(clave);
                return {
                    folio: str(e.FolioEntrada),
                    fecha: e.FechaEntrada,
                    tienda: salida ? (tiendas.get(num(salida.IdTienda)) ?? `Tienda ${num(salida.IdTienda)}`) : '',
                    descripcion: salida ? str(salida.TransferenciaSalida) : '',
                    idSalida: salida ? num(salida.IdTransferenciaSalida) : 0,
                    idTiendaSalida: salida ? num(salida.IdTienda) : 0,
                    monto: monto?.monto ?? 0,
                    partidas: monto?.partidas ?? 0,
                    cancelada: num(e.Status) !== 0,
                    recibida: true,
                };
            });
        } else {
            const params: MysqlParam[] = [session.idTienda, fechaInicio, fechaFin];
            const salidas = await tiendaQuery(session.idTienda, `
                SELECT IdTransferenciaSalida, IdTienda, IdTiendaDestino, FolioSalida, FolioEntrada,
                       TransferenciaSalida, FechaSalida, FechaEntrada, Status
                FROM tblTransferenciasSalidas
                WHERE IdTienda = ? AND FechaSalida >= ? AND FechaSalida < ? + INTERVAL 1 DAY
                ORDER BY FechaSalida DESC
                LIMIT ${LIMITE}
            `, params) as Row[];

            const montos = await cargarMontos(salidas.map(s => ({
                idSalida: num(s.IdTransferenciaSalida),
                idTienda: num(s.IdTienda),
            })));

            transferencias = salidas.map(s => {
                const monto = montos.get(`${num(s.IdTransferenciaSalida)}|${num(s.IdTienda)}`);
                return {
                    folio: str(s.FolioSalida),
                    fecha: s.FechaSalida,
                    tienda: tiendas.get(num(s.IdTiendaDestino)) ?? `Tienda ${num(s.IdTiendaDestino)}`,
                    descripcion: str(s.TransferenciaSalida),
                    idSalida: num(s.IdTransferenciaSalida),
                    idTiendaSalida: num(s.IdTienda),
                    monto: monto?.monto ?? 0,
                    partidas: monto?.partidas ?? 0,
                    cancelada: num(s.Status) !== 0,
                    recibida: Boolean(str(s.FolioEntrada)),
                };
            });
        }

        // Búsqueda sobre folio, descripción o tienda (en JS, tras el cruce)
        if (busqueda) {
            transferencias = transferencias.filter(t =>
                `${t.folio} ${t.descripcion} ${t.tienda}`.toLowerCase().includes(busqueda)
            );
        }

        const totalMonto = transferencias.reduce((acc, t) => acc + num(t.monto), 0);

        return NextResponse.json({
            tipo,
            fechaInicio,
            fechaFin,
            total: transferencias.length,
            truncado: transferencias.length === LIMITE,
            resumen: {
                transferencias: transferencias.length,
                monto: totalMonto,
                canceladas: transferencias.filter(t => t.cancelada).length,
            },
            transferencias,
        });
    } catch (error) {
        console.error(`Error listando transferencias (tienda ${session.idTienda}):`, error);
        return NextResponse.json(
            { error: 'No fue posible consultar las transferencias de la tienda.' },
            { status: 502 }
        );
    }
}
