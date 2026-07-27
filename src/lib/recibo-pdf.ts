// Impresión del recibo de mercancía en PDF, basada en el webservice Java
// ImprimirReciboMovil (misma estructura y cálculos, presentación más limpia):
// encabezado de empresa con logo, datos del recibo, partidas con descuentos 1-5 + V,
// devoluciones a proveedor, canastillas, diferencias de totales, destares y
// temperaturas, y pedidos pendientes del proveedor.
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { dibujarCodigoBarras } from './barcode';

export interface Empresa {
    razonSocial: string;
    rfc: string;
    direccion: string;
    coloniaMunicipio: string;
    cp: string;
    telefonos: string;
}

interface ReciboEnc {
    folio: string;
    fecha: string;
    tienda: string;
    idProveedor: number;
    proveedor: string;
    rfc: string;
    numero: string;
    usuario: string;
    condicionesPago: string;
    canastillasEntregadas: number;
    canastillasRecibidas: number;
    uuid: string;
    cancelado: boolean;
}

interface Partida {
    pedido: number;
    rec: number;
    medida: string;
    recGranelPiezas: number;
    kilosPiezas: number;
    codigoBarras: string;
    descripcion: string;
    llevaIva: boolean;
    caducidad?: string;
    costo: number;
    ieps: number;
    iepsCantidad: number;
    descuentos: number[]; // [d0..d4, mayoreo]
    total: number;
}

interface Devolucion {
    rec: number;
    medida: string;
    codigoBarras: string;
    descripcion: string;
    llevaIva: boolean;
    costo: number;
    ieps: number;
    iepsCantidad: number;
    descuentos: number[];
    total: number;
}

interface Destare {
    codigoBarras: string;
    descripcion: string;
    pesos: { pesoTotal: number; cajas: number; tara: number }[];
    pesoNeto: number;
    temperatura: number;
}

interface Pendiente {
    pedido: number;
    medida: string;
    codigoBarras: string;
    descripcion: string;
    llevaIva: boolean;
    costo: number;
    descuentos: number[];
    total: number;
}

interface Totales {
    sumPed: number;
    sumRec: number;
    subtotal: number;
    descuentos: number;
    ieps: number;
    iva: number;
    totalEntradas: number;
    subtotalDev: number;
    descuentosDev: number;
    iepsDev: number;
    ivaDev: number;
    totalSalidas: number;
    totalOrdenCompra: number;
    difTotalPedido: number;
    totalFactura: number;
    difTotalFactura: number;
    descuentoPtoPago: number;
    dctoFinanciero: number;
    totalPagar: number;
}

