import { jsPDF } from "jspdf";
import type { PasoFlujo } from "@/components/dashboard/diagrama-flujo";

// PDF imprimible del diagrama de flujo de los agentes: hoja A4 APAISADA con
// encabezado de marca, nodos INICIO/FIN, tarjetas numeradas conectadas por
// flechas → (con salto de fila si el proceso es largo) y decisiones con sus
// ramas SÍ/NO en verde/rojo. Colores pensados para papel (fondo blanco).
// Se importa dinámicamente desde DiagramaFlujo para no cargar jspdf al chat.

const ACENTOS = {
    violeta: { r: 109, g: 40, b: 217 },
    ambar: { r: 202, g: 138, b: 4 },
} as const;

const MARGEN = 14;
const ANCHO_PASO = 58;
const ANCHO_DECISION = 66;
const ANCHO_TERMINAL = 24;
const GAP = 11;               // espacio de la flecha entre tarjetas
const LINEA = 4.6;            // alto aproximado de línea a 10pt

interface Medida {
    ancho: number;
    alto: number;
    lineas?: string[];
    pregunta?: string[];
    si?: string[];
    no?: string[];
}

type Nodo =
    | { tipo: "terminal"; texto: string }
    | (PasoFlujo & { numero?: number });

export function generarPdfFlujo(titulo: string, pasos: PasoFlujo[], acento: "ambar" | "violeta") {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const ac = ACENTOS[acento];

    // ── Encabezado de marca ──
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, W, 20, "F");
    doc.setFillColor(ac.r, ac.g, ac.b);
    doc.rect(0, 20, W, 1.8, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(titulo || "Diagrama de flujo", MARGEN, 12.5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(203, 213, 225);
    doc.text("KYK Server Web", W - MARGEN, 12.5, { align: "right" });

    // ── Lista de nodos: INICIO + pasos numerados + FIN ──
    let numero = 0;
    const nodos: Nodo[] = [
        { tipo: "terminal", texto: "INICIO" },
        ...pasos.map(p => (p.tipo === "paso" ? { ...p, numero: ++numero } : p)),
        { tipo: "terminal", texto: "FIN" },
    ];

    doc.setFontSize(10);
    const medir = (n: Nodo): Medida => {
        if (n.tipo === "terminal") return { ancho: ANCHO_TERMINAL, alto: 10 };
        if (n.tipo === "paso") {
            const lineas = doc.splitTextToSize(n.texto, ANCHO_PASO - 19) as string[];
            return { ancho: ANCHO_PASO, alto: Math.max(18, 9 + lineas.length * LINEA), lineas };
        }
        const pregunta = doc.splitTextToSize(n.texto, ANCHO_DECISION - 12) as string[];
        const si = n.si ? (doc.splitTextToSize(n.si, ANCHO_DECISION - 26) as string[]) : [];
        const no = n.no ? (doc.splitTextToSize(n.no, ANCHO_DECISION - 26) as string[]) : [];
        const altoSi = si.length ? si.length * LINEA + 5 : 0;
        const altoNo = no.length ? no.length * LINEA + 5 : 0;
        return {
            ancho: ANCHO_DECISION,
            alto: 9 + pregunta.length * LINEA + altoSi + altoNo + (altoSi ? 2 : 0) + (altoNo ? 2 : 0) + 2,
            pregunta, si, no,
        };
    };
    const medidas = nodos.map(medir);

    const flecha = (xFin: number, yCentro: number) => {
        doc.setDrawColor(ac.r, ac.g, ac.b);
        doc.setLineWidth(0.5);
        doc.line(xFin - GAP + 2, yCentro, xFin - 3.5, yCentro);
        doc.setFillColor(ac.r, ac.g, ac.b);
        doc.triangle(xFin - 3.5, yCentro - 1.8, xFin - 3.5, yCentro + 1.8, xFin - 0.8, yCentro, "F");
    };

    // ── Acomodo en filas con salto cuando ya no cabe ──
    let x = MARGEN;
    let y = 30;
    let altoFila = 0;

    nodos.forEach((nodo, i) => {
        const m = medidas[i];
        if (x + m.ancho > W - MARGEN && x > MARGEN) {
            // Indicador de continuación: flecha hacia abajo al final de la fila
            doc.setFillColor(ac.r, ac.g, ac.b);
            doc.triangle(x - GAP + 3, y + 11, x - GAP + 7, y + 11, x - GAP + 5, y + 15, "F");
            y += altoFila + 12;
            x = MARGEN;
            altoFila = 0;
            if (y + m.alto > H - 18) {
                doc.addPage();
                y = 18;
            }
        } else if (i > 0) {
            flecha(x, y + 9);
        }

        if (nodo.tipo === "terminal") {
            const esInicio = nodo.texto === "INICIO";
            if (esInicio) doc.setFillColor(22, 163, 74);
            else doc.setFillColor(71, 85, 105);
            doc.roundedRect(x, y + 4, m.ancho, 10, 5, 5, "F");
            doc.setTextColor(255, 255, 255);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(8.5);
            doc.text(nodo.texto, x + m.ancho / 2, y + 10.3, { align: "center" });
        } else if (nodo.tipo === "paso") {
            doc.setFillColor(244, 245, 248);
            doc.setDrawColor(198, 204, 216);
            doc.setLineWidth(0.35);
            doc.roundedRect(x, y, m.ancho, m.alto, 2.5, 2.5, "FD");
            doc.setFillColor(ac.r, ac.g, ac.b);
            doc.circle(x + 7.5, y + 8, 3.7, "F");
            doc.setTextColor(255, 255, 255);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(9);
            doc.text(String(nodo.numero), x + 7.5, y + 9.3, { align: "center" });
            doc.setTextColor(30, 35, 48);
            doc.setFont("helvetica", "normal");
            doc.setFontSize(10);
            doc.text(m.lineas ?? [], x + 13.5, y + 7.6);
        } else {
            doc.setFillColor(254, 243, 199);
            doc.setDrawColor(202, 138, 4);
            doc.setLineWidth(0.4);
            doc.roundedRect(x, y, m.ancho, m.alto, 2.5, 2.5, "FD");
            doc.setTextColor(120, 53, 15);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(10);
            doc.text(m.pregunta ?? [], x + 6, y + 7.6);
            let yRama = y + 5 + (m.pregunta?.length ?? 0) * LINEA + 2;
            if (m.si?.length) {
                const alto = m.si.length * LINEA + 4;
                doc.setFillColor(220, 247, 232);
                doc.setDrawColor(22, 163, 74);
                doc.roundedRect(x + 4, yRama, m.ancho - 8, alto, 1.5, 1.5, "FD");
                doc.setTextColor(21, 101, 52);
                doc.setFont("helvetica", "bold");
                doc.setFontSize(8);
                doc.text("SÍ", x + 7, yRama + 4.2);
                doc.setFont("helvetica", "normal");
                doc.setFontSize(9.5);
                doc.setTextColor(25, 60, 40);
                doc.text(m.si, x + 15, yRama + 4.2);
                yRama += alto + 2;
            }
            if (m.no?.length) {
                const alto = m.no.length * LINEA + 4;
                doc.setFillColor(254, 228, 230);
                doc.setDrawColor(220, 38, 38);
                doc.roundedRect(x + 4, yRama, m.ancho - 8, alto, 1.5, 1.5, "FD");
                doc.setTextColor(153, 27, 27);
                doc.setFont("helvetica", "bold");
                doc.setFontSize(8);
                doc.text("NO", x + 7, yRama + 4.2);
                doc.setFont("helvetica", "normal");
                doc.setFontSize(9.5);
                doc.setTextColor(80, 30, 30);
                doc.text(m.no, x + 15, yRama + 4.2);
            }
        }

        x += m.ancho + GAP;
        altoFila = Math.max(altoFila, m.alto);
    });

    // ── Pie de página ──
    const paginas = doc.getNumberOfPages();
    const fecha = new Date().toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" });
    for (let p = 1; p <= paginas; p++) {
        doc.setPage(p);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        doc.text(fecha, MARGEN, H - 8);
        doc.text(`Página ${p} de ${paginas}`, W - MARGEN, H - 8, { align: "right" });
    }

    const archivo = (titulo || "diagrama-flujo")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "diagrama-flujo";
    doc.save(`${archivo}.pdf`);
}
