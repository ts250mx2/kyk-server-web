import { NextResponse } from 'next/server';
import { portalQuery } from '@/lib/portal-db';
import {
    esCorreoValido,
    esTelefonoValido,
    etiquetaDeValor,
    MAX_CORREO_LEN,
    MAX_TELEFONO_LEN,
    obtenerConfig,
    obtenerPreguntasActivas,
    resolverUuidTienda,
    sanitizarComentario,
    sanitizarTexto,
    valorMaximo,
} from '@/lib/encuestas-clientes';

export const dynamic = 'force-dynamic';

// Endpoint PÚBLICO de la encuesta de clientes (el QR de cada sucursal apunta
// aquí): GET entrega la configuración y preguntas; POST recibe la respuesta.
// La sucursal se resuelve SOLO por el UUID de la URL. Rate limit por IP.
const LIMITE_VENTANA_MS = 60_000;
const LIMITE_ENVIOS_POR_MINUTO = 5;
const ventanas = new Map<string, number[]>();

function excedeLimite(ip: string): boolean {
    const ahora = Date.now();
    const recientes = (ventanas.get(ip) ?? []).filter(t => ahora - t < LIMITE_VENTANA_MS);
    const excede = recientes.length >= LIMITE_ENVIOS_POR_MINUTO;
    ventanas.set(ip, excede ? recientes : [...recientes, ahora]);
    return excede;
}

export async function GET(request: Request, { params }: { params: Promise<{ uuid: string }> }) {
    try {
        const { uuid } = await params;
        const tienda = await resolverUuidTienda(uuid);
        if (!tienda) {
            return NextResponse.json({ error: 'Esta encuesta no está disponible' }, { status: 404 });
        }
        const [config, preguntas] = await Promise.all([obtenerConfig(), obtenerPreguntasActivas()]);
        return NextResponse.json({ tienda: tienda.tienda, config, preguntas });
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

        const ip = (request.headers.get('x-forwarded-for') ?? 'local').split(',')[0].trim();
        if (excedeLimite(ip)) {
            return NextResponse.json({ error: 'Espera un momento antes de enviar otra respuesta.' }, { status: 429 });
        }

        let cuerpo: Record<string, unknown>;
        try {
            cuerpo = await request.json();
        } catch {
            return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
        }

        const preguntas = await obtenerPreguntasActivas();
        const porId = new Map(preguntas.map(p => [p.idPregunta, p]));

        // Solo respuestas a preguntas activas, con valor dentro del rango
        const crudas = Array.isArray(cuerpo.respuestas) ? cuerpo.respuestas : [];
        const detalle: { idPregunta: number; pregunta: string; tipo: string; valor: number; etiqueta: string | null }[] = [];
        for (const r of crudas.slice(0, preguntas.length)) {
            const idPregunta = Number((r as Record<string, unknown>)?.idPregunta);
            const valor = Number((r as Record<string, unknown>)?.valor);
            const pregunta = porId.get(idPregunta);
            if (!pregunta || !Number.isInteger(valor)) continue;
            if (valor < 1 || valor > valorMaximo(pregunta.tipo, pregunta.etiquetas)) continue;
            if (detalle.some(d => d.idPregunta === idPregunta)) continue;
            detalle.push({
                idPregunta,
                pregunta: pregunta.pregunta,
                tipo: pregunta.tipo,
                valor,
                etiqueta: etiquetaDeValor(pregunta.tipo, pregunta.etiquetas, valor),
            });
        }
        if (detalle.length === 0) {
            return NextResponse.json({ error: 'Contesta al menos una pregunta' }, { status: 400 });
        }

        const correoCrudo = sanitizarTexto(cuerpo.correo, MAX_CORREO_LEN);
        const telefonoCrudo = sanitizarTexto(cuerpo.telefono, MAX_TELEFONO_LEN);
        const correo = correoCrudo && esCorreoValido(correoCrudo) ? correoCrudo : null;
        const telefono = telefonoCrudo && esTelefonoValido(telefonoCrudo) ? telefonoCrudo : null;
        const comentario = sanitizarComentario(cuerpo.comentario);
        const aceptaPromos = cuerpo.aceptaPromos === true || cuerpo.aceptaPromos === 1 ? 1 : 0;

        const insercion = (await portalQuery(
            `INSERT INTO encuestas_clientes_respuestas (IdTienda, Correo, Telefono, AceptaPromos, Comentario, Fecha)
             VALUES (?, ?, ?, ?, ?, NOW())`,
            [tienda.idTienda, correo, telefono, aceptaPromos, comentario]
        )) as unknown as { insertId: number };

        for (const d of detalle) {
            await portalQuery(
                `INSERT INTO encuestas_clientes_detalle (IdRespuesta, IdPregunta, Pregunta, TipoPregunta, Valor, Etiqueta)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [insercion.insertId, d.idPregunta, d.pregunta, d.tipo, d.valor, d.etiqueta]
            );
        }

        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error('Error guardando respuesta de encuesta:', error);
        return NextResponse.json({ error: 'No fue posible guardar tu respuesta' }, { status: 502 });
    }
}
