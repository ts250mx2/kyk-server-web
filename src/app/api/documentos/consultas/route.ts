import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { esOficina } from '@/lib/portal-db';
import { resumenConsultas } from '@/lib/adian-bitacora';

export const dynamic = 'force-dynamic';

const DIAS_DEFAULT = 7;

// Bitácora de consultas de A.D.iA.N para oficina: totales del periodo
// (?dias=7 por default), desglose por modelo y las 100 consultas más
// recientes. Sirve para medir latencia, cortes y preguntas sin respuesta.
export async function GET(request: Request) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    if (!(await esOficina(session.codigobarras))) {
        return NextResponse.json({ error: 'Solo el rol oficina puede ver la bitácora de consultas' }, { status: 403 });
    }

    try {
        const pedido = Number(new URL(request.url).searchParams.get('dias') ?? DIAS_DEFAULT);
        const dias = Number.isFinite(pedido) && pedido > 0 ? pedido : DIAS_DEFAULT;
        return NextResponse.json(await resumenConsultas(dias));
    } catch (error) {
        console.error('Error consultando la bitácora de consultas de A.D.iA.N:', error);
        return NextResponse.json(
            { error: 'No fue posible consultar la bitácora de consultas.' },
            { status: 502 }
        );
    }
}
