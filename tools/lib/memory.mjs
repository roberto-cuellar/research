// Memoria persistente de dos capas (§7).
//
// El punto que suele fallar: un JSONL grande NO resuelve el problema del
// contexto, lo empeora. Por eso hay dos ficheros con roles opuestos:
//
//   attempts.jsonl  crudo, append-only, NUNCA entra al contexto. Registro forense.
//   lessons.jsonl   destilado, deduplicado, corto. Lo único que se inyecta,
//                   y solo las top-K relevantes (K<=5, tope duro de tokens).
//
// La deduplicación es lo que mantiene `lessons.jsonl` pequeño: si una
// error_signature ya existe, NO se crea una lección nueva — se incrementa `hits`
// y se refina el texto (§7.4 paso 3).

import { join } from 'node:path';
import {
  ESTADO, LIMITES, appendJsonl, memoriaDesactivada, procedencia,
  readJsonl, readJsonlAt, redact, rutasMemoria, truncar, writeAtomic,
} from './store.mjs';
import { errorSignature as calcErrorSig } from './signature.mjs';
import { Indice } from './index.mjs';

/** Campos sin los cuales un attempt es inútil para medir (§7.2). */
const OBLIGATORIOS = ['id', 'ts', 'project', 'iteration', 'task_signature', 'action', 'result', 'metrics', 'tokens'];

export class Memoria {
  #raiz; #rutas; #indice; #cargada = false;

  constructor(raiz) {
    this.#raiz = raiz;
    this.#rutas = rutasMemoria(raiz);
    this.#indice = new Indice(this.#rutas.index);
  }

