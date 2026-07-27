import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { tiendaQuery } from '@/lib/tienda-db';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

// Detalle de una transferencia: encabezado de la salida + partidas de
// tblDetalleTransferenciasSalidas (importe = Mov × Costo). La salida se identifica
// por (IdTransferenciaSalida, IdTienda) porque el folio de salida es por tienda origen.
export async function GET(request: Request) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const idSalida = num(searchParams.get('idSalida'));
    const idTiendaSalida = num(searchParams.get('idTiendaSalida'));
    if (idSalida <= 0 || idTiendaSalida <= 0) {
        return NextResponse.json({ error: 'Transferencia inválida' }, { status: 400 });
    }

    try {
        const [empresas, encabezados, partidasRows] = await Promise.all([
            tiendaQuery(session.idTienda, `
                SELECT A.Tienda, B.RazonSocial, B.RFC, B.Direccion, B.Colonia, B.Municipio, B.CP, A.Tel1, A.Tel2
                FROM tblTiendas A
                INNER JOIN tblRazonesSociales B ON A.IdRazonSocial = B.IdRazonSocial
                WHERE A.IdTienda = ?
            `, [session.idTienda]) as Promise<Row[]>,
            tiendaQuery(session.idTienda, `
                SELECT S.*, TO_.Tienda AS TiendaOrigen, TD.Tienda AS TiendaDestino,
                       U.Usuario AS UsuarioSalida
                FROM tblTransferenciasSalidas S
                LEFT JOIN tblTiendas TO_ ON TO_.IdTienda = S.IdTienda
                LEFT JOIN tblTiendas TD ON TD.IdTienda = S.IdTiendaDestino
                LEFT JOIN tblUsuarios U ON U.IdUsuario = S.IdUsuarioSalida
                WHERE S.IdTransferenciaSalida = ? AND S.IdTienda = ?
            `, [idSalida, idTiendaSalida]) as Promise<Row[]>,
            tiendaQuery(session.idTienda, `
                SELECT D.CodigoInterno, D.Mov, D.Costo, D.Iva, D.CantidadCompra,
                       D.PiezasPedido, D.PiezasRecibo,
                       A.CodigoBarras, A.Descripcion, A.MedidaCompra, A.IdTipo
                FROM tblDetalleTransferenciasSalidas D
                LEFT JOIN tblArticulos A ON A.CodigoInterno = D.CodigoInterno
                WHERE D.IdTransferenciaSalida = ? AND D.IdTienda = ? AND D.Mov > 0
                ORDER BY A.Descripcion
            `, [idSalida, idTiendaSalida]) as Promise<Row[]>,
        ]);

        const enc = encabezados[0];
        if (!enc) {
            return NextResponse.json({ error: 'Transferencia no encontrada' }, { status: 404 });
        }

        let monto = 0;
        const partidas = partidasRows.map(p => {
            const mov = num(p.Mov);
            const costo = num(p.Costo);
            const importe = mov * costo;
            monto += importe;
            return {
                codigoInterno: num(p.CodigoInterno),
                codigoBarras: str(p.CodigoBarras),
                descripcion: str(p.Descripcion) || `(código ${num(p.CodigoInterno)})`,
                medida: num(p.IdTipo) === 2 ? 'Kg' : str(p.MedidaCompra) || 'Pzs',
                mov,
                piezasPedido: num(p.PiezasPedido),
                piezasRecibo: num(p.PiezasRecibo),
                costo,
                iva: num(p.Iva),
                importe,
            };
        });

        const emp = empresas[0] ?? {};

        return NextResponse.json({
            empresa: {
                razonSocial: str(emp.RazonSocial),
                rfc: str(emp.RFC),
                direccion: str(emp.Direccion),
                coloniaMunicipio: [str(emp.Colonia), str(emp.Municipio)].filter(Boolean).join(', '),
                cp: str(emp.CP),
                telefonos: [str(emp.Tel1), str(emp.Tel2)].filter(Boolean).join(' '),
            },
            transferencia: {
                idSalida,
                folioSalida: str(enc.FolioSalida),
                folioEntrada: str(enc.FolioEntrada),
                descripcion: str(enc.TransferenciaSalida),
                origen: str(enc.TiendaOrigen) || `Tienda ${idTiendaSalida}`,
                destino: str(enc.TiendaDestino) || `Tienda ${num(enc.IdTiendaDestino)}`,
                fechaSalida: enc.FechaSalida,
                fechaEntrada: enc.FechaEntrada ?? null,
                usuarioSalida: str(enc.UsuarioSalida) || null,
                recibida: Boolean(str(enc.FolioEntrada)),
                cancelada: num(enc.Status) !== 0,
                monto,
            },
            partidas,
        });
    } catch (error) {
        console.error(`Error en detalle de transferencia ${idSalida} (tienda ${session.idTienda}):`, error);
        return NextResponse.json(
            { error: 'No fue posible consultar el detalle de la transferencia.' },
            { status: 502 }
        );
    }
}
