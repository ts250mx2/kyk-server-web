// Foto del cliente tomada desde el navegador de la tienda: se reduce ANTES de
// enviarla (JPEG de ~640 px, decenas de KB) para que viaje y se guarde ligera.
// Solo navegador (usa Image, video y canvas).

export const LADO_MAX_FOTO = 640;
export const CALIDAD_FOTO = 0.8;

/** Dibuja la fuente reducida a `ladoMax` y la regresa como data-URL JPEG. */
function reducirEnLienzo(fuente: CanvasImageSource, ancho: number, alto: number, ladoMax: number, calidad: number): string {
    const escala = Math.min(1, ladoMax / Math.max(ancho, alto, 1));
    const lienzo = document.createElement("canvas");
    lienzo.width = Math.max(1, Math.round(ancho * escala));
    lienzo.height = Math.max(1, Math.round(alto * escala));
    const contexto = lienzo.getContext("2d");
    if (!contexto) throw new Error("El navegador no pudo procesar la foto");
    contexto.drawImage(fuente, 0, 0, lienzo.width, lienzo.height);
    return lienzo.toDataURL("image/jpeg", calidad);
}

/** Archivo elegido o tomado con la app de cámara del dispositivo. */
export function redimensionarFoto(archivo: File, ladoMax = LADO_MAX_FOTO, calidad = CALIDAD_FOTO): Promise<string> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(archivo);
        const imagen = new Image();
        imagen.onload = () => {
            URL.revokeObjectURL(url);
            try {
                resolve(reducirEnLienzo(imagen, imagen.width, imagen.height, ladoMax, calidad));
            } catch (error) {
                reject(error);
            }
        };
        imagen.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("No se pudo leer la foto"));
        };
        imagen.src = url;
    });
}

/** Fotograma actual de la cámara en vivo. */
export function fotogramaAJpeg(video: HTMLVideoElement, ladoMax = LADO_MAX_FOTO, calidad = CALIDAD_FOTO): string {
    if (!video.videoWidth || !video.videoHeight) throw new Error("La cámara todavía no está lista");
    return reducirEnLienzo(video, video.videoWidth, video.videoHeight, ladoMax, calidad);
}

/** El navegador puede abrir la cámara en vivo (requiere HTTPS o localhost). */
export function hayCamaraEnVivo(): boolean {
    return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function";
}
