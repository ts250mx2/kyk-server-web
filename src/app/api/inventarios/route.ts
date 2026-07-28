import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { consultarInventariosWs, ServicioInventariosError, wsNumero, wsTexto } from '@/lib/inventarios-ws';

export const dynamic = 'force-dynamic';
// El servicio recalcula el inventario en vivo (buffers + 12 tipos de movimientos);
// el sitio PHP viejo le daba 240 s, aquí se respeta ese margen.
export const maxDuration = 300;

const TIMEOUT_INV_MS = 240_000;

// Inventario perpetuo del proveedor para la tienda de la sesión, vía el servicio
// Java de la tienda (method=inv). La tienda NO es elegible: siempre la del login.
export async function GET(request: Request) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const idProveedor = Number(searchParams.get('idProveedor'));
    const diasPedido = Number(searchParams.get('diasPedido'));
    if (!Number.isInteger(idProveedor) || idProveedor <= 0) {
        return NextResponse.json({ error: 'Proveedor inválido' }, { status: 400 });
    }
    if (!Number.isInteger(diasPedido) || diasPedido <= 0 || diasPedido > 99) {
        return NextResponse.json({ error: 'Días de pedido inválidos (1 a 99)' }, { status: 400 });
    }

    try {
        const json = await consultarInventariosWs(session.idTienda, {
            method: 'inv',
            IdTienda: session.idTienda,
            IdProveedor: idProveedor,
            DiasPedido: diasPedido,
        }, TIMEOUT_INV_MS);

        const filas = Array.isArray(json.Articulos) ? json.Articulos : [];
        const articulos = filas.map((r: Record<string, unknown>) => ({
            codigoInterno: wsNumero(r.CodigoInterno),
            codigoBarras: wsTexto(r.CodigoBarras),
            descripcion: wsTexto(r.Descripcion),
            exiActual: wsNumero(r.ExiActual),
            exiPara: wsNumero(r.ExiPara),
            pvd: wsNumero(r.PVD),
            medidaVenta: wsTexto(r.MedidaVenta),
            estatus: wsNumero(r.StatusInventario),
            // Pedido es un string de despliegue: "(en tránsito) sugerido" cuando hay OC abiertas
            pedido: wsTexto(r.Pedido),
            pedidoSugerido: wsNumero(r.PedidoSugerido),
            pedidoTransito: wsNumero(r.PedidoTransito),
            medidaCompra: wsTexto(r.MedidaCompra),
            // Llave del buffer en el servicio, requerida por el detalle de movimientos
            idComputadora: wsNumero(r.IdSessionComputadora),
        }));

        return NextResponse.json({ articulos });
    } catch (error) {
        if (error instanceof ServicioInventariosError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error('Error al consultar inventario:', error);
        return NextResponse.json(
            { error: 'Error al consultar el inventario de la tienda' },
            { status: 502 }
        );
    }
}
