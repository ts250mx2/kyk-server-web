import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { portalQuery, esOficina } from '@/lib/portal-db';
import { generarEvaluacion, type PreguntaEvaluacion } from '@/lib/evaluaciones';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

type Row = Record<string, unknown>;
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

// La visibilidad de una evaluación es la de su documento (todas las tiendas o
// dirigido a la tienda de la sesión); oficina ve todo.
const filtroDocs = (oficina: boolean, idTienda: number) => oficina ? '' : `
    AND (D.TodasTiendas = 1 OR EXISTS (
        SELECT 1 FROM documentos_tiendas T
        WHERE T.IdDocumento = D.IdDocumento AND T.IdTienda = ${idTienda}
    ))`;

// Preguntas sin respuestas correctas ni explicaciones (lo único que ve el cliente
// mientras presenta; el detalle se revela al calificar)
const sanitizar = (preguntas: PreguntaEvaluacion[]) =>
    preguntas.map(p => ({ pregunta: p.pregunta, opciones: p.opciones }));

// Lista de documentos evaluables con el estado de su evaluación: si ya existe,
// cuántas preguntas tiene, el mejor intento del usuario y (oficina) cuántos la
// han presentado y su promedio.
export async function GET() {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    try {
        const oficina = await esOficina(session.codigobarras);
        const [docs, evals, mios, stats] = await Promise.all([
            portalQuery(`
                SELECT D.IdDocumento, D.Nombre, D.NombreArchivo, D.FechaSubida
                FROM documentos D
                WHERE D.Status = 0 ${filtroDocs(oficina, session.idTienda)}
                ORDER BY D.FechaSubida DESC
                LIMIT 200
            `) as Promise<Row[]>,
            portalQuery(`
                SELECT IdEvaluacion, IdDocumento, Titulo, Preguntas, FechaCreacion
                FROM evaluaciones WHERE Status = 0
            `) as Promise<Row[]>,
            portalQuery(`
                SELECT IdEvaluacion, COUNT(*) AS Intentos, MAX(Calificacion) AS Mejor, MAX(FechaFin) AS Ultima
                FROM evaluaciones_resultados
                WHERE CodigoBarras = ?
                GROUP BY IdEvaluacion
            `, [session.codigobarras]) as Promise<Row[]>,
            oficina
                ? portalQuery(`
                    SELECT IdEvaluacion, COUNT(*) AS N, AVG(Calificacion) AS Promedio
                    FROM evaluaciones_resultados
                    GROUP BY IdEvaluacion
                `) as Promise<Row[]>
                : Promise.resolve([] as Row[]),
        ]);

        // Evaluación activa más reciente por documento
        const porDocumento = new Map<number, Row>();
        for (const e of evals) {
            const idDoc = num(e.IdDocumento);
            const previa = porDocumento.get(idDoc);
            if (!previa || num(e.IdEvaluacion) > num(previa.IdEvaluacion)) porDocumento.set(idDoc, e);
        }
        const miosMap = new Map(mios.map(m => [num(m.IdEvaluacion), m]));
        const statsMap = new Map(stats.map(s => [num(s.IdEvaluacion), s]));

        return NextResponse.json({
            rol: oficina ? 'oficina' : 'tienda',
            documentos: docs.map(d => {
                const ev = porDocumento.get(num(d.IdDocumento));
                let totalPreguntas = 0;
                if (ev) {
                    try { totalPreguntas = (JSON.parse(str(ev.Preguntas)) as unknown[]).length; } catch { /* JSON ilegible */ }
                }
                const mio = ev ? miosMap.get(num(ev.IdEvaluacion)) : undefined;
                const stat = ev ? statsMap.get(num(ev.IdEvaluacion)) : undefined;
                return {
                    idDocumento: num(d.IdDocumento),
                    nombre: str(d.Nombre),
                    archivo: str(d.NombreArchivo),
                    fecha: d.FechaSubida,
                    evaluacion: ev
                        ? { idEvaluacion: num(ev.IdEvaluacion), titulo: str(ev.Titulo), totalPreguntas }
                        : null,
                    mio: mio
                        ? { intentos: num(mio.Intentos), mejor: num(mio.Mejor), ultima: mio.Ultima }
                        : null,
                    resultados: stat
                        ? { presentados: num(stat.N), promedio: Math.round(num(stat.Promedio) * 10) / 10 }
                        : (oficina && ev ? { presentados: 0, promedio: 0 } : null),
                };
            }),
        });
    } catch (error) {
        console.error('Error listando evaluaciones:', error);
        return NextResponse.json(
            { error: 'No fue posible consultar las evaluaciones.' },
            { status: 502 }
        );
    }
}

