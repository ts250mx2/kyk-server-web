import mysql from 'mysql2/promise';

// Pool al MySQL central (BDKYKRemoto) — catálogo de tiendas y sus conexiones.
const pool = mysql.createPool({
  host: process.env.MYSQL_SERVER_SERVER,
  user: process.env.MYSQL_SERVER_USER,
  password: process.env.MYSQL_SERVER_PASSWORD,
  database: process.env.MYSQL_SERVER_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
});

export type MysqlParam = string | number | boolean | Date | Buffer | null;

export async function mysqlQuery(sql: string, params?: MysqlParam[], retries = 3) {
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
        console.warn(`MySQL Query Attempt ${i + 1} failed (error: ${code}), retrying in ${1000 * (i + 1)}ms...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        continue;
      }
      console.error('MySQL Query Error:', error);
      throw error;
    }
  }
}

export default pool;
