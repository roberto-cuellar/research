// Índice de recuperación de la memoria.
//
// Resuelve el nivel 1 de §7.6: lookup exacto por `error_signature` ANTES de
// reintentar, a coste cero de tokens y sin cargar `attempts.jsonl`.
//
// DECISIÓN MEDIDA (2026-09-04): `node:sqlite` está disponible en Node 22.22.0
// SIN flag, pero emite `ExperimentalWarning` en cada invocación y su API puede
// cambiar sin aviso. Para el sustrato durable de la memoria eso es un riesgo que
// no compensa: el índice es un mapa signature -> offset de ~50 bytes por entrada,
// así que un JSON plano lo cubre con cero dependencias y cero warnings.
// Si el volumen crece hasta hacerlo insostenible, se migra a sqlite CON el dato
// que lo justifique, no antes.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { writeAtomic } from './store.mjs';

const VACIO = () => ({
  version: 1,
  por_error: {},   // error_signature -> [{ file, offset, bytes, id }]
  por_tarea: {},   // task_signature  -> [ids de lección]
  lecciones: {},   // lesson_id       -> { file, offset, bytes }
});

export class Indice {
  #ruta;
  #datos;
  #sucio = false;

  constructor(ruta) {
    this.#ruta = ruta;
    this.#datos = VACIO();
  }

  /** Un índice corrupto se reconstruye vacío; nunca crashea ni se sobrescribe a ciegas. */
  async cargar() {
    if (!existsSync(this.#ruta)) return this;
    try {
      const parsed = JSON.parse(await readFile(this.#ruta, 'utf8'));
      this.#datos = { ...VACIO(), ...parsed };
    } catch {
      this.#datos = VACIO();
      this.#sucio = true;   // se regenerará en el próximo guardar()
    }
    return this;
  }

  async guardar() {
    if (!this.#sucio) return;
    await writeAtomic(this.#ruta, `${JSON.stringify(this.#datos, null, 0)}\n`);
    this.#sucio = false;
  }

  /** Registra dónde vive un attempt para poder leerlo por offset. */
  registrarAttempt({ errorSignature, taskSignature, id, file, offset, bytes }) {
    if (errorSignature) {
      (this.#datos.por_error[errorSignature] ||= []).push({ file, offset, bytes, id });
    }
    if (taskSignature) {
      this.#datos.por_tarea[taskSignature] ||= [];
    }
    this.#sucio = true;
  }

  registrarLeccion({ id, taskSignature, errorSignature, file, offset, bytes }) {
    this.#datos.lecciones[id] = { file, offset, bytes, errorSignature, taskSignature };
    if (taskSignature) {
      const lista = (this.#datos.por_tarea[taskSignature] ||= []);
      if (!lista.includes(id)) lista.push(id);
    }
    this.#sucio = true;
  }

  /** Nivel 1 de §7.6: ¿existe ya una lección para esta huella exacta? O(1). */
  leccionPorError(errorSignature) {
    for (const [id, meta] of Object.entries(this.#datos.lecciones)) {
      if (meta.errorSignature === errorSignature) return { id, ...meta };
    }
    return null;
  }

  /** Nivel 2 de §7.6: filtro por task_signature. */
  leccionesPorTarea(taskSignature) {
    const ids = this.#datos.por_tarea[taskSignature] || [];
    return ids.map((id) => ({ id, ...this.#datos.lecciones[id] })).filter((l) => l.file);
  }

  /** Prefijo de dominio: `collision:` recupera todas las de colisión. */
  leccionesPorDominio(dominio) {
    const pref = `${dominio.toLowerCase()}:`;
    const out = [];
    for (const [tarea, ids] of Object.entries(this.#datos.por_tarea)) {
      if (!tarea.startsWith(pref)) continue;
      for (const id of ids) if (this.#datos.lecciones[id]) out.push({ id, ...this.#datos.lecciones[id] });
    }
    return out;
  }

  attemptsPorError(errorSignature) {
    return this.#datos.por_error[errorSignature] || [];
  }

  ubicacionLeccion(id) {
    const m = this.#datos.lecciones[id];
    return m ? { id, ...m } : null;
  }

  olvidarLeccion(id) {
    delete this.#datos.lecciones[id];
    for (const ids of Object.values(this.#datos.por_tarea)) {
      const i = ids.indexOf(id);
      if (i !== -1) ids.splice(i, 1);
    }
    this.#sucio = true;
  }

  get stats() {
    return {
      lecciones: Object.keys(this.#datos.lecciones).length,
      firmas_error: Object.keys(this.#datos.por_error).length,
      tareas: Object.keys(this.#datos.por_tarea).length,
    };
  }
}
