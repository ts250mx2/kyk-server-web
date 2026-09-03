import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { esOficina } from '@/lib/portal-db';
import { resumenConsultas } from '@/lib/adian-bitacora';
import { estadoDelCorpus } from '@/lib/documentos-texto';

export const dynamic = 'force-dynamic';

const DIAS_DEFAULT = 7;

// Bitácora de consultas de A.D.iA.N para oficina: totales del periodo
// (?dias=7 por default), desglose por modelo, las 100 consultas más
// recientes y el estado del corpus (cuántos documentos tienen texto, cuántos
// son escaneados o sin texto, cuántos faltan por indexar). Sirve para medir
// latencia, cortes y preguntas sin respuesta, y para saber si vale la pena
// el OCR.
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
        const [resumen, corpus] = await Promise.all([resumenConsultas(dias), estadoDelCorpus()]);
        return NextResponse.json({ ...resumen, corpus });
    } catch (error) {
        console.error('Error consultando la bitácora de consultas de A.D.iA.N:', error);
        return NextResponse.json(
            { error: 'No fue posible consultar la bitácora de consultas.' },
            { status: 502 }
        );
    }
}
