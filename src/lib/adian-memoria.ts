// Memoria corta de A.D.iA.N por conversación: las páginas que el agente ya
// leyó en turnos anteriores. El historial que manda el cliente solo trae
// texto, así que sin esto cada pregunta de seguimiento ("dame un ejemplo",
// "explícamelo más fácil") obligaba a buscar y releer el documento desde cero,
// es decir 2 a 4 rondas de modelo extra. Vive en memoria del proceso (como el
// rate limit): se pierde al reiniciar el servidor y no se comparte entre
// instancias, lo cual es aceptable porque el costo de perderla es solo volver
// a leer. Módulo puro (reloj inyectable) para poder probarlo sin servidor.

export interface PaginaLeida {
    idDocumento: number;
    nombre: string;
    pagina: number;
    totalPaginas: number;
    texto: string;
}

export const MAX_PAGINAS_RECORDADAS = 3;
export const MAX_CARACTERES_RECORDADOS = 30_000;
export const VIGENCIA_MS = 45 * 60_000;
// Con más conversaciones vivas que esto, cada alta barre las vencidas
const UMBRAL_LIMPIEZA = 500;

interface Entrada {
    paginas: PaginaLeida[];
    expira: number;
}

const memoria = new Map<string, Entrada>();

function limpiarVencidas(ahora: number): void {
    if (memoria.size < UMBRAL_LIMPIEZA) return;
    for (const [clave, entrada] of memoria) {
        if (entrada.expira <= ahora) memoria.delete(clave);
    }
}

/** Páginas recordadas de la conversación (vacío si no hay o ya venció) */
export function paginasRecordadas(clave: string, ahora: number = Date.now()): PaginaLeida[] {
    const entrada = memoria.get(clave);
    if (!entrada) return [];
    if (entrada.expira <= ahora) {
        memoria.delete(clave);
        return [];
    }
    return entrada.paginas;
}

/** Guarda una página leída: conserva las 3 más recientes (una misma página se
 *  reemplaza) sin pasar del tope de caracteres, y renueva la vigencia. */
export function recordarPagina(clave: string, pagina: PaginaLeida, ahora: number = Date.now()): void {
    limpiarVencidas(ahora);
    const previas = paginasRecordadas(clave, ahora)
        .filter(p => !(p.idDocumento === pagina.idDocumento && p.pagina === pagina.pagina));
    let paginas = [...previas, pagina].slice(-MAX_PAGINAS_RECORDADAS);
    while (paginas.length > 1 && totalCaracteres(paginas) > MAX_CARACTERES_RECORDADOS) {
        paginas = paginas.slice(1);
    }
    memoria.set(clave, { paginas, expira: ahora + VIGENCIA_MS });
}

/** El usuario empezó una conversación nueva (↺): se olvida lo leído */
export function olvidarConversacion(clave: string): void {
    memoria.delete(clave);
}

function totalCaracteres(paginas: PaginaLeida[]): number {
    return paginas.reduce((total, p) => total + p.texto.length, 0);
}

/** Bloque de contexto para el mensaje del usuario con lo ya leído */
export function contextoDeLectura(paginas: PaginaLeida[]): string {
    if (paginas.length === 0) return '';
    const bloques = paginas.map(p =>
        `### Documento: ${p.nombre} (idDocumento ${p.idDocumento}, página ${p.pagina} de ${p.totalPaginas})\n${p.texto}`
    );
    return 'Documentos que YA leíste en esta conversación. Úsalos directo para responder o seguir '
        + 'explicando, con su cita y su link; vuelve a buscar solo si el usuario cambia de tema.\n\n'
        + bloques.join('\n\n');
}
