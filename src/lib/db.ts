import sql from 'mssql';

// Conexión a SQL Server (BDKYK) — validación de usuarios, igual que kyk-dashboard.
const user = process.env.SQL_SERVER_USER || 'sa';
const password = (process.env.SQL_SERVER_PASSWORD || '').replace(/\\(\$)/g, '$1');
const database = process.env.SQL_SERVER_DATABASE || 'BDKYK';
const server = process.env.SQL_SERVER_SERVER || '192.168.1.20';

if (!user || !password || !database) {
    throw new Error('Missing required database environment variables (SQL_SERVER_USER, SQL_SERVER_PASSWORD, SQL_SERVER_DATABASE)');
}

const sqlConfig: sql.config = {
    user,
    password,
    database,
    server,
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    },
    options: {
        encrypt: false, // false para entornos locales con IP y evitar errores TLS SNI
        trustServerCertificate: true,
        useUTC: false
    },
    requestTimeout: 60000
};

let pool: sql.ConnectionPool | null = null;

export async function getPool() {
    if (pool) return pool;
    try {
        pool = await new sql.ConnectionPool(sqlConfig).connect();
        return pool;
    } catch (err) {
        console.error('Database Connection Failed! Bad Config: ', err);
        throw err;
    }
}

export async function query(queryString: string, params: (string | number | boolean | Date | Buffer | null | undefined)[] = []) {
    try {
        const pool = await getPool();
        const request = pool.request();

        params.forEach((param, index) => {
            request.input(`p${index}`, param);
        });

        // Reemplaza ? por @p0, @p1, etc.
        let paramIndex = 0;
        const convertedQuery = queryString.replace(/\?/g, () => {
            return `@p${paramIndex++}`;
        });

        const result = await request.query(convertedQuery);
        return result.recordset;
    } catch (error) {
        console.error('Database Error:', error);
        throw new Error('Failed to execute query ' + error);
    }
}
