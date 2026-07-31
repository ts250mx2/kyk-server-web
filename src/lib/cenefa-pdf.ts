// Cenefas de precio ("KE PRECIAZO"): réplica del diseño impreso de la cadena —
// fondo rojo, título amarillo, logo, caja blanca con la descripción y el precio
// gigante (centavos arriba y unidad abajo) y panel amarillo opcional de precio
// especial por volumen. Se imprime en PDF tamaño carta: 1 por hoja (carta),
// 2 (media carta) o 4 (cuarto), con las copias que se pidan.
import jsPDF from 'jspdf';
import { cargarLogo } from './recibo-pdf';

const ROJO: [number, number, number] = [228, 16, 28];
const AMARILLO: [number, number, number] = [255, 205, 0];
const NEGRO: [number, number, number] = [17, 17, 17];
const BLANCO: [number, number, number] = [255, 255, 255];

export type TamanoCenefa = 'carta' | 'media' | 'cuarto';

export interface DatosCenefa {
    titulo: string;            // "KE PRECIAZO" (se parte en 2 líneas por espacio)
    descripcion: string;       // nombre del producto
    etiqueta: string;          // "A Solo:"
    precio: number;
    unidad: string;            // "PZA" / "KG"
    panel: {
        titulo: string;        // "¡PRECIO ESPECIAL!"
        cantidad: number;      // a partir de N
        unidad: string;        // "PZS"
        precio: number;
    } | null;
}

interface Celda { x: number; y: number; w: number; h: number }

/** Texto centrado que se encoge hasta caber en anchoMax (regresa el tamaño usado). */
function ajustarTexto(doc: jsPDF, texto: string, anchoMax: number, tamanoIdeal: number, minimo = 6): number {
    let tamano = tamanoIdeal;
    doc.setFontSize(tamano);
    while (tamano > minimo && doc.getTextWidth(texto) > anchoMax) {
        tamano -= 0.5;
        doc.setFontSize(tamano);
    }
    return tamano;
}

