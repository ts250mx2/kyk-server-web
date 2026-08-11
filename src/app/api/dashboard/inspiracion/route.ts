import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getSession } from '@/lib/session';
import { portalQuery } from '@/lib/portal-db';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Tip de mejora continua para retail + reflexión del día. Se generan UNA vez
// al día (Sonnet) y se guardan en la base central (portal_contenido_diario):
// todos los usuarios ven el mismo contenido y el costo es una llamada diaria.
const MODELO = 'claude-sonnet-5';

// El tema rota por día para que los tips no se repitan entre sí
const TEMAS = [
    'control de mermas y productos próximos a caducar',
    'exhibición y acomodo de productos en el piso de venta',
    'servicio y trato al cliente en el mostrador',
    'rapidez y precisión al cobrar en caja',
    'conteos de inventario y orden en bodega',
    'limpieza e higiene en tienda y carnicería',
    'recibo de mercancía y revisión contra factura',
    'trabajo en equipo y comunicación entre turnos',
    'frescura y rotación de perecederos (PEPS)',
    'prevención de faltantes y cuidado del efectivo',
    'orden y seguridad en pasillos y trastienda',
    'venta sugerida y conocimiento de las ofertas',
];

type Row = Record<string, unknown>;

function diaDelAnio(fecha: Date): number {
    const inicio = new Date(fecha.getFullYear(), 0, 0);
    return Math.floor((fecha.getTime() - inicio.getTime()) / 86_400_000);
}

export async function GET() {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    try {
        const hoy = (await portalQuery(
            'SELECT TipTitulo, TipTexto, Reflexion FROM portal_contenido_diario WHERE Fecha = CURDATE()'
        )) as Row[];
        if (hoy.length > 0) {
            return NextResponse.json({
                tip: { titulo: String(hoy[0].TipTitulo), texto: String(hoy[0].TipTexto) },
                reflexion: String(hoy[0].Reflexion),
            });
        }

        if (!process.env.ANTHROPIC_API_KEY) {
            return NextResponse.json({ error: 'El contenido diario no está configurado' }, { status: 503 });
        }

        const tema = TEMAS[diaDelAnio(new Date()) % TEMAS.length];
        const anthropic = new Anthropic();
        const respuesta = await anthropic.messages.create({
            model: MODELO,
            max_tokens: 600,
            messages: [{
                role: 'user',
                content: `Genera el contenido diario del portal de una cadena mexicana de tiendas de abarrotes y carnicería. Los lectores son de TODO perfil: intendencia, cajeros, almacenistas, carniceros y gerentes.

Responde SOLO un JSON válido con esta forma exacta:
{"tip": {"titulo": "...", "texto": "..."}, "reflexion": "..."}

- tip: un consejo de mejora continua sobre "${tema}". Concreto y accionable HOY mismo en la tienda, en 50-80 palabras, tono de compañero con experiencia (de "tú"), sin tecnicismos sin explicar. El título en 4-7 palabras, llamativo.
- reflexion: un pensamiento breve y motivador sobre el trabajo bien hecho, el crecimiento o el trato a las personas (2-3 frases, cálido y directo, sin cursilería). NO lo atribuyas a nadie: nada de autores.`,
            }],
        });

        const texto = respuesta.content.find(b => b.type === 'text')?.text ?? '';
        const limpio = texto.replace(/```json|```/g, '').trim();
        const json = JSON.parse(limpio) as { tip?: { titulo?: string; texto?: string }; reflexion?: string };
        const tipTitulo = String(json.tip?.titulo ?? '').slice(0, 200);
        const tipTexto = String(json.tip?.texto ?? '').trim();
        const reflexion = String(json.reflexion ?? '').trim();
        if (!tipTexto || !reflexion) throw new Error('Contenido generado incompleto');

        // INSERT IGNORE: si dos usuarios llegan al mismo tiempo, gana el primero
        await portalQuery(
            'INSERT IGNORE INTO portal_contenido_diario (Fecha, TipTitulo, TipTexto, Reflexion, FechaGeneracion) VALUES (CURDATE(), ?, ?, ?, NOW())',
            [tipTitulo, tipTexto, reflexion]
        );
        const final = (await portalQuery(
            'SELECT TipTitulo, TipTexto, Reflexion FROM portal_contenido_diario WHERE Fecha = CURDATE()'
        )) as Row[];
        const fila = final[0] ?? { TipTitulo: tipTitulo, TipTexto: tipTexto, Reflexion: reflexion };

        return NextResponse.json({
            tip: { titulo: String(fila.TipTitulo), texto: String(fila.TipTexto) },
            reflexion: String(fila.Reflexion),
        });
    } catch (error) {
        console.error('Error generando el contenido diario:', error);
        return NextResponse.json({ error: 'No fue posible obtener el contenido del día' }, { status: 502 });
    }
}
