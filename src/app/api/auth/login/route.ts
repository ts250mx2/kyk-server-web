import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getTiendaById } from '@/lib/tiendas';
import { testTiendaConnection } from '@/lib/tienda-db';
import { createSessionToken, setSessionCookie } from '@/lib/session';

export async function POST(request: Request) {
    try {
        const { codigobarras, password, idTienda } = await request.json();

        if (!codigobarras || !password) {
            return NextResponse.json(
                { error: 'Usuario y contraseña son requeridos' },
                { status: 400 }
            );
        }

        const idTiendaNum = Number(idTienda);
        if (!idTienda || Number.isNaN(idTiendaNum)) {
            return NextResponse.json(
                { error: 'Selecciona una tienda' },
                { status: 400 }
            );
        }

        // 1) Validar credenciales contra tblUsuarios (SQL Server), igual que kyk-dashboard.
        const users = await query(
            `SELECT * FROM tblUsuarios WHERE Status = 0 AND CodigoBarras = @p0 AND Contrasenia2 = @p1`,
            [codigobarras, password]
        );

        const user = users[0];
        if (!user) {
            return NextResponse.json(
                { error: 'Credenciales inválidas' },
                { status: 401 }
            );
        }

        // 2) Resolver la tienda seleccionada y sus datos de conexión (BDKYKRemoto).
        const tienda = await getTiendaById(idTiendaNum);
        if (!tienda) {
            return NextResponse.json(
                { error: 'La tienda seleccionada no es válida' },
                { status: 400 }
            );
        }

        // 3) Establecer/verificar la conexión al servidor MySQL de la tienda
        //    (DireccionMySql / BaseDatosMySQL / UsuarioMySQL / PasswdMySQL).
        const conn = await testTiendaConnection(tienda.IdTienda);
        if (!conn.ok) {
            console.error(`❌ Sin conexión al MySQL de "${tienda.Tienda}" (${tienda.DireccionMySql}):`, conn.error);
            return NextResponse.json(
                { error: `No fue posible conectar al servidor de la tienda ${tienda.Tienda}. Intenta de nuevo o reporta a sistemas.` },
                { status: 502 }
            );
        }

        // 4) Crear sesión con usuario + tienda (sin credenciales MySQL en el token).
        const token = await createSessionToken({
            id: user.IdUsuario || user.id || 'unknown',
            name: user.Usuario,
            codigobarras: user.CodigoBarras,
            idTienda: tienda.IdTienda,
            tienda: tienda.Tienda,
            mysqlHost: tienda.DireccionMySql,
            mysqlDatabase: tienda.BaseDatosMySQL,
        });
        await setSessionCookie(token);

        console.log(`✅ Acceso correcto: "${user.Usuario}" en tienda "${tienda.Tienda}" (MySQL ${tienda.DireccionMySql}/${tienda.BaseDatosMySQL}).`);

        return NextResponse.json({
            success: true,
            user: {
                name: user.Usuario,
                codigobarras: user.CodigoBarras,
            },
            tienda: {
                IdTienda: tienda.IdTienda,
                Tienda: tienda.Tienda,
            },
        });

    } catch (error) {
        console.error('Login error:', error);
        return NextResponse.json(
            { error: 'Error interno del servidor' },
            { status: 500 }
        );
    }
}
