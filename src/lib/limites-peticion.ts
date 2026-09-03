// Protecciones de las rutas que reciben datos del público o de la tienda:
// límite de envíos por ventana (en memoria del proceso, por IP o por usuario)
// y lectura del cuerpo JSON con tope REAL de bytes — Content-Length lo manda
// el cliente y puede mentir u omitirse; aquí se cuentan los bytes que llegan.

export interface Limitador {
    /** true si la clave ya agotó su cuota en la ventana (el intento no cuenta). */
    excede: (clave: string) => boolean;
}

export function crearLimitador(maximo: number, ventanaMs: number, maxClaves = 5_000): Limitador {
    const ventanas = new Map<string, number[]>();

    /** Suelta las claves sin envíos recientes para que el mapa no crezca sin límite. */
    const depurar = (ahora: number) => {
        if (ventanas.size < maxClaves) return;
        for (const [clave, tiempos] of ventanas) {
            if (tiempos.every(t => ahora - t >= ventanaMs)) ventanas.delete(clave);
        }
    };

    return {
        excede(clave) {
            const ahora = Date.now();
            depurar(ahora);
            const recientes = (ventanas.get(clave) ?? []).filter(t => ahora - t < ventanaMs);
            const excede = recientes.length >= maximo;
            ventanas.set(clave, excede ? recientes : [...recientes, ahora]);
            return excede;
        },
    };
}

export type CuerpoJson =
    | { ok: true; cuerpo: Record<string, unknown> }
    | { ok: false; status: 400 | 413; error: string };

const DEMASIADO_GRANDE: CuerpoJson = { ok: false, status: 413, error: 'Cuerpo demasiado grande' };
const INVALIDO: CuerpoJson = { ok: false, status: 400, error: 'Cuerpo inválido' };

/** Lee el cuerpo como objeto JSON cortando en cuanto rebasa `maxBytes`. */
export async function leerJsonLimitado(request: Request, maxBytes: number): Promise<CuerpoJson> {
    const declarado = Number(request.headers.get('content-length'));
    if (Number.isFinite(declarado) && declarado > maxBytes) return DEMASIADO_GRANDE;

    const lector = request.body?.getReader();
    if (!lector) return INVALIDO;
    const partes: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await lector.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
            await lector.cancel().catch(() => undefined);
            return DEMASIADO_GRANDE;
        }
        partes.push(value);
    }

    try {
        const cuerpo: unknown = JSON.parse(Buffer.concat(partes).toString('utf8'));
        return cuerpo && typeof cuerpo === 'object' && !Array.isArray(cuerpo)
            ? { ok: true, cuerpo: cuerpo as Record<string, unknown> }
            : INVALIDO;
    } catch {
        return INVALIDO;
    }
}
