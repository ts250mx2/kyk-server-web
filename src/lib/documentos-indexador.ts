import { asegurarTexto } from './documentos-texto';

// Indexación de documentos en segundo plano: extraer el texto de un documento
// histórico (leer el archivo, correr pdf-parse, insertar sus partes y pedir el
// resumen a Haiku) tarda segundos, y antes lo pagaba el primer usuario que
// buscaba, con hasta 10 documentos en fila dentro de su consulta. Ahora la
// búsqueda solo espera un par y el resto se encola aquí: se procesan de uno en
// uno, fuera de la petición, para no saturar la base ni el proveedor.

export interface IndexadorEnSegundoPlano {
    /** Suma documentos a la cola (ignora repetidos) y arranca si estaba parado */
    encolar(ids: number[]): void;
    /** ¿Está en cola o procesándose? Sirve para no indexarlo dos veces */
    estaEnProceso(id: number): boolean;
    /** Promesa que termina cuando la cola se vacía (para pruebas y cierres) */
    esperar(): Promise<void>;
}

export function crearIndexador(
    indexar: (id: number) => Promise<unknown>,
    avisarError: (id: number, error: unknown) => void
): IndexadorEnSegundoPlano {
    const pendientes = new Set<number>();
    let corrida: Promise<void> | null = null;

    const procesar = async (): Promise<void> => {
        while (pendientes.size > 0) {
            const [id] = pendientes;
            try {
                await indexar(id);
            } catch (error) {
                avisarError(id, error);
            } finally {
                pendientes.delete(id);
            }
        }
    };

    return {
        encolar(ids) {
            for (const id of ids) {
                if (Number.isInteger(id) && id > 0) pendientes.add(id);
            }
            if (!corrida && pendientes.size > 0) {
                // El ciclo no debería rechazar (cada documento va en su try),
                // pero nadie espera esta promesa: un rechazo suelto tumbaría
                // el proceso. 0 = falla del ciclo, no de un documento
                corrida = procesar()
                    .catch(error => avisarError(0, error))
                    .finally(() => { corrida = null; });
            }
        },
        estaEnProceso: id => pendientes.has(id),
        esperar: () => corrida ?? Promise.resolve(),
    };
}

/** Indexador del portal: una sola cola por proceso */
export const indexadorDocumentos = crearIndexador(
    asegurarTexto,
    (id, error) => console.warn(`No se indexó en segundo plano el documento ${id}:`, error)
);