// Obtener (o generar con IA la primera vez) la evaluación de un documento.
// regenerar=true (solo oficina) retira la actual y crea una nueva versión.
export async function POST(request: Request) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    try {
        const cuerpo = await request.json().catch(() => ({}));
        const idDocumento = num(cuerpo?.idDocumento);
        const regenerar = cuerpo?.regenerar === true;
        if (!Number.isInteger(idDocumento) || idDocumento <= 0) {
            return NextResponse.json({ error: 'Documento inválido' }, { status: 400 });
        }

        const oficina = await esOficina(session.codigobarras);
        const docs = (await portalQuery(`
            SELECT D.IdDocumento, D.Nombre FROM documentos D
            WHERE D.IdDocumento = ? AND D.Status = 0 ${filtroDocs(oficina, session.idTienda)}
        `, [idDocumento])) as Row[];
        const doc = docs[0];
        if (!doc) {
            return NextResponse.json({ error: 'Documento no encontrado o no disponible para tu tienda' }, { status: 404 });
        }

        const existentes = (await portalQuery(`
            SELECT IdEvaluacion, Titulo, Preguntas FROM evaluaciones
            WHERE IdDocumento = ? AND Status = 0
            ORDER BY IdEvaluacion DESC LIMIT 1
        `, [idDocumento])) as Row[];
        const existente = existentes[0];

        if (existente && !regenerar) {
            const preguntas = JSON.parse(str(existente.Preguntas)) as PreguntaEvaluacion[];
            return NextResponse.json({
                idEvaluacion: num(existente.IdEvaluacion),
                titulo: str(existente.Titulo),
                preguntas: sanitizar(preguntas),
            });
        }
        if (regenerar && !oficina) {
            return NextResponse.json({ error: 'Solo oficina puede regenerar una evaluación' }, { status: 403 });
        }

        const generada = await generarEvaluacion(idDocumento, str(doc.Nombre));
        if (!generada) {
            return NextResponse.json(
                { error: 'No se pudo generar: el documento no tiene texto extraíble o el modelo no produjo un cuestionario válido.' },
                { status: 422 }
            );
        }

        if (regenerar && existente) {
            await portalQuery(`UPDATE evaluaciones SET Status = 1 WHERE IdDocumento = ? AND Status = 0`, [idDocumento]);
        }
        const insertado = await portalQuery(`
            INSERT INTO evaluaciones (IdDocumento, Titulo, Preguntas, CreadaPor, FechaCreacion, Status)
            VALUES (?, ?, ?, ?, NOW(), 0)
        `, [
            idDocumento,
            generada.titulo,
            JSON.stringify(generada.preguntas),
            session.codigobarras,
        ]) as unknown as { insertId: number };

        return NextResponse.json({
            idEvaluacion: insertado.insertId,
            titulo: generada.titulo,
            preguntas: sanitizar(generada.preguntas),
        });
    } catch (error) {
        console.error('Error generando evaluación:', error);
        return NextResponse.json(
            { error: 'No fue posible generar la evaluación.' },
            { status: 502 }
        );
    }
}
