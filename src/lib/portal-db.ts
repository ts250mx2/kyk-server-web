import mysql from 'mysql2/promise';
import type { MysqlParam } from './mysql';

// Base central del portal (BDKYKPortal en el MySQL central, MariaDB 5.5):
// comunicados, acuses y roles. Es independiente de las bases operativas —
// las tablas se crean solas si no existen (todo aditivo, nada legacy se toca).
const pool = mysql.createPool({
    host: process.env.MYSQL_SERVER_SERVER,
    user: process.env.MYSQL_SERVER_USER,
    password: process.env.MYSQL_SERVER_PASSWORD,
    database: 'BDKYKPortal',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
});

const TABLAS = [
    `CREATE TABLE IF NOT EXISTS comunicados (
        IdComunicado INT AUTO_INCREMENT PRIMARY KEY,
        Titulo VARCHAR(200) NOT NULL,
        Cuerpo TEXT NOT NULL,
        Prioridad TINYINT NOT NULL DEFAULT 0,
        TodasTiendas TINYINT NOT NULL DEFAULT 1,
        VigenteHasta DATETIME NULL,
        PublicadoPor VARCHAR(45) NOT NULL,
        PublicadoPorNombre VARCHAR(100) NOT NULL DEFAULT '',
        FechaPublicacion DATETIME NOT NULL,
        Status TINYINT NOT NULL DEFAULT 0,
        KEY idx_fecha (FechaPublicacion)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8`,
    `CREATE TABLE IF NOT EXISTS comunicados_tiendas (
        IdComunicado INT NOT NULL,
        IdTienda INT NOT NULL,
        PRIMARY KEY (IdComunicado, IdTienda)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8`,
    `CREATE TABLE IF NOT EXISTS comunicados_acuses (
        IdComunicado INT NOT NULL,
        IdTienda INT NOT NULL,
        CodigoBarras VARCHAR(45) NOT NULL,
        Nombre VARCHAR(100) NOT NULL DEFAULT '',
        FechaAcuse DATETIME NOT NULL,
        PRIMARY KEY (IdComunicado, IdTienda, CodigoBarras)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8`,
    `CREATE TABLE IF NOT EXISTS portal_usuarios (
        CodigoBarras VARCHAR(45) NOT NULL PRIMARY KEY,
        Nombre VARCHAR(100) NOT NULL DEFAULT '',
        Rol VARCHAR(20) NOT NULL DEFAULT 'tienda',
        FechaAlta DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8`,
    `CREATE TABLE IF NOT EXISTS documentos_carpetas (
        IdCarpeta INT AUTO_INCREMENT PRIMARY KEY,
        Nombre VARCHAR(100) NOT NULL,
        Status TINYINT NOT NULL DEFAULT 0,
        FechaAlta DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8`,
    `CREATE TABLE IF NOT EXISTS documentos (
        IdDocumento INT AUTO_INCREMENT PRIMARY KEY,
        IdCarpeta INT NOT NULL DEFAULT 0,
        Nombre VARCHAR(200) NOT NULL,
        NombreArchivo VARCHAR(255) NOT NULL,
        Archivo VARCHAR(255) NOT NULL,
        Tamano BIGINT NOT NULL DEFAULT 0,
        TipoMime VARCHAR(100) NOT NULL DEFAULT '',
        TodasTiendas TINYINT NOT NULL DEFAULT 1,
        SubidoPor VARCHAR(45) NOT NULL,
        SubidoPorNombre VARCHAR(100) NOT NULL DEFAULT '',
        FechaSubida DATETIME NOT NULL,
        Status TINYINT NOT NULL DEFAULT 0,
        KEY idx_carpeta (IdCarpeta)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8`,
    `CREATE TABLE IF NOT EXISTS documentos_tiendas (
        IdDocumento INT NOT NULL,
        IdTienda INT NOT NULL,
        PRIMARY KEY (IdDocumento, IdTienda)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8`,
    `CREATE TABLE IF NOT EXISTS documentos_descargas (
        IdDescarga INT AUTO_INCREMENT PRIMARY KEY,
        IdDocumento INT NOT NULL,
        IdTienda INT NOT NULL,
        CodigoBarras VARCHAR(45) NOT NULL,
        Nombre VARCHAR(100) NOT NULL DEFAULT '',
        FechaDescarga DATETIME NOT NULL,
        KEY idx_doc (IdDocumento)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8`,
];

let esquemaListo: Promise<void> | null = null;

function asegurarEsquema(): Promise<void> {
    if (!esquemaListo) {
        esquemaListo = (async () => {
            for (const ddl of TABLAS) {
                await pool.query(ddl);
            }
        })().catch(err => {
            // Permitir reintento en la siguiente llamada si falló (p. ej. red caída)
            esquemaListo = null;
            throw err;
        });
    }
    return esquemaListo;
}

export async function portalQuery(sql: string, params?: MysqlParam[]) {
    await asegurarEsquema();
    const [rows] = await pool.execute(sql, params);
    return rows;
}

// Rol 'oficina' (puede publicar/administrar): por variable de entorno PORTAL_OFICINA
// (códigos de barras separados por coma) o por registro en portal_usuarios.
export async function esOficina(codigoBarras: string): Promise<boolean> {
    const porEnv = (process.env.PORTAL_OFICINA ?? '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    if (porEnv.includes(codigoBarras)) return true;

    try {
        const rows = await portalQuery(
            `SELECT Rol FROM portal_usuarios WHERE CodigoBarras = ?`,
            [codigoBarras]
        ) as Array<{ Rol: string }>;
        return rows[0]?.Rol === 'oficina';
    } catch {
        return false;
    }
}
