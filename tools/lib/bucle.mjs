// EL BUCLE DE EVOLUCIÓN (§6.1).
//
// Hasta aquí existían las piezas —memoria, métricas, gate, breaker— y no el
// orquestador. Sin él no hay evolución: hay un agente que trabaja y un gate que
// le dice que no.
//
// El ciclo, y el orden NO es negociable:
//
//   [1] CONSULTAR MEMORIA   ¿qué falló antes en tareas como ésta?
//   [2] DEFINIR MÉTRICA     GOALS.yml: objetivo, umbral, criterio de parada
//   [3] VERIFICADOR PRIMERO el test existe ANTES que la solución
//   [4] ACTUAR
//   [5] MEDIR               funcional + visual + coste
//   [6] REGISTRAR           SIEMPRE, éxito o fallo
//   [7] ¿PARAR?             los cuatro criterios, o destilar y volver a [1]
//
// El paso 1 no es decorativo: repetir un error ya documentado es un fallo del
// SISTEMA, no mala suerte (§7.4).

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { leerYaml } from './yaml.mjs';
import { validarGoals } from './esquemas.mjs';
import { Memoria } from './memory.mjs';
import { RegistroVisual } from './capturas.mjs';
import { CircuitBreaker, ESTADO_TAREA, RAZON, evaluarParada } from './parada.mjs';
import { errorSignature, taskSignature } from './signature.mjs';

export class Bucle {
  #raiz; #proyecto; #goals; #memoria; #visual; #breaker;
  #historial = []; #iteracion = 0; #campeon = null;

  constructor({ raiz, proyecto }) {
    this.#raiz = raiz;
    this.#proyecto = proyecto;
    this.#memoria = new Memoria(raiz);
    this.#visual = new RegistroVisual(join(raiz, proyecto));
    this.#breaker = new CircuitBreaker();
  }

