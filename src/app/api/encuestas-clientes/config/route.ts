import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { esOficina, portalQuery } from '@/lib/portal-db';
import {
    asegurarSemilla,
    CONFIG_DEFAULT,
    ESCALA,
    MAX_TEXTO_CONFIG_LEN,
    sanitizarTexto,
    sanitizarEtiquetas,
    MAX_PREGUNTA_LEN,
    MAX_PREGUNTAS,
    type TipoPregunta,
} from '@/lib/encuestas-clientes';

export const dynamic = 'force-dynamic';

// Guarda la configuración de la encuesta de clientes y sus preguntas (solo
// oficina). Las preguntas se guardan en bloque: las existentes se actualizan,
// las nuevas se insertan y las que ya no vienen se DESACTIVAN (soft delete,
// para que el histórico de respuestas conserve su snapshot).
export async function PUT(request: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    if (!(await esOficina(session.codigobarras))) {
        return NextResponse.json({ error: 'Solo oficina puede administrar las encuestas' }, { status: 403 });
    }

    let cuerpo: Record<string, unknown>;
    try {
        cuerpo = await request.json();
    } catch {
        return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
    }

    try {
        await asegurarSemilla();

        // ── Config ──
        const c = (cuerpo.config ?? {}) as Record<string, unknown>;
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

        // ── Preguntas ──
        const crudas = Array.isArray(cuerpo.preguntas) ? cuerpo.preguntas.slice(0, MAX_PREGUNTAS) : null;
        if (crudas) {
            const conservadas: number[] = [];
            for (const [orden, p] of crudas.entries()) {
                const fila = p as Record<string, unknown>;
                const texto = sanitizarTexto(fila.pregunta, MAX_PREGUNTA_LEN);
                if (!texto) continue;
                const tipo: TipoPregunta = fila.tipo === 'opciones' ? 'opciones' : 'estrellas';
                const etiquetas = sanitizarEtiquetas(fila.etiquetas, tipo);
                if (tipo === 'opciones' && etiquetas.length < 2) continue;
                const id = Number(fila.idPregunta);
                if (Number.isInteger(id) && id > 0) {
                    await portalQuery(
                        `UPDATE encuestas_clientes_preguntas
                         SET Pregunta = ?, TipoPregunta = ?, Etiquetas = ?, Orden = ?, Activa = 1, FechaAct = NOW()
                         WHERE IdPregunta = ?`,
                        [texto, tipo, JSON.stringify(etiquetas), orden, id]
                    );
                    conservadas.push(id);
                } else {
                    const res = (await portalQuery(
                        `INSERT INTO encuestas_clientes_preguntas (Pregunta, TipoPregunta, Etiquetas, Orden, Activa, FechaAct)
                         VALUES (?, ?, ?, ?, 1, NOW())`,
                        [texto, tipo, JSON.stringify(etiquetas), orden]
                    )) as unknown as { insertId: number };
                    conservadas.push(res.insertId);
                }
            }
            if (conservadas.length > 0) {
                await portalQuery(
                    `UPDATE encuestas_clientes_preguntas SET Activa = 0, FechaAct = NOW()
                     WHERE Activa = 1 AND IdPregunta NOT IN (${conservadas.map(() => '?').join(',')})`,
                    conservadas
                );
            }
        }

        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error('Error guardando configuración de encuestas:', error);
        return NextResponse.json({ error: 'No fue posible guardar la configuración' }, { status: 502 });
    }
}
