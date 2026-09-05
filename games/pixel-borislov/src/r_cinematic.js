/**
 * Cinematicas: linea de tiempo de disparadores.
 *
 * Una cinematica no es "bloquear el control y soltar una frase". Es una pista de
 * eventos cuantizada a la musica: en el compas N, este actor hace esta animacion,
 * la camara va aqui, y salta este efecto. Eso es lo que da continuidad.
 *
 * Todos los tiempos van en SEGUNDOS desde el inicio del momento, y la cinematica
 * dura un numero entero de compases: la musica no se detiene nunca, asi que todo
 * tiene que caer en la rejilla (plan §19.4).
 *
 * Tipos de evento:
 *   { at, actor, anim }              fuerza una animacion en un actor
 *   { at, actor, move:{toX,seconds} } desplazamiento guiado
 *   { at, actor, face }              hacia donde mira (-1 / 1)
 *   { at, camera:{x,y,z,seconds} }   toma de camara, interpolada
 *   { at, fx }                       efecto con nombre (lo resuelve el juego)
 *   { at, say }                      linea de dialogo
 */

import * as THREE from 'three';
import { clone as cloneSkinned } from '../vendor/utils/SkeletonUtils.js';
import { Animator } from './r_animator.js';

/** Un actor secundario: malla clonada del GLB base con su propio mixer. */
export class Actor {
  constructor(sourceGltf, options = {}) {
    // clone() de SkeletonUtils es imprescindible: el clone normal de three.js
    // comparte el esqueleto y los dos personajes se moverian a la vez.
    this.root = cloneSkinned(sourceGltf.scene);
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });

    this.root.scale.setScalar(options.scale ?? 1);
    this.root.position.set(options.x ?? 0, options.y ?? 0, options.z ?? 0);
    this.root.rotation.y = (options.face ?? 1) > 0 ? Math.PI / 2 : -Math.PI / 2;

    this.animator = new Animator(this.root, sourceGltf.animations);
    this.name = options.name || 'actor';
    this._move = null;
  }

  /** Reproduce un clip por nombre, saltandose la maquina de estados. */
  play(clipName, loop = true) {
    const clip = this.animator.clips.get(clipName);
    if (!clip) return false;
    const action = this.animator._action(clipName);
    if (!action) return false;

    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = !loop;
    action.enabled = true;
    action.setEffectiveWeight(1);
    action.timeScale = 1;
    action.play();

    if (this.animator.current && this.animator.current !== action) {
      this.animator.current.crossFadeTo(action, 0.25, false);
    }
    this.animator.current = action;
    this.animator.currentName = clipName;
    return true;
  }

  moveTo(toX, seconds) {
    this._move = { fromX: this.root.position.x, toX, seconds, t: 0 };
  }

  face(direction) {
    this.root.rotation.y = direction > 0 ? Math.PI / 2 : -Math.PI / 2;
  }

  update(dt) {
    if (this._move) {
      this._move.t = Math.min(this._move.seconds, this._move.t + dt);
      const k = this._move.t / this._move.seconds;
      // Suavizado en los extremos: un actor no arranca ni frena de golpe.
      const eased = k * k * (3 - 2 * k);
      this.root.position.x = this._move.fromX + (this._move.toX - this._move.fromX) * eased;
      if (this._move.t >= this._move.seconds) this._move = null;
    }
    this.animator.update(dt);
  }

  dispose() {
    this.root.parent?.remove(this.root);
  }
}

export class CinematicPlayer {
  /**
   * @param {object} handlers  { getActor(name), setCamera(shot), fx(name), say(id) }
   */
  constructor(handlers) {
    this.handlers = handlers;
    this.spec = null;
    this.startedAt = 0;
    this.fired = new Set();
    this.active = false;
  }

  start(spec, position) {
    this.spec = spec;
    this.startedAt = position;
    this.fired.clear();
    this.active = true;
  }

  stop() {
    this.active = false;
    this.spec = null;
  }

  /** @param {number} position  posicion actual de la musica, en segundos */
  update(position) {
    if (!this.active || !this.spec) return;
    const elapsed = position - this.startedAt;

    for (let i = 0; i < (this.spec.track || []).length; i += 1) {
      if (this.fired.has(i)) continue;
      const event = this.spec.track[i];
      if (elapsed + 0.02 < event.at) continue;
      this.fired.add(i);
      this._fire(event);
    }
  }

  _fire(event) {
    const h = this.handlers;

    if (event.actor) {
      const actor = h.getActor(event.actor);
      if (actor) {
        if (event.face !== undefined) actor.face(event.face);
        if (event.anim) actor.play(event.anim, event.loop !== false);
        if (event.move) actor.moveTo(event.move.toX, event.move.seconds);
      }
    }

    if (event.camera && h.setCamera) h.setCamera(event.camera);
    if (event.fx && h.fx) h.fx(event.fx);
    if (event.say && h.say) h.say(event.say);
  }
}
