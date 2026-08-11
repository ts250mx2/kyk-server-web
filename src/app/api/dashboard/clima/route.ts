import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

// Clima actual para la tarjeta del dashboard. El cliente manda lat/lon (las
// obtiene de la IP pública con ipwho.is); aquí solo se consulta open-meteo
// (gratuito, sin API key) con caché en memoria. Anti-SSRF: el host es fijo y
// las coordenadas se validan como números en rango.
const CACHE_MS = 15 * 60_000;
// Monterrey, NL: donde están las tiendas — respaldo si la geolocalización falla
const LAT_DEFAULT = 25.6866;
const LON_DEFAULT = -100.3161;

const cache = new Map<string, { datos: unknown; expira: number }>();

// Códigos WMO de open-meteo → icono y descripción en español
function describirClima(codigo: number): { icono: string; descripcion: string } {
    if (codigo === 0) return { icono: '☀️', descripcion: 'Despejado' };
    if (codigo <= 2) return { icono: '🌤️', descripcion: 'Poco nublado' };
    if (codigo === 3) return { icono: '☁️', descripcion: 'Nublado' };
    if (codigo === 45 || codigo === 48) return { icono: '🌫️', descripcion: 'Neblina' };
    if (codigo <= 57) return { icono: '🌦️', descripcion: 'Llovizna' };
    if (codigo <= 67) return { icono: '🌧️', descripcion: 'Lluvia' };
    if (codigo <= 77) return { icono: '❄️', descripcion: 'Nieve' };
    if (codigo <= 82) return { icono: '🌧️', descripcion: 'Chubascos' };
    if (codigo <= 86) return { icono: '❄️', descripcion: 'Nieve' };
    return { icono: '⛈️', descripcion: 'Tormenta' };
}

export async function GET(request: Request) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    let lat = Number(searchParams.get('lat'));
    let lon = Number(searchParams.get('lon'));
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) lat = LAT_DEFAULT;
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) lon = LON_DEFAULT;

    const clave = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    const guardado = cache.get(clave);
    if (guardado && guardado.expira > Date.now()) {
        return NextResponse.json(guardado.datos);
    }

    try {
        const url = 'https://api.open-meteo.com/v1/forecast'
            + `?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`
            + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m'
            + '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max'
            + '&timezone=auto&forecast_days=1';
        const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
        if (!res.ok) throw new Error(`open-meteo ${res.status}`);
        const json = await res.json();

        const codigo = Number(json?.current?.weather_code ?? 0);
        const datos = {
            temperatura: Math.round(Number(json?.current?.temperature_2m ?? 0)),
            sensacion: Math.round(Number(json?.current?.apparent_temperature ?? 0)),
            humedad: Number(json?.current?.relative_humidity_2m ?? 0),
            viento: Math.round(Number(json?.current?.wind_speed_10m ?? 0)),
            maxima: Math.round(Number(json?.daily?.temperature_2m_max?.[0] ?? 0)),
            minima: Math.round(Number(json?.daily?.temperature_2m_min?.[0] ?? 0)),
            probabilidadLluvia: Number(json?.daily?.precipitation_probability_max?.[0] ?? 0),
            ...describirClima(codigo),
        };
        cache.set(clave, { datos, expira: Date.now() + CACHE_MS });
        return NextResponse.json(datos);
    } catch (error) {
        console.error('Error consultando el clima:', error);
        return NextResponse.json({ error: 'No fue posible consultar el clima' }, { status: 502 });
    }
}
