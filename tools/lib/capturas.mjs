// Registro visual: toda captura queda con su historial.
//
// POR QUÉ DIRECCIONADO POR CONTENIDO
//
// Un bucle que converge produce muchas capturas IDÉNTICAS: las últimas
// iteraciones apenas cambian nada. Guardarlas por iteración llenaría el disco de
// copias del mismo PNG. Guardándolas por su sha256, una imagen repetida se
// almacena una vez y el registro apunta a ella tantas veces como haga falta.
//
// Efecto secundario útil: si dos iteraciones comparten sha, son EXACTAMENTE la
// misma imagen. Eso responde "¿cambió algo?" sin abrir ningún fichero.
//
// El registro es append-only y vive junto al proyecto, no en memory/: es
// evidencia del experimento, no memoria del agente.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { appendJsonl, procedencia, readJsonl, redact } from './store.mjs';

export class RegistroVisual {
  #raizProyecto; #dirStore; #jsonl;

  constructor(raizProyecto) {
    this.#raizProyecto = raizProyecto;
    this.#dirStore = join(raizProyecto, 'experiments', 'capturas');
    this.#jsonl = join(raizProyecto, 'experiments', 'capturas.jsonl');
  }

  get rutas() { return { store: this.#dirStore, registro: this.#jsonl }; }

  /**
   * Registra una captura.
   *
   * @param ruta        PNG a registrar
   * @param proyecto    id del proyecto
   * @param iteracion   número de iteración del bucle
   * @param tipo        'render' | 'screenshot' | 'baseline' | 'diff'
   * @param referencia  sha o ruta de la imagen contra la que se comparó
   * @param metricas    { mse, ssim, lpips... } — el VEREDICTO viene de aquí
   * @param descripcion texto del VLM. Es DESCRIPCIÓN, nunca veredicto (§14.14)
   */
  async registrar({
    ruta, proyecto, iteracion, tipo = 'screenshot',
    referencia = null, metricas = {}, descripcion = null, modelo_descriptor = null,
    contexto = {},
  }) {
    if (!existsSync(ruta)) throw new Error(`no existe la captura: ${ruta}`);

    const bytes = await readFile(ruta);
    const sha = createHash('sha256').update(bytes).digest('hex');
    const destino = join(this.#dirStore, `${sha.slice(0, 16)}.png`);

    await mkdir(this.#dirStore, { recursive: true });
    // Si ya existe, es literalmente el mismo contenido: no se vuelve a copiar.
    const yaEstaba = existsSync(destino);
    if (!yaEstaba) await copyFile(ruta, destino);

    const entrada = redact({
      ...procedencia(this.#raizProyecto),
      sha256: sha,
      almacen: `experiments/capturas/${sha.slice(0, 16)}.png`,
      origen: basename(ruta),
      proyecto,
      iteracion,
      tipo,
      referencia,
      bytes: bytes.length,
      dimensiones: leerDimensionesPNG(bytes),
      metricas,
      // El VLM describe; la métrica decide. Se guardan por separado a propósito,
      // para que nadie pueda confundir uno con otro al leer el registro.
      descripcion_vlm: descripcion,
      modelo_descriptor,
      deduplicada: yaEstaba,
      contexto,
    });

    await appendJsonl(this.#jsonl, entrada);
    return entrada;
  }

  /** Historial completo de un proyecto, en orden. */
  async historial({ proyecto = null, tipo = null } = {}) {
    const { entradas } = await readJsonl(this.#jsonl);
    return entradas.filter((e) =>
      (!proyecto || e.proyecto === proyecto) && (!tipo || e.tipo === tipo));
  }

  /**
   * ¿Cambió la imagen respecto a la iteración anterior? Sin abrir ficheros:
   * basta comparar shas.
   */
  async cambios({ proyecto }) {
    const h = await this.historial({ proyecto });
    const out = [];
    for (let i = 1; i < h.length; i++) {
      out.push({
        de: h[i - 1].iteracion, a: h[i].iteracion,
        cambio: h[i - 1].sha256 !== h[i].sha256,
        sha: h[i].sha256.slice(0, 12),
      });
    }
    return out;
  }

  async stats() {
    const { entradas, corruptas } = await readJsonl(this.#jsonl);
    const unicas = new Set(entradas.map((e) => e.sha256));
    let bytes = 0;
    for (const sha of unicas) {
      const f = join(this.#dirStore, `${sha.slice(0, 16)}.png`);
      if (existsSync(f)) bytes += (await stat(f)).size;
    }
    return {
      registradas: entradas.length,
      imagenes_unicas: unicas.size,
      ahorro_por_dedup: entradas.length - unicas.size,
      bytes_en_disco: bytes,
      corruptas,
    };
  }
}

/** Ancho y alto de un PNG leyendo su cabecera IHDR. Sin dependencias. */
function leerDimensionesPNG(buf) {
  const FIRMA = [0x89, 0x50, 0x4e, 0x47];
  if (buf.length < 24 || !FIRMA.every((b, i) => buf[i] === b)) return null;
  return { ancho: buf.readUInt32BE(16), alto: buf.readUInt32BE(20) };
}
