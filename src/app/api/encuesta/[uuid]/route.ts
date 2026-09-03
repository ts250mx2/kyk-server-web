import { NextResponse } from 'next/server';
import { portalQuery } from '@/lib/portal-db';
import { getSession } from '@/lib/session';
import {
    esCorreoValido,
    esTelefonoValido,
    esValorValido,
    etiquetaDeValor,
    MAX_CORREO_LEN,
    MAX_TELEFONO_LEN,
    obtenerConfig,
    obtenerPreguntasActivas,
    requiereSeguimiento,
    resolverUuidTienda,
    sanitizarComentario,
    sanitizarRespuestaTexto,
    sanitizarTexto,
    type PreguntaEncuesta,
} from '@/lib/encuestas-clientes';
import { armarCaptura, guardarCaptura } from '@/lib/encuestas-captura-db';
import { crearLimitador, leerJsonLimitado } from '@/lib/limites-peticion';

export const dynamic = 'force-dynamic';

// Endpoint PÚBLICO de la encuesta de clientes (el QR de cada sucursal apunta
// aquí): GET entrega la configuración y preguntas; POST recibe la respuesta.
// La sucursal se resuelve SOLO por el UUID de la URL. Cuota por IP para el
// público; con sesión de la MISMA sucursal ("modo tienda") la cuota es por
// usuario y además se acepta la captura del cliente (nombre, foto, ticket),
// que se guarda como historial.
const VENTANA_MS = 60_000;
const limitePublico = crearLimitador(5, VENTANA_MS);
const limiteTienda = crearLimitador(30, VENTANA_MS);
// Una respuesta son unas cuantas cifras y textos cortos: cualquier cuerpo
// mayor es abuso y se corta al leerlo. Con sesión de tienda viaja además la
// foto del cliente (JPEG reducido en el navegador).
const MAX_CUERPO_BYTES = 64 * 1024;
const MAX_CUERPO_BYTES_TIENDA = 2 * 1024 * 1024;

interface DetalleRespuesta {
    idPregunta: number;
    pregunta: string;
    tipo: string;
    valor: number;
    etiqueta: string | null;
    texto: string | null;
}

/**
 * Valida una respuesta cruda contra su pregunta y arma el snapshot; null si no
 * cuenta. Una pregunta abierta vale por su texto; en las demás el texto es el
 * seguimiento y solo se conserva cuando la respuesta lo pedía.
 */
function armarDetalle(pregunta: PreguntaEncuesta, cruda: Record<string, unknown>): DetalleRespuesta | null {
    const base = { idPregunta: pregunta.idPregunta, pregunta: pregunta.pregunta, tipo: pregunta.tipo };
    const texto = sanitizarRespuestaTexto(cruda.texto);
    if (pregunta.tipo === 'texto') {
        return texto ? { ...base, valor: 0, etiqueta: null, texto } : null;
    }
    const valor = Number(cruda.valor);
    if (!esValorValido(pregunta.tipo, pregunta.etiquetas, valor)) return null;
    const pideSeguimiento = Boolean(pregunta.seguimiento) && requiereSeguimiento(pregunta.tipo, pregunta.etiquetas, valor);
    return {
        ...base,
        valor,
        etiqueta: etiquetaDeValor(pregunta.tipo, pregunta.etiquetas, valor),
        texto: pideSeguimiento ? texto : null,
    };
}

/** Solo respuestas a preguntas activas, válidas y sin repetir pregunta. */
function armarRespuestas(preguntas: PreguntaEncuesta[], crudas: unknown): DetalleRespuesta[] {
    const porId = new Map(preguntas.map(p => [p.idPregunta, p]));
    const lista = Array.isArray(crudas) ? crudas.slice(0, preguntas.length) : [];
    return lista.reduce<DetalleRespuesta[]>((acumulado, r) => {
        const cruda = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
        const pregunta = porId.get(Number(cruda.idPregunta));
        if (!pregunta || acumulado.some(d => d.idPregunta === pregunta.idPregunta)) return acumulado;
        const detalle = armarDetalle(pregunta, cruda);
        return detalle ? [...acumulado, detalle] : acumulado;
    }, []);
}

