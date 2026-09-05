// Criterio de parada (§6.2) y circuit breaker (§6.2.1).
//
// Los CUATRO casos deben estar implementados; no basta con el primero. Un bucle
// que solo sabe parar cuando alcanza el objetivo no para nunca cuando no lo
// alcanza, que es el caso habitual.
//
// INVARIANTE que lo sostiene todo: siempre se conserva el MEJOR resultado hasta
// ahora. Una iteración que empeora nunca sobrescribe al campeón.

import { failureFingerprint } from './signature.mjs';

export const RAZON = Object.freeze({
  OBJETIVO: 'objetivo_alcanzado',
  MESETA: 'meseta',
  DIVERGENCIA: 'divergencia',
  PRESUPUESTO: 'presupuesto_agotado',
  BREAKER: 'circuito_abierto',
  BLOQUEO: 'bloqueo_de_producto',
});

const mejorQue = (a, b, dir) => (dir === 'minimize' ? a < b : a > b);

/**
 * Evalúa si el bucle debe parar.
 *
 * @param historial lista de { iteracion, valor, ts, tokens }
 * @param objetivo  { target, direction, ...stopping }
 * @returns { parar, razon, mejor, detalle }
 */
export function evaluarParada(historial, objetivo) {
  const {
    target, direction = 'maximize',
    max_iterations = 25, patience = 5, epsilon = 0.005, divergence_k = 3,
    max_tokens = Infinity, max_wallclock_min = Infinity,
  } = objetivo;

  if (!historial.length) return { parar: false, razon: null, mejor: null, detalle: 'sin iteraciones' };

  // --- el campeón: se recalcula siempre, nunca se pisa ---------------------
  const mejor = historial.reduce((m, h) => (mejorQue(h.valor, m.valor, direction) ? h : m), historial[0]);
  const ultimo = historial.at(-1);
  const base = { mejor, ultimo };

  const alcanza = (v) => (direction === 'minimize' ? v <= target : v >= target);

  // --- 1. Objetivo alcanzado: DOS iteraciones seguidas ---------------------
  // Una sola podría ser ruido. Dos seguidas es una señal.
  const dos = historial.slice(-2);
  if (dos.length === 2 && dos.every((h) => alcanza(h.valor))) {
    return { ...base, parar: true, razon: RAZON.OBJETIVO,
      detalle: `${target} alcanzado en las iteraciones ${dos[0].iteracion} y ${dos[1].iteracion}` };
  }

  // --- 4. Presupuesto: se comprueba ANTES que meseta y divergencia ---------
  // Agotarlo para y entrega el mejor resultado con su número. Nunca se sigue en
  // silencio (§14.9).
  if (historial.length >= max_iterations) {
    return { ...base, parar: true, razon: RAZON.PRESUPUESTO,
      detalle: `${historial.length} iteraciones, tope ${max_iterations}. Mejor: ${mejor.valor}` };
  }
  const tokens = historial.reduce((s, h) => s + (h.tokens ?? 0), 0);
  if (tokens > max_tokens) {
    return { ...base, parar: true, razon: RAZON.PRESUPUESTO,
      detalle: `${tokens} tokens, tope ${max_tokens}. Mejor: ${mejor.valor}` };
  }
  const minutos = (new Date(ultimo.ts) - new Date(historial[0].ts)) / 60000;
  if (minutos > max_wallclock_min) {
    return { ...base, parar: true, razon: RAZON.PRESUPUESTO,
      detalle: `${minutos.toFixed(1)} min, tope ${max_wallclock_min}. Mejor: ${mejor.valor}` };
  }

  // --- 3. Divergencia: k empeoramientos SEGUIDOS -> rollback ---------------
  // Se comprueba antes que la meseta: divergir también es "no mejorar", y si la
  // meseta ganara, se perdería la señal de que hay que revertir.
  if (historial.length > divergence_k) {
    const ventana = historial.slice(-(divergence_k + 1));
    let empeora = 0;
    for (let i = 1; i < ventana.length; i++) {
      if (mejorQue(ventana[i - 1].valor, ventana[i].valor, direction)) empeora++;
      else break;
    }
    if (empeora >= divergence_k) {
      return { ...base, parar: true, razon: RAZON.DIVERGENCIA,
        rollback: mejor,
        detalle: `${divergence_k} empeoramientos seguidos. Rollback a la iteración ${mejor.iteracion} (${mejor.valor})` };
    }
  }

  // --- 2. Meseta: mejora < epsilon durante `patience` iteraciones ----------
  if (historial.length > patience) {
    const ventana = historial.slice(-(patience + 1));
    const mejorVentanaPrevia = ventana[0].valor;
    const mejoraMax = Math.max(...ventana.slice(1).map((h) =>
      (direction === 'minimize' ? mejorVentanaPrevia - h.valor : h.valor - mejorVentanaPrevia)));
    if (mejoraMax < epsilon) {
      return { ...base, parar: true, razon: RAZON.MESETA,
        detalle: `mejora ${mejoraMax.toFixed(6)} < epsilon ${epsilon} en ${patience} iteraciones. `
               + `Mejor: ${mejor.valor}. Escalar a un modelo superior o pedir input humano.` };
    }
  }

  return { ...base, parar: false, razon: null, detalle: `iteración ${historial.length}, mejor ${mejor.valor}` };
}

