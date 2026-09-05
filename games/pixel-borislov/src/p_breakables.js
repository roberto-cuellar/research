/**
 * Objetos rompibles — la logica.
 *
 * Existen para que el camino tenga algo que HACER entre salto y salto. Un tramo de
 * carrera limpia es correcto pero muerto; una caja que revienta al pisarla convierte
 * el mismo tramo en una decision — la rodeo o la rompo.
 *
 * Coherentes con el tono del cuento (GDD §10.3, "nada se destruye: se repara"): no
 * son enemigos ni obstaculos hostiles, son trastos del Proyector que se deshacen en
 * chispas y devuelven lo que llevaban dentro. Romper aqui no es violencia, es abrir.
 *
 * Tres formas de romperlos, y las tres son verbos que el jugador ya tiene:
 *   - caer encima          (el mas directo)
 *   - lanzarle una Chispa  (a distancia, si tiene los guantes)
 *   - el pisoton del robot (los rompe de paso, y eso los hace parte del climax)
 *
 * ---- que hay y que NO hay aqui ----
 *
 * Aqui esta cuanto aguanta cada uno y cuando cede. La caja de madera, el humo y la
 * sacudida viven en `r_breakables.js`. Por eso este archivo no importa Three, y por
 * eso `hit()` mide contra `box` y no contra la posicion de una malla: el playsim no
 * puede depender de que exista algo dibujado.
 */

import { SURFACE } from './w_contracts.js';
import { EV, emitir } from './p_events.js';

/** Tipos de rompible. `drops` es lo que suelta al abrirse. */
export const KINDS = {
  caja: {
    color: 0x8a5a32, size: [0.9, 0.9, 0.9],
    solid: true,          // se puede pisar hasta que se rompe
    hp: 1,
    drops: 'chispa',
    shards: 14,
  },
  barril: {
    color: 0x5d6c8a, size: [0.8, 1.1, 0.8],
    solid: true,
    hp: 2,                // aguanta dos golpes: el segundo se siente ganado
    drops: 'chispa',
    shards: 18,
  },
  maceta: {
    color: 0x9c4a3a, size: [0.7, 0.6, 0.7],
    solid: false,         // decorativa: se atraviesa y se rompe al rozarla
    hp: 1,
    drops: null,
    shards: 10,
  },
};

/** Codigos de `mag` en `EV.ROTURA`, para que el render sepa que humo sacar. */
export const KIND_ID = { caja: 1, barril: 2, maceta: 3 };

export class Breakables {
  /**
   * @param {Array} specs  del nivel: {x, y, kind, layer}
   * @param {object} hooks  {onDrop(x, y, capa, que)} — lo que SUELTA es cosa de la
   *   partida, no del render: crea una chispa que se puede recoger.
   */
  constructor(specs = [], hooks = {}) {
    this.hooks = hooks;
    this.items = specs.map((spec) => {
      const kind = KINDS[spec.kind] || KINDS.caja;
      const [w, h, d] = kind.size;
      return {
        ...spec, kind, w, h, d,
        hp: kind.hp, broken: false, shake: 0,
        // Centro geometrico. Antes se leia de `mesh.position`, que ataba la logica a
        // que existiera una malla.
        cx: spec.x, cy: spec.y + h / 2,
        // Caja de colision en el mismo formato que los solidos del nivel, para que
        // la fisica no tenga que saber que esto es especial.
        box: { x: spec.x - w / 2, y: spec.y, w, h, surface: SURFACE.MADERA,
               layer: spec.layer ?? 0 },
      };
    });
  }

  /** Los que aun estan enteros y son solidos: se inyectan en el mundo de colision. */
  get solids() {
    return this.items
      .filter((it) => !it.broken && it.kind.solid)
      .map((it) => it.box);
  }

  /**
   * Golpea lo que haya en ese punto.
   *
   * @param {number} power golpes que descuenta — un pisoton del robot vale por dos
   * @returns {boolean} true si algo se rompio
   */
  hit(x, y, radius = 0.7, power = 1, layer = 0) {
    let any = false;
    for (const it of this.items) {
      if (it.broken || (it.layer ?? 0) !== layer) continue;
      if (Math.abs(it.cx - x) > it.w / 2 + radius) continue;
      if (Math.abs(it.cy - y) > it.h / 2 + radius) continue;

      it.hp -= power;
      if (it.hp > 0) {
        // Aviso de que va. Sin esto, un barril de dos golpes parece que ignora el
        // primero. Aqui solo se arma el temporizador; sacudirlo y oscurecerlo es
        // cosa del render, que lo lee.
        it.shake = 0.22;
        continue;
      }
      this._break(it);
      any = true;
    }
    return any;
  }

  _break(it) {
    it.broken = true;
    emitir(EV.ROTURA, it.cx, it.cy, it.layer ?? 0, KIND_ID[it.kind === KINDS.caja ? 'caja'
      : it.kind === KINDS.barril ? 'barril' : 'maceta'] ?? 1);
    if (it.kind.drops) this.hooks.onDrop?.(it.cx, it.cy, it.layer ?? 0, it.kind.drops);
  }

  update(dt) {
    for (const it of this.items) {
      if (it.broken || !it.shake) continue;
      it.shake = Math.max(0, it.shake - dt);
    }
  }

  get remaining() { return this.items.filter((it) => !it.broken).length; }
}
