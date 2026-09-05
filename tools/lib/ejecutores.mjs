// Ejecutores: el paso [4] del bucle. Lo que ACTÚA y MIDE.
//
// El motor del bucle (bucle.mjs) no sabe nada de tests ni de navegadores: recibe
// una función y un número. Aquí viven las funciones concretas, una por tipo de
// métrica declarada en un GOALS.yml.
//
// REGLA: un ejecutor MIDE, no juzga. Devuelve `valor`; quién decide si ese valor
// basta es `evaluarParada` contra el `target` del GOALS. Un ejecutor que
// devolviera true/false le quitaría al bucle su criterio de convergencia.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Extrae el resumen de `node --test`. -1 si no se pudo leer: no se inventa. */
function contarTests(salida) {
  const n = (re) => Number(salida.match(re)?.[1] ?? -1);
  return { pass: n(/^# pass (\d+)$/m), fail: n(/^# fail (\d+)$/m), total: n(/^# tests (\d+)$/m) };
}

/**
 * @param shell `true` hace falta para `npm`/`npx` en Windows, que son .cmd.
 *              Debe ser `false` para un .exe cuya RUTA LLEVA ESPACIOS: con
 *              shell:true la línea se re-parsea y "C:/Program Files/..." se
 *              parte en dos argumentos. Costó tres fallos idénticos y una
 *              cuarentena del breaker descubrirlo.
 */
function correr(cmd, args, cwd, timeout = 600_000, shell = process.platform === 'win32') {
  try {
    const salida = execFileSync(cmd, args, {
      cwd, encoding: 'utf8', timeout,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell,
    });
    return { salida, codigo: 0 };
  } catch (e) {
    return { salida: `${e.stdout ?? ''}${e.stderr ?? ''}`, codigo: e.status ?? 1, señal: e.signal };
  }
}

/**
 * Métrica funcional: número de tests en verde de la suite del proyecto.
 * Es directamente el PASS_TO_PASS de §8.3.1.
 */
export function ejecutorSuite({ raiz, proyecto }) {
  const cwd = join(raiz, proyecto);
  return async () => {
    const { salida, codigo, señal } = correr('npm', ['test', '--silent'], cwd);
    const c = contarTests(salida);

    if (c.total < 0) {
      return {
        valor: null,
        error: `no se pudo leer el resumen de la suite (exit ${codigo}${señal ? `, señal ${señal}` : ''})`,
        operacion: 'npm test',
        exitCode: codigo,
        evidencia: [salida.slice(-1200)],
      };
    }
    // Una suite en rojo NO es un error del ejecutor: es una MEDIDA legítima —
    // el valor bajó. Devolverlo como error dispararía el circuit breaker por un
    // resultado que el bucle debe poder comparar contra el anterior.
    return {
      valor: c.pass,
      metricas: { tests_total: c.total, tests_fail: c.fail },
      resumen: `${c.pass}/${c.total} en verde`,
      accion: { type: 'run', target: `${proyecto}/tests`, summary: 'suite completa' },
    };
  };
}

/**
 * Métrica visual: Playwright compara contra el golden y la captura queda
 * registrada con su historial.
 */
export function ejecutorVisual({ raiz, proyecto, spec, capturaEsperada }) {
  return async () => {
    const { salida, codigo } = correr('npx', ['playwright', 'test', spec, '--reporter=list'], raiz);

    const okRe = /(\d+) passed/.exec(salida);
    const falloRe = /(\d+) failed/.exec(salida);
    const pasa = codigo === 0 && !!okRe;

    const capturas = [];
    if (capturaEsperada && existsSync(join(raiz, capturaEsperada))) {
      capturas.push({
        ruta: join(raiz, capturaEsperada),
        tipo: 'baseline',
        metricas: { playwright_pasa: pasa ? 1 : 0 },
      });
    }

    return {
      // 1 = coincide con el golden, 0 = no. El umbral lo pone el GOALS, no esto.
      valor: pasa ? 1 : 0,
      metricas: { pasadas: Number(okRe?.[1] ?? 0), fallidas: Number(falloRe?.[1] ?? 0) },
      capturas,
      resumen: pasa ? 'coincide con el golden' : 'difiere del golden',
      accion: { type: 'run', target: spec, summary: 'golden visual' },
      // Si Playwright ni arrancó, eso SÍ es un error del ejecutor.
      ...(okRe || falloRe ? {} : {
        error: `playwright no produjo resumen (exit ${codigo})`,
        operacion: 'playwright',
        exitCode: codigo,
        evidencia: [salida.slice(-1200)],
      }),
    };
  };
}


/**
 * Métrica de progreso real: cuántas trampas tienen su test EN VERDE.
 *
 * A diferencia de las métricas guardia —"no bajes de 155", "no rompas el
 * golden"—, ésta empieza en 0 y solo sube escribiendo código nuevo. Es la que
 * hace trabajar al bucle de verdad.
 *
 * Cuenta trampas, NO ficheros ni tests: una trampa con su fichero creado pero
 * sin tests dentro cuenta 0, y una con tests en rojo también. Contar ficheros
 * permitiría subir la métrica creando ficheros vacíos.
 */
export function ejecutorTrampas({ raiz, proyecto, inventario = 'assets/trampas.json' }) {
  const cwd = join(raiz, proyecto);
  return async () => {
    const rutaInv = join(cwd, inventario);
    if (!existsSync(rutaInv)) {
      return { valor: null, error: `sin inventario de trampas: ${inventario}`, operacion: 'trampas' };
    }
    const { trampas } = JSON.parse(readFileSync(rutaInv, 'utf8'));

    const hechas = [];
    const rojas = [];
    const sinTest = [];

    for (const tr of trampas) {
      const spec = join(cwd, 'tests', 'traps', `${tr.id}.test.mjs`);
      if (!existsSync(spec)) { sinTest.push(tr.id); continue; }

      const { salida, codigo } = correr('node', ['--test', spec], cwd, 120_000);
      const c = contarTests(salida);
      // Un fichero sin ningún test dentro NO cuenta: si no, bastaría con crear
      // el fichero para subir la métrica.
      if (codigo === 0 && c.fail === 0 && c.pass > 0) hechas.push(tr.id);
      else rojas.push(tr.id);
    }

    return {
      valor: hechas.length,
      metricas: {
        declaradas: trampas.length,
        sin_test: sinTest.length,
        en_rojo: rojas.length,
      },
      resumen: `${hechas.length}/${trampas.length} trampas con test verde`
             + (rojas.length ? ` · ${rojas.length} en rojo: ${rojas.join(', ')}` : ''),
      evidencia: hechas.map((id) => `tests/traps/${id}.test.mjs`),
      accion: { type: 'run', target: 'tests/traps', summary: 'inventario de trampas' },
    };
  };
}


/** Ruta de Blender. No esta en el PATH todavia (TDB-005 de pixel-borislov). */
const BLENDER = process.env.BLENDER_EXE
  ?? 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';

/**
 * Vitrales: la primera métrica del repo que converge SOLA.
 *
 * Las anteriores solo MEDÍAN, y hacía falta un humano escribiendo código entre
 * iteraciones para que subieran. Aquí la acción es mecánica —hornear el
 * siguiente cuadro que falte— así que el ejecutor la realiza y luego mide. El
 * bucle sube de 1 a 6 sin intervención.
 *
 * Sigue sin JUZGAR: devuelve cuántos hay horneados, y quién decide si bastan es
 * `evaluarParada` contra el `target` del GOALS.
 *
 * Un cuadro cuenta solo si tiene manifiesto Y sus tres capas con contenido
 * VISIBLE. Un PNG enteramente transparente se genera igual de bien con el
 * shader roto, así que contar ficheros permitiría converger sin vitral.
 */
export function ejecutorVitrales({ raiz, proyecto, guion = 'assets/guion.json' }) {
  const cwd = join(raiz, proyecto);
  return async () => {
    const rutaGuion = join(cwd, guion);
    if (!existsSync(rutaGuion)) {
      return { valor: null, error: `sin guion: ${guion}`, operacion: 'vitrales' };
    }
    const { cuadros } = JSON.parse(readFileSync(rutaGuion, 'utf8'));

    const completo = (id) => {
      const dir = join(cwd, 'assets', 'vitrales', id);
      if (!existsSync(join(dir, 'manifiesto.json'))) return false;
      let man;
      try { man = JSON.parse(readFileSync(join(dir, 'manifiesto.json'), 'utf8')); }
      catch { return false; }
      if (!Array.isArray(man.capas) || man.capas.length !== 3) return false;
      return man.capas.every((c) => {
        const png = join(dir, c.png);
        // 2 KB: un PNG totalmente transparente de 1280x720 comprime por debajo
        // de eso. No es una medida de calidad, es un detector de vacío.
        return existsSync(png) && statSync(png).size > 2048;
      });
    };

    const hechos = cuadros.filter((c) => completo(c.id)).map((c) => c.id);
    const faltan = cuadros.filter((c) => !completo(c.id));

    // --- ACTUAR: hornear el siguiente que falte -------------------------
    let horneado = null;
    let fallo = null;
    if (faltan.length) {
      const siguiente = faltan[0];
      if (!existsSync(BLENDER)) {
        return {
          valor: hechos.length,
          error: `no se encuentra Blender en ${BLENDER}. Define BLENDER_EXE.`,
          operacion: 'blender',
          exitCode: 127,
        };
      }
      const { salida, codigo } = correr(BLENDER, [
        '--background', '--python', join(raiz, 'tools', 'vitral', 'build_vitral.py'),
        '--', '--guion', rutaGuion, '--cuadro', siguiente.id,
        // shell:false — la ruta de Blender lleva espacios.
      ], raiz, 900_000, false);

      if (codigo === 0 && completo(siguiente.id)) {
        horneado = siguiente.id;
        hechos.push(siguiente.id);
      } else {
        fallo = `no se pudo hornear ${siguiente.id}`;
        // Es un fallo REAL del ejecutor: la acción no se completó. Que pase por
        // el breaker es lo correcto, porque reintentarla sin cambiar nada daría
        // exactamente el mismo resultado.
        return {
          valor: hechos.length,
          error: `${fallo} (exit ${codigo})`,
          operacion: `hornear:${siguiente.id}`,
          exitCode: codigo,
          evidencia: [salida.slice(-1500)],
        };
      }
    }

    return {
      valor: hechos.length,
      metricas: { declarados: cuadros.length, pendientes: cuadros.length - hechos.length },
      resumen: horneado
        ? `horneado ${horneado} · ${hechos.length}/${cuadros.length}`
        : `${hechos.length}/${cuadros.length} cuadros completos`,
      evidencia: hechos.map((id) => `assets/vitrales/${id}/manifiesto.json`),
      capturas: horneado
        ? [{
            ruta: join(cwd, 'assets', 'vitrales', horneado, `${horneado}_figura.png`),
            tipo: 'render',
            metricas: { cuadro_index: hechos.length },
            contexto: { cuadro: horneado, capa: 'figura' },
          }]
        : [],
      accion: { type: 'build', target: horneado ?? 'ninguno', summary: 'horneado de vitral' },
    };
  };
}

/**
 * Elige el ejecutor por la forma de la métrica.
 * Si no hay ninguno, se dice — no se inventa uno que devuelva cualquier cosa.
 */
export function ejecutorPara({ raiz, proyecto, metrica }) {
  if (metrica.verifier.includes('tools/vitral')) return ejecutorVitrales({ raiz, proyecto });
  if (/\/traps\/?$/.test(metrica.verifier)) return ejecutorTrampas({ raiz, proyecto });
  if (metrica.kind === 'visual' || /\.spec\.(mjs|ts|js)$/.test(metrica.verifier)) {
    return ejecutorVisual({
      raiz, proyecto,
      spec: metrica.verifier,
      capturaEsperada: metrica.reference ?? null,
    });
  }
  if (metrica.verifier.endsWith('/') || metrica.verifier.includes('/tests')) {
    return ejecutorSuite({ raiz, proyecto });
  }
  return null;
}
