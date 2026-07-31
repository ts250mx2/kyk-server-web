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
        IdCarpetaPadre INT NOT NULL DEFAULT 0,
        Status TINYINT NOT NULL DEFAULT 0,
        FechaAlta DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8`,
    `CREATE TABLE IF NOT EXISTS documentos (
        IdDocumento INT AUTO_INCREMENT PRIMARY KEY,
        IdCarpeta INT NOT NULL DEFAULT 0,
        Nombre VARCHAR(200) NOT NULL,
        NombreArchivo VARCHAR(255) NOT NULL,
        Archivo VARCHAR(255) NOT NULL,
        Contenido LONGBLOB NULL,
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
    `CREATE TABLE IF NOT EXISTS comunicados_adjuntos (
        IdAdjunto INT AUTO_INCREMENT PRIMARY KEY,
        IdComunicado INT NOT NULL,
        Nombre VARCHAR(255) NOT NULL,
        Archivo VARCHAR(255) NOT NULL,
        Tamano BIGINT NOT NULL DEFAULT 0,
        TipoMime VARCHAR(100) NOT NULL DEFAULT '',
        KEY idx_comunicado (IdComunicado)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8`,
    `CREATE TABLE IF NOT EXISTS chat_mensajes (
        IdMensaje INT AUTO_INCREMENT PRIMARY KEY,
        Canal VARCHAR(30) NOT NULL,
        IdTienda INT NOT NULL DEFAULT 0,
        CodigoBarras VARCHAR(45) NOT NULL,
        Nombre VARCHAR(100) NOT NULL DEFAULT '',
        Mensaje TEXT NOT NULL,
        Imagen VARCHAR(255) NOT NULL DEFAULT '',
        FechaEnvio DATETIME NOT NULL,
        KEY idx_canal (Canal, IdMensaje)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS adian_preguntas (
        IdPregunta INT AUTO_INCREMENT PRIMARY KEY,
        IdTienda INT NOT NULL DEFAULT 0,
        Tienda VARCHAR(100) NOT NULL DEFAULT '',
        CodigoBarras VARCHAR(45) NOT NULL DEFAULT '',
        Nombre VARCHAR(100) NOT NULL DEFAULT '',
        Pregunta TEXT NOT NULL,
        Fecha DATETIME NOT NULL,
        Status TINYINT NOT NULL DEFAULT 0,
        KEY idx_status_fecha (Status, Fecha)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8`,
    `CREATE TABLE IF NOT EXISTS documentos_texto (
        IdDocumento INT NOT NULL,
        Parte INT NOT NULL,
        Texto MEDIUMTEXT NOT NULL,
        PRIMARY KEY (IdDocumento, Parte)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8`,
    `CREATE TABLE IF NOT EXISTS chat_lecturas (
        Canal VARCHAR(100) NOT NULL,
        CodigoBarras VARCHAR(45) NOT NULL,
        UltimoLeido INT NOT NULL DEFAULT 0,
        FechaAct DATETIME NOT NULL,
        PRIMARY KEY (Canal, CodigoBarras)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8`,
    `CREATE TABLE IF NOT EXISTS portal_presencia (
        CodigoBarras VARCHAR(45) NOT NULL PRIMARY KEY,
        Nombre VARCHAR(100) NOT NULL DEFAULT '',
        IdTienda INT NOT NULL DEFAULT 0,
        UltimaVez DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS evaluaciones (
        IdEvaluacion INT AUTO_INCREMENT PRIMARY KEY,
        IdDocumento INT NOT NULL,
        Titulo VARCHAR(200) NOT NULL DEFAULT '',
        Preguntas MEDIUMTEXT NOT NULL,
        CreadaPor VARCHAR(45) NOT NULL DEFAULT '',
        FechaCreacion DATETIME NOT NULL,
        Status TINYINT NOT NULL DEFAULT 0,
        KEY idx_documento (IdDocumento)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS evaluaciones_resultados (
        IdResultado INT AUTO_INCREMENT PRIMARY KEY,
        IdEvaluacion INT NOT NULL,
        IdTienda INT NOT NULL DEFAULT 0,
        CodigoBarras VARCHAR(45) NOT NULL,
        Nombre VARCHAR(100) NOT NULL DEFAULT '',
        Respuestas TEXT NOT NULL,
        Aciertos INT NOT NULL DEFAULT 0,
        TotalPreguntas INT NOT NULL DEFAULT 0,
        Calificacion DECIMAL(5,2) NOT NULL DEFAULT 0,
        FechaFin DATETIME NOT NULL,
        KEY idx_eval (IdEvaluacion),
        KEY idx_usuario (CodigoBarras)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

// Migraciones aditivas sobre instalaciones existentes; el error 1060
// (columna duplicada) significa que la migración ya corrió y se ignora.
const MIGRACIONES = [
    `ALTER TABLE documentos_carpetas ADD COLUMN IdCarpetaPadre INT NOT NULL DEFAULT 0`,
    // El binario del documento vive en la base; los subidos antes de esta
    // migración se siguen leyendo de disco como respaldo
    `ALTER TABLE documentos ADD COLUMN Contenido LONGBLOB NULL`,
    // Resumen automático (Haiku) para que A.D.iA.N elija documentos por significado
    `ALTER TABLE documentos ADD COLUMN Resumen TEXT NULL`,
    // Emojis en el chat (🧀📦😀 son de 4 bytes): utf8 de MySQL solo guarda 3 y
    // los volvía "?". Idempotente: re-convertir una tabla ya en utf8mb4 no falla.
    `ALTER TABLE chat_mensajes CONVERT TO CHARACTER SET utf8mb4`,
    // Chats directos: el canal dm-<codigoA>-<codigoB> necesita más de 30 chars
    `ALTER TABLE chat_mensajes MODIFY Canal VARCHAR(100) NOT NULL`,
    `ALTER TABLE chat_lecturas MODIFY Canal VARCHAR(100) NOT NULL`,
];

let esquemaListo: Promise<void> | null = null;

function asegurarEsquema(): Promise<void> {
    if (!esquemaListo) {
        esquemaListo = (async () => {
            for (const ddl of TABLAS) {
                await pool.query(ddl);
            }
            for (const ddl of MIGRACIONES) {
                try {
                    await pool.query(ddl);
                } catch (err) {
                    if ((err as { errno?: number }).errno !== 1060) throw err;
                }
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
