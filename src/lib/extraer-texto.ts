import * as XLSX from 'xlsx-js-style';

// Extracción de texto de los documentos del portal para el agente A.D.iA.N —
// todo local en el servidor, sin servicios externos: PDF con pdf-parse, Word
// (.docx) con mammoth, Excel/CSV con SheetJS y texto plano directo. Los tipos
// sin texto (imágenes, video, ZIP, .doc binario viejo...) regresan null.
export async function extraerTexto(
    nombreArchivo: string,
    mime: string,
    contenido: Buffer
): Promise<string | null> {
    const ext = nombreArchivo.split('.').pop()?.toLowerCase() ?? '';

    try {
        if (mime.includes('pdf') || ext === 'pdf') {
            const { PDFParse } = await import('pdf-parse');
            const parser = new PDFParse({ data: new Uint8Array(contenido) });
            try {
                const resultado = await parser.getText();
                // Marcadores [Página N]: permiten al agente decir en qué página
                // está algo y construir links con #page=N al visor del navegador
                const paginas = (resultado as { pages?: { num: number; text: string }[] }).pages;
                if (Array.isArray(paginas) && paginas.length > 0) {
                    return paginas.map(p => `[Página ${p.num}]\n${p.text}`).join('\n\n');
                }
                return resultado.text;
            } finally {
                await parser.destroy().catch(() => { /* liberar el documento es best-effort */ });
            }
        }

        if (ext === 'docx' || mime.includes('wordprocessingml')) {
            const mammoth = await import('mammoth');
            const resultado = await mammoth.extractRawText({ buffer: contenido });
            return resultado.value;
        }

        if (['xlsx', 'xls', 'xlsm', 'csv'].includes(ext) || mime.includes('sheet') || mime.includes('excel')) {
            const libro = XLSX.read(contenido, { type: 'buffer' });
            return libro.SheetNames
                .map(nombre => `--- Hoja: ${nombre} ---\n${XLSX.utils.sheet_to_csv(libro.Sheets[nombre])}`)
                .join('\n\n');
        }

        if (['txt', 'log', 'json', 'xml', 'html', 'md'].includes(ext) || mime.startsWith('text/')) {
            return contenido.toString('utf8');
        }
    } catch (error) {
        console.warn(`No se pudo extraer texto de ${nombreArchivo}:`, error);
        return null;
    }

    return null;
}