export async function GET(request: Request, { params }: { params: Promise<{ uuid: string }> }) {
    try {
        const { uuid } = await params;
        const tienda = await resolverUuidTienda(uuid);
        if (!tienda) {
            return NextResponse.json({ error: 'Esta encuesta no está disponible' }, { status: 404 });
        }
        const [config, preguntas, sesion] = await Promise.all([obtenerConfig(), obtenerPreguntasActivas(), getSession()]);
        // Modo tienda solo con sesión de la misma sucursal; el id de tienda no sale al público
        const modoTienda = sesion && sesion.idTienda === tienda.idTienda ? { usuario: sesion.name } : null;
        const sesionOtraTienda = sesion && !modoTienda ? sesion.tienda : null;
        return NextResponse.json({ tienda: tienda.tienda, config, preguntas, modoTienda, sesionOtraTienda });
    } catch (error) {
        console.error('Error cargando encuesta pública:', error);
        return NextResponse.json({ error: 'No fue posible cargar la encuesta' }, { status: 502 });
    }
}

export async function POST(request: Request, { params }: { params: Promise<{ uuid: string }> }) {
    try {
        const { uuid } = await params;
        const tienda = await resolverUuidTienda(uuid);
        if (!tienda) {
            return NextResponse.json({ error: 'Esta encuesta no está disponible' }, { status: 404 });
        }

        // Modo tienda: sesión de la misma sucursal que la liga
        const sesion = await getSession();
        const sesionTienda = sesion && sesion.idTienda === tienda.idTienda ? sesion : null;

        const ip = (request.headers.get('x-forwarded-for') ?? 'local').split(',')[0].trim();
        const excede = sesionTienda ? limiteTienda.excede(sesionTienda.codigobarras) : limitePublico.excede(ip);
        if (excede) {
            return NextResponse.json({ error: 'Espera un momento antes de enviar otra respuesta.' }, { status: 429 });
        }

        const lectura = await leerJsonLimitado(request, sesionTienda ? MAX_CUERPO_BYTES_TIENDA : MAX_CUERPO_BYTES);
        if (!lectura.ok) return NextResponse.json({ error: lectura.error }, { status: lectura.status });
        const { cuerpo } = lectura;

        const detalle = armarRespuestas(await obtenerPreguntasActivas(), cuerpo.respuestas);
        if (detalle.length === 0) {
            return NextResponse.json({ error: 'Contesta al menos una pregunta' }, { status: 400 });
        }

        const correoCrudo = sanitizarTexto(cuerpo.correo, MAX_CORREO_LEN);
        const telefonoCrudo = sanitizarTexto(cuerpo.telefono, MAX_TELEFONO_LEN);
        const correo = correoCrudo && esCorreoValido(correoCrudo) ? correoCrudo : null;
        const telefono = telefonoCrudo && esTelefonoValido(telefonoCrudo) ? telefonoCrudo : null;
        const comentario = sanitizarComentario(cuerpo.comentario);
        const aceptaPromos = cuerpo.aceptaPromos === true || cuerpo.aceptaPromos === 1 ? 1 : 0;
        // La captura se re-valida aquí contra la tienda; lo que diga el navegador no se guarda
        const captura = sesionTienda ? await armarCaptura(cuerpo.captura, sesionTienda) : null;

        const insercion = (await portalQuery(
            `INSERT INTO encuestas_clientes_respuestas (IdTienda, Correo, Telefono, AceptaPromos, Comentario, Fecha)
             VALUES (?, ?, ?, ?, ?, NOW())`,
            [tienda.idTienda, correo, telefono, aceptaPromos, comentario]
        )) as unknown as { insertId: number };

        for (const d of detalle) {
            await portalQuery(
                `INSERT INTO encuestas_clientes_detalle
                    (IdRespuesta, IdPregunta, Pregunta, TipoPregunta, Valor, Etiqueta, Texto)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [insercion.insertId, d.idPregunta, d.pregunta, d.tipo, d.valor, d.etiqueta, d.texto]
            );
        }
        if (captura && sesionTienda) {
            await guardarCaptura(insercion.insertId, tienda.idTienda, captura, sesionTienda);
        }

        return NextResponse.json({
            ok: true,
            captura: captura
                ? { ticketValido: captura.ticket?.coincide ?? null, ticketAntiguo: captura.ticket?.antiguo ?? false, errorTicket: captura.errorTicket }
                : null,
        });
    } catch (error) {
        console.error('Error guardando respuesta de encuesta:', error);
        return NextResponse.json({ error: 'No fue posible guardar tu respuesta' }, { status: 502 });
    }
}