  // --- [2] La métrica se define ANTES del código ---------------------------
  async cargarObjetivo({ metrica = null } = {}) {
    const ruta = join(this.#raiz, this.#proyecto, 'GOALS.yml');
    if (!existsSync(ruta)) {
      throw new Error(`${this.#proyecto} no tiene GOALS.yml. Sin métrica declarada no arranca (§14.3).`);
    }
    const goals = await leerYaml(ruta);
    const errores = validarGoals(goals, `${this.#proyecto}/GOALS.yml`, this.#raiz);
    if (errores.length) {
      throw new Error(`GOALS.yml inválido:\n  ${errores.join('\n  ')}`);
    }

    const elegida = metrica
      ? goals.metrics.find((m) => m.name === metrica)
      : goals.metrics[0];
    if (!elegida) throw new Error(`no existe la métrica "${metrica}" en ${this.#proyecto}`);

    // --- [3] Verificador primero -----------------------------------------
    const verificador = join(this.#raiz, elegida.verifier);
    if (!existsSync(verificador)) {
      throw new Error(
        `la métrica "${elegida.name}" apunta a un verificador que NO EXISTE: ${elegida.verifier}\n`
        + 'Sin verificador no hay tarea (§2 principio 2). Escríbelo antes de iterar.',
      );
    }

    this.#goals = { ...elegida, ...(goals.stopping ?? {}) };
    this.#goals.proyecto = this.#proyecto;
    this.#goals.bloqueo = goals.bloqueo ?? null;
    return this.#goals;
  }

  // --- [1] Consultar memoria ANTES de actuar -------------------------------
  async consultarMemoria({ dominio, sujeto }) {
    const firma = taskSignature(dominio, sujeto);
    const lecciones = await this.#memoria.recall({ taskSignature: firma, k: 5, maxChars: 4000 });
    return { firma, lecciones };
  }

  /**
   * ¿Este error ya está documentado? Se consulta ANTES de reintentar, con coste
   * cero de tokens. Un choque aquí es un bug del sistema de memoria (§7.4).
   */
  async esErrorConocido(error) {
    return this.#memoria.esReincidencia(error);
  }

  get iteracion() { return this.#iteracion; }
  get campeon() { return this.#campeon; }
  get historial() { return [...this.#historial]; }

  /**
   * Una iteración completa.
   *
   * @param accion async ({iteracion, lecciones, campeon}) =>
   *               { valor, metricas?, evidencia?, capturas?, error?, tokens?, operacion? }
   */
  async iterar(accion, { dominio, sujeto }) {
    // Un bloqueo de producto no se adivina: se registra y se libera (§6.2.3).
    if (this.#goals.bloqueo) {
      return {
        parar: true, razon: RAZON.BLOQUEO,
        detalle: `bloqueado por decisión de producto: ${this.#goals.bloqueo.pregunta}`,
        pregunta: this.#goals.bloqueo.pregunta,
      };
    }

    this.#iteracion += 1;
    const t0 = Date.now();
    const { firma, lecciones } = await this.consultarMemoria({ dominio, sujeto });

    let res;
    try {
      res = await accion({ iteracion: this.#iteracion, lecciones, campeon: this.#campeon });
    } catch (e) {
      res = { error: e.message ?? String(e), valor: null, operacion: 'accion' };
    }

    const duracion = (Date.now() - t0) / 1000;

    // --- [5b] capturas: toda imagen queda con su historial ----------------
    const capturasRegistradas = [];
    for (const c of res.capturas ?? []) {
      capturasRegistradas.push(await this.#visual.registrar({
        ...c, proyecto: this.#proyecto, iteracion: this.#iteracion,
      }));
    }

    // --- fallo: pasa por el breaker ---------------------------------------
    let breaker = null;
    if (res.error) {
      breaker = this.#breaker.registrar({
        operation: res.operacion ?? 'iteracion',
        exitCode: res.exitCode ?? 1,
        error: res.error,
        evidencia: res.evidencia?.[0] ?? null,
      });
    }

    // --- [6] REGISTRAR: siempre, éxito o fallo ---------------------------
    const attempt = await this.#memoria.registrarIntento({
      project: this.#proyecto,
      iteration: this.#iteracion,
      task_signature: firma,
      action: res.accion ?? { type: 'iterar', target: this.#proyecto, summary: res.resumen ?? '' },
      model: res.model ?? null,
      result: res.error ? 'fail' : 'pass',
      metrics: { [this.#goals.name]: res.valor, ...(res.metricas ?? {}) },
      error: res.error ?? null,
      evidence: [...(res.evidencia ?? []), ...capturasRegistradas.map((c) => c.almacen)],
      tokens: res.tokens ?? { in: 0, out: 0, cached: 0 },
      duration_s: duracion,
    });

    // --- fallo con el circuito abierto: se corta aquí ---------------------
    if (breaker && !breaker.reintentable) {
      if (res.error) await this.#destilar(res.error, firma, res.evidencia);
      return {
        parar: true, razon: RAZON.BREAKER, breaker, attempt,
        detalle: breaker.motivo, estado: breaker.estado,
      };
    }
    if (breaker?.estado === ESTADO_TAREA.ESPERANDO) {
      return { parar: false, esperando: true, breaker, attempt, detalle: breaker.motivo };
    }
    if (res.error) {
      await this.#destilar(res.error, firma, res.evidencia);
      return { parar: false, attempt, breaker, detalle: `fallo en la iteración ${this.#iteracion}` };
    }

    // --- éxito: el campeón solo se mueve si MEJORA ------------------------
    const punto = {
      iteracion: this.#iteracion, valor: res.valor, ts: attempt.ts,
      tokens: (res.tokens?.in ?? 0) + (res.tokens?.out ?? 0),
    };
    this.#historial.push(punto);

    const dir = this.#goals.direction ?? 'maximize';
    const mejora = !this.#campeon
      || (dir === 'minimize' ? punto.valor < this.#campeon.valor : punto.valor > this.#campeon.valor);
    if (mejora) this.#campeon = { ...punto, evidencia: res.evidencia ?? [] };

    // --- [7] ¿parar? ------------------------------------------------------
    const veredicto = evaluarParada(this.#historial, this.#goals);
    return { ...veredicto, attempt, campeon: this.#campeon, capturas: capturasRegistradas };
  }

  /** [7b] Si falló, se destila una lección. Si la firma ya existe, se refina. */
  async #destilar(error, firma, evidencia) {
    const sig = errorSignature(error);
    const previa = await this.#memoria.leccionPara(sig);
    if (previa) {
      // §7.4: un fallo repetido cuya firma YA estaba registrada es un bug del
      // sistema de memoria, y se reporta como tal.
      return { reincidencia: true, leccion: previa };
    }
    return this.#memoria.destilar({
      taskSignature: firma,
      error,
      leccion: `Falló en ${this.#proyecto} iteración ${this.#iteracion}: ${String(error).slice(0, 400)}`,
      evidencia: evidencia ?? [],
      confidence: 'low',   // destilada automáticamente: hay que refinarla a mano
    });
  }

  async resumen() {
    return {
      proyecto: this.#proyecto,
      metrica: this.#goals?.name,
      objetivo: this.#goals?.target,
      direccion: this.#goals?.direction,
      iteraciones: this.#iteracion,
      campeon: this.#campeon,
      historial: this.#historial,
      huellas_de_fallo: this.#breaker.huellas.length,
      visual: await this.#visual.stats(),
    };
  }
}

export { RAZON, ESTADO_TAREA };
