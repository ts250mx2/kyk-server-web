// Evaluación de A.D.iA.N contra el banco de preguntas de referencia.
//
// Corre las preguntas de evaluaciones/adian-preguntas.json contra un servidor
// en marcha, como si fuera un usuario de tienda, y reporta por pregunta si la
// respuesta citó el documento esperado, cuántas rondas de herramientas usó y
// cuánto tardó. Guarda el resultado en evaluaciones/resultados/ para comparar
// configuraciones (modelo, esfuerzo, prompt) con números y no con opiniones.
//
//   npm run evaluar:adian -- --usuario 123456 --password xxx --tienda 1
//   npm run evaluar:adian -- --modelo claude-sonnet-5 --solo 5
//   npm run evaluar:adian -- --comparar evaluaciones/resultados/a.json evaluaciones/resultados/b.json
//
// Opciones (o variables ADIAN_EVAL_BASE / _USUARIO / _PASSWORD / _TIENDA):
//   --base URL del portal (default http://localhost:3007)
//   --modelo id del catálogo del selector; sin él usa el default del servidor
//   --banco ruta del banco de preguntas
//   --solo N corre solo las primeras N preguntas
//   --pausa ms entre preguntas (default 6500: el agente admite 10 por minuto)
//
// Corre con Node 22.18+ o 23.6+ sin compilar (node quita los tipos por sí
// mismo); en versiones anteriores agrega --experimental-strip-types.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface PreguntaBanco {
    id: string;
    pregunta: string;
    documentoEsperado: string | null;
    paginaEsperada?: number | null;
    notas?: string;
    ejemplo?: boolean;
}

interface ResultadoPregunta {
    id: string;
    pregunta: string;
    documentoEsperado: string | null;
    acierto: boolean;
    documentoCitado: boolean;
    paginaCitada: boolean | null;
    /** El agente ejecutó registrar_pregunta_sin_respuesta (dato del servidor) */
    sinRespuesta: boolean;
    /** La redacción suena a "no encontré" (heurística, solo informativa) */
    textoSinRespuesta: boolean;
    rondas: number;
    herramientas: string[];
    duracionMs: number;
    primerTextoMs: number | null;
    error: string;
    respuesta: string;
}

interface Corrida {
    fecha: string;
    base: string;
    modelo: string;
    banco: string;
    resumen: Resumen;
    resultados: ResultadoPregunta[];
}

interface Resumen {
    total: number;
    aciertos: number;
    porcentajeAcierto: number;
    duracionPromedioMs: number;
    duracionP50Ms: number;
    duracionP90Ms: number;
    primerTextoPromedioMs: number;
    rondasPromedio: number;
    sinRespuesta: number;
    errores: number;
}

const PAUSA_DEFAULT_MS = 6_500;
const ESPERA_429_MS = 30_000;
const CARPETA_RESULTADOS = join('evaluaciones', 'resultados');

// ---------- argumentos ----------

function argumentos(): Map<string, string> {
    const mapa = new Map<string, string>();
    const lista = process.argv.slice(2);
    for (let i = 0; i < lista.length; i++) {
        const actual = lista[i];
        if (!actual.startsWith('--')) continue;
        const nombre = actual.slice(2);
        const siguiente = lista[i + 1];
        if (siguiente !== undefined && !siguiente.startsWith('--')) {
            mapa.set(nombre, siguiente);
            i++;
        } else {
            mapa.set(nombre, 'true');
        }
    }
    return mapa;
}

function opcion(args: Map<string, string>, nombre: string, variable: string, valorDefault = ''): string {
    return args.get(nombre) ?? process.env[variable] ?? valorDefault;
}

function numero(args: Map<string, string>, nombre: string, valorDefault: number): number {
    const crudo = args.get(nombre);
    if (crudo === undefined) return valorDefault;
    const valor = Number(crudo);
    if (!Number.isFinite(valor) || valor < 0) {
        console.warn(`Opción --${nombre} inválida ("${crudo}"): se usa ${valorDefault}`);
        return valorDefault;
    }
    return valor;
}

// ---------- utilidades ----------

function normalizar(texto: string): string {
    return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function percentil(valores: number[], p: number): number {
    if (valores.length === 0) return 0;
    const ordenados = [...valores].sort((a, b) => a - b);
    const indice = Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1);
    return ordenados[Math.max(0, indice)];
}

