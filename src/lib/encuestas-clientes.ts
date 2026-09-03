import { portalQuery } from '@/lib/portal-db';
import {
    ESCALA,
    MAX_PREGUNTAS,
    PLANTILLA_KYK,
    esUuidValido,
    normalizarTipo,
    parseEtiquetas,
    type ConfigEncuesta,
    type PreguntaEncuesta,
} from '@/lib/encuestas-tipos';

// Encuestas de satisfacción de CLIENTES (plantilla oficial de Kesos y Kosas):
// el cliente la contesta desde su celular escaneando el QR de la sucursal, sin
// login. Cada sucursal tiene su propio UUID (la URL pública /encuesta/[uuid]
// identifica a la tienda; el cliente nunca manda IdTienda), y TODO vive en la
// base central BDKYKPortal (la de documentos). Las respuestas guardan un
// snapshot de la pregunta para que el reporte sobreviva ediciones.
//
// Las reglas puras (tipos, rangos, plantilla) viven en encuestas-tipos.ts y se
// re-exportan aquí para que las rutas sigan importando de un solo lugar.

export * from '@/lib/encuestas-tipos';

type Row = Record<string, unknown>;

/** Textos con los que arranca la encuesta la primera vez. */
export const CONFIG_DEFAULT = {
    Titulo: '¿Cómo fue tu experiencia de compra?',
    Subtitulo: 'Tu opinión nos ayuda a mejorar tu tienda.',
    Subtitulo2: 'Solo te tomará un minuto.',
    UmbralComentario: 0,
    TituloComentario: '¿Algo no salió como esperabas?',
    TextoComentario: 'Cuéntanos qué sucedió. Queremos escucharte y mejorar.',
    RegaloActivo: 1,
    TituloRegalo: 'Queremos consentirte',
    TextoRegalo: 'Déjanos tu teléfono o tu correo para enviarte promociones y sorpresas especiales de tu tienda.',
    TextoPromos: 'Quiero recibir promociones especiales.',
    TextoBotonEnviar: 'Enviar mi opinión',
    TituloGracias: '¡Gracias por ayudarnos a mejorar!',
    TextoGracias: 'Tu opinión llega directo al equipo de la tienda. ¡Te esperamos pronto!',
} as const;

/** Preguntas con las que arranca el módulo: la plantilla oficial. */
export const PREGUNTAS_DEFAULT = PLANTILLA_KYK;

/**
 * Siembra inicial. El renglón de config vive SIEMPRE con IdConfig = 1: el
 * INSERT IGNORE sobre esa PK fija hace de candado — dos requests simultáneos
 * no duplican nada y las preguntas que oficina borre no reaparecen.
 */
