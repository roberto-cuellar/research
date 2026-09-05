/**
 * Cajas empujables.
 *
 * El otro uso de los trastos del Proyector: estas NO se rompen, se mueven. Sirven
 * para tapar un hueco que de otro modo no se cruza, que es lo que las convierte en
 * un puzle corto en vez de en decoracion — hay que traerlas desde donde estan hasta
 * donde hacen falta.
 *
 * Se distinguen de las rompibles a la vista (metal, no madera) porque el jugador
 * tiene que saber cual va a ceder ANTES de saltarle encima.
 *
 * La fisica es deliberadamente simple: se desplazan en X mientras el jugador empuja
 * y caen si no tienen suelo. Nada de inercia ni de rotacion — una caja que rueda en
 * un platformer es una caja que acaba donde no debe.
 *
 * ---- que hay y que NO hay aqui ----
 *
 * Aqui esta el empuje, la caida y el contacto. El metal, el marco cian y las flechas
 * viven en `r_pushable.js`. Es lo que permite probar el empuje sin dibujarlo.
 */

import { SURFACE } from './w_contracts.js';

/**
 * Velocidad de empuje, en m/s.
 *
 * 1,4 contra los 3,2 de caminar: se nota el esfuerzo sin que mover una caja tres
 * metros se haga eterno.
 *
 * Y no es un numero libre. El clip `pushing` avanza 1,060 m en 2,67 s — medido en
 * Blender sobre su variante con root motion, es decir 0,40 m/s naturales. El
 * animador ajusta su cadencia dividiendo la velocidad real entre esa, asi que a 1,4
 * el clip corre a 3,5x y los pies caen donde tienen que caer. Subir esto sin tocar
 * el rango del estado en `animator.js` hace que el personaje patine.
 */
export const PUSH_SPEED = 1.4;
const GRAVITY = 22.0;
const FLOOR = -3.0;   // fondo del mundo: por debajo no se cae mas

/**
 * ALCANCE — del centro del personaje al punto mas adelantado de su MALLA, en metros.
 *
 * Es el numero que hacia falta y que no existia. La colision del jugador mide 0,55
 * de ancho, asi que la fisica lo frena con su centro a 0,275 de la cara de la caja
 * (mas 4 cm de holgura). Pero el personaje DIBUJADO no cabe en esa caja: los brazos
 * y el hocico salen mucho mas alla, y el modelo se metia dentro de la caja.
 *
 * No se arregla ensanchando la colision — eso le impediria pasar por huecos
 * estrechos y le haria flotar al borde de las plataformas. Se arregla separandolo
 * SOLO de las cajas: en contacto con una, se le mantiene a esta distancia.
 *
 * ---- de donde sale el numero ----
 *
 * MEDIDO, no deducido, y el primer intento a ojo (0,52) se quedo corto de 25 cm.
 * El bounding box de la malla no vale: es una malla con esqueleto y su caja de CPU
 * es la de reposo, no la de la pose — da 0,268 en cualquier estado. Hay que aplicar
 * el esqueleto vertice a vertice (`applyBoneTransform`) y quedarse con el maximo.
 *
 * Asi medido, mirando a la derecha:
 *
 *     idle 0,404 · run 0,457 · fall 0,537 · PUSH 0,764
 *
 * Empujar es de largo el que mas estira, y con razon: es la unica pose con los dos
 * brazos extendidos al frente. Todas las demas caben de sobra por debajo, asi que
 * basta un numero y no hace falta una tabla por estado.
 *
 * OJO al medir: el resultado depende de hacia donde MIRA el personaje. Midiendolo de
 * espaldas sale 0,825, que es su cola, no su alcance — me paso, y por poco meto una
 * tabla entera para arreglar un problema que no existia.
 *
 * 0,765 deja las yemas justo sobre la cara de la caja en el pico de extension. El
 * resto del ciclo abre unos centimetros porque las manos se mueven dentro del clip:
 * eso es la animacion, no una holgura.
 */
const REACH = 0.765;

export class Pushables {
  /**
   * @param {Array} specs  del nivel: {x, y, size, layer}
   * @param {object} world  para consultar el suelo bajo cada caja
   */
  constructor(specs = [], world) {
    this.world = world;
    this.items = specs.map((spec) => {
      const size = spec.size ?? 1.0;
      const item = {
        ...spec, size, vy: 0,
        box: { x: spec.x - size / 2, y: spec.y, w: size, h: size,
               surface: SURFACE.METAL, layer: spec.layer ?? 0 },
      };
      this._place(item, spec.x, spec.y);
      return item;
    });
  }

  _place(item, x, y) {
    item.box.x = x - item.size / 2;
    item.box.y = y;
  }

  get solids() { return this.items.map((it) => it.box); }