function dibujarCenefa(doc: jsPDF, c: Celda, datos: DatosCenefa, logo: string | null) {
    const { x, y, w, h } = c;
    const e = Math.min(w, h * 1.34); // escala base (diseño ~4:3)

    // ── Fondo rojo ──
    doc.setFillColor(...ROJO);
    doc.rect(x, y, w, h, 'F');

    // ── Título en 2 líneas ("KE" / "PRECIAZO"), amarillo, arriba-izquierda ──
    const [linea1, ...resto] = datos.titulo.trim().toUpperCase().split(/\s+/);
    const linea2 = resto.join(' ');
    doc.setTextColor(...AMARILLO);
    doc.setFont('helvetica', 'bold');
    const anchoTitulo = w * (logo ? 0.62 : 0.9);
    if (linea2) {
        const t1 = ajustarTexto(doc, linea1, anchoTitulo, e * 0.115);
        doc.setFontSize(t1);
        doc.text(linea1, x + w * 0.045, y + h * 0.155);
        const t2 = ajustarTexto(doc, linea2, anchoTitulo, e * 0.125);
        doc.setFontSize(t2);
        doc.text(linea2, x + w * 0.045, y + h * 0.30);
    } else {
        const t1 = ajustarTexto(doc, linea1, anchoTitulo, e * 0.125);
        doc.setFontSize(t1);
        doc.text(linea1, x + w * 0.045, y + h * 0.22);
    }

    // ── Logo arriba-derecha (o insignia de texto si no hay imagen) ──
    const logoW = w * 0.26;
    const logoH = logoW * 0.66;
    const logoX = x + w - logoW - w * 0.035;
    const logoY = y + h * 0.045;
    if (logo) {
        try {
            doc.addImage(logo, 'JPEG', logoX, logoY, logoW, logoH);
        } catch { /* sin logo, queda el fondo rojo */ }
    } else {
        doc.setFillColor(...AMARILLO);
        doc.roundedRect(logoX, logoY, logoW, logoH, e * 0.02, e * 0.02, 'F');
        doc.setTextColor(...ROJO);
        doc.setFontSize(ajustarTexto(doc, 'KESOS Y KOSAS', logoW * 0.9, e * 0.035));
        doc.text('KESOS Y KOSAS', logoX + logoW / 2, logoY + logoH * 0.45, { align: 'center' });
        doc.setTextColor(...NEGRO);
        doc.setFontSize(ajustarTexto(doc, 'Las más deliciosas', logoW * 0.85, e * 0.024));
        doc.text('Las más deliciosas', logoX + logoW / 2, logoY + logoH * 0.78, { align: 'center' });
    }

    // ── Caja blanca del producto ──
    const conPanel = datos.panel !== null;
    const cajaX = x + w * 0.03;
    const cajaY = y + h * 0.375;
    const cajaW = conPanel ? w * 0.665 : w * 0.94;
    const cajaH = h * 0.585;
    const radio = e * 0.028;
    doc.setFillColor(...BLANCO);
    doc.roundedRect(cajaX, cajaY, cajaW, cajaH, radio, radio, 'F');

    // Descripción: mayúsculas, centrada, hasta 3 líneas con auto-encogido
    doc.setTextColor(...NEGRO);
    doc.setFont('helvetica', 'bold');
    const descripcion = datos.descripcion.trim().toUpperCase();
    let tamanoDesc = e * 0.055;
    let lineas: string[] = [];
    for (; tamanoDesc >= 6; tamanoDesc -= 0.5) {
        doc.setFontSize(tamanoDesc);
        lineas = doc.splitTextToSize(descripcion, cajaW * 0.92) as string[];
        if (lineas.length <= 3) break;
    }
    doc.setFontSize(tamanoDesc);
    let descY = cajaY + cajaH * 0.14 + tamanoDesc * 0.3;
    for (const linea of lineas) {
        doc.text(linea, cajaX + cajaW / 2, descY, { align: 'center' });
        descY += tamanoDesc * 1.12;
    }

    // Precio: "$" + entero gigante + centavos arriba y unidad abajo
    const precioY = cajaY + cajaH * 0.82;
    const entero = Math.floor(datos.precio);
    const centavos = Math.round((datos.precio - entero) * 100);
    const textoEntero = `${entero}.`;
    const textoCentavos = String(centavos).padStart(2, '0');
    const unidad = datos.unidad.trim().toUpperCase();

    const tamanoEntero = Math.min(e * 0.21, cajaH * 0.52);
    const tamanoCent = tamanoEntero * 0.42;
    const tamanoUnidad = tamanoEntero * 0.28;
    const tamanoPeso = tamanoEntero * 0.55;
    const tamanoEtiqueta = e * 0.038;

    doc.setFontSize(tamanoEntero);
    const anchoEntero = doc.getTextWidth(textoEntero);
    doc.setFontSize(tamanoCent);
    const anchoCent = Math.max(doc.getTextWidth(textoCentavos), doc.getTextWidth(unidad) * 0.8);
    doc.setFontSize(tamanoPeso);
    const anchoPeso = doc.getTextWidth('$');
    doc.setFontSize(tamanoEtiqueta);
    const anchoEtiqueta = doc.getTextWidth(datos.etiqueta) + e * 0.015;

    const anchoTotal = anchoEtiqueta + anchoPeso + e * 0.02 + anchoEntero + anchoCent;
    let px = cajaX + (cajaW - anchoTotal) / 2;
    if (px < cajaX + cajaW * 0.03) px = cajaX + cajaW * 0.03;

    // "A Solo:" con subrayado, a la izquierda del precio
    doc.setFontSize(tamanoEtiqueta);
    doc.text(datos.etiqueta, px, precioY - tamanoEntero * 0.38);
    doc.setLineWidth(e * 0.004);
    doc.setDrawColor(...NEGRO);
    const anchoSolo = doc.getTextWidth(datos.etiqueta);
    doc.line(px, precioY - tamanoEntero * 0.38 + e * 0.008, px + anchoSolo, precioY - tamanoEntero * 0.38 + e * 0.008);
    px += anchoEtiqueta;

    doc.setFontSize(tamanoPeso);
    doc.text('$', px, precioY);
    px += anchoPeso + e * 0.02;

    doc.setFontSize(tamanoEntero);
    doc.text(textoEntero, px, precioY);
    px += anchoEntero;

    doc.setFontSize(tamanoCent);
    doc.text(textoCentavos, px, precioY - tamanoEntero * 0.42);
    doc.setFontSize(tamanoUnidad);
    doc.text(unidad, px, precioY - tamanoEntero * 0.02);

    // ── Panel amarillo de precio especial (mayoreo) ──
    if (datos.panel) {
        const p = datos.panel;
        const panX = cajaX + cajaW + w * 0.025;
        const panW = x + w - panX - w * 0.03;
        const panY = cajaY;
        const panH = cajaH;
        doc.setFillColor(...AMARILLO);
        doc.roundedRect(panX, panY, panW, panH, radio, radio, 'F');

        doc.setTextColor(...NEGRO);
        doc.setFont('helvetica', 'bold');
        const centroX = panX + panW / 2;

        // Título del panel en 2 líneas si trae espacio ("¡PRECIO ESPECIAL!")
        const palabras = p.titulo.trim().toUpperCase().split(/\s+/);
        const mitad = Math.ceil(palabras.length / 2);
        const tituloLineas = palabras.length > 1
            ? [palabras.slice(0, mitad).join(' '), palabras.slice(mitad).join(' ')]
            : [p.titulo.toUpperCase()];
        let ty = panY + panH * 0.16;
        for (const linea of tituloLineas) {
            doc.setFontSize(ajustarTexto(doc, linea, panW * 0.88, e * 0.048));
            doc.text(linea, centroX, ty, { align: 'center' });
            ty += e * 0.055;
        }

        const lineasPanel = [
            'A PARTIR',
            `DE ${p.cantidad} ${p.unidad.trim().toUpperCase()}`,
            `$${p.precio.toFixed(2)}`,
        ];
        let ly = panY + panH * 0.58;
        for (const linea of lineasPanel) {
            doc.setFontSize(ajustarTexto(doc, linea, panW * 0.86, e * 0.05));
            doc.text(linea, centroX, ly, { align: 'center' });
            ly += e * 0.062;
        }
    }
}

