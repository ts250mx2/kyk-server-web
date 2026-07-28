import { mysqlQuery } from './mysql';

// Cliente del servicio Java de inventarios (KYKInventariosWeb) que corre en el
// Tomcat de cada tienda. El host se resuelve desde tblTiendas.DireccionWebService
// del MySQL central — nunca desde el navegador — lo que además acota las llamadas
// a hosts registrados (el getData.php del sitio PHP viejo era un proxy abierto).
// El servicio recalcula el inventario en vivo, por eso los timeouts largos.

const CACHE_TTL_MS = 5 * 60 * 1000;
const cacheUrls = new Map<number, { url: string; at: number }>();

export class ServicioInventariosError extends Error {
    constructor(mensaje: string, readonly status = 502) {
        super(mensaje);
    }
}

// Origen (http://host:puerto) del servicio de la tienda. DireccionWebService
// guarda la URL completa del WSDL, p.ej. http://192.168.8.90:2323/KYKInventariosWeb/...
async function origenServicio(idTienda: number): Promise<string> {
    const cacheado = cacheUrls.get(idTienda);
    if (cacheado && Date.now() - cacheado.at < CACHE_TTL_MS) {
        return cacheado.url;
    }

    const rows = (await mysqlQuery(
        'SELECT DireccionWebService FROM tblTiendas WHERE IdTienda = ? LIMIT 1',
        [idTienda]
    )) as { DireccionWebService: string | null }[];

    const direccion = String(rows?.[0]?.DireccionWebService ?? '').trim();
    if (!direccion) {
        throw new ServicioInventariosError(
            'La tienda no tiene configurado el servicio de inventarios (DireccionWebService)',
            503
        );
    }
    try {
        const url = new URL(direccion).origin;
        cacheUrls.set(idTienda, { url, at: Date.now() });
        return url;
    } catch {
        throw new ServicioInventariosError(
            'La dirección del servicio de inventarios de la tienda es inválida',
            503
        );
    }
}

// Llama a webservices.jsp del Tomcat de la tienda y regresa el JSON parseado.
// El servicio responde text/html con JSON armado a mano (todo en strings, sin
// escapar y con espacios colgando), así que se parsea de forma defensiva.
export async function consultarInventariosWs(
    idTienda: number,
    params: Record<string, string | number>,
    timeoutMs = 240_000
): Promise<Record<string, unknown>> {
    const origen = await origenServicio(idTienda);
    const qs = new URLSearchParams();
    for (const [clave, valor] of Object.entries(params)) {
        qs.set(clave, String(valor));
    }
    qs.set('rnd', String(Math.random()));

    let res: Response;
    try {
        res = await fetch(`${origen}/KYKInventariosWeb/webservices.jsp?${qs.toString()}`, {
            signal: AbortSignal.timeout(timeoutMs),
            cache: 'no-store',
        });
    } catch (error) {
        const esTimeout = error instanceof DOMException && error.name === 'TimeoutError';
        throw new ServicioInventariosError(
            esTimeout
                ? 'El servicio de inventarios de la tienda tardó demasiado en responder'
                : 'No fue posible conectar con el servicio de inventarios de la tienda'
        );
    }

    const texto = (await res.text()).trim();
    // Ante cualquier excepción el servicio regresa cuerpo vacío/null con HTTP 200
    if (!res.ok || !texto || texto === 'null') {
        throw new ServicioInventariosError('El servicio de inventarios no regresó datos, intenta de nuevo');
    }
    try {
        return JSON.parse(texto);
    } catch {
        throw new ServicioInventariosError('El servicio de inventarios regresó una respuesta inválida');
    }
}

// Los valores del servicio vienen todos como strings con espacios colgando
export const wsTexto = (v: unknown): string => String(v ?? '').trim();
export const wsNumero = (v: unknown): number => {
    const n = Number(wsTexto(v));
    return Number.isFinite(n) ? n : 0;
};
