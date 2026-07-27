// Impresión de una transferencia en PDF, con el mismo formato de documento que el
// recibo de mercancía (encabezado de empresa con logo, caja fecha/folio, datos de la
// transferencia, partidas y totales).
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { cargarLogo, type Empresa } from './recibo-pdf';

interface TransferenciaEnc {
    folioSalida: string;
    folioEntrada: string;
    descripcion: string;
    origen: string;
    destino: string;
    fechaSalida: string;
    fechaEntrada: string | null;
    recibida: boolean;
    cancelada: boolean;
    monto: number;
}

interface PartidaTransferencia {
    codigoBarras: string;
    descripcion: string;
    medida: string;
    mov: number;
    piezasPedido: number;
    piezasRecibo: number;
    costo: number;
    iva: number;
    importe: number;
}

export interface ImpresionTransferencia {
    empresa: Empresa;
    transferencia: TransferenciaEnc;
    partidas: PartidaTransferencia[];
}

const EMERALD: [number, number, number] = [5, 150, 105];
const DARK: [number, number, number] = [15, 23, 42];
const MUTED: [number, number, number] = [100, 116, 139];
const LIGHT: [number, number, number] = [241, 245, 249];
const ROSE: [number, number, number] = [190, 18, 60];
const BORDER: [number, number, number] = [203, 213, 225];

const money = (v: number) =>
    new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(v || 0);
const n2 = (v: number) => (Math.round((v || 0) * 100) / 100).toString();