/** Genera el PDF: reparte `copias` cenefas en hojas carta según el tamaño. */
export async function generarCenefasPdf(
    datos: DatosCenefa,
    tamano: TamanoCenefa,
    copias: number
) {
    const logo = await cargarLogo();
    const vertical = tamano === 'media';
    const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: vertical ? 'portrait' : 'landscape' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();

    const porPagina = tamano === 'carta' ? 1 : tamano === 'media' ? 2 : 4;
    const columnas = tamano === 'cuarto' ? 2 : 1;
    const filas = porPagina / columnas;
    const celdaW = pageW / columnas;
    const celdaH = pageH / filas;
    // Margencito interno para que el corte con tijera no se coma el diseño
    const m = 8;

    const total = Math.max(1, Math.min(copias, 100));
    for (let i = 0; i < total; i++) {
        const enPagina = i % porPagina;
        if (i > 0 && enPagina === 0) doc.addPage('letter', vertical ? 'portrait' : 'landscape');
        const col = enPagina % columnas;
        const fila = Math.floor(enPagina / columnas);
        dibujarCenefa(doc, {
            x: col * celdaW + m,
            y: fila * celdaH + m,
            w: celdaW - m * 2,
            h: celdaH - m * 2,
        }, datos, logo);
    }

    const nombre = datos.descripcion.trim().replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 40) || 'cenefa';
    doc.save(`cenefa_${nombre}.pdf`);
}
