// Canales del chat del portal. Son lógicos (sin tabla de canales):
//  - 'general': todas las tiendas y oficina
//  - 'tienda-<id>': la tienda con oficina (oficina ve todos los canales de tienda)
//  - 'dm-<codigoA>-<codigoB>': chat directo entre dos usuarios (códigos ordenados)
import type { SessionPayload } from './session';
import { esOficina } from './portal-db';
import { getTiendasReportes } from './tiendas';

export const CANAL_GENERAL = 'general';

export const canalTienda = (idTienda: number) => `tienda-${idTienda}`;

// ── Chats directos ──
// Los códigos de barras de usuario son alfanuméricos sin guion; el canal se
// arma con ambos ordenados para que sea el mismo sin importar quién lo abra.
export const esCanalDm = (canal: string) => canal.startsWith('dm-');

export const codigoValidoParaDm = (codigo: string) => /^[A-Za-z0-9]{1,45}$/.test(codigo);

export function canalDm(codigoA: string, codigoB: string): string {
    return `dm-${[codigoA, codigoB].sort().join('-')}`;
}

/** ¿El código participa en el canal dm-A-B? */
export function participaEnDm(canal: string, codigo: string): boolean {
    if (!esCanalDm(canal) || !codigoValidoParaDm(codigo)) return false;
    const resto = canal.slice(3);
    return resto.startsWith(`${codigo}-`) || resto.endsWith(`-${codigo}`);
}

/** El otro participante del canal directo ('' si el código no participa). */
export function otroDelDm(canal: string, codigo: string): string {
    const resto = canal.slice(3);
    if (resto.startsWith(`${codigo}-`)) return resto.slice(codigo.length + 1);
    if (resto.endsWith(`-${codigo}`)) return resto.slice(0, resto.length - codigo.length - 1);
    return '';
}

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
    if (esCanalDm(canal)) return participaEnDm(canal, session.codigobarras);
    return false;
}
