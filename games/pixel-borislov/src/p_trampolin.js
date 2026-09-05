/**
 * Trampolín — trampa 1 de 13 del pack CC0.
 *
 * Estados del sprite: `Idle` y `Jump`. Los estados definen el comportamiento,
 * así que valen como especificación: hay dos, luego el trampolín está o en
 * reposo o disparado, y no hay estado intermedio de "cargando".
 *
 * Módulo puro y simulable en Node, como el resto de la capa `p_`: no toca
 * Three.js ni el DOM. Eso es lo que permite probarlo sin navegador y lo que
 * `arquitectura.test.mjs` hace cumplir.
 */

export const TUNING_TRAMPOLIN = {
  /**
   * Impulso vertical FIJO. Deliberadamente no depende de la velocidad de
   * llegada: si dependiera, caer desde más alto botaría más alto y la altura de
   * rebote dejaría de ser una constante con la que diseñar un nivel.
   *
   * 15.0 contra los 10.66 de `jumpVelocity` del jugador: el trampolín tiene que
   * llevar claramente más lejos que un salto normal, o no sirve de nada.
   */
  impulso: 15.0,

  /**
   * Duración del estado `jump` en segundos. Las animaciones del pack corren a
   * 20 FPS (50 ms/frame); 6 frames son 0.3 s. Mientras dure, el trampolín no
   * vuelve a impulsar: evita el doble disparo en contactos consecutivos.
   */
  duracion_jump: 0.3,

  /** Margen vertical de contacto, en tiles. */
  alcance: 0.35,
};

const ANCHO = 1.0;   // un tile
const ALTO = 0.4;    // el trampolín es bajo: se pisa, no se escala

export function crearTrampolin({ x, y }) {
  return { x, y, w: ANCHO, h: ALTO, estado: 'idle', t: 0 };
}

/** ¿El cuerpo está sobre el trampolín y lo bastante cerca en vertical? */
function enContacto(tr, cuerpo) {
  const solapaX = cuerpo.x < tr.x + tr.w && cuerpo.x + cuerpo.w > tr.x;
  if (!solapaX) return false;
  // `cuerpo.y` es la esquina INFERIOR (convenio de CollisionWorld), así que la
  // distancia relevante es entre la base del cuerpo y la cara superior.
  const dy = cuerpo.y - (tr.y + tr.h);
  return dy <= TUNING_TRAMPOLIN.alcance && dy >= -TUNING_TRAMPOLIN.alcance;
}

/**
 * Avanza los trampolines un paso y devuelve la velocidad vertical resultante.
 *
 * @param trampolines lista mutable: los estados se actualizan in situ
 * @param cuerpo      { x, y, w, h } con x/y en la esquina inferior izquierda
 * @param vy          velocidad vertical actual del cuerpo
 * @returns { vy, impulsado }
 */
export function actualizarTrampolines(trampolines, cuerpo, vy, dt) {
  let salida = vy;
  let impulsado = false;

  for (const tr of trampolines) {
    if (tr.estado === 'jump') {
      tr.t += dt;
      if (tr.t >= TUNING_TRAMPOLIN.duracion_jump) { tr.estado = 'idle'; tr.t = 0; }
      continue;   // mientras dure la animación no vuelve a disparar
    }

    // Solo impulsa al pisarlo CAYENDO. Subiendo se atraviesa, que es lo que
    // permite colocar trampolines bajo una plataforma sin bloquear el paso.
    if (vy < 0 && enContacto(tr, cuerpo)) {
      tr.estado = 'jump';
      tr.t = 0;
      salida = TUNING_TRAMPOLIN.impulso;
      impulsado = true;
    }
  }

  return { vy: salida, impulsado };
}
