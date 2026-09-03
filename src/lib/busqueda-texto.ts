// Búsqueda multi-término de A.D.iA.N sobre las partes de documentos_texto: el
// agente manda en UNA llamada la palabra clave, sinónimos y variantes, y aquí
// se arman los patrones LIKE con peso, la expresión SQL de puntaje y el ranking
// por documento con fragmentos. Es LIKE y no FULLTEXT porque el portal corre en
// MariaDB 5.5, cuyo InnoDB no soporta índices FULLTEXT; a la escala del portal
// (cientos de partes de 3k caracteres) el LIKE con puntaje alcanza de sobra.
// Módulo puro: lo que toca MySQL vive en documentos-texto.ts.

export const MAX_TERMINOS = 6;
export const MAX_FRAGMENTOS_POR_DOCUMENTO = 3;
export const MAX_DOCUMENTOS_RESULTADO = 8;

const PESO_FRASE = 3;
const PESO_PALABRA_SUELTA = 2;
const PESO_PALABRA_DE_FRASE = 1;
const LARGO_MINIMO_PALABRA = 3;
const LARGO_MINIMO_TERMINO = 2;
const CONTEXTO_ANTES = 120;
const CONTEXTO_DESPUES = 200;

const PALABRAS_VACIAS = new Set([
    'de', 'la', 'el', 'en', 'del', 'los', 'las', 'un', 'una', 'unos', 'unas', 'para', 'por',
    'con', 'que', 'se', 'y', 'o', 'a', 'al', 'lo', 'su', 'sus', 'es', 'como', 'sin', 'sobre',
    'mas', 'muy', 'hay', 'son', 'ser', 'este', 'esta', 'esto', 'ese', 'esa', 'eso', 'cuando',
    'donde', 'cual', 'quien', 'porque', 'hacer', 'hace', 'tiene', 'tener', 'puede', 'debe',
]);

export interface PatronBusqueda {
    /** Texto tal cual va al LIKE (sin los % de los extremos) */
    texto: string;
    /** Versión normalizada (minúsculas, sin acentos) para ubicarlo en JS */
    clave: string;
    peso: number;
    /** Término del agente del que salió el patrón */
    termino: string;
}