const fechaHora = (v: string | null) => {
    if (!v) return '—';
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('es-MX', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
};

type DocConTabla = jsPDF & { lastAutoTable?: { finalY: number } };

/** Genera el PDF de la transferencia y lo abre en una pestaña nueva para imprimir. */
export async function imprimirTransferenciaPdf(datos: ImpresionTransferencia) {
    const { empresa, transferencia, partidas } = datos;

    const doc = new jsPDF({ unit: 'pt', format: 'a4' }) as DocConTabla;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 36;
    const usable = pageWidth - margin * 2;
    const totalPagesExp = '{total_pages_count_string}';

    const logo = await cargarLogo();

    // ===== Encabezado: logo + empresa + caja fecha/folio =====
    doc.setFillColor(...EMERALD);
    doc.rect(0, 0, pageWidth, 5, 'F');

    const y0 = 24;
    if (logo) {
        try { doc.addImage(logo, 'JPEG', margin, y0, 78, 52); } catch { /* sin logo */ }
    }

    const centroX = margin + 90 + (usable - 90 - 130) / 2;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...DARK);
    doc.text('TRANSFERENCIA DE MERCANCÍA', centroX, y0 + 8, { align: 'center' });
    doc.setFontSize(9.5);
    doc.text(empresa.razonSocial, centroX, y0 + 21, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(empresa.rfc, centroX, y0 + 31, { align: 'center' });
    doc.text(empresa.direccion, centroX, y0 + 40, { align: 'center' });
    doc.text(`${empresa.coloniaMunicipio}${empresa.cp ? ` CP ${empresa.cp}` : ''}`, centroX, y0 + 49, { align: 'center' });
    if (empresa.telefonos.trim()) {
        doc.text(`Teléfonos: ${empresa.telefonos}`, centroX, y0 + 58, { align: 'center' });
    }

    // Caja fecha / folio
    const cajaX = pageWidth - margin - 126;
    doc.setDrawColor(...BORDER);
    doc.setFillColor(...LIGHT);
    doc.roundedRect(cajaX, y0, 126, 52, 4, 4, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(...MUTED);
    doc.text('FECHA SALIDA', cajaX + 63, y0 + 11, { align: 'center' });
    doc.setFontSize(8);
    doc.setTextColor(...DARK);
    doc.text(fechaHora(transferencia.fechaSalida), cajaX + 63, y0 + 21, { align: 'center' });
    doc.setFontSize(6.5);
    doc.setTextColor(...MUTED);
    doc.text('FOLIO SALIDA', cajaX + 63, y0 + 33, { align: 'center' });
    doc.setFontSize(11);
    doc.setTextColor(...EMERALD);
    doc.text(transferencia.folioSalida, cajaX + 63, y0 + 45, { align: 'center' });

    if (transferencia.cancelada) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(...ROSE);
        doc.text('*** CANCELADA ***', cajaX + 63, y0 + 64, { align: 'center' });
    }

    let y = y0 + 64;

    // ===== Datos de la transferencia =====
    autoTable(doc, {
        body: [
            ['Origen:', transferencia.origen, 'Destino:', transferencia.destino],
            ['Descripción:', transferencia.descripcion || '—', 'Estado:', transferencia.recibida ? 'RECIBIDA' : 'EN TRÁNSITO'],
            ['Folio Entrada:', transferencia.folioEntrada || '—', 'Fecha Entrada:', fechaHora(transferencia.fechaEntrada)],
        ],
        startY: y,
        margin: { left: margin, right: margin },
        theme: 'grid',
        styles: { fontSize: 7.5, cellPadding: 3, textColor: DARK, lineColor: BORDER, lineWidth: 0.5 },
        columnStyles: {
            0: { cellWidth: 78, textColor: MUTED },
            1: { fontStyle: 'bold' },
            2: { cellWidth: 92, textColor: MUTED },
            3: { fontStyle: 'bold', cellWidth: 150 },
        },
    });
    y = (doc.lastAutoTable?.finalY ?? y) + 8;

    // ===== Partidas =====
    autoTable(doc, {
        head: [['#', 'Código', 'Descripción', 'Cantidad', 'Med', 'Pzs Ped', 'Pzs Rec', 'Costo', 'IVA', 'Importe']],
        body: partidas.map((p, i) => [
            String(i + 1),
            p.codigoBarras,
            p.descripcion,
            n2(p.mov),
            p.medida,
            p.piezasPedido > 0 ? n2(p.piezasPedido) : '',
            p.piezasRecibo > 0 ? n2(p.piezasRecibo) : '',
            money(p.costo),
            p.iva > 0 ? `${n2(p.iva * 100)}%` : '',
            money(p.importe),
        ]),
        foot: [[
            '', '', 'TOTAL',
            n2(partidas.reduce((acc, p) => acc + p.mov, 0)),
            '', '', '', '', '',
            money(transferencia.monto),
        ]],
        startY: y,
        margin: { left: margin, right: margin },
        styles: { fontSize: 7, cellPadding: 2.5, textColor: DARK, overflow: 'linebreak' },
        headStyles: { fillColor: EMERALD, textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
        footStyles: { fillColor: LIGHT, textColor: DARK, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
            0: { cellWidth: 18, halign: 'right' },
            1: { cellWidth: 62 },
            3: { cellWidth: 42, halign: 'right', fontStyle: 'bold' },
            4: { cellWidth: 26 },
            5: { cellWidth: 36, halign: 'right' },
            6: { cellWidth: 36, halign: 'right' },
            7: { cellWidth: 48, halign: 'right' },
            8: { cellWidth: 30, halign: 'right' },
            9: { cellWidth: 52, halign: 'right', fontStyle: 'bold' },
        },
        didDrawPage: (data) => {
            doc.setFontSize(7);
            doc.setTextColor(...MUTED);
            doc.text(`Página ${data.pageNumber} de ${totalPagesExp}`, pageWidth - margin, pageHeight - 14, { align: 'right' });
            doc.text('KYK Server Web', margin, pageHeight - 14);
        },
    });
    y = (doc.lastAutoTable?.finalY ?? y) + 14;

    // ===== Total destacado =====
    if (y + 30 > pageHeight - 30) {
        doc.addPage();
        y = 40;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...EMERALD);
    doc.text(`MONTO TOTAL: ${money(transferencia.monto)}`, pageWidth - margin, y, { align: 'right' });
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`${partidas.length} partidas`, pageWidth - margin, y + 12, { align: 'right' });

    if (typeof doc.putTotalPages === 'function') {
        doc.putTotalPages(totalPagesExp);
    }

    const url = doc.output('bloburl');
    const ventana = window.open(url, '_blank');
    if (!ventana) {
        doc.save(`transferencia_${transferencia.folioSalida}.pdf`);
    }
}
