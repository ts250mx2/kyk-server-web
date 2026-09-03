import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { esOficina, portalQuery } from '@/lib/portal-db';
import {
    asegurarSemilla,
    CONFIG_DEFAULT,
    ESCALA,
    esDefinicionValida,
    MAX_PREGUNTA_LEN,
    MAX_PREGUNTAS,
    MAX_SECCION_LEN,
    MAX_TEXTO_CONFIG_LEN,
    normalizarTipo,
    sanitizarEtiquetas,
    sanitizarTexto,
    type DefinicionPregunta,
} from '@/lib/encuestas-clientes';

export const dynamic = 'force-dynamic';

type Cuerpo = Record<string, unknown>;

async function guardarConfig(c: Cuerpo): Promise<void> {
    const t = (v: unknown, def: string) => sanitizarTexto(v, MAX_TEXTO_CONFIG_LEN) ?? def;
    const umbral = Math.min(ESCALA, Math.max(0, Number(c.umbralComentario ?? CONFIG_DEFAULT.UmbralComentario) || 0));
    await portalQuery(
        `UPDATE encuestas_clientes_config SET
            Titulo = ?, Subtitulo = ?, Subtitulo2 = ?, UmbralComentario = ?,
            TituloComentario = ?, TextoComentario = ?, RegaloActivo = ?,
            TituloRegalo = ?, TextoRegalo = ?, TextoPromos = ?, TextoBotonEnviar = ?,
            TituloGracias = ?, TextoGracias = ?, FechaAct = NOW()
         WHERE IdConfig = 1`,
        [
            t(c.titulo, CONFIG_DEFAULT.Titulo),
            sanitizarTexto(c.subtitulo, MAX_TEXTO_CONFIG_LEN),
            sanitizarTexto(c.subtitulo2, MAX_TEXTO_CONFIG_LEN),
            umbral,
            t(c.tituloComentario, CONFIG_DEFAULT.TituloComentario),
            sanitizarTexto(c.textoComentario, MAX_TEXTO_CONFIG_LEN),
            c.regaloActivo === false ? 0 : 1,
            t(c.tituloRegalo, CONFIG_DEFAULT.TituloRegalo),
            sanitizarTexto(c.textoRegalo, MAX_TEXTO_CONFIG_LEN),
            t(c.textoPromos, CONFIG_DEFAULT.TextoPromos),
            t(c.textoBotonEnviar, CONFIG_DEFAULT.TextoBotonEnviar),
            t(c.tituloGracias, CONFIG_DEFAULT.TituloGracias),
            sanitizarTexto(c.textoGracias, MAX_TEXTO_CONFIG_LEN),
        ]
    );
}

/** Limpia una pregunta que manda oficina; null si no es válida. */
function definirPregunta(fila: Cuerpo): DefinicionPregunta | null {
    const pregunta = sanitizarTexto(fila.pregunta, MAX_PREGUNTA_LEN);
    if (!pregunta) return null;
    const tipo = normalizarTipo(fila.tipo);
    const etiquetas = sanitizarEtiquetas(fila.etiquetas, tipo);
    if (!esDefinicionValida(tipo, etiquetas)) return null;
    return {
        pregunta,
        tipo,
        etiquetas,
        seccion: sanitizarTexto(fila.seccion, MAX_SECCION_LEN),
        // Una pregunta abierta no tiene seguimiento: ya es abierta
        seguimiento: tipo === 'texto' ? null : sanitizarTexto(fila.seguimiento, MAX_PREGUNTA_LEN),
    };
}

/** Actualiza o inserta la pregunta y regresa su id. */
async function guardarPregunta(id: number, orden: number, p: DefinicionPregunta): Promise<number> {
    const valores = [p.pregunta, p.tipo, JSON.stringify(p.etiquetas), p.seccion, p.seguimiento, orden];
    if (Number.isInteger(id) && id > 0) {
        await portalQuery(
            `UPDATE encuestas_clientes_preguntas
             SET Pregunta = ?, TipoPregunta = ?, Etiquetas = ?, Seccion = ?, Seguimiento = ?, Orden = ?, Activa = 1, FechaAct = NOW()
             WHERE IdPregunta = ?`,
            [...valores, id]
        );
        return id;
    }
    const res = (await portalQuery(
        `INSERT INTO encuestas_clientes_preguntas
            (Pregunta, TipoPregunta, Etiquetas, Seccion, Seguimiento, Orden, Activa, FechaAct)
         VALUES (?, ?, ?, ?, ?, ?, 1, NOW())`,
        valores
    )) as unknown as { insertId: number };
    return res.insertId;
}

/**
 * Las preguntas se guardan en bloque: las existentes se actualizan, las nuevas
 * se insertan y las que ya no vienen se DESACTIVAN (soft delete, para que el
 * histórico de respuestas conserve su snapshot).
 */
async function guardarPreguntas(crudas: unknown[]): Promise<void> {
    const conservadas: number[] = [];
    let hayNps = false;
    for (const [orden, cruda] of crudas.slice(0, MAX_PREGUNTAS).entries()) {
        const fila = (cruda && typeof cruda === 'object' ? cruda : {}) as Cuerpo;
        const base = definirPregunta(fila);
        if (!base) continue;
        // El NPS sale de UNA sola pregunta: cualquier otra 1-10 es escala normal
        const definicion: DefinicionPregunta = base.tipo === 'nps' && hayNps ? { ...base, tipo: 'escala10' } : base;
        hayNps = hayNps || definicion.tipo === 'nps';
        conservadas.push(await guardarPregunta(Number(fila.idPregunta), orden, definicion));
    }
    if (conservadas.length > 0) {
        await portalQuery(
            `UPDATE encuestas_clientes_preguntas SET Activa = 0, FechaAct = NOW()
             WHERE Activa = 1 AND IdPregunta NOT IN (${conservadas.map(() => '?').join(',')})`,
            conservadas
        );
    }
}

// Guarda la configuración de la encuesta de clientes y sus preguntas (solo oficina).
export async function PUT(request: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    if (!(await esOficina(session.codigobarras))) {
        return NextResponse.json({ error: 'Solo oficina puede administrar las encuestas' }, { status: 403 });
    }

    let cuerpo: Cuerpo;
    try {
        cuerpo = await request.json();
    } catch {
        return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
    }

    try {
        await asegurarSemilla();
        await guardarConfig((cuerpo.config ?? {}) as Cuerpo);
        if (Array.isArray(cuerpo.preguntas)) await guardarPreguntas(cuerpo.preguntas);
        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error('Error guardando configuración de encuestas:', error);
        return NextResponse.json({ error: 'No fue posible guardar la configuración' }, { status: 502 });
    }
}