  async abrir() {
    if (this.#cargada) return this;
    await this.#indice.cargar();
    this.#cargada = true;
    return this;
  }

  get desactivada() { return memoriaDesactivada(); }
  get rutas() { return this.#rutas; }

  #siguienteId(prefijo, n) {
    return `${prefijo}_${String(n + 1).padStart(4, '0')}`;
  }

  // --- §7.2 attempts.jsonl --------------------------------------------------

  /**
   * Registra un intento. SIEMPRE, éxito o fallo (§6.1 paso 6).
   * Devuelve el registro tal y como quedó persistido (ya redactado).
   */
  async registrarIntento(attempt) {
    if (this.desactivada) return { skipped: 'SEM_MEMORY_DISABLED' };
    await this.abrir();

    const { entradas } = await readJsonl(this.#rutas.attempts);
    const errSig = attempt.error_signature
      ?? (attempt.error ? calcErrorSig(attempt.error) : null);

    // Regla 1 de §7.5: redactar ANTES de persistir, nunca al leer.
    const registro = redact({
      id: attempt.id ?? this.#siguienteId('att', entradas.length),
      ...procedencia(this.#raiz),
      project: attempt.project ?? null,
      iteration: attempt.iteration ?? 0,
      task_signature: attempt.task_signature ?? null,
      action: attempt.action ?? {},
      model: attempt.model ?? null,
      result: attempt.result ?? 'unknown',
      metrics: attempt.metrics ?? {},
      error_signature: errSig,
      evidence: attempt.evidence ?? [],
      // PASS_TO_PASS / FAIL_TO_PASS: §8.3.1 exige AMBOS conjuntos por iteración.
      pass_to_pass: attempt.pass_to_pass ?? null,
      fail_to_pass: attempt.fail_to_pass ?? null,
      tokens: attempt.tokens ?? { in: 0, out: 0, cached: 0 },
      duration_s: attempt.duration_s ?? null,
    });

    const faltan = OBLIGATORIOS.filter((k) => registro[k] === undefined || registro[k] === null);
    if (faltan.length) {
      throw new Error(`attempt incompleto, faltan campos obligatorios (§7.2): ${faltan.join(', ')}`);
    }

    const { offset, bytes } = await appendJsonl(this.#rutas.attempts, registro);
    this.#indice.registrarAttempt({
      errorSignature: registro.error_signature,
      taskSignature: registro.task_signature,
      id: registro.id, file: 'attempts', offset, bytes,
    });
    await this.#indice.guardar();
    return registro;
  }

  // --- §7.3 lessons.jsonl ---------------------------------------------------

  /**
   * Destila una lección. Si su `error_signature` ya existe, NO crea una nueva:
   * incrementa `hits` y refina el texto (§7.4 paso 3). Eso es lo que impide que
   * `lessons.jsonl` crezca sin control.
   */
  async destilar({ taskSignature, error, errorSignature, leccion, evidencia = [], confidence = 'medium' }) {
    if (this.desactivada) return { skipped: 'SEM_MEMORY_DISABLED' };
    await this.abrir();

    const errSig = errorSignature ?? calcErrorSig(error);
    const existente = errSig ? this.#indice.leccionPorError(errSig) : null;
    if (existente) return this.#refinar(existente.id, { leccion, evidencia });

    const { entradas } = await readJsonl(this.#rutas.lessons);
    const activas = entradas.filter((l) => l.status === ESTADO.ACTIVE).length;
    // Regla 3 de §7.5: el desbordamiento FALLA CERRADO y da una indicación.
    if (activas >= LIMITES.MAX_ENTRADAS) {
      throw new Error(
        `lessons.jsonl alcanzó el tope de ${LIMITES.MAX_ENTRADAS} lecciones activas. ` +
        'Archiva las de hits:0 antes de destilar más (§7.3).',
      );
    }

    const registro = redact({
      id: this.#siguienteId('les', entradas.length),
      ...procedencia(this.#raiz),
      task_signature: taskSignature ?? null,
      error_signature: errSig,
      lesson: truncar(leccion),
      evidence: evidencia,
      confidence,
      hits: 1,
      status: ESTADO.ACTIVE,
    });

    const { offset, bytes } = await appendJsonl(this.#rutas.lessons, registro);
    this.#indice.registrarLeccion({
      id: registro.id, taskSignature: registro.task_signature,
      errorSignature: registro.error_signature, file: 'lessons', offset, bytes,
    });
    await this.#indice.guardar();
    return registro;
  }

  /** Reescribe lessons.jsonl completo, atómicamente. Solo lo usan refinar/archivar. */
  async #reescribirLecciones(mutar) {
    const { entradas } = await readJsonl(this.#rutas.lessons);
    const nuevas = entradas.map(mutar);
    const texto = nuevas.map((l) => JSON.stringify(l)).join('\n');
    await writeAtomic(this.#rutas.lessons, texto ? `${texto}\n` : '');

    // El fichero cambió de tamaño: los offsets del índice ya no valen. Se reindexa.
    let offset = 0;
    for (const l of nuevas) {
      const bytes = Buffer.byteLength(`${JSON.stringify(l)}\n`, 'utf8');
      this.#indice.registrarLeccion({
        id: l.id, taskSignature: l.task_signature,
        errorSignature: l.error_signature, file: 'lessons', offset, bytes,
      });
      if (l.status !== ESTADO.ACTIVE) this.#indice.olvidarLeccion(l.id);
      offset += bytes;
    }
    await this.#indice.guardar();
    return nuevas;
  }

  async #refinar(id, { leccion, evidencia }) {
    let out = null;
    await this.#reescribirLecciones((l) => {
      if (l.id !== id) return l;
      out = redact({
        ...l,
        hits: (l.hits ?? 0) + 1,
        lesson: leccion ? truncar(leccion) : l.lesson,
        evidence: [...new Set([...(l.evidence ?? []), ...evidencia])],
        refined_at: new Date().toISOString(),
      });
      return out;
    });
    return out;
  }

  /**
   * Regla 5 de §7.5: tombstone, no borrado. El historial de lo descartado
   * también es información.
   */
  async archivar(id, estado = ESTADO.FORGOTTEN, motivo = null) {
    await this.abrir();
    let out = null;
    await this.#reescribirLecciones((l) => {
      if (l.id !== id) return l;
      out = { ...l, status: estado, forgottenAt: new Date().toISOString(), forgottenReason: motivo };
      return out;
    });
    return out;
  }

  /** Una lección con hits:0 tras N iteraciones deja de ocupar contexto (§7.3). */
  async archivarSinUso({ minHits = 1 } = {}) {
    await this.abrir();
    const { entradas } = await readJsonl(this.#rutas.lessons);
    const candidatas = entradas.filter((l) => l.status === ESTADO.ACTIVE && (l.hits ?? 0) < minHits);
    for (const l of candidatas) await this.archivar(l.id, ESTADO.SUPERSEDED, 'hits insuficientes');
    return candidatas.map((l) => l.id);
  }

  // --- §7.6 recuperación, de coste cero a coste alto ------------------------

  /**
   * NIVEL 1 — lookup exacto por error_signature. O(1), CERO tokens.
   * Es la consulta obligatoria antes de reintentar cualquier cosa (§14.8).
   * No carga `lessons.jsonl`: salta al offset y lee solo esa línea.
   */
  async leccionPara(error) {
    if (this.desactivada) return null;
    await this.abrir();
    const sig = typeof error === 'string' && error.startsWith('err_') ? error : calcErrorSig(error);
    if (!sig) return null;
    const meta = this.#indice.leccionPorError(sig);
    if (!meta) return null;
    const leccion = await readJsonlAt(this.#rutas.lessons, meta.offset, meta.bytes);
    return leccion.status === ESTADO.ACTIVE ? leccion : null;
  }

  /**
   * NIVEL 2 — filtro por task_signature + status active.
   * Devuelve top-K (K<=5) con tope duro de tokens: §7.6 trata la inyección
   * automática de memoria como un RIESGO, no como una feature. Una lección mal
   * destilada que entra en todos los prompts envenena todas las decisiones.
   */
  async recall({ taskSignature, dominio, k = 5, maxChars = 4000 } = {}) {
    if (this.desactivada) return [];
    await this.abrir();
    const K = Math.min(k, 5);

    const metas = taskSignature
      ? this.#indice.leccionesPorTarea(taskSignature)
      : dominio ? this.#indice.leccionesPorDominio(dominio) : [];

    const leidas = [];
    for (const m of metas) {
      const l = await readJsonlAt(this.#rutas.lessons, m.offset, m.bytes);
      if (l.status === ESTADO.ACTIVE) leidas.push(l);
    }

    // Orden: más golpes primero, luego confianza, luego reciente.
    const peso = { high: 3, medium: 2, low: 1 };
    leidas.sort((a, b) =>
      (b.hits ?? 0) - (a.hits ?? 0)
      || (peso[b.confidence] ?? 0) - (peso[a.confidence] ?? 0)
      || String(b.ts).localeCompare(String(a.ts)));

    const out = [];
    let chars = 0;
    for (const l of leidas.slice(0, K)) {
      chars += l.lesson.length;
      if (chars > maxChars) break;   // tope duro: se corta, no se negocia
      out.push(l);
    }
    return out;
  }

  /**
   * §7.4: un fallo repetido cuya error_signature YA estaba en lessons.jsonl es
   * un bug del sistema de memoria, y debe reportarse como tal — no como un
   * intento más.
   */
  async esReincidencia(error) {
    const l = await this.leccionPara(error);
    return l ? { reincidencia: true, leccion: l } : { reincidencia: false };
  }

  async stats() {
    await this.abrir();
    const a = await readJsonl(this.#rutas.attempts);
    const l = await readJsonl(this.#rutas.lessons);
    return {
      attempts: a.entradas.length,
      attempts_corruptos: a.corruptas,
      lecciones_activas: l.entradas.filter((x) => x.status === ESTADO.ACTIVE).length,
      lecciones_archivadas: l.entradas.filter((x) => x.status !== ESTADO.ACTIVE).length,
      indice: this.#indice.stats,
      desactivada: this.desactivada,
    };
  }
}

/** Localiza la raíz del repo subiendo hasta encontrar AGENTS.md. */
export function raizProyecto(desde = process.cwd()) {
  return desde.includes('open_code')
    ? desde.slice(0, desde.indexOf('open_code') + 'open_code'.length)
    : desde;
}

export { ESTADO, join };
