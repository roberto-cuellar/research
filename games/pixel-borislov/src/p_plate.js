/**
 * Placas de presion — la logica.
 *
 * El fondo de un encaje que reacciona a que le pongan algo encima. Existen para que
 * empujar una caja tenga una consecuencia visible en otro sitio, que es lo que
 * convierte "mover un trasto" en un puzle.
 *
 * No detectan al jugador a proposito. Una placa que se activa pisandola convierte el
 * puzle en "quedate aqui", y entonces la caja sobra.
 *
 * ---- que hay y que NO hay aqui ----
 *
 * Aqui esta cuando se hunde una placa. Como se ve —la chapa, el anillo, el haz que
 * sube hacia el campo de energia— vive en `r_plate.js`. La union es un evento: esto
 * emite `EV.PLACA`, y el render decide que significa.
 *
 * Es la frontera de la spec 035, y no es cosmetica: sin ella este archivo importaria
 * Three.js y el nivel no se podria simular sin dibujarlo.
 */

import { EV, emitir } from './p_events.js';

export class Plates {
  /**
   * @param {Array} specs  del nivel: {x, y, w, layer, unlocks}
   */
  constructor(specs = []) {
    this.items = specs.map((spec) => ({ ...spec, pressed: false }));

    /**
     * Se conserva ademas del evento porque quien escucha esto no es el render, es el
     * JUEGO: la placa desbloquea un prop concreto (`unlocks`), y eso es una decision
     * de partida, no un efecto. El evento cuenta el hecho; el hook decide que abre.
     */
    this.onPress = null;
  }

  /**
   * @param {object} pushables  el sistema de empujables, para ver que hay encima
   */
  update(dt, pushables) {
    for (const it of this.items) {
      if (it.pressed) continue;
      if (!this._occupied(it, pushables)) continue;

      it.pressed = true;
      emitir(EV.PLACA, it.x, it.y, it.layer ?? 0, 1);
      this.onPress?.(it);
    }
  }

  /**
   * ¿Hay una caja apoyada dentro del encaje?
   *
   * Se pide que el centro caiga dentro de la placa Y que la base este a su altura.
   * Solo lo primero valdria con la caja pasando por encima en el aire, y entonces el
   * puzle se resolveria de un salto afortunado en vez de encajandola.
   */
  _occupied(it, pushables) {
    if (!pushables) return false;
    for (const caja of pushables.items) {
      if ((caja.layer ?? 0) !== (it.layer ?? 0)) continue;
      const cx = caja.box.x + caja.size / 2;
      if (Math.abs(cx - it.x) > it.w / 2) continue;
      if (Math.abs(caja.box.y - it.y) > 0.12) continue;
      return true;
    }
    return false;
  }
}
