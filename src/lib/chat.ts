// Canales del chat del portal. Son lógicos (sin tabla de canales):
//  - 'general': todas las tiendas y oficina
//  - 'tienda-<id>': la tienda con oficina (oficina ve todos los canales de tienda)
import type { SessionPayload } from './session';
import { esOficina } from './portal-db';
import { getTiendasReportes } from './tiendas';

export const CANAL_GENERAL = 'general';

export const canalTienda = (idTienda: number) => `tienda-${idTienda}`;

export interface CanalInfo {
    canal: string;
    nombre: string;
}

/** Canales visibles para la sesión (oficina ve todos los de tienda). */
export async function canalesDe(session: SessionPayload): Promise<CanalInfo[]> {
    const canales: CanalInfo[] = [{ canal: CANAL_GENERAL, nombre: 'General' }];

    if (await esOficina(session.codigobarras)) {
        const tiendas = await getTiendasReportes();
        for (const t of tiendas) {
            canales.push({ canal: canalTienda(t.IdTienda), nombre: t.Tienda });
        }
    } else {
        canales.push({ canal: canalTienda(session.idTienda), nombre: `${session.tienda} · Oficina` });
    }
    return canales;
}

/** Valida que la sesión pueda ver/escribir en el canal. */
export async function puedeVerCanal(canal: string, session: SessionPayload): Promise<boolean> {
    if (canal === CANAL_GENERAL) return true;
    if (canal === canalTienda(session.idTienda)) return true;
    if (/^tienda-\d+$/.test(canal)) return esOficina(session.codigobarras);
    return false;
}
