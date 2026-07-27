// Utilidades del catálogo de artículos (equivalentes a las del sistema VB6).

// RedondearMas de modFuncionesSistemax.bas: redondea hacia arriba a la décima.
export function redondearMas(dato: number): number {
    const x = dato * 10;
    const entero = Math.floor(x);
    return (x > entero ? entero + 1 : entero) / 10;
}

// Costo real como lo calcula frmCatArticulosServer: costo con descuentos en cascada;
// para artículos de tipo pieza (IdTipo = 1) se divide entre la cantidad por caja.
export function calculaCostoReal(
    costo: number,
    descuentos: number[],
    idTipo: number,
    cantidadCaja: number,
): number {
    let real = costo;
    for (const d of descuentos) {
        real = real * (1 - (d || 0));
    }
    if (idTipo === 1 && cantidadCaja > 0) {
        real = real / cantidadCaja;
    }
    return real;
}
