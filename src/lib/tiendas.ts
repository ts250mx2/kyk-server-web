import { mysqlQuery } from './mysql';

// Catálogo de tiendas con reportes y sus datos de conexión MySQL, leído de BDKYKRemoto.
export interface TiendaReporte {
    IdTienda: number;
    Tienda: string;
    IdRazonSocial: number;
    ReporteCortes: number | null;
    Abr: string | null;
    DireccionMySql: string;
    BaseDatosMySQL: string;
    UsuarioMySQL: string;
    PasswdMySQL: string;
}

const TIENDAS_SQL = `
    SELECT A.*, B.DireccionMySql, B.BaseDatosMySQL, B.UsuarioMySQL, B.PasswdMySQL
    FROM tblTiendasReportes A
    INNER JOIN tblTiendas B ON A.IdTienda = B.IdTienda
    WHERE A.IdRazonSocial IN (3,8)
    ORDER BY Tienda
`;

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { rows: TiendaReporte[]; at: number } | null = null;

export async function getTiendasReportes(forceRefresh = false): Promise<TiendaReporte[]> {
    if (!forceRefresh && cache && Date.now() - cache.at < CACHE_TTL_MS) {
        return cache.rows;
    }
    const rows = (await mysqlQuery(TIENDAS_SQL)) as TiendaReporte[];
    cache = { rows, at: Date.now() };
    return rows;
}

export async function getTiendaById(idTienda: number): Promise<TiendaReporte | null> {
    const tiendas = await getTiendasReportes();
    const found = tiendas.find(t => t.IdTienda === idTienda);
    if (found) return found;
    // Si no está en cache, refresca por si el catálogo cambió.
    const fresh = await getTiendasReportes(true);
    return fresh.find(t => t.IdTienda === idTienda) ?? null;
}
