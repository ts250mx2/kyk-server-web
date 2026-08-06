import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const secret = process.env.JWT_SECRET;
const SECRET_KEY = new TextEncoder().encode(secret || 'dev-secret-key-replaces-this-in-prod');

// CORS para la app handheld (Ionic/Capacitor). El WebView presenta el origen
// `https://localhost` y el preview web `http://localhost:8100`; se permiten
// solo esos y los de red privada (RFC1918) — un sitio público jamás puede
// presentar estos orígenes. Las apps nativas autentican con Bearer, no cookie.
function origenPermitido(origen: string): boolean {
    try {
        const url = new URL(origen);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
        const host = url.hostname;
        if (host === 'localhost' || host === '127.0.0.1') return true;
        return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
    } catch {
        return false;
    }
}

function conCors(respuesta: NextResponse, origen: string): NextResponse {
    respuesta.headers.set('Access-Control-Allow-Origin', origen);
    respuesta.headers.set('Vary', 'Origin');
    return respuesta;
}

export async function middleware(request: NextRequest) {
    const session = request.cookies.get('session');
    const { pathname } = request.nextUrl;

    const origen = request.headers.get('origin') || '';
    const corsPermitido = pathname.startsWith('/api') && !!origen && origenPermitido(origen);

    // Preflight de las peticiones del handheld (JSON y multipart con Bearer).
    if (corsPermitido && request.method === 'OPTIONS') {
        return conCors(new NextResponse(null, {
            status: 204,
            headers: {
                'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                'Access-Control-Max-Age': '86400',
            },
        }), origen);
    }

    // Permitir login y APIs sin protección de sesión general (las APIs validan sesión propia).
    if (pathname === '/login' || pathname.startsWith('/api')) {
        // Si ya hay sesión activa e intenta ir a login, redirigir al dashboard.
        if (session && pathname === '/login') {
            try {
                await jwtVerify(session.value, SECRET_KEY);
                return NextResponse.redirect(new URL('/dashboard', request.url));
            } catch {
                // Token inválido, dejarlo en login.
            }
        }
        const respuesta = NextResponse.next();
        return corsPermitido ? conCors(respuesta, origen) : respuesta;
    }

    // Proteger el resto de las páginas.
    if (!session) {
        return NextResponse.redirect(new URL('/login', request.url));
    }

    try {
        await jwtVerify(session.value, SECRET_KEY);
        return NextResponse.next();
    } catch {
        return NextResponse.redirect(new URL('/login', request.url));
    }
}

export const config = {
    matcher: [
        /*
         * Intercepta todas las peticiones excepto estáticos de Next, favicon y
         * archivos públicos con extensión (logo.svg, imágenes, etc.).
         */
        '/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)',
    ],
};
