// Almacenamiento de archivos del portal (documentos y fotos del chat): carpetas
// locales del servidor web (fuera de /public), metadatos en BDKYKPortal.
import path from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';

// Límite de subida de documentos, configurable con DOCUMENTOS_MAX_MB (default
// 50 MB). El max_allowed_packet del MySQL central debe superar este límite
// (recomendado el doble) porque el binario viaja en un solo paquete.
export const TAMANO_MAXIMO = (Number(process.env.DOCUMENTOS_MAX_MB) || 50) * 1024 * 1024;
export const TAMANO_MAXIMO_MB = Math.round(TAMANO_MAXIMO / (1024 * 1024));
export const TAMANO_MAXIMO_IMAGEN = 10 * 1024 * 1024; // 10 MB fotos del chat

const RAIZ_UPLOADS = process.env.PORTAL_UPLOADS
    || path.join(process.cwd(), 'uploads');

function carpeta(subcarpeta: string): string {
    return path.join(RAIZ_UPLOADS, subcarpeta);
}

function sanitizarNombre(nombre: string): string {
    return nombre.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
}

/** Guarda el archivo y regresa el nombre físico con el que quedó en disco. */
export async function guardarArchivo(
    nombreOriginal: string,
    contenido: Buffer,
    subcarpeta = 'documentos'
): Promise<string> {
    await mkdir(carpeta(subcarpeta), { recursive: true });
    const nombreFisico = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${sanitizarNombre(nombreOriginal)}`;
    await writeFile(path.join(carpeta(subcarpeta), nombreFisico), contenido);
    return nombreFisico;
}

/** Lee un archivo guardado (el nombre físico viene de la base, no del cliente). */
export async function leerArchivo(nombreFisico: string, subcarpeta = 'documentos'): Promise<Buffer> {
    // Defensa por si un nombre en base viniera contaminado: nunca salir de la carpeta
    const ruta = path.join(carpeta(subcarpeta), path.basename(nombreFisico));
    return readFile(ruta);
}
