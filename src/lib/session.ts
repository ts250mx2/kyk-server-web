import { SignJWT, jwtVerify } from 'jose';
import { cookies, headers } from 'next/headers';

const SECRET_KEY = new TextEncoder().encode(
    process.env.JWT_SECRET || 'dev-secret-key-replaces-this-in-prod'
);

export const SESSION_COOKIE = 'session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24; // 24 horas

// La cookie de sesión guarda usuario + tienda seleccionada. Las credenciales MySQL de la
// tienda NUNCA van en el JWT (es legible en base64); se resuelven server-side con tienda-db.
export interface SessionPayload {
    id: number | string;
    name: string;
    codigobarras: string;
    idTienda: number;
    tienda: string;
    mysqlHost: string;
    mysqlDatabase: string;
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
    return await new SignJWT({ ...payload })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('24h')
        .sign(SECRET_KEY);
}

export async function setSessionCookie(token: string) {
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE, token, {
        httpOnly: true,
        secure: false, // false para soportar despliegues HTTP internos
        sameSite: 'lax',
        maxAge: SESSION_MAX_AGE_SECONDS,
        path: '/',
    });
}

/**
 * Token de la petición: cookie en el navegador y `Authorization: Bearer` en
 * clientes nativos. La app handheld corre en un WebView cuyo origen es
 * `https://localhost`, así que una cookie SameSite=Lax nunca le llegaría.
 */
async function tokenDeLaPeticion(): Promise<string | null> {
    const cookieStore = await cookies();
    const cookie = cookieStore.get(SESSION_COOKIE);
    if (cookie?.value) return cookie.value;

    const cabeceras = await headers();
    const autorizacion = cabeceras.get('authorization') ?? '';
    if (!autorizacion.toLowerCase().startsWith('bearer ')) return null;
    return autorizacion.slice(7).trim() || null;
}

export async function getSession(): Promise<SessionPayload | null> {
    const token = await tokenDeLaPeticion();
    if (!token) return null;
    try {
        const { payload } = await jwtVerify(token, SECRET_KEY);
        return payload as unknown as SessionPayload;
    } catch {
        return null;
    }
}
