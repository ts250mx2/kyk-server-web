import { portalQuery } from './portal-db';

// Bitácora por consulta de A.D.iA.N (tabla adian_consultas): modelo, rondas,
// herramientas, duración, tokens y cómo terminó. Sirve para medir con datos
// (latencia, cuántas consultas se cortan, cuántas acaban sin respuesta, qué
// modelo usa la gente) en vez de depender de comentarios. Oficina la consulta
// en /api/documentos/consultas.

export type ResultadoConsulta = 'ok' | 'error' | 'cancelado';

export interface ConsultaAdian {
    idTienda: number;
    tienda: string;
    codigoBarras: string;
    nombre: string;
    modelo: string;
    pregunta: string;
    rondas: number;
    herramientas: string[];
    duracionMs: number;
    tokensEntrada: number;
    tokensSalida: number;
    tokensCache: number;
    stopReason: string;
    truncada: boolean;
    /** El agente registró la pregunta como sin respuesta en los documentos */
    sinRespuesta: boolean;
    resultado: ResultadoConsulta;
    error: string;
}

const MAX_PREGUNTA = 500;
const MAX_HERRAMIENTAS = 255;
const MAX_ERROR = 255;
const MAX_RECIENTES = 100;
const MAX_DIAS = 365;

type Row = Record<string, unknown>;
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

export async function registrarConsulta(consulta: ConsultaAdian): Promise<void> {
    await portalQuery(`
        INSERT INTO adian_consultas
            (IdTienda, Tienda, CodigoBarras, Nombre, Modelo, Pregunta, Rondas, Herramientas,
             DuracionMs, TokensEntrada, TokensSalida, TokensCache, StopReason, Truncada,
             SinRespuesta, Resultado, Error, Fecha)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `, [
        consulta.idTienda,
        consulta.tienda,
        consulta.codigoBarras,
        consulta.nombre,
        consulta.modelo,
        consulta.pregunta.slice(0, MAX_PREGUNTA),
        consulta.rondas,
        consulta.herramientas.join(',').slice(0, MAX_HERRAMIENTAS),
        Math.round(consulta.duracionMs),
        consulta.tokensEntrada,
        consulta.tokensSalida,
        consulta.tokensCache,
        consulta.stopReason,
        consulta.truncada ? 1 : 0,
        consulta.sinRespuesta ? 1 : 0,
        consulta.resultado,
        consulta.error.slice(0, MAX_ERROR),
    ]);
}

export interface TotalesConsultas {
    total: number;
    duracionPromedioMs: number;
    rondasPromedio: number;
    truncadas: number;
    errores: number;
    canceladas: number;
    sinRespuesta: number;
    tokensEntrada: number;
    tokensSalida: number;
    tokensCache: number;
}

export interface TotalesPorModelo extends TotalesConsultas {
    modelo: string;
}

export interface ConsultaReciente {
    idConsulta: number;
    fecha: unknown;
    tienda: string;
    usuario: string;
    modelo: string;
    pregunta: string;
    rondas: number;
    herramientas: string;
    duracionMs: number;
    tokensEntrada: number;
    tokensSalida: number;
    tokensCache: number;
    stopReason: string;
    truncada: boolean;
    sinRespuesta: boolean;
    resultado: string;
    error: string;
}

const COLUMNAS_TOTALES = `
    COUNT(*) AS Total,
    ROUND(AVG(DuracionMs)) AS DuracionPromedioMs,
    ROUND(AVG(Rondas), 1) AS RondasPromedio,
    SUM(Truncada) AS Truncadas,
    SUM(Resultado = 'error') AS Errores,
    SUM(Resultado = 'cancelado') AS Canceladas,
    SUM(SinRespuesta) AS SinRespuesta,
    SUM(TokensEntrada) AS TokensEntrada,
    SUM(TokensSalida) AS TokensSalida,
    SUM(TokensCache) AS TokensCache`;

function aTotales(fila: Row | undefined): TotalesConsultas {
    return {
        total: num(fila?.Total),
        duracionPromedioMs: num(fila?.DuracionPromedioMs),
        rondasPromedio: num(fila?.RondasPromedio),
        truncadas: num(fila?.Truncadas),
        errores: num(fila?.Errores),
        canceladas: num(fila?.Canceladas),
        sinRespuesta: num(fila?.SinRespuesta),
        tokensEntrada: num(fila?.TokensEntrada),
        tokensSalida: num(fila?.TokensSalida),
        tokensCache: num(fila?.TokensCache),
    };
}

/** Totales del periodo, desglose por modelo y las consultas más recientes */
export async function resumenConsultas(dias: number): Promise<{
    dias: number;
    totales: TotalesConsultas;
    porModelo: TotalesPorModelo[];
    recientes: ConsultaReciente[];
}> {
    const periodo = Math.min(Math.max(Math.floor(dias) || 7, 1), MAX_DIAS);
    const [totales, porModelo, recientes] = await Promise.all([
        portalQuery(`
            SELECT ${COLUMNAS_TOTALES}
            FROM adian_consultas
            WHERE Fecha >= DATE_SUB(NOW(), INTERVAL ? DAY)
        `, [periodo]) as Promise<Row[]>,
        portalQuery(`
            SELECT Modelo, ${COLUMNAS_TOTALES}
            FROM adian_consultas
            WHERE Fecha >= DATE_SUB(NOW(), INTERVAL ? DAY)
            GROUP BY Modelo
            ORDER BY Total DESC
        `, [periodo]) as Promise<Row[]>,
        portalQuery(`
            SELECT IdConsulta, Fecha, Tienda, Nombre, Modelo, Pregunta, Rondas, Herramientas,
                   DuracionMs, TokensEntrada, TokensSalida, TokensCache, StopReason, Truncada,
                   SinRespuesta, Resultado, Error
            FROM adian_consultas
            ORDER BY IdConsulta DESC
            LIMIT ${MAX_RECIENTES}
        `) as Promise<Row[]>,
    ]);

    return {
        dias: periodo,
        totales: aTotales(totales[0]),
        porModelo: porModelo.map(f => ({ modelo: str(f.Modelo), ...aTotales(f) })),
        recientes: recientes.map(f => ({
            idConsulta: num(f.IdConsulta),
            fecha: f.Fecha,
            tienda: str(f.Tienda),
            usuario: str(f.Nombre),
            modelo: str(f.Modelo),
            pregunta: str(f.Pregunta),
            rondas: num(f.Rondas),
            herramientas: str(f.Herramientas),
            duracionMs: num(f.DuracionMs),
            tokensEntrada: num(f.TokensEntrada),
            tokensSalida: num(f.TokensSalida),
            tokensCache: num(f.TokensCache),
            stopReason: str(f.StopReason),
            truncada: num(f.Truncada) === 1,
            sinRespuesta: num(f.SinRespuesta) === 1,
            resultado: str(f.Resultado),
            error: str(f.Error),
        })),
    };
}
