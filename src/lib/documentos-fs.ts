// Almacenamiento de archivos del repositorio de documentos: carpeta local del
// servidor web (fuera de /public), metadatos en BDKYKPortal.documentos.
import path from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';

export const TAMANO_MAXIMO = 25 * 1024 * 1024; // 25 MB

const CARPETA_UPLOADS = process.env.PORTAL_UPLOADS
    || path.join(process.cwd(), 'uploads', 'documentos');

function sanitizarNombre(nombre: string): string {
    return nombre.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
}

/** Guarda el archivo y regresa el nombre físico con el que quedó en disco. */
export async function guardarArchivo(nombreOriginal: string, contenido: Buffer): Promise<string> {
    await mkdir(CARPETA_UPLOADS, { recursive: true });
    const nombreFisico = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${sanitizarNombre(nombreOriginal)}`;
    await writeFile(path.join(CARPETA_UPLOADS, nombreFisico), contenido);
    return nombreFisico;
}

/** Lee un archivo guardado (el nombre físico viene de la base, no del cliente). */
export async function leerArchivo(nombreFisico: string): Promise<Buffer> {
    // Defensa por si un nombre en base viniera contaminado: nunca salir de la carpeta
    const ruta = path.join(CARPETA_UPLOADS, path.basename(nombreFisico));
    return readFile(ruta);
}
