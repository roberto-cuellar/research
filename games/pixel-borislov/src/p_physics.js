/**
 * Colision de plataformas: AABB con barrido contra solidos estaticos.
 *
 * Sin librería de fisicas a proposito (ver plan §3): un platformer 2.5D no necesita
 * cuerpos rigidos, y una implementacion propia es determinista, pesa cero en el bundle
 * y no arrastra dependencias.
 *
 * La resolucion es por ejes separados (X y luego Y), que es el metodo estandar y el
 * unico que se comporta bien al caminar sobre suelos contiguos: resolver en diagonal
 * hace que el jugador tropiece con las juntas entre plataformas.
 */

/** Rectangulo alineado a ejes. x/y es la esquina inferior izquierda. */
export function aabb(x, y, w, h) {
  return { x, y, w, h };
}

export function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
         a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * Superficie sobre la que se apoya el jugador, con su material para el feedback.
 *
 * Vive en `w_contracts.js` desde la spec 035: es vocabulario con el que se declara
 * un nivel, no parte de como se resuelve una colision. Se reexporta aqui porque
 * media docena de modulos la importan de este archivo desde el principio.
 */
export { SURFACE } from './w_contracts.js';
import { SURFACE } from './w_contracts.js';

export class CollisionWorld {
  /**
   * @param {Array<{x,y,w,h,surface?,layer?}>} solids
   */
  constructor(solids = []) {
    this.solids = solids;
  }

  /** Solo colisionan los solidos de la capa en la que esta el jugador. */
  solidsForLayer(layer) {
    return this.solids.filter((s) => s.layer === undefined || s.layer === layer);
  }

  /**
   * Mueve un cuerpo aplicando su velocidad y resolviendo colisiones.
   *
   * @param {{x,y,w,h}} body  se modifica in situ
   * @param {{x,y}} velocity  m/s, se modifica in situ al chocar
   * @param {number} dt
   * @param {number} layer
   * @returns {{grounded:boolean, ceiling:boolean, wall:number, surface:string|null}}
   */
  /**
   * @param {object} options  maxStep: altura maxima que se sube sola sin saltar
   */
  move(body, velocity, dt, layer = 0, options = {}) {
    const solids = this.solidsForLayer(layer);
    const maxStep = options.maxStep ?? 0;
    const result = { grounded: false, ceiling: false, wall: 0, surface: null, stepped: false };

    // --- eje X ---
    body.x += velocity.x * dt;

    let blocker = null;
    for (const solid of solids) {
      if (overlaps(body, solid)) { blocker = solid; break; }
    }

    // Asistencia de escalon: sin esto, un bordillo de 40 cm es un muro infranqueable
    // y el personaje se siente torpe. Solo se sube si de verdad cabe arriba.
    if (blocker && maxStep > 0 && velocity.y <= 0.01) {
      const top = blocker.y + blocker.h;
      const rise = top - body.y;
      if (rise > 0 && rise <= maxStep) {
        const probe = { x: body.x, y: top + 0.001, w: body.w, h: body.h };
        if (!solids.some((s) => overlaps(probe, s))) {
          body.y = top + 0.001;
          result.stepped = true;
          blocker = null;
        }
      }
    }

    if (blocker) {
      if (velocity.x > 0) {
        body.x = blocker.x - body.w;
        result.wall = 1;
      } else if (velocity.x < 0) {
        body.x = blocker.x + blocker.w;
        result.wall = -1;
      }
      velocity.x = 0;
      // Puede haber mas de un solido solapando tras corregir: se repasa.
      for (const solid of solids) {
        if (!overlaps(body, solid)) continue;
        if (result.wall > 0) body.x = Math.min(body.x, solid.x - body.w);
        else if (result.wall < 0) body.x = Math.max(body.x, solid.x + solid.w);
      }
    }

    // --- eje Y ---
    body.y += velocity.y * dt;
    for (const solid of solids) {
      if (!overlaps(body, solid)) continue;
      if (velocity.y < 0) {
        body.y = solid.y + solid.h;
        result.grounded = true;
        result.surface = solid.surface || SURFACE.TIERRA;
      } else if (velocity.y > 0) {
        body.y = solid.y - body.h;
        result.ceiling = true;
      }
      velocity.y = 0;
    }

    return result;
  }

  /**
   * Sonda de suelo: mira un poco por debajo sin mover nada.
   * Hace falta porque tras resolver Y la velocidad ya es 0 y no se puede deducir
   * si seguimos apoyados o acabamos de salir de la cornisa.
   */
  /**
   * Altura del techo solido mas alto bajo una x. Lo usa el dron para volar POR
   * ENCIMA del terreno en vez de atravesarlo.
   *
   * No es una consulta de colision: es una sonda vertical barata que no necesita
   * cuerpo ni barrido, porque al dron no le hace falta resolver contactos.
   *
   * OJO con `fallback`: es lo que se devuelve cuando NO hay nada bajo esa x, no un
   * minimo. Antes se inicializaba el maximo con el, y entonces pasarle un valor alto
   * lo imponia sobre el suelo real — asi las banderas acababan a la altura de
   * reaparicion del checkpoint en vez de sobre el terreno.
   *
   * @returns {number} altura del suelo, o `fallback` si no hay nada bajo esa x
   */
  groundHeightAt(x, layer = 0, fallback = -2) {
    let best = null;
    for (const s of this.solidsForLayer(layer)) {
      if (x < s.x || x > s.x + s.w) continue;
      const top = s.y + s.h;
      if (best === null || top > best) best = top;
    }
    return best === null ? fallback : best;
  }

  isGrounded(body, layer = 0, probe = 0.04) {
    const feet = { x: body.x, y: body.y - probe, w: body.w, h: probe };
    for (const solid of this.solidsForLayer(layer)) {
      if (overlaps(feet, solid)) return solid.surface || SURFACE.TIERRA;
    }
    return null;
  }

  /** Devuelve -1 / 1 si hay pared pegada a ese lado, 0 si no. */
  wallSide(body, layer = 0, probe = 0.05) {
    const left = { x: body.x - probe, y: body.y + 0.1, w: probe, h: body.h - 0.2 };
    const right = { x: body.x + body.w, y: body.y + 0.1, w: probe, h: body.h - 0.2 };
    for (const solid of this.solidsForLayer(layer)) {
      if (overlaps(left, solid)) return -1;
      if (overlaps(right, solid)) return 1;
    }
    return 0;
  }
}
