import { tiendaQuery } from './tienda-db';

// Reglas de kits del webservice KYKInventariosWeb (InventariosPerpetuos.java:454
// y kykinvservices.java:2146). tblKits liga hijo (CodigoInterno) → padre
// (CodigoInterno2) con Factor, y los kits son RECURSIVOS: el hijo de un hijo
// pertenece al maestro raíz con los factores MULTIPLICADOS. Ejemplo real:
// 7501147529384 (maestro) → 076 (hijo) → 1076 (nieto): los movimientos de 1076
// aportan Mov/(Factor076 × Factor1076) al maestro. La recursión del Java NO
// atraviesa padres intermedios con TipoOperacion = 4: los descendientes de un
// intermedio así se quedan con el intermedio, no suben al maestro.

export interface Kits {
    // hijo → su liga directa (padre y factor)
    ligas: Map<number, { padre: number; factor: number }>;
    // padre → sus hijos directos
    hijosDe: Map<number, { hijo: number; factor: number }[]>;
    // TipoOperacion de los códigos que aparecen como padre en tblKits
    tipoOperacionPadre: Map<number, number>;
}

// El Java resuelve un nivel extra por REPLACE; con 5 niveles cubrimos de sobra
const MAX_NIVELES = 5;

type Row = Record<string, unknown>;
const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

export async function cargarKits(idTienda: number): Promise<Kits> {
    const rows = (await tiendaQuery(idTienda, `
        SELECT K.CodigoInterno, K.CodigoInterno2, K.Factor, A.TipoOperacion
        FROM tblKits K
        LEFT JOIN tblArticulos A ON K.CodigoInterno2 = A.CodigoInterno
    `).catch(() => [])) as Row[];

    const ligas = new Map<number, { padre: number; factor: number }>();
    const hijosDe = new Map<number, { hijo: number; factor: number }[]>();
    const tipoOperacionPadre = new Map<number, number>();
    for (const r of rows ?? []) {
        const hijo = num(r.CodigoInterno);
        const padre = num(r.CodigoInterno2);
        const factor = num(r.Factor) > 0 ? num(r.Factor) : 1;
        if (hijo <= 0 || padre <= 0 || hijo === padre) continue;
        ligas.set(hijo, { padre, factor });
        const lista = hijosDe.get(padre) ?? [];
        hijosDe.set(padre, [...lista, { hijo, factor }]);
        tipoOperacionPadre.set(padre, num(r.TipoOperacion));
    }
    return { ligas, hijosDe, tipoOperacionPadre };
}

// Maestro raíz de un código: sube por las ligas multiplicando el Factor. El
// primer salto (la liga directa) siempre aplica; los siguientes solo si el
// intermedio donde estamos parados no es TipoOperacion = 4.
export function resolverMaestro(codigo: number, kits: Kits): { maestro: number; factor: number } {
    let actual = codigo;
    let factor = 1;
    for (let salto = 0; salto < MAX_NIVELES; salto++) {
        if (salto > 0 && kits.tipoOperacionPadre.get(actual) === 4) break;
        const liga = kits.ligas.get(actual);
        if (!liga || liga.padre === codigo) break;
        actual = liga.padre;
        factor *= liga.factor;
    }
    return { maestro: actual, factor };
}

// Familia completa de un maestro: él mismo (Factor 1) más TODOS sus
// descendientes con el factor acumulado (los movimientos de cada variante
// aportan Mov/Factor al maestro). No se desciende a través de intermedios
// con TipoOperacion = 4, igual que la recursión del Java.
export function familiaDelMaestro(maestro: number, kits: Kits): Map<number, number> {
    const familia = new Map<number, number>([[maestro, 1]]);
    let frontera: { codigo: number; factor: number }[] = [{ codigo: maestro, factor: 1 }];
    for (let nivel = 0; nivel < MAX_NIVELES && frontera.length > 0; nivel++) {
        const siguiente: { codigo: number; factor: number }[] = [];
        for (const nodo of frontera) {
            if (nivel > 0 && kits.tipoOperacionPadre.get(nodo.codigo) === 4) continue;
            for (const h of kits.hijosDe.get(nodo.codigo) ?? []) {
                if (familia.has(h.hijo)) continue;
                const factor = nodo.factor * h.factor;
                familia.set(h.hijo, factor);
                siguiente.push({ codigo: h.hijo, factor });
            }
        }
        frontera = siguiente;
    }
    return familia;
}
