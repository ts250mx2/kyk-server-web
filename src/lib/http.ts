// Lectura segura de respuestas que DEBERÍAN ser JSON: cuando un proxy (nginx)
// rechaza la petición — típicamente 413 por client_max_body_size al subir un
// archivo — regresa una página HTML y res.json() truena con el críptico
// "Unexpected token '<' ... is not valid JSON". Aquí se convierte en un error
// entendible para el usuario.
export async function jsonSeguro(res: Response): Promise<Record<string, unknown>> {
    try {
        return await res.json();
    } catch {
        if (res.status === 413) {
            return {
                error: 'El archivo es demasiado grande para el servidor web: hay que aumentar '
                    + 'client_max_body_size en el proxy (nginx) de producción.',
            };
        }
        return {
            error: `El servidor respondió ${res.status} sin detalle `
                + '(posible límite del proxy o error del servidor web).',
        };
    }
}
