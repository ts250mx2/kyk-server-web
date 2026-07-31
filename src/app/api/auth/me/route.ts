import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { esOficina } from '@/lib/portal-db';

export const dynamic = 'force-dynamic';

export async function GET() {
    const session = await getSession();
    // El rol oficina habilita controles de administración en la UI (la API
    // siempre lo re-valida en el servidor; esto es solo para mostrar/ocultar)
    const oficina = session ? await esOficina(session.codigobarras).catch(() => false) : false;
    return NextResponse.json({ user: session, oficina });
}
