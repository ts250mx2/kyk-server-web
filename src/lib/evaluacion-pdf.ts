// PDF del resultado de una evaluación de capacitación: constancia imprimible
// con los datos del evaluado, la calificación y el repaso pregunta por
// pregunta, más líneas de firma (evaluado / supervisor) para archivarla.
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const EMERALD: [number, number, number] = [5, 150, 105];
const ROSE: [number, number, number] = [225, 29, 72];
const AMBER: [number, number, number] = [217, 119, 6];
const DARK: [number, number, number] = [15, 23, 42];
const MUTED: [number, number, number] = [100, 116, 139];

const LETRAS = ['A', 'B', 'C', 'D'];

export interface DatosResultadoPdf {
    titulo: string;
    documento: string;
    usuario: string;
    tienda: string;
    aciertos: number;
    total: number;
    calificacion: number;
    fecha: Date;
    preguntas: { pregunta: string; opciones: string[] }[];
    detalle: { correcta: number; elegida: number; acerto: boolean; explicacion: string }[];
}

export function generarPdfResultado(datos: DatosResultadoPdf) {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const anchoPagina = doc.internal.pageSize.getWidth();
    const margen = 40;

    // Barra de marca y encabezado
    doc.setFillColor(...EMERALD);
    doc.rect(0, 0, anchoPagina, 6, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(...DARK);
    doc.text('Resultado de Evaluación', margen, 42);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(
        datos.fecha.toLocaleString('es-MX', {
            day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
        }),
        anchoPagina - margen, 42, { align: 'right' }
    );

    // Ficha del evaluado + calificación
    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(margen, 56, anchoPagina - margen * 2, 84, 6, 6, 'FD');

    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text('EVALUADO', margen + 14, 74);
    doc.text('TIENDA', margen + 14, 104);
    doc.text('EVALUACIÓN', margen + 14, 128);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...DARK);
    doc.text(datos.usuario || '—', margen + 14, 88);
    doc.setFontSize(10);
    doc.text(datos.tienda || '—', margen + 14, 116);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const tituloCorto = doc.splitTextToSize(datos.titulo, anchoPagina - margen * 2 - 190) as string[];
    doc.text(tituloCorto[0] ?? '', margen + 76, 128);

    // Calificación grande a la derecha
    const colorCalif = datos.calificacion >= 80 ? EMERALD : datos.calificacion >= 60 ? AMBER : ROSE;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(34);
    doc.setTextColor(...colorCalif);
    doc.text(String(datos.calificacion), anchoPagina - margen - 70, 100, { align: 'center' });
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(`${datos.aciertos} de ${datos.total} correctas`, anchoPagina - margen - 70, 116, { align: 'center' });

    // Repaso pregunta por pregunta
    autoTable(doc, {
        startY: 156,
        margin: { left: margen, right: margen },
        head: [['#', 'Pregunta', 'Tu respuesta', 'Respuesta correcta', 'Resultado']],
        body: datos.preguntas.map((p, i) => {
            const d = datos.detalle[i];
            const correcta = `${LETRAS[d.correcta]}. ${p.opciones[d.correcta]}${d.explicacion ? `\n${d.explicacion}` : ''}`;
            return [
                String(i + 1),
                p.pregunta,
                `${LETRAS[d.elegida]}. ${p.opciones[d.elegida]}`,
                correcta,
                d.acerto ? 'Correcta' : 'Incorrecta',
            ];
        }),
        styles: { fontSize: 7.5, cellPadding: 4, textColor: DARK, valign: 'top' },
        headStyles: { fillColor: EMERALD, textColor: [255, 255, 255], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [241, 245, 249] },
        columnStyles: {
            0: { cellWidth: 18, halign: 'center' },
            1: { cellWidth: 150 },
            4: { cellWidth: 52, halign: 'center', fontStyle: 'bold' },
        },
        didParseCell: (data) => {
            if (data.section === 'body' && data.column.index === 4) {
                data.cell.styles.textColor = data.cell.raw === 'Correcta' ? EMERALD : ROSE;
            }
        },
    });

    // Firmas (si el repaso llegó muy abajo, brinca de página)
    type ConTabla = jsPDF & { lastAutoTable?: { finalY: number } };
    let y = ((doc as ConTabla).lastAutoTable?.finalY ?? 400) + 56;
    if (y > doc.internal.pageSize.getHeight() - 80) {
        doc.addPage();
        y = 120;
    }
    const anchoFirma = (anchoPagina - margen * 2 - 40) / 2;
    doc.setDrawColor(...DARK);
    doc.line(margen, y, margen + anchoFirma, y);
    doc.line(anchoPagina - margen - anchoFirma, y, anchoPagina - margen, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text('Firma del evaluado', margen + anchoFirma / 2, y + 12, { align: 'center' });
    doc.text('Firma del supervisor', anchoPagina - margen - anchoFirma / 2, y + 12, { align: 'center' });

    doc.setFontSize(8);
    doc.text('KYK Server Web · Evaluaciones de capacitación', margen, doc.internal.pageSize.getHeight() - 16);

    const archivo = `evaluacion_${(datos.usuario || 'resultado').replace(/[^a-zA-Z0-9]+/g, '_')}`;
    doc.save(`${archivo}.pdf`);
}
