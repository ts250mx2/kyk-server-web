import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

// Noticias más relevantes del día (México) vía Serper (búsqueda de Google).
// Se cachean 30 minutos en memoria: todos los usuarios comparten la consulta
// y la cuota de la API no se desgasta.
const CACHE_MS = 30 * 60_000;

interface Noticia {
    titulo: string;
    fuente: string;
    hace: string;
    url: string;
}

let cache: { noticias: Noticia[]; actualizado: string; expira: number } | null = null;

export async function GET() {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    if (!process.env.SERPER_API_KEY) {
        return NextResponse.json({ error: 'Las noticias no están configuradas (falta SERPER_API_KEY)' }, { status: 503 });
    }

    if (cache && cache.expira > Date.now()) {
        return NextResponse.json({ noticias: cache.noticias, actualizado: cache.actualizado });
    }

    try {
        const res = await fetch('https://google.serper.dev/news', {
            method: 'POST',
            headers: {
                'X-API-KEY': process.env.SERPER_API_KEY,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ q: 'noticias más importantes hoy', gl: 'mx', hl: 'es', num: 12 }),
            signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`serper ${res.status}`);
        const json = await res.json();

        const noticias: Noticia[] = (Array.isArray(json?.news) ? json.news : [])
            .map((n: Record<string, unknown>) => ({
                titulo: String(n.title ?? '').trim(),
                fuente: String(n.source ?? '').trim(),
                hace: String(n.date ?? '').trim(),
                url: String(n.link ?? ''),
            }))
            .filter((n: Noticia) => n.titulo && /^https?:\/\//.test(n.url))
            .slice(0, 10);

        const actualizado = new Date().toISOString();
        cache = { noticias, actualizado, expira: Date.now() + CACHE_MS };
        return NextResponse.json({ noticias, actualizado });
    } catch (error) {
        console.error('Error consultando noticias:', error);
        // Si hay caché vencido, mejor viejo que nada
        if (cache) {
            return NextResponse.json({ noticias: cache.noticias, actualizado: cache.actualizado });
        }
        return NextResponse.json({ error: 'No fue posible consultar las noticias' }, { status: 502 });
    }
}
