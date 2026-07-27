import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const secret = process.env.JWT_SECRET;
const SECRET_KEY = new TextEncoder().encode(secret || 'dev-secret-key-replaces-this-in-prod');

export async function middleware(request: NextRequest) {
    const session = request.cookies.get('session');
    const { pathname } = request.nextUrl;

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
        return NextResponse.next();
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
