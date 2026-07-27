import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { tiendaQuery } from '@/lib/tienda-db';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

const LIMITE = 2000;
const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/;

// Tipos de documento como en frmProcFacturas (tblTiposDocumentos + regla del buffer:
// una factura con IdApertura > 0 es del corte de caja = PÚBLICO GENERAL).
const TIPOS: Record<number, string> = {
    0: 'CONTADO',
    1: 'CRÉDITO',
    2: 'NOTA CRÉDITO',
    4: 'PÚBLICO GENERAL',
    5: 'TRASLADO',
    6: 'ENTRADA TRANSF.',
};

const limpiarUuid = (v: string): string => {
    const idMatch = v.match(/id=([0-9a-fA-F-]{30,40})/);
    if (idMatch) return idMatch[1];
    if (v.startsWith('http')) return '';
    return v.split('&')[0];
};

// Versión web de frmProcFacturas: combina facturas (contado/crédito/nota de crédito/
// público general), traslados de salida propios y entradas de transferencia en un solo
// listado de documentos por rango de fechas. El VB6 lo arma en tblBufferDocumentos con
// REPLACE/DELETE por computadora; aquí se combinan las mismas consultas en memoria,
// sin escribir en la base de la tienda.
export async function GET(request: Request) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const hoy = new Date().toLocaleDateString('sv-SE');
    const fechaInicio = ES_FECHA.test(searchParams.get('fechaInicio') ?? '') ? searchParams.get('fechaInicio')! : hoy;
    const fechaFin = ES_FECHA.test(searchParams.get('fechaFin') ?? '') ? searchParams.get('fechaFin')! : hoy;
    const busqueda = (searchParams.get('busqueda') ?? '').trim();
    const tipoFiltro = num(searchParams.get('tipo') ?? -1);

    try {
        const [facturas, salidas, entradas] = await Promise.all([
            tiendaQuery(session.idTienda, `
                SELECT IdFactura, AlfaNumerico, Credito, IdApertura, IdComputadora, MetodoPago,
                       RFC, ClienteConcepto, UUID, FechaFactura, Total, TotalPagos, Status
                FROM tblFacturas
                WHERE FechaFactura >= ? AND FechaFactura < ? + INTERVAL 1 DAY
            `, [fechaInicio, fechaFin]) as Promise<Row[]>,
            tiendaQuery(session.idTienda, `
                SELECT IdTransferenciaSalida, IdTienda, FolioSalida, TransferenciaSalida, FechaSalida, UUID, Status
                FROM tblTransferenciasSalidas
                WHERE IdTienda = ? AND FechaSalida >= ? AND FechaSalida < ? + INTERVAL 1 DAY
            `, [session.idTienda, fechaInicio, fechaFin]) as Promise<Row[]>,
            tiendaQuery(session.idTienda, `
                SELECT IdTransferenciaSalida, IdTienda, FolioEntrada, TransferenciaSalida, FechaEntrada, UUID, Status
                FROM tblTransferenciasSalidas
                WHERE IdTransferenciaEntrada > 0 AND IdTiendaDestino = ?
                  AND FechaEntrada >= ? AND FechaEntrada < ? + INTERVAL 1 DAY
            `, [session.idTienda, fechaInicio, fechaFin]) as Promise<Row[]>,
        ]);

        interface Documento {
            tipoId: number;
            tipoDocumento: string;
            idFolio: number;
            folio: string;
            fecha: unknown;
            receptor: string;
            rfc: string;
            uuid: string;
            metodoPagoClave: string;
            metodoPago: string;
            total: number;
            saldo: number;
            cancelada: boolean;
            z: string | null;
            // Para el drill-down de traslados
            idSalida: number;
            idTiendaSalida: number;
        }

        const documentos: Documento[] = [];

        for (const f of facturas) {
            const credito = num(f.Credito);
            const idApertura = num(f.IdApertura);
            const tipoId = idApertura > 0 ? 4 : credito;
            const metodoPago = str(f.MetodoPago);
            const total = num(f.Total);
            documentos.push({
                tipoId,
                tipoDocumento: TIPOS[tipoId] ?? `TIPO ${tipoId}`,
                idFolio: num(f.IdFactura),
                folio: `${str(f.AlfaNumerico)}-${num(f.IdFactura)}`,
                fecha: f.FechaFactura,
                receptor: str(f.ClienteConcepto),
                rfc: str(f.RFC),
                uuid: limpiarUuid(str(f.UUID)),
                metodoPagoClave: metodoPago.slice(0, 2),
                metodoPago,
                total,
                saldo: credito === 1 ? total - num(f.TotalPagos) : 0,
                cancelada: num(f.Status) === 2,
                z: idApertura > 0 ? `${num(f.IdComputadora)}-${idApertura}` : null,
                idSalida: 0,
                idTiendaSalida: 0,
            });
        }

        for (const s of salidas) {
            documentos.push({
                tipoId: 5,
                tipoDocumento: TIPOS[5],
                idFolio: num(s.IdTransferenciaSalida),
                folio: str(s.FolioSalida),
                fecha: s.FechaSalida,
                receptor: str(s.TransferenciaSalida),
                rfc: '',
                uuid: limpiarUuid(str(s.UUID)),
                metodoPagoClave: 'NA',
                metodoPago: 'NO APLICA',
                total: 0,
                saldo: 0,
                cancelada: num(s.Status) !== 0,
                z: null,
                idSalida: num(s.IdTransferenciaSalida),
                idTiendaSalida: num(s.IdTienda),
            });
        }

        for (const e of entradas) {
            documentos.push({
                tipoId: 6,
                tipoDocumento: TIPOS[6],
                idFolio: num(e.IdTransferenciaSalida),
                folio: str(e.FolioEntrada),
                fecha: e.FechaEntrada,
                receptor: str(e.TransferenciaSalida),
                rfc: '',
                uuid: limpiarUuid(str(e.UUID)),
                metodoPagoClave: 'NA',
                metodoPago: 'NO APLICA',
                total: 0,
                saldo: 0,
                cancelada: num(e.Status) !== 0,
                z: null,
                idSalida: num(e.IdTransferenciaSalida),
                idTiendaSalida: num(e.IdTienda),
            });
        }

        // Búsqueda con la semántica del VB6: número → Total o folio; texto → RFC/receptor
        // LIKE, UUID o folio exactos.
        let filtrados = documentos;
        if (busqueda) {
            if (/^\d+(\.\d+)?$/.test(busqueda)) {
                const n = Number(busqueda);
                filtrados = filtrados.filter(d =>
                    Math.abs(d.total - n) < 0.005 || d.idFolio === n || d.folio === busqueda
                );
            } else {
                const t = busqueda.toLowerCase();
                filtrados = filtrados.filter(d =>
                    d.rfc.toLowerCase().includes(t) ||
                    d.receptor.toLowerCase().includes(t) ||
                    d.uuid.toLowerCase() === t ||
                    d.folio.toLowerCase() === t
                );
            }
        }
        if (tipoFiltro >= 0) {
            filtrados = filtrados.filter(d => d.tipoId === tipoFiltro);
        }

        filtrados.sort((a, b) => new Date(String(b.fecha)).getTime() - new Date(String(a.fecha)).getTime());
        const truncado = filtrados.length > LIMITE;
        if (truncado) filtrados = filtrados.slice(0, LIMITE);

        const facturasFiscales = filtrados.filter(d => d.tipoId < 5 && !d.cancelada);

        return NextResponse.json({
            fechaInicio,
            fechaFin,
            total: filtrados.length,
            truncado,
            resumen: {
                documentos: filtrados.length,
                facturas: facturasFiscales.length,
                totalFacturado: facturasFiscales.reduce((acc, d) => acc + (d.tipoId === 2 ? -d.total : d.total), 0),
                publicoGeneral: filtrados.filter(d => d.tipoId === 4).length,
                traslados: filtrados.filter(d => d.tipoId >= 5).length,
                canceladas: filtrados.filter(d => d.cancelada).length,
            },
            documentos: filtrados,
        });
    } catch (error) {
        console.error(`Error listando facturas (tienda ${session.idTienda}):`, error);
        return NextResponse.json(
            { error: 'No fue posible consultar las facturas de la tienda.' },
            { status: 502 }
        );
    }
}
