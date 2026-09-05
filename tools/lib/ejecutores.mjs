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
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Extrae el resumen de `node --test`. -1 si no se pudo leer: no se inventa. */
function contarTests(salida) {
  const n = (re) => Number(salida.match(re)?.[1] ?? -1);
  return { pass: n(/^# pass (\d+)$/m), fail: n(/^# fail (\d+)$/m), total: n(/^# tests (\d+)$/m) };
}

function correr(cmd, args, cwd, timeout = 600_000) {
  try {
    const salida = execFileSync(cmd, args, {
      cwd, encoding: 'utf8', timeout,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
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
 * Elige el ejecutor por la forma de la métrica.
 * Si no hay ninguno, se dice — no se inventa uno que devuelva cualquier cosa.
 */
export function ejecutorPara({ raiz, proyecto, metrica }) {
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