  /**
   * @param {object} player  {position, layer, velocity, grounded, width}
   * @returns {object|null} la caja que se esta empujando, o null
   */
  update(dt, player, input) {
    let pushing = null;
    this.nearby = null;      // la caja que se tiene al lado, se empuje o no
    this.blocked = null;     // se empuja pero no cede

    for (const it of this.items) {
      // --- caida ---
      // El suelo se consulta EXCLUYENDO la propia caja, o se apoyaria en si misma.
      const ground = this._groundUnder(it);
      const bottom = it.box.y;
      if (bottom > ground + 0.001) {
        it.vy -= GRAVITY * dt;
        const next = bottom + it.vy * dt;
        this._place(it, it.box.x + it.size / 2, Math.max(ground, next));
        if (next <= ground) it.vy = 0;
      } else {
        it.vy = 0;
      }

      if ((it.layer ?? 0) !== player.layer) continue;

      // --- empuje ---
      // Hay que estar a su altura, pegado al lado correcto y andando contra ella.
      const cx = it.box.x + it.size / 2;
      const dx = cx - player.position.x;
      const alturaOk = Math.abs(it.box.y - player.position.y) < it.size * 0.8;
      const dir = Math.sign(dx);
      // El contacto se mide al ALCANCE del brazo, no al borde de la caja de
      // colision: es donde estan las manos, y por tanto donde empieza a tener
      // sentido que empuje.
      const separacion = it.size * 0.5 + REACH;
      const contacto = Math.abs(dx) < separacion + 0.04;

      if (!alturaOk || !contacto || !player.grounded) continue;

      // ---- que no se metan el uno en el otro ----
      //
      // La fisica frena al jugador con su caja, que es mas estrecha que su dibujo.
      // Aqui se le retiene los ultimos centimetros para que el modelo no entre en la
      // caja. Va antes de comprobar si empuja porque tambien pasa quieto: apoyarse
      // contra una caja sin moverla incrustaba igual.
      //
      // Solo en horizontal y solo a esta altura: encima de la caja no se toca nada,
      // o saltarle encima se sentiria pegajoso.
      if (dir !== 0 && Math.abs(dx) < separacion) {
        player.body.x = cx - dir * separacion - player.width * 0.5;
        if (Math.sign(player.velocity.x) === dir) player.velocity.x = 0;
      }
      // Se recuerda aunque no se este empujando: es lo que dispara el aviso de
      // "camina contra ella", que hace falta porque empujar no tiene tecla propia.
      this.nearby = it;
      if (Math.sign(input.axisX) !== dir || input.axisX === 0) continue;

      // Se mueve solo si el sitio de destino esta libre. Si NO lo esta, el jugador
      // sigue empujando pero la caja no cede: eso es `bloqueada`, y tiene su propia
      // animacion — apoyarse sin avanzar en vez de caminar contra una pared.
      const step = dir * PUSH_SPEED * dt;
      const probe = { ...it.box, x: it.box.x + step };
      // El jugador cuenta como estorbo. Sin esto la caja puede desplazarse ENCIMA de
      // el —empujando desde el lado contrario, o alcanzandole si va mas lento— y el
      // modelo se queda incrustado dentro hasta que la fisica lo expulsa al frame
      // siguiente. Que la caja no invada es mas barato que resolverlo despues.
      const cuerpo = { x: player.position.x - player.width / 2, y: player.position.y,
                       w: player.width, h: player.height };
      const pisaJugador = probe.x < cuerpo.x + cuerpo.w && probe.x + probe.w > cuerpo.x
                       && probe.y < cuerpo.y + cuerpo.h && probe.y + probe.h > cuerpo.y;
      if (pisaJugador || this._blocked(probe, it)) { this.blocked = it; continue; }

      this._place(it, cx + step, it.box.y);
      pushing = it;
    }

    return pushing;
  }

  _groundUnder(it) {
    // Suelo del mundo como red de seguridad: una caja empujada a un hueco sin fondo
    // tiene que quedarse ahi abajo, no caer para siempre consumiendo fisica.
    let best = FLOOR;
    const solids = this.world.solids.filter((s) => s !== it.box);
    for (const s of solids) {
      if (s.layer !== undefined && s.layer !== (it.layer ?? 0)) continue;
      const cx = it.box.x + it.size / 2;
      if (cx < s.x || cx > s.x + s.w) continue;
      const top = s.y + s.h;
      if (top <= it.box.y + 0.05 && top > best) best = top;
    }
    return best;
  }

  _blocked(probe, self) {
    for (const s of this.world.solids) {
      if (s === self.box) continue;
      if (s.layer !== undefined && s.layer !== (self.layer ?? 0)) continue;
      if (probe.x < s.x + s.w && probe.x + probe.w > s.x &&
          probe.y < s.y + s.h && probe.y + probe.h > s.y) return true;
    }
    return false;
  }
}
