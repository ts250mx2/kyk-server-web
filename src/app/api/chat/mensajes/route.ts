import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { portalQuery } from '@/lib/portal-db';
import { puedeVerCanal } from '@/lib/chat';
import { guardarArchivo, TAMANO_MAXIMO_IMAGEN } from '@/lib/documentos-fs';
import { preguntaExistencias, responderExistenciasEnCanal } from '@/lib/chat-bot';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

const LARGO_MAXIMO = 2000;

const mapearMensaje = (r: Row) => ({
    idMensaje: num(r.IdMensaje),
    idTienda: num(r.IdTienda),
    codigoBarras: str(r.CodigoBarras),
    nombre: str(r.Nombre),
    mensaje: str(r.Mensaje),
    imagen: str(r.Imagen) || null,
    fecha: r.FechaEnvio,
});

// Mensajes de un canal. Con ?desde=<id> regresa solo los nuevos (polling
// incremental cada pocos segundos); sin desde, los últimos 50. Al consultar se
// marca el canal como leído hasta el último mensaje entregado.
export async function GET(request: Request) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const canal = str(searchParams.get('canal'));
    const desde = num(searchParams.get('desde'));

    if (!canal || !(await puedeVerCanal(canal, session))) {
        return NextResponse.json({ error: 'Canal no disponible' }, { status: 403 });
    }

    try {
        let rows: Row[];
        if (desde > 0) {
            rows = await portalQuery(`
                SELECT * FROM chat_mensajes
                WHERE Canal = ? AND IdMensaje > ?
                ORDER BY IdMensaje
                LIMIT 200
            `, [canal, desde]) as Row[];
        } else {
            rows = (await portalQuery(`
                SELECT * FROM chat_mensajes
                WHERE Canal = ?
                ORDER BY IdMensaje DESC
                LIMIT 50
            `, [canal]) as Row[]).reverse();
        }

        // Marcar leído hasta el último mensaje entregado (o conservar el anterior)
        const ultimo = rows.length > 0 ? num(rows[rows.length - 1].IdMensaje) : 0;
        if (ultimo > 0) {
            await portalQuery(`
                INSERT INTO chat_lecturas (Canal, CodigoBarras, UltimoLeido, FechaAct)
                VALUES (?, ?, ?, NOW())
                ON DUPLICATE KEY UPDATE
                    UltimoLeido = GREATEST(UltimoLeido, VALUES(UltimoLeido)),
                    FechaAct = NOW()
            `, [canal, session.codigobarras, ultimo]).catch(() => { /* lectura no crítica */ });
        }

        return NextResponse.json({
            canal,
            mensajes: rows.map(mapearMensaje),
        });
    } catch (error) {
        console.error(`Error consultando mensajes del canal ${canal}:`, error);
        return NextResponse.json(
            { error: 'No fue posible consultar los mensajes.' },
            { status: 502 }
        );
    }
}

// Enviar mensaje (texto y/o foto) a un canal.
export async function POST(request: Request) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    try {
        const form = await request.formData();
        const canal = str(form.get('canal'));
        const mensaje = str(form.get('mensaje')).trim().slice(0, LARGO_MAXIMO);
        const imagen = form.get('imagen');

        if (!canal || !(await puedeVerCanal(canal, session))) {
            return NextResponse.json({ error: 'Canal no disponible' }, { status: 403 });
        }

        const tieneImagen = imagen instanceof File && imagen.size > 0;
        if (!mensaje && !tieneImagen) {
            return NextResponse.json({ error: 'Mensaje vacío' }, { status: 400 });
        }

        let nombreImagen = '';
        if (tieneImagen) {
            if (!imagen.type.startsWith('image/')) {
                return NextResponse.json({ error: 'Solo se pueden adjuntar imágenes' }, { status: 400 });
            }
            if (imagen.size > TAMANO_MAXIMO_IMAGEN) {
                return NextResponse.json({ error: 'La imagen excede el límite de 10 MB' }, { status: 400 });
            }
            const contenido = Buffer.from(await imagen.arrayBuffer());
            nombreImagen = await guardarArchivo(imagen.name, contenido, 'chat');
        }

        const resultado = await portalQuery(`
            INSERT INTO chat_mensajes
                (Canal, IdTienda, CodigoBarras, Nombre, Mensaje, Imagen, FechaEnvio)
            VALUES (?, ?, ?, ?, ?, ?, NOW())
        `, [
            canal,
            session.idTienda,
            session.codigobarras,
            session.name,
            mensaje,
            nombreImagen,
        ]) as unknown as { insertId: number };

        // El propio emisor queda al corriente en el canal
        await portalQuery(`
            INSERT INTO chat_lecturas (Canal, CodigoBarras, UltimoLeido, FechaAct)
            VALUES (?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE
                UltimoLeido = GREATEST(UltimoLeido, VALUES(UltimoLeido)),
                FechaAct = NOW()
        `, [canal, session.codigobarras, resultado.insertId]).catch(() => { /* no crítica */ });

        // Bot de existencias: en canales de sucursal, una pregunta de existencias
        // se responde con datos de LA TIENDA DEL CANAL. Sin await: el envío no se
        // bloquea y la respuesta del bot llega con el siguiente poll (~5 s).
        if (mensaje && /^tienda-\d+$/.test(canal) && preguntaExistencias(mensaje)) {
            responderExistenciasEnCanal(canal, mensaje, session.name).catch(err =>
                console.error('Error del bot de existencias del chat:', err)
            );
        }

        return NextResponse.json({ success: true, idMensaje: resultado.insertId });
    } catch (error) {
        console.error('Error enviando mensaje:', error);
        return NextResponse.json(
            { error: 'No fue posible enviar el mensaje.' },
            { status: 502 }
        );
    }
}