function promedio(valores: number[]): number {
    return valores.length === 0 ? 0 : Math.round(valores.reduce((a, b) => a + b, 0) / valores.length);
}

const esperar = (ms: number) => new Promise(resolver => setTimeout(resolver, ms));

// La redacción suena a "no encontré": solo informativo; el veredicto sale del
// evento de herramienta que manda el servidor
const RE_SIN_RESPUESTA = /anot[eé] tu pregunta|qued[oó] (anotada|registrada)|no (lo )?encontr[eé]|no hay (ning[uú]n )?documento|ning[uú]n documento/i;
const HERRAMIENTA_SIN_RESPUESTA = 'registrar_pregunta_sin_respuesta';

// ---------- servidor ----------

async function iniciarSesion(base: string, codigobarras: string, password: string, idTienda: string): Promise<string> {
    const respuesta = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigobarras, password, idTienda }),
    });
    const cuerpo = (await respuesta.json().catch(() => ({}))) as { token?: string; error?: string };
    if (!respuesta.ok || !cuerpo.token) {
        throw new Error(`No se pudo iniciar sesión: ${cuerpo.error ?? respuesta.status}`);
    }
    return cuerpo.token;
}

interface Consulta {
    texto: string;
    /** Rondas de herramientas (eventos `reinicio`: el borrador anterior se descarta) */
    rondas: number;
    /** Herramientas que el agente ejecutó, en orden (eventos `herramienta`) */
    herramientas: string[];
    /** Milisegundos hasta el primer texto que el usuario sí ve (después del último reinicio) */
    primerTextoMs: number | null;
    duracionMs: number;
    error: string;
    estado: number;
}

const CONSULTA_VACIA: Omit<Consulta, 'duracionMs' | 'error' | 'estado'> = {
    texto: '',
    rondas: 0,
    herramientas: [],
    primerTextoMs: null,
};

async function preguntar(base: string, token: string, pregunta: string, modelo: string): Promise<Consulta> {
    const inicio = Date.now();
    const respuesta = await fetch(`${base}/api/chat/adian`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ mensaje: pregunta, historial: [], ...(modelo ? { modelo } : {}) }),
    });
    if (!respuesta.ok || !respuesta.body) {
        const cuerpo = (await respuesta.json().catch(() => ({}))) as { error?: string };
        return { ...CONSULTA_VACIA, duracionMs: Date.now() - inicio, error: cuerpo.error ?? `HTTP ${respuesta.status}`, estado: respuesta.status };
    }

    let texto = '';
    let rondas = 0;
    let primerTextoMs: number | null = null;
    let error = '';
    const herramientas: string[] = [];
    const procesar = (linea: string) => {
        if (!linea.trim()) return;
        let evento: { t?: string; texto?: string; error?: string; nombre?: string };
        try { evento = JSON.parse(linea); } catch { return; }
        if (evento.t === 'delta') {
            if (primerTextoMs === null) primerTextoMs = Date.now() - inicio;
            texto += evento.texto ?? '';
        } else if (evento.t === 'reinicio') {
            // El texto de antes se descarta en pantalla: el "primer texto" que
            // cuenta es el que llega después
            rondas++;
            texto = '';
            primerTextoMs = null;
        } else if (evento.t === 'herramienta') {
            if (evento.nombre) herramientas.push(evento.nombre);
        } else if (evento.t === 'error') {
            error = evento.error ?? 'error';
        }
    };

    const lector = respuesta.body.getReader();
    const decodificador = new TextDecoder();
    let pendiente = '';
    for (;;) {
        const { done, value } = await lector.read();
        if (done) break;
        pendiente += decodificador.decode(value, { stream: true });
        const lineas = pendiente.split('\n');
        pendiente = lineas.pop() ?? '';
        lineas.forEach(procesar);
    }
    procesar(pendiente);
    return { texto: texto.trim(), rondas, herramientas, primerTextoMs, duracionMs: Date.now() - inicio, error, estado: 200 };
}

// ---------- evaluación ----------

