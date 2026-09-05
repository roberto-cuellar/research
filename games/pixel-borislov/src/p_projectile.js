/**
 * Proyectiles — la logica.
 *
 * El robot NO es un enemigo: es una maquina de limpieza a la que se le cayeron los
 * tornillos y ha perdido el control. Por eso lo que dispara es su propio chorro de
 * agua, descontrolado — no un arma. Mojarse cuesta tiempo, nunca vida, igual que
 * todo lo demas en este juego (GDD §25.7).
 *
 * Existe para tapar un agujero de diseno: sin disparo, el jugador podia quedarse
 * fuera del alcance del manotazo y esperar. Ahora quedarse lejos tambien tiene
 * respuesta, y el climax obliga a moverse.
 *
 * ---- que hay y que NO hay aqui ----
 *
 * Aqui esta la parabola, la colision y cuando revienta. La esfera, el halo y la luz
 * viven en `r_projectile.js`. Los tiros son datos —posicion, velocidad, vida— y el
 * render los lee.
 *
 * Pool fijo, cero asignaciones en runtime. La regla no es negociable (constitucion
 * › PRESUPUESTO): asignar en el bucle se paga en recoleccion de basura y se ve como
 * tirones.
 */

import { EV, emitir } from './p_events.js';

const MAX_SHOTS = 4;

export class Projectiles {
  /**
   * @param {object} [options]
   * @param {number} [options.radius] radio de impacto contra el jugador
   * @param {number} [options.gravity] por pool: el chorro del robot pesa y cae
   *   recto; la Chispa del jugador va mas lenta y con mas arco, porque tiene que
   *   LEERSE en el aire para poder apuntar con ella
   */
  constructor(options = {}) {
    this.radius = options.radius ?? 0.9;
    this.gravity = options.gravity ?? 9.0;
    this.targets = null;

    // Todo reservado de una vez. `shots` no crece nunca.
    this.shots = Array.from({ length: MAX_SHOTS }, () => ({
      alive: false, x: 0, y: 0, layer: 0,
      vx: 0, vy: 0, life: 0,
      prevX: 0, prevY: 0,      // lo lee el render para la estela por distancia
    }));
    this.cursor = 0;
  }

  /**
   * Lanza un chorro con la parabola que pasa por el objetivo.
   *
   * Se resuelve el tiro parabolico en vez de apuntar en linea recta: asi el arco es
   * legible y el jugador puede leer donde va a caer y apartarse. Un disparo directo
   * seria injusto en un juego cuya regla es que nada mata.
   *
   * @param {number} time segundos de vuelo hasta el objetivo — cuanto mas alto, mas
   *   telegrafiado y mas facil de esquivar
   */
  fire(x, y, targetX, targetY, layer = 0, time = 1.1) {
    const shot = this.shots[this.cursor];
    this.cursor = (this.cursor + 1) % MAX_SHOTS;

    shot.alive = true;
    shot.life = time + 0.6;          // margen para que caiga aunque falle
    shot.layer = layer;
    shot.x = shot.prevX = x;
    shot.y = shot.prevY = y;

    // v = (destino - origen) / t, compensando la caida: vy += g*t/2
    shot.vx = (targetX - x) / time;
    shot.vy = (targetY - y) / time + (this.gravity * time) / 2;
    return shot;
  }

  /**
   * Blancos ademas del jugador: el dron, el robot, lo que sea.
   *
   * Sin esto un proyectil solo podia chocar contra el suelo o contra el jugador, asi
   * que la Chispa lanzada al dron le pasaba limpiamente a traves y seguia hasta el
   * suelo — ni impacto, ni aturdimiento, ni explosion.
   *
   * @param {Array<{x:number,y:number,radius:number,layer?:number,onHit?:Function}>} list
   */
  setTargets(list) { this.targets = list || null; }

  /**
   * @param {(x:number, y:number, capa:number, hitPlayer:boolean) => void} [onImpact]
   *   se llama en el punto exacto donde revienta el chorro. Ademas se emite
   *   `EV.IMPACTO`, que es lo que el render convierte en onda y sonido.
   */
  update(dt, playerX, playerY, playerLayer, groundYAt, onImpact) {
    for (const shot of this.shots) {
      if (!shot.alive) continue;

      shot.prevX = shot.x;
      shot.prevY = shot.y;

      shot.vy -= this.gravity * dt;
      shot.x += shot.vx * dt;
      shot.y += shot.vy * dt;
      shot.life -= dt;

      const sameLayer = shot.layer === playerLayer;
      const hitPlayer = sameLayer
        && Math.hypot(shot.x - playerX, shot.y - (playerY + 0.8)) < this.radius;
      const ground = groundYAt ? groundYAt(shot.x, shot.layer) : 0;
      const hitGround = shot.y <= ground + 0.1;

      // Blancos del mundo. Se comprueba ANTES que el suelo: si no, un proyectil que
      // roza un blanco justo al aterrizar contaria como impacto contra el suelo.
      let hitTarget = null;
      if (this.targets) {
        for (const t of this.targets) {
          if (t.layer !== undefined && t.layer !== shot.layer) continue;
          if (Math.hypot(shot.x - t.x, shot.y - t.y) < (t.radius ?? 1.2)) { hitTarget = t; break; }
        }
      }

      if (!hitTarget && !hitPlayer && !hitGround && shot.life > 0) continue;

      if (hitTarget) hitTarget.onHit?.(shot.x, shot.y, shot.layer);
      shot.alive = false;
      // El impacto se reporta en el suelo si choco contra el, no en el aire: asi la
      // onda expansiva sale de donde se ve reventar el chorro.
      const iy = hitGround ? ground : shot.y;
      emitir(EV.IMPACTO, shot.x, iy, shot.layer, hitPlayer ? 1 : 0);
      onImpact?.(shot.x, iy, shot.layer, hitPlayer);
    }
  }

  /** Retira todos los chorros en vuelo (al reparar el robot, o al reaparecer). */
  clear() {
    for (const shot of this.shots) shot.alive = false;
  }

  get activeCount() {
    let n = 0;
    for (const s of this.shots) if (s.alive) n += 1;
    return n;
  }
}