export async function asegurarSemilla(): Promise<void> {
    const c = CONFIG_DEFAULT;
    const resultado = (await portalQuery(
        `INSERT IGNORE INTO encuestas_clientes_config
            (IdConfig, Titulo, Subtitulo, Subtitulo2, UmbralComentario, TituloComentario, TextoComentario,
             RegaloActivo, TituloRegalo, TextoRegalo, TextoPromos, TextoBotonEnviar, TituloGracias, TextoGracias, FechaAct)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [c.Titulo, c.Subtitulo, c.Subtitulo2, c.UmbralComentario, c.TituloComentario, c.TextoComentario,
         c.RegaloActivo, c.TituloRegalo, c.TextoRegalo, c.TextoPromos, c.TextoBotonEnviar, c.TituloGracias, c.TextoGracias]
    )) as unknown as { affectedRows?: number };

    if ((resultado?.affectedRows ?? 0) > 0) {
        for (const [orden, p] of PREGUNTAS_DEFAULT.entries()) {
            await portalQuery(
                `INSERT INTO encuestas_clientes_preguntas
                    (Pregunta, TipoPregunta, Etiquetas, Seccion, Seguimiento, Orden, Activa, FechaAct)
                 VALUES (?, ?, ?, ?, ?, ?, 1, NOW())`,
                [p.pregunta, p.tipo, JSON.stringify(p.etiquetas), p.seccion, p.seguimiento, orden]
            );
        }
    }
}

export async function obtenerConfig(): Promise<ConfigEncuesta> {
    await asegurarSemilla();
    const filas = (await portalQuery('SELECT * FROM encuestas_clientes_config WHERE IdConfig = 1')) as Row[];
    const f = filas[0] ?? {};
    const s = (v: unknown, def: string) => (typeof v === 'string' && v ? v : def);
    return {
        titulo: s(f.Titulo, CONFIG_DEFAULT.Titulo),
        subtitulo: s(f.Subtitulo, ''),
        subtitulo2: s(f.Subtitulo2, ''),
        umbralComentario: Math.min(ESCALA, Math.max(0, Number(f.UmbralComentario ?? CONFIG_DEFAULT.UmbralComentario))),
        tituloComentario: s(f.TituloComentario, CONFIG_DEFAULT.TituloComentario),
        textoComentario: s(f.TextoComentario, ''),
        regaloActivo: Number(f.RegaloActivo ?? 1) === 1,
        tituloRegalo: s(f.TituloRegalo, CONFIG_DEFAULT.TituloRegalo),
        textoRegalo: s(f.TextoRegalo, ''),
        textoPromos: s(f.TextoPromos, CONFIG_DEFAULT.TextoPromos),
        textoBotonEnviar: s(f.TextoBotonEnviar, CONFIG_DEFAULT.TextoBotonEnviar),
        tituloGracias: s(f.TituloGracias, CONFIG_DEFAULT.TituloGracias),
        textoGracias: s(f.TextoGracias, ''),
    };
}

/** Renglón de encuestas_clientes_preguntas → pregunta tipada. */
export function filaAPregunta(f: Row): PreguntaEncuesta {
    const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    return {
        idPregunta: Number(f.IdPregunta),
        pregunta: String(f.Pregunta),
        tipo: normalizarTipo(f.TipoPregunta),
        etiquetas: parseEtiquetas(f.Etiquetas),
        seccion: texto(f.Seccion),
        seguimiento: texto(f.Seguimiento),
    };
}

export async function obtenerPreguntasActivas(): Promise<PreguntaEncuesta[]> {
    const filas = (await portalQuery(
        `SELECT IdPregunta, Pregunta, TipoPregunta, Etiquetas, Seccion, Seguimiento
         FROM encuestas_clientes_preguntas WHERE Activa = 1 ORDER BY Orden, IdPregunta`
    )) as Row[];
    return filas.slice(0, MAX_PREGUNTAS).map(filaAPregunta);
}

/** Liga (UUID) de una sucursal; se estrena si aún no tiene. */
export async function asegurarQrTienda(idTienda: number, tienda: string): Promise<{ uuid: string; activa: boolean }> {
    const leer = async () => {
        const filas = (await portalQuery(
            'SELECT Uuid, Activa FROM encuestas_clientes_qr WHERE IdTienda = ? LIMIT 1',
            [idTienda]
        )) as Row[];
        return filas[0] ? { uuid: String(filas[0].Uuid), activa: Number(filas[0].Activa) === 1 } : null;
    };
    const existente = await leer();
    if (existente) return existente;
    // INSERT IGNORE sobre la PK: si otro request la estrenó primero, gana la de la base
    await portalQuery(
        'INSERT IGNORE INTO encuestas_clientes_qr (IdTienda, Tienda, Uuid, Activa, FechaAct) VALUES (?, ?, ?, 1, NOW())',
        [idTienda, tienda, crypto.randomUUID()]
    );
    return (await leer()) ?? { uuid: '', activa: false };
}

export interface FiltroReporte {
    /** `WHERE ...` armado con parámetros (o vacío); usa el alias R de encuestas_clientes_respuestas */
    filtro: string;
    parametros: (string | number)[];
    /** El filtro con una condición extra (o solo la condición si no hay filtro) */
    donde: (extra: string) => string;
}

/** Filtros de reporte e historial desde la URL: rango de fechas y sucursal. */
export function filtroDeReporte(url: string): FiltroReporte {
    const { searchParams } = new URL(url);
    const fecha = (clave: string) => {
        const v = searchParams.get(clave) ?? '';
        return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
    };
    const fechaInicio = fecha('fechaInicio');
    const fechaFin = fecha('fechaFin');
    const idTienda = Number(searchParams.get('idTienda')) || 0;

    const condiciones: string[] = [];
    const parametros: (string | number)[] = [];
    if (fechaInicio) { condiciones.push('R.Fecha >= ?'); parametros.push(`${fechaInicio} 00:00:00`); }
    if (fechaFin) { condiciones.push('R.Fecha <= ?'); parametros.push(`${fechaFin} 23:59:59`); }
    if (idTienda > 0) { condiciones.push('R.IdTienda = ?'); parametros.push(idTienda); }
    const filtro = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
    return { filtro, parametros, donde: extra => (filtro ? `${filtro} AND ${extra}` : `WHERE ${extra}`) };
}

/**
 * Traduce el UUID de la URL pública a la sucursal. Es la ÚNICA identificación
 * que viaja en la liga; un QR desactivado resuelve a null (indistinguible de
 * una liga inexistente).
 */
export async function resolverUuidTienda(uuid: string): Promise<{ idTienda: number; tienda: string } | null> {
    if (!esUuidValido(uuid)) return null;
    const filas = (await portalQuery(
        'SELECT IdTienda, Tienda FROM encuestas_clientes_qr WHERE Uuid = ? AND Activa = 1 LIMIT 1',
        [uuid]
    )) as Row[];
    if (filas.length === 0) return null;
    return { idTienda: Number(filas[0].IdTienda), tienda: String(filas[0].Tienda) };
}