function evaluar(pregunta: PreguntaBanco, consulta: Consulta): ResultadoPregunta {
    const texto = normalizar(consulta.texto);
    const documentoCitado = pregunta.documentoEsperado !== null && texto.includes(normalizar(pregunta.documentoEsperado));
    const sinRespuesta = consulta.herramientas.includes(HERRAMIENTA_SIN_RESPUESTA);
    const textoSinRespuesta = RE_SIN_RESPUESTA.test(consulta.texto);
    const paginaCitada = pregunta.paginaEsperada
        ? new RegExp(`p[aá]gina ${pregunta.paginaEsperada}\\b|#page=${pregunta.paginaEsperada}\\b`, 'i').test(consulta.texto)
        : null;
    const acierto = !consulta.error && (
        pregunta.documentoEsperado === null
            ? sinRespuesta
            : documentoCitado && !sinRespuesta && paginaCitada !== false
    );
    return {
        id: pregunta.id,
        pregunta: pregunta.pregunta,
        documentoEsperado: pregunta.documentoEsperado,
        acierto,
        documentoCitado,
        paginaCitada,
        sinRespuesta,
        textoSinRespuesta,
        rondas: consulta.rondas,
        herramientas: consulta.herramientas,
        duracionMs: consulta.duracionMs,
        primerTextoMs: consulta.primerTextoMs,
        error: consulta.error,
        respuesta: consulta.texto,
    };
}

function resumir(resultados: ResultadoPregunta[]): Resumen {
    const duraciones = resultados.map(r => r.duracionMs);
    const primeros = resultados.map(r => r.primerTextoMs).filter((v): v is number => v !== null);
    const aciertos = resultados.filter(r => r.acierto).length;
    return {
        total: resultados.length,
        aciertos,
        porcentajeAcierto: resultados.length === 0 ? 0 : Math.round((aciertos / resultados.length) * 100),
        duracionPromedioMs: promedio(duraciones),
        duracionP50Ms: percentil(duraciones, 50),
        duracionP90Ms: percentil(duraciones, 90),
        primerTextoPromedioMs: promedio(primeros),
        rondasPromedio: resultados.length === 0 ? 0 : Math.round((resultados.reduce((a, r) => a + r.rondas, 0) / resultados.length) * 10) / 10,
        sinRespuesta: resultados.filter(r => r.sinRespuesta).length,
        errores: resultados.filter(r => r.error).length,
    };
}

function imprimirResumen(titulo: string, resumen: Resumen): void {
    console.log(`\n${titulo}`);
    console.log(`  Aciertos: ${resumen.aciertos}/${resumen.total} (${resumen.porcentajeAcierto}%)`);
    console.log(`  Duración: promedio ${resumen.duracionPromedioMs} ms, p50 ${resumen.duracionP50Ms} ms, p90 ${resumen.duracionP90Ms} ms`);
    console.log(`  Primer texto: promedio ${resumen.primerTextoPromedioMs} ms`);
    console.log(`  Rondas de herramientas: promedio ${resumen.rondasPromedio}`);
    console.log(`  Sin respuesta: ${resumen.sinRespuesta}   Errores: ${resumen.errores}`);
}

function comparar(rutaA: string, rutaB: string): void {
    const a = JSON.parse(readFileSync(rutaA, 'utf8')) as Corrida;
    const b = JSON.parse(readFileSync(rutaB, 'utf8')) as Corrida;
    imprimirResumen(`A: ${rutaA} (${a.modelo || 'default'})`, a.resumen);
    imprimirResumen(`B: ${rutaB} (${b.modelo || 'default'})`, b.resumen);
    console.log('\nDiferencias por pregunta (solo donde cambió el acierto):');
    const porId = new Map(b.resultados.map(r => [r.id, r]));
    let cambios = 0;
    for (const ra of a.resultados) {
        const rb = porId.get(ra.id);
        if (!rb || ra.acierto === rb.acierto) continue;
        cambios++;
        console.log(`  ${ra.id}: A ${ra.acierto ? 'ok' : 'falla'} (${ra.duracionMs} ms, ${ra.rondas} rondas) → B ${rb.acierto ? 'ok' : 'falla'} (${rb.duracionMs} ms, ${rb.rondas} rondas)`);
    }
    if (cambios === 0) console.log('  ninguna');
}

// ---------- principal ----------

