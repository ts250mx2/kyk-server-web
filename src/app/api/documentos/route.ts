import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { portalQuery, esOficina } from '@/lib/portal-db';
import { guardarArchivo, TAMANO_MAXIMO } from '@/lib/documentos-fs';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

// Repositorio de documentos: lista visible para la tienda de la sesión
// (todas las tiendas o dirigidos a la suya), con carpetas y, para oficina,
// el conteo de descargas por documento.
export async function GET(request: Request) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const idCarpeta = num(searchParams.get('carpeta'));
    const busqueda = (searchParams.get('busqueda') ?? '').trim().toLowerCase();
    const oficina = await esOficina(session.codigobarras);

    try {
        const [docs, carpetas, descargas, conteos] = await Promise.all([
            // Vista de carpeta estricta, como el explorador: la raíz muestra solo
            // documentos sin carpeta (o de carpetas retiradas, para no perderlos);
            // con búsqueda activa se escanean TODAS las carpetas.
            portalQuery(`
                SELECT D.IdDocumento, D.IdCarpeta, D.Nombre, D.NombreArchivo, D.Tamano,
                       D.TipoMime, D.TodasTiendas, D.SubidoPorNombre, D.FechaSubida,
                       C.Nombre AS Carpeta
                FROM documentos D
                LEFT JOIN documentos_carpetas C ON C.IdCarpeta = D.IdCarpeta AND C.Status = 0
                WHERE D.Status = 0
                  ${oficina ? '' : `AND (D.TodasTiendas = 1 OR EXISTS (
                      SELECT 1 FROM documentos_tiendas T
                      WHERE T.IdDocumento = D.IdDocumento AND T.IdTienda = ?
                  ))`}
                  ${busqueda ? '' : (idCarpeta > 0
                      ? 'AND D.IdCarpeta = ?'
                      : 'AND (D.IdCarpeta = 0 OR C.IdCarpeta IS NULL)')}
                ORDER BY D.FechaSubida DESC
                LIMIT 500
            `, [
                ...(oficina ? [] : [session.idTienda]),
                ...(!busqueda && idCarpeta > 0 ? [idCarpeta] : []),
            ]) as Promise<Row[]>,
            portalQuery(`
                SELECT IdCarpeta, Nombre, IdCarpetaPadre FROM documentos_carpetas WHERE Status = 0 ORDER BY Nombre
            `) as Promise<Row[]>,
            oficina
                ? portalQuery(`
                    SELECT IdDocumento, COUNT(*) AS N FROM documentos_descargas GROUP BY IdDocumento
                `) as Promise<Row[]>
                : Promise.resolve([] as Row[]),
            // Documentos visibles por carpeta, para el explorador
            portalQuery(`
                SELECT D.IdCarpeta, COUNT(*) AS N
                FROM documentos D
                WHERE D.Status = 0
                  ${oficina ? '' : `AND (D.TodasTiendas = 1 OR EXISTS (
                      SELECT 1 FROM documentos_tiendas T
                      WHERE T.IdDocumento = D.IdDocumento AND T.IdTienda = ?
                  ))`}
                GROUP BY D.IdCarpeta
            `, oficina ? [] : [session.idTienda]) as Promise<Row[]>,
        ]);

        const descargasMap = new Map(descargas.map(d => [num(d.IdDocumento), num(d.N)]));
        const conteoCarpetas = new Map(conteos.map(c => [num(c.IdCarpeta), num(c.N)]));

        let documentos = docs.map(d => ({
            idDocumento: num(d.IdDocumento),
            idCarpeta: num(d.IdCarpeta),
            carpeta: str(d.Carpeta) || 'Sin carpeta',
            nombre: str(d.Nombre),
            nombreArchivo: str(d.NombreArchivo),
            tamano: num(d.Tamano),
            tipoMime: str(d.TipoMime),
            todasTiendas: num(d.TodasTiendas) === 1,
            subidoPor: str(d.SubidoPorNombre),
            fecha: d.FechaSubida,
            descargas: descargasMap.get(num(d.IdDocumento)) ?? 0,
        }));

        if (busqueda) {
            documentos = documentos.filter(d =>
                `${d.nombre} ${d.nombreArchivo} ${d.carpeta}`.toLowerCase().includes(busqueda)
            );
        }

        return NextResponse.json({
            rol: oficina ? 'oficina' : 'tienda',
            total: documentos.length,
            carpetas: carpetas.map(c => ({
                idCarpeta: num(c.IdCarpeta),
                nombre: str(c.Nombre),
                idPadre: num(c.IdCarpetaPadre),
                documentos: conteoCarpetas.get(num(c.IdCarpeta)) ?? 0,
            })),
            documentos,
        });
    } catch (error) {
        console.error('Error listando documentos:', error);
        return NextResponse.json(
            { error: 'No fue posible consultar los documentos.' },
            { status: 502 }
        );
    }
}

// Subir documento (solo oficina): multipart con archivo + metadatos.
export async function POST(request: Request) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    if (!(await esOficina(session.codigobarras))) {
        return NextResponse.json({ error: 'Solo el rol oficina puede subir documentos' }, { status: 403 });
    }

    try {
        const form = await request.formData();
        const archivo = form.get('archivo');
        if (!(archivo instanceof File) || archivo.size === 0) {
            return NextResponse.json({ error: 'Archivo requerido' }, { status: 400 });
        }
        if (archivo.size > TAMANO_MAXIMO) {
            return NextResponse.json({ error: 'El archivo excede el límite de 25 MB' }, { status: 400 });
        }

        const nombre = str(form.get('nombre')).trim() || archivo.name;
        const idCarpeta = num(form.get('carpeta'));
        let destinos: number[] = [];
        try {
            destinos = JSON.parse(str(form.get('tiendas')) || '[]')
                .map(Number)
                .filter((n: number) => Number.isInteger(n) && n > 0);
        } catch { destinos = []; }
        const todasTiendas = destinos.length === 0 ? 1 : 0;

        const contenido = Buffer.from(await archivo.arrayBuffer());
        const nombreFisico = await guardarArchivo(archivo.name, contenido);

        const resultado = await portalQuery(`
            INSERT INTO documentos
                (IdCarpeta, Nombre, NombreArchivo, Archivo, Tamano, TipoMime, TodasTiendas,
                 SubidoPor, SubidoPorNombre, FechaSubida, Status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 0)
        `, [
            idCarpeta,
            nombre.slice(0, 200),
            archivo.name.slice(0, 255),
            nombreFisico,
            archivo.size,
            archivo.type || '',
            todasTiendas,
            session.codigobarras,
            session.name,
        ]) as unknown as { insertId: number };

        if (!todasTiendas) {
            for (const idTienda of destinos) {
                await portalQuery(
                    `INSERT IGNORE INTO documentos_tiendas (IdDocumento, IdTienda) VALUES (?, ?)`,
                    [resultado.insertId, idTienda]
                );
            }
        }

        return NextResponse.json({ success: true, idDocumento: resultado.insertId });
    } catch (error) {
        console.error('Error subiendo documento:', error);
        return NextResponse.json(
            { error: 'No fue posible subir el documento.' },
            { status: 502 }
        );
    }
}