export interface ImpresionRecibo {
    empresa: Empresa;
    recibo: ReciboEnc;
    partidas: Partida[];
    devoluciones: Devolucion[];
    destares: Destare[];
    pendientes: Pendiente[];
    totales: Totales;
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
const pctCell = (f: number) => (f > 0 ? n2(f * 100) : '');

const fechaHora = (v: string) => {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('es-MX', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
};

export async function cargarLogo(): Promise<string | null> {
    try {
        const res = await fetch('/kyklogo.jpg');
        if (!res.ok) return null;
        const blob = await res.blob();
        return await new Promise(resolve => {
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result as string);
            fr.onerror = () => resolve(null);
            fr.readAsDataURL(blob);
        });
    } catch {
        return null;
    }
}

type DocConTabla = jsPDF & { lastAutoTable?: { finalY: number } };

/** Genera el PDF del recibo (formato del webservice Java) y lo abre para imprimir. */
export async function imprimirReciboPdf(datos: ImpresionRecibo) {
    const { empresa, recibo, partidas, devoluciones, destares, pendientes, totales } = datos;

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

    let y = 24;
    if (logo) {
        try { doc.addImage(logo, 'JPEG', margin, y, 78, 52); } catch { /* sin logo */ }
    }

    const centroX = margin + 90 + (usable - 90 - 130) / 2;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...DARK);
    doc.text('RECIBO DE MERCANCÍA', centroX, y + 8, { align: 'center' });
    doc.setFontSize(9.5);
    doc.text(empresa.razonSocial, centroX, y + 21, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(empresa.rfc, centroX, y + 31, { align: 'center' });
    doc.text(empresa.direccion, centroX, y + 40, { align: 'center' });
    doc.text(`${empresa.coloniaMunicipio}${empresa.cp ? ` CP ${empresa.cp}` : ''}`, centroX, y + 49, { align: 'center' });
    if (empresa.telefonos.trim()) {
        doc.text(`Teléfonos: ${empresa.telefonos}`, centroX, y + 58, { align: 'center' });
    }

    // Caja fecha / folio (con código de barras del folio, como el impreso original)
    const cajaX = pageWidth - margin - 126;
    doc.setDrawColor(...BORDER);
    doc.setFillColor(...LIGHT);
    doc.roundedRect(cajaX, y, 126, 70, 4, 4, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(...MUTED);
    doc.text('FECHA', cajaX + 63, y + 11, { align: 'center' });
    doc.setFontSize(8);
    doc.setTextColor(...DARK);
    doc.text(fechaHora(recibo.fecha), cajaX + 63, y + 21, { align: 'center' });
    doc.setFontSize(6.5);
    doc.setTextColor(...MUTED);
    doc.text('FOLIO', cajaX + 63, y + 33, { align: 'center' });
    doc.setFontSize(11);
    doc.setTextColor(...EMERALD);
    doc.text(recibo.folio, cajaX + 63, y + 45, { align: 'center' });
    dibujarCodigoBarras(doc, recibo.folio, cajaX + 10, y + 50, 106, 14);

    if (recibo.cancelado) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(...ROSE);
        doc.text('*** CANCELADO ***', cajaX + 63, y + 82, { align: 'center' });
    }

    y += 82;

    // ===== Datos del recibo (sucursal, condiciones, proveedor, factura) =====
    autoTable(doc, {
        body: [
            ['Sucursal:', recibo.tienda, 'Condiciones de Pago:', recibo.condicionesPago],
            ['Proveedor:', `${recibo.idProveedor}  ${recibo.proveedor}`, 'Factura:', recibo.numero || '—'],
            ['Recibió:', recibo.usuario || '—', 'UUID:', recibo.uuid || '—'],
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

    // ===== Partidas del RECIBO =====
    const cabecerasPartidas = [
        '#', 'Ped', 'Rec', 'Med', 'Kg/Pz', 'Prom', 'Código', 'Descripción', 'Cad.',
        'Costo', 'IEPS', 'D1', 'D2', 'D3', 'D4', 'D5', 'V', 'Total',
    ];
    autoTable(doc, {
        head: [cabecerasPartidas],
        body: partidas.map((p, i) => [
            String(i + 1),
            n2(p.pedido),
            n2(p.rec),
            p.medida,
            p.recGranelPiezas > 0 ? n2(p.recGranelPiezas) : '',
            p.kilosPiezas > 0 ? n2(p.kilosPiezas) : '',
            p.codigoBarras,
            `${p.descripcion}${p.llevaIva ? ' *' : ''}`,
            p.caducidad ? p.caducidad.slice(0, 10) : '',
            money(p.costo),
            p.iepsCantidad > 0 ? money(p.iepsCantidad) : (p.ieps > 0 ? `${n2(p.ieps * 100)}%` : ''),
            ...p.descuentos.map(pctCell),
            money(p.total),
        ]),
        foot: [[
            'T', n2(totales.sumPed), n2(totales.sumRec), 'Dif:', n2(totales.sumPed - totales.sumRec),
            '', '', '', '', '', '', '', '', '', '', '', '', '',
        ]],
        startY: y,
        margin: { left: margin, right: margin },
        styles: { fontSize: 6, cellPadding: 1.8, textColor: DARK, overflow: 'linebreak' },
        headStyles: { fillColor: EMERALD, textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
        footStyles: { fillColor: LIGHT, textColor: DARK, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
            0: { cellWidth: 13, halign: 'right' },
            1: { cellWidth: 23, halign: 'right' },
            2: { cellWidth: 25, halign: 'right', fontStyle: 'bold' },
            3: { cellWidth: 20 },
            4: { cellWidth: 25, halign: 'right' },
            5: { cellWidth: 24, halign: 'right' },
            6: { cellWidth: 52 },
            8: { cellWidth: 38 },
            9: { cellWidth: 33, halign: 'right' },
            10: { cellWidth: 26, halign: 'right' },
            11: { cellWidth: 15, halign: 'right' },
            12: { cellWidth: 15, halign: 'right' },
            13: { cellWidth: 15, halign: 'right' },
            14: { cellWidth: 15, halign: 'right' },
            15: { cellWidth: 15, halign: 'right' },
            16: { cellWidth: 15, halign: 'right' },
            17: { cellWidth: 38, halign: 'right', fontStyle: 'bold' },
        },
        didDrawPage: (data) => {
            doc.setFontSize(7);
            doc.setTextColor(...MUTED);
            doc.text(`Página ${data.pageNumber} de ${totalPagesExp}`, pageWidth - margin, pageHeight - 14, { align: 'right' });
            doc.text('KYK Server Web', margin, pageHeight - 14);
        },
    });
    y = (doc.lastAutoTable?.finalY ?? y) + 8;

    // ===== DEVOLUCIONES A PROVEEDOR =====
    if (devoluciones.length > 0) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(...ROSE);
        doc.text('DEVOLUCIONES A PROVEEDOR', margin, y + 2);
        autoTable(doc, {
            head: [['#', 'Dev', 'Med', 'Código', 'Descripción', 'Costo', 'IEPS', 'D1', 'D2', 'D3', 'D4', 'D5', 'V', 'Total']],
            body: devoluciones.map((p, i) => [
                String(i + 1),
                n2(p.rec),
                p.medida,
                p.codigoBarras,
                `${p.descripcion}${p.llevaIva ? ' *' : ''}`,
                money(p.costo),
                p.iepsCantidad > 0 ? money(p.iepsCantidad) : (p.ieps > 0 ? `${n2(p.ieps * 100)}%` : ''),
                ...p.descuentos.map(pctCell),
                money(p.total),
            ]),
            startY: y + 6,
            margin: { left: margin, right: margin },
            styles: { fontSize: 6, cellPadding: 1.8, textColor: ROSE, overflow: 'linebreak' },
            headStyles: { fillColor: ROSE, textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
            alternateRowStyles: { fillColor: [254, 242, 242] },
            columnStyles: {
                0: { cellWidth: 13, halign: 'right' },
                1: { cellWidth: 25, halign: 'right', fontStyle: 'bold' },
                2: { cellWidth: 22 },
                3: { cellWidth: 55 },
                5: { cellWidth: 34, halign: 'right' },
                6: { cellWidth: 27, halign: 'right' },
                7: { cellWidth: 15, halign: 'right' },
                8: { cellWidth: 15, halign: 'right' },
                9: { cellWidth: 15, halign: 'right' },
                10: { cellWidth: 15, halign: 'right' },
                11: { cellWidth: 15, halign: 'right' },
                12: { cellWidth: 15, halign: 'right' },
                13: { cellWidth: 38, halign: 'right', fontStyle: 'bold' },
            },
            didDrawPage: (data) => {
                doc.setFontSize(7);
                doc.setTextColor(...MUTED);
                doc.text(`Página ${data.pageNumber} de ${totalPagesExp}`, pageWidth - margin, pageHeight - 14, { align: 'right' });
                doc.text('KYK Server Web', margin, pageHeight - 14);
            },
        });
        y = (doc.lastAutoTable?.finalY ?? y) + 8;
    }

    // ===== Cajas de totales =====
    const drawBox = (
        x: number, yBox: number, w: number, titulo: string,
        filas: Array<[string, string, boolean?]>, tituloColor: [number, number, number] = EMERALD
    ): number => {
        const h = 13 + filas.length * 10 + 5;
        doc.setDrawColor(...BORDER);
        doc.setFillColor(255, 255, 255);
        doc.roundedRect(x, yBox, w, h, 3, 3, 'S');
        doc.setFillColor(...tituloColor);
        doc.roundedRect(x, yBox, w, 11, 3, 3, 'F');
        doc.rect(x, yBox + 6, w, 5, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.3);
        doc.setTextColor(255, 255, 255);
        doc.text(titulo, x + w / 2, yBox + 7.5, { align: 'center' });
        let fy = yBox + 20;
        for (const [etiqueta, valor, destacado] of filas) {
            doc.setFont('helvetica', destacado ? 'bold' : 'normal');
            doc.setFontSize(destacado ? 7 : 6.5);
            doc.setTextColor(...(destacado ? EMERALD : DARK));
            doc.text(etiqueta, x + 5, fy);
            doc.text(valor, x + w - 5, fy, { align: 'right' });
            fy += 10;
        }
        return h;
    };

    const alturaTotales = 96;
    if (y + alturaTotales > pageHeight - 30) {
        doc.addPage();
        y = 30;
    }

    const gap = 8;
    const wRecibo = 128, wDev = 128, wTotal = 128, wCan = 84;
    let x = margin;
    const h1 = drawBox(x, y, wRecibo, 'RECIBO', [
        ['Subtotal:', money(totales.subtotal)],
        ['Descuentos:', money(-totales.descuentos)],
        ['I.E.P.S.:', money(totales.ieps)],
        ['I.V.A.:', money(totales.iva)],
        ['Total:', money(totales.totalEntradas), true],
    ]);
    x += wRecibo + gap;
    let h2 = 0;
    if (devoluciones.length > 0) {
        h2 = drawBox(x, y, wDev, 'DEVOLUCIONES', [
            ['Subtotal:', money(totales.subtotalDev)],
            ['Descuentos:', money(-totales.descuentosDev)],
            ['I.E.P.S.:', money(totales.iepsDev)],
            ['I.V.A.:', money(-totales.ivaDev)],
            ['Total:', money(totales.totalSalidas), true],
        ], ROSE);
        x += wDev + gap;
    }
    const h3 = drawBox(x, y, wTotal, 'TOTAL', [
        ['Entradas:', money(totales.totalEntradas)],
        ['Salidas:', money(totales.totalSalidas)],
        [`Dcto. Financiero (${n2(totales.descuentoPtoPago)}%):`, money(totales.dctoFinanciero)],
        ['TOTAL A PAGAR:', money(totales.totalPagar), true],
    ]);
    x += wTotal + gap;
    const h4 = drawBox(x, y, wCan, 'CANASTILLAS', [
        ['Entregadas:', String(recibo.canastillasEntregadas)],
        ['Recibidas:', String(recibo.canastillasRecibidas)],
    ], [71, 85, 105]);

    y += Math.max(h1, h2, h3, h4) + 8;

    const h5 = drawBox(margin, y, 200, 'DIF. TOTALES', [
        ['Subtotal:', money(totales.totalEntradas)],
        ['Total Pedido:', money(totales.totalOrdenCompra)],
        ['Dif. Total Pedido:', money(totales.difTotalPedido)],
        ['Total Factura:', money(totales.totalFactura)],
        ['Dif. Total Factura:', money(totales.difTotalFactura)],
    ], [71, 85, 105]);

    // Nota de IVA
    const hayIva = partidas.some(p => p.llevaIva) || devoluciones.some(p => p.llevaIva);
    if (hayIva) {
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(6.5);
        doc.setTextColor(...MUTED);
        doc.text('* Artículos con I.V.A.', margin + 210, y + 8);
    }
    y += h5 + 10;

    // ===== DESTARES Y TEMPERATURAS =====
    if (destares.length > 0) {
        if (y + 60 > pageHeight - 30) { doc.addPage(); y = 30; }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(...DARK);
        doc.text('DESTARES Y TEMPERATURAS', margin, y);
        const pesoCell = (p: { pesoTotal: number; cajas: number; tara: number }) =>
            p.pesoTotal > 0 ? `${n2(p.pesoTotal)} kg · ${p.cajas} cjs · ${n2(p.tara)}` : '';
        autoTable(doc, {
            head: [['Código', 'Descripción', 'Peso 1 (total·cajas·tara)', 'Peso 2', 'Peso 3', 'Peso 4', 'Peso Neto (Kg)', 'Temp. °C']],
            body: destares.map(d => [
                d.codigoBarras,
                d.descripcion,
                pesoCell(d.pesos[0]),
                pesoCell(d.pesos[1]),
                pesoCell(d.pesos[2]),
                pesoCell(d.pesos[3]),
                n2(d.pesoNeto),
                d.temperatura > 0 ? n2(d.temperatura) : '',
            ]),
            startY: y + 4,
            margin: { left: margin, right: margin },
            styles: { fontSize: 6, cellPadding: 1.8, textColor: DARK, overflow: 'linebreak' },
            headStyles: { fillColor: [71, 85, 105], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
            alternateRowStyles: { fillColor: [248, 250, 252] },
            columnStyles: {
                0: { cellWidth: 55 },
                6: { halign: 'right', fontStyle: 'bold' },
                7: { halign: 'right' },
            },
            didDrawPage: (data) => {
                doc.setFontSize(7);
                doc.setTextColor(...MUTED);
                doc.text(`Página ${data.pageNumber} de ${totalPagesExp}`, pageWidth - margin, pageHeight - 14, { align: 'right' });
                doc.text('KYK Server Web', margin, pageHeight - 14);
            },
        });
        y = (doc.lastAutoTable?.finalY ?? y) + 10;
    }

    // ===== PEDIDOS PENDIENTES =====
    if (pendientes.length > 0) {
        if (y + 60 > pageHeight - 30) { doc.addPage(); y = 30; }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(8, 145, 178);
        doc.text('PEDIDOS PENDIENTES DEL PROVEEDOR', margin, y - 2);
        const descComb = (ds: number[]) => {
            const comb = 1 - ds.reduce((acc, d) => acc * (1 - (d || 0)), 1);
            return comb > 0 ? `${n2(comb * 100)}%` : '';
        };
        autoTable(doc, {
            head: [['#', 'Pedido', 'Med', 'Código', 'Descripción', 'Costo', 'Desc.', 'Total']],
            body: pendientes.map((p, i) => [
                String(i + 1),
                n2(p.pedido),
                p.medida,
                p.codigoBarras,
                `${p.descripcion}${p.llevaIva ? ' *' : ''}`,
                money(p.costo),
                descComb(p.descuentos),
                money(p.total),
            ]),
            startY: y + 2,
            margin: { left: margin, right: margin },
            styles: { fontSize: 6, cellPadding: 1.8, textColor: DARK, overflow: 'linebreak' },
            headStyles: { fillColor: [8, 145, 178], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
            alternateRowStyles: { fillColor: [248, 250, 252] },
            columnStyles: {
                0: { cellWidth: 14, halign: 'right' },
                1: { cellWidth: 32, halign: 'right', fontStyle: 'bold' },
                2: { cellWidth: 24 },
                3: { cellWidth: 60 },
                5: { cellWidth: 40, halign: 'right' },
                6: { cellWidth: 30, halign: 'right' },
                7: { cellWidth: 44, halign: 'right', fontStyle: 'bold' },
            },
            didDrawPage: (data) => {
                doc.setFontSize(7);
                doc.setTextColor(...MUTED);
                doc.text(`Página ${data.pageNumber} de ${totalPagesExp}`, pageWidth - margin, pageHeight - 14, { align: 'right' });
                doc.text('KYK Server Web', margin, pageHeight - 14);
            },
        });
    }

    if (typeof doc.putTotalPages === 'function') {
        doc.putTotalPages(totalPagesExp);
    }

    const url = doc.output('bloburl');
    const ventana = window.open(url, '_blank');
    if (!ventana) {
        doc.save(`recibo_${recibo.folio}.pdf`);
    }
}