async function principal(): Promise<void> {
    const args = argumentos();
    if (args.has('comparar')) {
        // Las dos rutas van justo después de --comparar
        const posicion = process.argv.indexOf('--comparar');
        const [rutaA, rutaB] = process.argv.slice(posicion + 1, posicion + 3);
        if (!rutaA || !rutaB || rutaA.startsWith('--') || rutaB.startsWith('--')) {
            throw new Error('Uso: --comparar <corridaA.json> <corridaB.json>');
        }
        comparar(rutaA, rutaB);
        return;
    }

    const base = opcion(args, 'base', 'ADIAN_EVAL_BASE', 'http://localhost:3007').replace(/\/$/, '');
    const usuario = opcion(args, 'usuario', 'ADIAN_EVAL_USUARIO');
    const password = opcion(args, 'password', 'ADIAN_EVAL_PASSWORD');
    const tienda = opcion(args, 'tienda', 'ADIAN_EVAL_TIENDA');
    const modelo = opcion(args, 'modelo', 'ADIAN_EVAL_MODELO');
    const rutaBanco = opcion(args, 'banco', 'ADIAN_EVAL_BANCO', join('evaluaciones', 'adian-preguntas.json'));
    const solo = numero(args, 'solo', 0);
    const pausa = numero(args, 'pausa', PAUSA_DEFAULT_MS);
    if (!usuario || !password || !tienda) {
        throw new Error('Faltan --usuario, --password y --tienda (o las variables ADIAN_EVAL_*)');
    }

    const banco = JSON.parse(readFileSync(rutaBanco, 'utf8')) as { preguntas: PreguntaBanco[] };
    const preguntas = solo > 0 ? banco.preguntas.slice(0, solo) : banco.preguntas;
    const ejemplos = preguntas.filter(p => p.ejemplo).length;
    if (ejemplos > 0) {
        console.warn(`Aviso: ${ejemplos} pregunta(s) del banco siguen marcadas como ejemplo; reemplázalas por preguntas reales del portal.`);
    }

    console.log(`Portal ${base}, modelo ${modelo || '(default del servidor)'}, ${preguntas.length} pregunta(s)`);
    const token = await iniciarSesion(base, usuario, password, tienda);

    // La corrida se guarda después de cada pregunta: una caída a la mitad no
    // pierde lo ya corrido. El nombre del archivo solo lleva caracteres seguros.
    mkdirSync(CARPETA_RESULTADOS, { recursive: true });
    const inicioCorrida = new Date();
    const fecha = inicioCorrida.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const nombreModelo = (modelo || 'default').replace(/[^\w.-]/g, '_');
    const ruta = join(CARPETA_RESULTADOS, `${fecha}-${nombreModelo}.json`);
    const guardar = (resultados: ResultadoPregunta[]) => {
        const corrida: Corrida = {
            fecha: inicioCorrida.toISOString(),
            base,
            modelo,
            banco: rutaBanco,
            resumen: resumir(resultados),
            resultados,
        };
        writeFileSync(ruta, JSON.stringify(corrida, null, 2), 'utf8');
    };

    const resultados: ResultadoPregunta[] = [];
    for (const [indice, pregunta] of preguntas.entries()) {
        if (indice > 0) await esperar(pausa);
        const inicioPregunta = Date.now();
        let resultado: ResultadoPregunta;
        try {
            let consulta = await preguntar(base, token, pregunta.pregunta, modelo);
            if (consulta.estado === 429) {
                console.log('  límite de preguntas por minuto: esperando 30 s…');
                await esperar(ESPERA_429_MS);
                consulta = await preguntar(base, token, pregunta.pregunta, modelo);
            }
            resultado = evaluar(pregunta, consulta);
        } catch (error) {
            // Red caída o stream cortado: se anota y se sigue con la siguiente
            resultado = evaluar(pregunta, {
                ...CONSULTA_VACIA,
                duracionMs: Date.now() - inicioPregunta,
                error: error instanceof Error ? error.message : String(error),
                estado: 0,
            });
        }
        resultados.push(resultado);
        guardar(resultados);
        const marca = resultado.acierto ? 'ok   ' : 'FALLA';
        const detalle = resultado.error
            ? `error: ${resultado.error}`
            : `${resultado.rondas} rondas [${resultado.herramientas.join(', ') || 'sin herramientas'}], ${resultado.duracionMs} ms, primer texto ${resultado.primerTextoMs ?? '-'} ms${resultado.sinRespuesta ? ', registrada sin respuesta' : ''}`;
        console.log(`${marca} ${pregunta.id}: ${detalle}`);
    }

    imprimirResumen('Resumen', resumir(resultados));
    console.log(`\nResultado guardado en ${ruta}`);
    console.log('Compara dos corridas con: npm run evaluar:adian -- --comparar <a.json> <b.json>');
}

principal().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
