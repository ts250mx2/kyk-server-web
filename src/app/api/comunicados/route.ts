import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { portalQuery, esOficina } from '@/lib/portal-db';
import { guardarArchivo, TAMANO_MAXIMO } from '@/lib/documentos-fs';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

// Comunicados visibles para la tienda de la sesión, con el estado de acuse del
// usuario actual. Por default solo vigentes; con ?historial=1 se incluyen vencidos.
export async function GET(request: Request) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const historial = searchParams.get('historial') === '1';

    try {
        const rows = await portalQuery(`
            SELECT C.IdComunicado, C.Titulo, C.Cuerpo, C.Prioridad, C.TodasTiendas,
                   C.VigenteHasta, C.PublicadoPorNombre, C.FechaPublicacion,
                   A.FechaAcuse
            FROM comunicados C
            LEFT JOIN comunicados_acuses A
                ON A.IdComunicado = C.IdComunicado
               AND A.CodigoBarras = ? AND A.IdTienda = ?
            WHERE C.Status = 0
              AND (C.TodasTiendas = 1 OR EXISTS (
                  SELECT 1 FROM comunicados_tiendas T
                  WHERE T.IdComunicado = C.IdComunicado AND T.IdTienda = ?
              ))
              ${historial ? '' : 'AND (C.VigenteHasta IS NULL OR C.VigenteHasta >= NOW())'}
            ORDER BY C.FechaPublicacion DESC
            LIMIT 200
        `, [session.codigobarras, session.idTienda, session.idTienda]) as Row[];

        // Adjuntos de los comunicados listados (una sola consulta)
        const adjuntosMap = new Map<number, Array<{ idAdjunto: number; nombre: string; tamano: number }>>();
        if (rows.length > 0) {
            const ids = rows.map(r => num(r.IdComunicado)).filter(n => n > 0);
            try {
                const adjuntos = await portalQuery(`
                    SELECT IdAdjunto, IdComunicado, Nombre, Tamano
                    FROM comunicados_adjuntos
                    WHERE IdComunicado IN (${ids.join(',')})
                    ORDER BY IdAdjunto
                `) as Row[];
                for (const a of adjuntos) {
                    const idComunicado = num(a.IdComunicado);
                    const lista = adjuntosMap.get(idComunicado) ?? [];
                    lista.push({ idAdjunto: num(a.IdAdjunto), nombre: str(a.Nombre), tamano: num(a.Tamano) });
                    adjuntosMap.set(idComunicado, lista);
                }
            } catch { /* sin adjuntos si falla */ }
        }

        const comunicados = rows.map(r => ({
            idComunicado: num(r.IdComunicado),
            titulo: str(r.Titulo),
            cuerpo: str(r.Cuerpo),
            urgente: num(r.Prioridad) === 1,
            todasTiendas: num(r.TodasTiendas) === 1,
            vigenteHasta: r.VigenteHasta ?? null,
            publicadoPor: str(r.PublicadoPorNombre),
            fecha: r.FechaPublicacion,
            acusado: r.FechaAcuse != null,
            fechaAcuse: r.FechaAcuse ?? null,
            adjuntos: adjuntosMap.get(num(r.IdComunicado)) ?? [],
        }));

        return NextResponse.json({
            rol: (await esOficina(session.codigobarras)) ? 'oficina' : 'tienda',
            noLeidos: comunicados.filter(c => !c.acusado).length,
            comunicados,
        });
    } catch (error) {
        console.error('Error listando comunicados:', error);
        return NextResponse.json(
            { error: 'No fue posible consultar los comunicados.' },
            { status: 502 }
        );
    }
}

// Publicar comunicado (solo rol oficina).
export async function POST(request: Request) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    if (!(await esOficina(session.codigobarras))) {
        return NextResponse.json({ error: 'Solo el rol oficina puede publicar comunicados' }, { status: 403 });
    }

    try {
        // Multipart para soportar archivos adjuntos (arrastrados o seleccionados)
        const form = await request.formData();
        const titulo = String(form.get('titulo') ?? '').trim();
        const cuerpo = String(form.get('cuerpo') ?? '').trim();
        const urgente = String(form.get('urgente') ?? '') === '1';
        const vigenteHasta = String(form.get('vigenteHasta') ?? '');
        const adjuntos = form.getAll('adjuntos').filter((a): a is File => a instanceof File && a.size > 0);

        if (!titulo || !cuerpo) {
            return NextResponse.json({ error: 'Título y contenido son requeridos' }, { status: 400 });
        }
        if (adjuntos.length > 10) {
            return NextResponse.json({ error: 'Máximo 10 archivos adjuntos' }, { status: 400 });
        }
        for (const a of adjuntos) {
            if (a.size > TAMANO_MAXIMO) {
                return NextResponse.json({ error: `El adjunto "${a.name}" excede el límite de 25 MB` }, { status: 400 });
            }
        }

        let destinos: number[] = [];
        try {
            destinos = JSON.parse(String(form.get('tiendas') ?? '[]'))
                .map(Number)
                .filter((n: number) => Number.isInteger(n) && n > 0);
        } catch { destinos = []; }
        const todasTiendas = destinos.length === 0 ? 1 : 0;
        const vigencia = /^\d{4}-\d{2}-\d{2}$/.test(vigenteHasta)
            ? `${vigenteHasta} 23:59:59`
            : null;

        const resultado = await portalQuery(`
            INSERT INTO comunicados
                (Titulo, Cuerpo, Prioridad, TodasTiendas, VigenteHasta,
                 PublicadoPor, PublicadoPorNombre, FechaPublicacion, Status)
            VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), 0)
        `, [
            titulo.slice(0, 200),
            cuerpo,
            urgente ? 1 : 0,
            todasTiendas,
            vigencia,
            session.codigobarras,
            session.name,
        ]) as unknown as { insertId: number };

        if (!todasTiendas) {
            for (const idTienda of destinos) {
                await portalQuery(
                    `INSERT IGNORE INTO comunicados_tiendas (IdComunicado, IdTienda) VALUES (?, ?)`,
                    [resultado.insertId, idTienda]
                );
            }
        }

        for (const a of adjuntos) {
            const contenido = Buffer.from(await a.arrayBuffer());
            const nombreFisico = await guardarArchivo(a.name, contenido, 'comunicados');
            await portalQuery(`
                INSERT INTO comunicados_adjuntos (IdComunicado, Nombre, Archivo, Tamano, TipoMime)
                VALUES (?, ?, ?, ?, ?)
            `, [resultado.insertId, a.name.slice(0, 255), nombreFisico, a.size, a.type || '']);
        }

        return NextResponse.json({ success: true, idComunicado: resultado.insertId });
    } catch (error) {
        console.error('Error publicando comunicado:', error);
        return NextResponse.json(
            { error: 'No fue posible publicar el comunicado.' },
            { status: 502 }
        );
    }
}