/** Minúsculas y sin acentos, para comparar en JS igual que el LIKE con collation _ci */
export function normalizar(texto: string): string {
    return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** Raíz aproximada: quita el plural para que "devoluciones" también encuentre
 *  "devolución" (el LIKE con collation _ci ya ignora mayúsculas y acentos). */
export function raiz(palabra: string): string {
    const p = palabra.toLowerCase();
    if (p.length > 5 && p.endsWith('es')) return p.slice(0, -2);
    if (p.length > 4 && p.endsWith('s')) return p.slice(0, -1);
    return p;
}

// Signos al inicio y al final ("¿inventario?" → "inventario"); los de adentro
// se conservan (p. ej. "3.5"). Letras latinas con acento y ñ, sin × ni ÷
const PUNTUACION_EXTREMOS = /^[^0-9A-Za-zÀ-ÖØ-öø-ÿ]+|[^0-9A-Za-zÀ-ÖØ-öø-ÿ]+$/g;

export function limpiarPalabra(palabra: string): string {
    return palabra.replace(PUNTUACION_EXTREMOS, '');
}

function palabrasSignificativas(frase: string): string[] {
    return frase
        .split(' ')
        .map(limpiarPalabra)
        .filter(p => p.length >= LARGO_MINIMO_PALABRA && !PALABRAS_VACIAS.has(normalizar(p)));
}

/** Términos para la búsqueda automática con la pregunta del usuario: sus
 *  palabras significativas, las más largas primero (suelen ser las más
 *  específicas), sin repetidas y hasta el máximo de términos. */
export function terminosDePregunta(pregunta: string): string[] {
    const vistas = new Set<string>();
    return palabrasSignificativas(pregunta.replace(/\s+/g, ' '))
        .map(p => p.toLowerCase())
        .filter(p => {
            const clave = normalizar(p);
            if (vistas.has(clave)) return false;
            vistas.add(clave);
            return true;
        })
        .sort((a, b) => b.length - a.length)
        .slice(0, MAX_TERMINOS);
}

/** Página (1-indexada) en la que cae una parte, según el tamaño de página */
export function paginaDeParte(parte: number, partesPorPagina: number): number {
    return Math.max(1, Math.ceil(parte / partesPorPagina));
}

/** Patrones LIKE por término: la frase completa pesa 3 y cada palabra
 *  significativa (por su raíz) pesa 1; un término de una sola palabra pesa 2.
 *  Se deduplican por clave normalizada conservando el peso mayor. */
export function patronesDeBusqueda(terminos: string[]): PatronBusqueda[] {
    const patrones = new Map<string, PatronBusqueda>();
    const agregar = (texto: string, peso: number, termino: string) => {
        const clave = normalizar(texto);
        if (!clave) return;
        const previo = patrones.get(clave);
        if (!previo || previo.peso < peso) patrones.set(clave, { texto, clave, peso, termino });
    };
    for (const termino of terminos.slice(0, MAX_TERMINOS)) {
        const frase = limpiarPalabra(String(termino ?? '').trim().replace(/\s+/g, ' '));
        if (frase.length < LARGO_MINIMO_TERMINO) continue;
        const palabras = palabrasSignificativas(frase);
        if (palabras.length === 0) {
            agregar(frase, PESO_PALABRA_SUELTA, frase);
        } else if (palabras.length === 1) {
            agregar(raiz(palabras[0]), PESO_PALABRA_SUELTA, frase);
        } else {
            agregar(frase, PESO_FRASE, frase);
            for (const palabra of palabras) agregar(raiz(palabra), PESO_PALABRA_DE_FRASE, frase);
        }
    }
    return [...patrones.values()];
}

/** Expresión SQL de puntaje (suma de LIKE con peso) y sus parámetros en el
 *  mismo orden. La consulta la usa dos veces (SELECT y WHERE), así que los
 *  parámetros se mandan dos veces también. */
export function expresionDePuntaje(patrones: PatronBusqueda[]): { sql: string; params: string[] } {
    if (patrones.length === 0) return { sql: '0', params: [] };
    return {
        sql: patrones.map(p => `(Texto LIKE ?) * ${p.peso}`).join(' + '),
        params: patrones.map(p => `%${p.texto}%`),
    };
}

export interface ParteEncontrada {
    idDocumento: number;
    parte: number;
    texto: string;
    puntaje: number;
}

export interface DocumentoEncontrado {
    idDocumento: number;
    puntaje: number;
    /** Términos del agente que sí aparecen en el documento */
    terminos: string[];
    fragmentos: string[];
    /** Parte con mayor puntaje: de ahí sale la página sugerida para leer */
    mejorParte: number;
}

interface DocumentoAcumulado extends DocumentoEncontrado {
    mejorPuntaje: number;
}

/** Fragmento alrededor de la primera aparición de la clave (o del inicio si
 *  no se ubica en JS; el LIKE ya dijo que la parte coincide). */
export function fragmentoAlrededor(texto: string, clave: string): string {
    const posicion = normalizar(texto).indexOf(clave);
    const inicio = posicion < 0 ? 0 : Math.max(0, posicion - CONTEXTO_ANTES);
    const fin = posicion < 0
        ? CONTEXTO_ANTES + CONTEXTO_DESPUES
        : posicion + clave.length + CONTEXTO_DESPUES;
    return `...${texto.slice(inicio, fin).replace(/\s+/g, ' ').trim()}...`;
}

/** Agrupa las partes por documento, suma el puntaje, junta hasta 3 fragmentos
 *  y regresa los mejores documentos primero (máximo 8). */
export function agruparPorDocumento(partes: ParteEncontrada[], patrones: PatronBusqueda[]): DocumentoEncontrado[] {
    const porPeso = [...patrones].sort((a, b) => b.peso - a.peso);
    const porDocumento = new Map<number, DocumentoAcumulado>();
    for (const parte of partes) {
        const normalizado = normalizar(parte.texto);
        const presentes = porPeso.filter(p => normalizado.includes(p.clave));
        const previo: DocumentoAcumulado = porDocumento.get(parte.idDocumento) ?? {
            idDocumento: parte.idDocumento,
            puntaje: 0,
            terminos: [],
            fragmentos: [],
            mejorParte: parte.parte,
            mejorPuntaje: -1,
        };
        const terminos = [...new Set([...previo.terminos, ...presentes.map(p => p.termino)])];
        const fragmentos = previo.fragmentos.length < MAX_FRAGMENTOS_POR_DOCUMENTO && presentes[0]
            ? [...previo.fragmentos, fragmentoAlrededor(parte.texto, presentes[0].clave)]
            : previo.fragmentos;
        const esMejor = parte.puntaje > previo.mejorPuntaje;
        porDocumento.set(parte.idDocumento, {
            ...previo,
            puntaje: previo.puntaje + parte.puntaje,
            terminos,
            fragmentos,
            mejorParte: esMejor ? parte.parte : previo.mejorParte,
            mejorPuntaje: esMejor ? parte.puntaje : previo.mejorPuntaje,
        });
    }
    return [...porDocumento.values()]
        .sort((a, b) => b.puntaje - a.puntaje || a.idDocumento - b.idDocumento)
        .slice(0, MAX_DOCUMENTOS_RESULTADO)
        .map(d => ({
            idDocumento: d.idDocumento,
            puntaje: d.puntaje,
            terminos: d.terminos,
            fragmentos: d.fragmentos,
            mejorParte: d.mejorParte,
        }));
}
