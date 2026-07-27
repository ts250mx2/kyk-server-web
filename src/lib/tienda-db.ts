import mysql from 'mysql2/promise';
import { getTiendaById, type TiendaReporte } from './tiendas';
import type { MysqlParam } from './mysql';

// Pools MySQL por tienda: la conexión de reportes se hace al servidor MySQL de la
// tienda seleccionada en el login (DireccionMySql / BaseDatosMySQL / UsuarioMySQL / PasswdMySQL).
const pools = new Map<string, mysql.Pool>();

function poolKey(t: TiendaReporte) {
    return `${t.IdTienda}|${t.DireccionMySql}|${t.BaseDatosMySQL}|${t.UsuarioMySQL}`;
}

function createTiendaPool(t: TiendaReporte): mysql.Pool {
    return mysql.createPool({
        host: t.DireccionMySql,
        database: t.BaseDatosMySQL,
        user: t.UsuarioMySQL,
        password: t.PasswdMySQL,
        waitForConnections: true,
        connectionLimit: 5,
        queueLimit: 0,
        enableKeepAlive: true,
        keepAliveInitialDelay: 10000,
        connectTimeout: 10000,
    });
}

export async function getTiendaPool(idTienda: number): Promise<mysql.Pool> {
    const tienda = await getTiendaById(idTienda);
    if (!tienda) {
        throw new Error(`Tienda ${idTienda} no encontrada en el catálogo de reportes`);
    }
    const key = poolKey(tienda);
    let pool = pools.get(key);
    if (!pool) {
        pool = createTiendaPool(tienda);
        pools.set(key, pool);
    }
    return pool;
}

// Consulta sobre el MySQL de la tienda de la sesión (para los reportes).
export async function tiendaQuery(idTienda: number, sql: string, params?: MysqlParam[], retries = 3) {
    const pool = await getTiendaPool(idTienda);
    for (let i = 0; i < retries; i++) {
        try {
            const [rows] = await pool.execute(sql, params);
            return rows;
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            const isTransient = code === 'ECONNRESET' ||
                code === 'PROTOCOL_CONNECTION_LOST' ||
                code === 'ETIMEDOUT' ||
                code === 'ENOTFOUND' ||
                code === 'ECONNREFUSED';

            if (isTransient && i < retries - 1) {
                console.warn(`Tienda ${idTienda} MySQL attempt ${i + 1} failed (${code}), retrying in ${1000 * (i + 1)}ms...`);
                await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
                continue;
            }
            console.error(`Tienda ${idTienda} MySQL Query Error:`, error);
            throw error;
        }
    }
}

// Prueba la conexión al MySQL de la tienda (usada en el login).
export async function testTiendaConnection(idTienda: number): Promise<{ ok: boolean; error?: string }> {
    try {
        const pool = await getTiendaPool(idTienda);
        const conn = await pool.getConnection();
        try {
            await conn.ping();
        } finally {
            conn.release();
        }
        return { ok: true };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, error: message };
    }
}
