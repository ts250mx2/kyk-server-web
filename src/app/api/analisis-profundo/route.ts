import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Análisis Profundo IA — port del deep-summary de kyk-dashboard: recibe el
// contexto ya agregado de la página (KPIs, tops y anomalías; nunca filas
// crudas) y regresa 5 secciones estructuradas. Modelo fijo sonnet-5.
const MODELO = 'claude-sonnet-5';

interface Contexto {
    pageContext?: string;
    period?: { fechaInicio?: string; fechaFin?: string };
    scope?: string;
    kpis?: Record<string, unknown>;
    highlights?: {
        topStores?: { name?: string; value?: number }[];
        topItems?: { name?: string; value?: number }[];
        anomalies?: string[];
    };
}

const nf = new Intl.NumberFormat('es-MX');

export async function POST(request: Request) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    if (!process.env.ANTHROPIC_API_KEY) {
        return NextResponse.json({ error: 'El análisis no está configurado (falta ANTHROPIC_API_KEY)' }, { status: 503 });
    }

    try {
        const ctx: Contexto = await request.json();
        const pageContext = String(ctx.pageContext ?? 'Reporte').slice(0, 500);
        const fechaInicio = String(ctx.period?.fechaInicio ?? '');
        const fechaFin = String(ctx.period?.fechaFin ?? '');
        const scope = String(ctx.scope ?? session.tienda).slice(0, 200);
        const periodText = fechaInicio === fechaFin ? `el ${fechaInicio}` : `del ${fechaInicio} al ${fechaFin}`;

        const kpiLines = Object.entries(ctx.kpis ?? {})
            .filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
            .map(([k, v]) => `  ${k}: ${(v as number) >= 1000 ? nf.format(v as number) : v}`)
            .join('\n');

        const tops = (lista: { name?: string; value?: number }[] | undefined, titulo: string) =>
            lista?.length
                ? `${titulo}:\n${lista.slice(0, 10).map((s, i) => `  ${i + 1}. ${s.name}: ${nf.format(s.value ?? 0)}`).join('\n')}`
                : null;
        const highlightsText = [
            tops(ctx.highlights?.topStores, 'Top elementos'),
            tops(ctx.highlights?.topItems, 'Top items'),
            ctx.highlights?.anomalies?.length
                ? `Anomalías detectadas:\n${ctx.highlights.anomalies.slice(0, 15).map(a => `  - ${a}`).join('\n')}`
                : null,
        ].filter(Boolean).join('\n\n');

        const prompt = `Eres Kesito, consultor senior de retail. Vas a hacer un ANÁLISIS PROFUNDO de ${pageContext} con el snapshot actual de datos.

CONTEXTO:
- Reporte: ${pageContext}
- Período: ${periodText}
- Alcance: ${scope}

KPIs visibles:
${kpiLines || '  (sin KPIs)'}

${highlightsText || ''}

TU TAREA:
Genera un análisis estructurado en 5 secciones. Sé directo, usa cifras concretas con **negritas Markdown**, evita relleno corporativo.

RESPONDE EN JSON ESTRICTO (sin markdown wrapper):
{
  "executiveSummary": "2-3 oraciones con el diagnóstico general, p.ej. 'El **top 3** concentra el **62%** del total...'",
  "keyInsights": ["3-5 hallazgos concretos con cifras"],
  "opportunities": ["2-4 oportunidades accionables"],
  "risks": ["1-3 riesgos o alertas; si no hay, []"],
  "recommendedActions": ["2-4 acciones en imperativo"]
}

REGLAS:
- TODO en español
- Cifras con **negritas Markdown** SIEMPRE
- Sin emojis
- NO inventes datos que no estén en KPIs/highlights
- Si los datos son insuficientes en alguna sección, devuelve array vacío
- Sé honesto: si el reporte se ve normal/sano, dilo en executiveSummary

Devuelve SOLO el JSON.`;

        const anthropic = new Anthropic();
        const resultado = await anthropic.messages.create({
            model: MODELO,
            max_tokens: 2000,
            messages: [{ role: 'user', content: prompt }],
        });
        const texto = resultado.content
            .filter((b): b is Anthropic.TextBlock => b.type === 'text')
            .map(b => b.text)
            .join('\n');

        const inicio = texto.indexOf('{');
        const fin = texto.lastIndexOf('}');
        if (inicio < 0 || fin <= inicio) {
            return NextResponse.json({ error: 'Error parseando la respuesta del modelo' }, { status: 502 });
        }
        const json = JSON.parse(texto.slice(inicio, fin + 1));

        const lista = (v: unknown) => (Array.isArray(v) ? v.map(x => String(x)) : []);
        return NextResponse.json({
            executiveSummary: String(json.executiveSummary ?? ''),
            keyInsights: lista(json.keyInsights),
            opportunities: lista(json.opportunities),
            risks: lista(json.risks),
            recommendedActions: lista(json.recommendedActions),
        });
    } catch (error) {
        console.error('Error en análisis profundo:', error);
        return NextResponse.json({ error: 'No fue posible generar el análisis, intenta de nuevo' }, { status: 502 });
    }
}
