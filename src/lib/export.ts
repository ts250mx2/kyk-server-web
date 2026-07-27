// Exportación a PDF (jsPDF + autotable) y Excel (xlsx-js-style), misma
// tecnología que kyk-dashboard. Reemplaza los reportes Crystal del VB6.
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx-js-style';

export interface ColumnaExport {
    header: string;
    align?: 'left' | 'right' | 'center';
}

const EMERALD: [number, number, number] = [5, 150, 105];   // emerald-600
const DARK: [number, number, number] = [15, 23, 42];       // slate-900
const MUTED: [number, number, number] = [100, 116, 139];   // slate-500

/** Nombre de la tienda de la sesión activa (para encabezados de reporte). */
export async function obtenerTiendaSesion(): Promise<string> {
    try {
        const res = await fetch('/api/auth/me');
        const data = await res.json();
        return data.user?.tienda ?? '';
    } catch {
        return '';
    }
}

function fechaReporte(): string {
    return new Date().toLocaleString('es-MX', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

export function exportarPdf(opts: {
    titulo: string;
    subtitulo?: string;
    tienda?: string;
    columnas: ColumnaExport[];
    filas: string[][];
    nombreArchivo: string;
    orientacion?: 'portrait' | 'landscape';
}) {
    const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: opts.orientacion ?? 'portrait' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 40;
    const totalPagesExp = '{total_pages_count_string}';

    // Barra superior de marca
    doc.setFillColor(...EMERALD);
    doc.rect(0, 0, pageWidth, 6, 'F');

    // Título y fecha
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(...DARK);
    doc.text(opts.titulo, margin, 40);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(fechaReporte(), pageWidth - margin, 40, { align: 'right' });

    const partes = [opts.tienda, opts.subtitulo].filter(Boolean);
    if (partes.length) {
        doc.text(partes.join('  ·  '), margin, 56);
    }

    const columnStyles: Record<number, { halign: 'left' | 'right' | 'center' }> = {};
    opts.columnas.forEach((c, i) => {
        if (c.align) columnStyles[i] = { halign: c.align };
    });

    autoTable(doc, {
        head: [opts.columnas.map(c => c.header)],
        body: opts.filas,
        startY: 68,
        margin: { left: margin, right: margin },
        styles: { fontSize: 7.5, cellPadding: 3, textColor: DARK },
        headStyles: { fillColor: EMERALD, textColor: [255, 255, 255], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [241, 245, 249] },
        columnStyles,
        didDrawPage: (data) => {
            doc.setFontSize(8);
            doc.setTextColor(...MUTED);
            doc.text(
                `Página ${data.pageNumber} de ${totalPagesExp}`,
                pageWidth - margin,
                doc.internal.pageSize.getHeight() - 16,
                { align: 'right' }
            );
            doc.text('KYK Server Web', margin, doc.internal.pageSize.getHeight() - 16);
        },
    });

    if (typeof doc.putTotalPages === 'function') {
        doc.putTotalPages(totalPagesExp);
    }

    doc.save(`${opts.nombreArchivo}.pdf`);
}

export function exportarExcel(opts: {
    titulo: string;
    subtitulo?: string;
    tienda?: string;
    columnas: ColumnaExport[];
    filas: (string | number)[][];
    nombreArchivo: string;
    hoja?: string;
    /** Índices de columnas con formato moneda ($#,##0.00) */
    columnasMoneda?: number[];
    /** Índices de columnas con formato porcentaje (0.0%) — valores como fracción */
    columnasPorcentaje?: number[];
}) {
    const nCols = opts.columnas.length;
    const encabezado = [opts.tienda, opts.subtitulo, fechaReporte()].filter(Boolean).join('  ·  ');

    const data: (string | number)[][] = [
        [opts.titulo],
        [encabezado],
        [],
        opts.columnas.map(c => c.header),
        ...opts.filas,
    ];

    const ws = XLSX.utils.aoa_to_sheet(data);

    // Combinar título y subtítulo a lo ancho
    ws['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: nCols - 1 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: nCols - 1 } },
    ];

    // Estilos: título, subtítulo y encabezados
    const celda = (r: number, c: number) => ws[XLSX.utils.encode_cell({ r, c })];
    if (celda(0, 0)) celda(0, 0).s = { font: { bold: true, sz: 14, color: { rgb: '0F172A' } } };
    if (celda(1, 0)) celda(1, 0).s = { font: { sz: 10, color: { rgb: '64748B' } } };
    for (let c = 0; c < nCols; c++) {
        const cell = celda(3, c);
        if (cell) {
            cell.s = {
                font: { bold: true, color: { rgb: 'FFFFFF' } },
                fill: { fgColor: { rgb: '059669' } },
                alignment: { horizontal: opts.columnas[c].align ?? 'left' },
            };
        }
    }

    // Formatos numéricos por columna
    const primeraFila = 4;
    for (let r = 0; r < opts.filas.length; r++) {
        for (const c of opts.columnasMoneda ?? []) {
            const cell = celda(primeraFila + r, c);
            if (cell && typeof cell.v === 'number') cell.z = '$#,##0.00';
        }
        for (const c of opts.columnasPorcentaje ?? []) {
            const cell = celda(primeraFila + r, c);
            if (cell && typeof cell.v === 'number') cell.z = '0.0%';
        }
    }

    // Anchos de columna según contenido (con tope)
    ws['!cols'] = opts.columnas.map((col, c) => {
        let ancho = col.header.length;
        for (const fila of opts.filas) {
            const len = String(fila[c] ?? '').length;
            if (len > ancho) ancho = len;
        }
        return { wch: Math.min(Math.max(ancho + 2, 10), 60) };
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, opts.hoja ?? 'Reporte');
    XLSX.writeFile(wb, `${opts.nombreArchivo}.xlsx`);
}

/** Timestamp corto para nombres de archivo: 2026-07-27_1430 */
export function sufijoArchivo(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}
