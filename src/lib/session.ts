import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

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

export async function getSession(): Promise<SessionPayload | null> {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE);
    if (!token) return null;
    try {
        const { payload } = await jwtVerify(token.value, SECRET_KEY);
        return payload as unknown as SessionPayload;
    } catch {
        return null;
    }
}