// ---------------------------------------------------------------------------
// Circuit breaker (§6.2.1). Distinto del criterio de parada y TAMBIÉN obligatorio:
// evita que el agente se quede reintentando exactamente lo mismo.

/** Causas que NO cuentan como fallo de código. Confundirlas hace saltar el breaker por nada. */
const AJENAS = [
  /econnrefused|enotfound|etimedout|econnreset|socket hang up/i,
  /rate.?limit|429|too many requests/i,
  /queue|cola de ci|runner.*(busy|unavailable)/i,
  /model.*(not found|unavailable)|ollama.*not running/i,
];

export const ESTADO_TAREA = Object.freeze({
  ACTIVA: 'active', ESPERANDO: 'waiting', FALLIDA: 'failed', CUARENTENA: 'quarantined',
});

export class CircuitBreaker {
  #intentos = new Map();   // huella -> { n, evidencias:Set, primera }

  /** ¿Es un fallo ajeno al trabajo? Entonces es `waiting` con backoff, no un fallo. */
  static esAjeno(error) {
    const s = String(error ?? '');
    return AJENAS.some((re) => re.test(s));
  }

  static backoffMs(intento, maxMin = 30) {
    return Math.min(2 ** intento * 1000, maxMin * 60_000);
  }

  /**
   * Registra un fallo y dice qué hacer.
   *
   * `evidencia` es lo que distingue un reintento legítimo de uno ciego: los
   * intentos 2 y 3 sobre la misma huella EXIGEN evidencia diagnóstica nueva.
   * Reintentar sin haber aprendido nada está prohibido.
   */
  registrar({ operation, exitCode, error, evidencia = null }) {
    if (CircuitBreaker.esAjeno(error)) {
      const clave = `ajeno:${operation}`;
      const prev = this.#intentos.get(clave) ?? { n: 0, evidencias: new Set() };
      prev.n += 1;
      this.#intentos.set(clave, prev);
      return {
        estado: ESTADO_TAREA.ESPERANDO,
        reintentable: true,
        backoff_ms: CircuitBreaker.backoffMs(prev.n),
        motivo: 'fallo de red, límite de tasa o cola: NO cuenta como fallo de código (§6.2.1)',
      };
    }

    const huella = failureFingerprint({ operation, exitCode, error });
    const est = this.#intentos.get(huella) ?? { n: 0, evidencias: new Set(), primera: new Date().toISOString() };
    est.n += 1;
    if (evidencia) est.evidencias.add(String(evidencia));
    this.#intentos.set(huella, est);

    if (est.n >= 3) {
      return {
        estado: ESTADO_TAREA.CUARENTENA,
        huella, intentos: est.n, reintentable: false,
        motivo: 'tercer fallo idéntico: tarea en cuarentena, evidencia preservada, '
              + 'bloqueo liberado y humano alertado. No se reintenta sin evidencia nueva.',
      };
    }

    // Intentos 2 y 3: hace falta haber aprendido algo.
    if (est.n >= 2 && est.evidencias.size < est.n - 1) {
      return {
        estado: ESTADO_TAREA.FALLIDA,
        huella, intentos: est.n, reintentable: false,
        motivo: `intento ${est.n} sobre la misma huella sin evidencia diagnóstica nueva. `
              + 'Reintentar sin haber aprendido nada está prohibido (§14.15).',
      };
    }

    return { estado: ESTADO_TAREA.ACTIVA, huella, intentos: est.n, reintentable: true, motivo: null };
  }

  intentosDe(huella) { return this.#intentos.get(huella)?.n ?? 0; }
  get huellas() { return [...this.#intentos.keys()]; }
}
