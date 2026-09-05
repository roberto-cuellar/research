/**
 * Maquina de estados de animacion: estado del jugador -> clip, con crossfade.
 *
 * Ajuste de cadencia: los clips de Mixamo tienen su propia velocidad natural, medida
 * de las variantes __rootmotion (ver rig/clips.json). Si el personaje se mueve a 6 m/s
 * y el clip de correr avanza a 2,58 m/s, los pies patinan. Se corrige escalando el
 * tiempo del clip, con tope para que no se vuelva una caricatura.
 */

import * as THREE from 'three';
import { STATE, TUNING } from './p_player.js';

/**
 * Velocidad maxima que el personaje puede alcanzar EN TODA LA PARTIDA.
 *
 * Dos fuentes, y hay que cubrir la mayor:
 *
 *   el Motor de Idea multiplica la carrera por 1,25 (`r_equip.js` › PROPS.motor)
 *   un tramo con `runner` fija su propia velocidad, con techo `TUNING.runnerMaxSpeed`
 *
 * Si mañana aparece otra mejora de velocidad, entra aqui: es el unico numero del que
 * dependen las cadencias, y separarlo de la velocidad real es como se llego a que el
 * personaje corriera a 6 m/s con el clip reproduciendose al equivalente de 4,4.
 */
export const MAX_RUN_SPEED = Math.max(TUNING.runSpeed * 1.25, TUNING.runnerMaxSpeed);   // 8,0 m/s

/**
 * Rango de cadencia que necesita un clip para cubrir un tramo de velocidades.
 *
 * Se DERIVA, no se escribe a mano, y esa es toda la gracia: el error que arregla es
 * el de tener el tope de cadencia y la velocidad del personaje en dos sitios
 * distintos, que es como se llego a que el personaje corriera a 6 m/s con el clip
 * reproduciendose al equivalente de 4,4.
 */
const cadencia = (clip, vMin, vMax) => [vMin / CLIP_SPEED[clip], vMax / CLIP_SPEED[clip]];

/** Velocidad natural de cada clip, en m/s, medida de su variante __rootmotion. */
export const CLIP_SPEED = {
  walking: 0.61,
  running: 2.58,
  running_soft: 2.35,
  sneak_walk: 0.45,
  orc_walk: 0.70,
  // Medido en Blender sobre `pushing__rootmotion`: 1,060 m en 2,67 s.
  // El clip esta autorado para un empuje MUY lento, asi que sin ajustar la cadencia
  // el personaje mueve los pies a un sexto de lo que se desplaza y patina.
  pushing: 0.40,
};

export const STATE_CLIPS = {
  [STATE.IDLE]:        { clip: 'happy_idle',         loop: true,  fade: 0.22 },
  /**
   * CAMINAR Y CORRER — la cadencia se deriva de la velocidad REAL.
   *
   * Aqui habia un patinaje grande y estaba en el techo compartido `speedScaleRange`,
   * que vale `[0,7 – 1,7]`. Las cuentas, con las velocidades reales del juego:
   *
   *   correr a 6,0 m/s con un clip de 2,58   ->  necesita 2,33  ->  se daba 1,70
   *   correr a 7,5 con el Motor de Idea      ->  necesita 2,91  ->  se daba 1,70
   *   correr a 6,3 en el runner              ->  necesita 2,44  ->  se daba 1,70
   *
   * O sea que a partir de 4,4 m/s los pies dejaban de seguir al suelo, y **cualquier
   * mejora de velocidad no cambiaba la animacion en absoluto**: el personaje se movia
   * mas rapido con la misma zancada. Es exactamente lo que se ve como antinatural, y
   * es peor cuanto mejor equipado va el jugador — justo al reves de lo que interesa.
   *
   * Los rangos se derivan de `TUNING` y del bonus del motor, asi que ya no pueden
   * separarse de la velocidad que producen.
   */
  [STATE.WALK]:        { clip: 'walking',            loop: true,  fade: 0.18, matchSpeed: true,
                         /**
                          * Andar cubre de 0,4 al umbral de carrera (3,68 m/s), y el
                          * clip esta autorado a 0,61: cubrirlo entero pediria 6,0x y
                          * a esa cadencia el paseo se ve a trompicones. Se topa en
                          * 3,4x — el clip cubre limpio hasta ~2,1 m/s y por encima
                          * queda algo de patinaje, que dura lo que la rampa de
                          * carrera: 0,40 s. Cerrar ese hueco del todo pide MEZCLAR
                          * andar y correr por velocidad, no escalar uno solo (TDB-040).
                          */
                         speedRange: [cadencia('walking', 0.4, 1)[0], 3.4] },
  [STATE.RUN]:         { clip: 'running',            loop: true,  fade: 0.16, matchSpeed: true,
                         // Correr cubre del umbral hasta el techo CON motor.
                         speedRange: cadencia('running', TUNING.walkSpeed * 1.15, MAX_RUN_SPEED) },
  // Los estados aereos NO bloquean: los manda la fisica. Si el clip de salto retiene
  // el estado, al aterrizar el personaje se queda pegado al suelo esperandolo.
  [STATE.JUMP]:        { clip: 'jumping',            loop: false, fade: 0.08, noHold: true },
  // Volteo real de captura. Antes se giraba la malla entera sobre su eje, que se ve
  // rigido y postizo: un cuerpo que da una vuelta no gira como una tabla.
  // `speed` lo comprime para que la vuelta quepa en el tiempo de vuelo (~0,65 s).
  [STATE.DOUBLE_JUMP]: { clip: 'running_forward_flip', loop: false, fade: 0.10, speed: 1.7 },
  [STATE.FALL]:        { clip: 'jumping_up_on_air',  loop: true,  fade: 0.14 },
  // Tres aterrizajes distintos, y la diferencia es de RITMO, no de clip:
  //   LAND  -> toque breve, no retiene: sigues corriendo sin notarlo.
  //   ROLL  -> rueda y sale rodando, acelerado para enlazar con la carrera.
  //   HARD  -> el unico que se toma su tiempo: te levantas despacio. Es el castigo.
  [STATE.LAND]:        { clip: 'hard_landing',       loop: false, fade: 0.10, speed: 2.6, noHold: true },
  [STATE.ROLL]:        { clip: 'falling_to_roll',    loop: false, fade: 0.08, speed: 1.55 },
  [STATE.HARD_LANDING]:{ clip: 'hard_landing',       loop: false, fade: 0.05, speed: 1.0 },
  // OJO: `wall_run` es correr A LO LARGO de una pared, no agarrarse a ella: de perfil
  // se ve al personaje corriendo en el aire. `climbing_ladder` a velocidad lenta lee
  // como agarre, que es lo que el estado significa de verdad.
  [STATE.WALL_SLIDE]:  { clip: 'climbing_ladder',    loop: true,  fade: 0.14, speed: 0.4 },
  // Reparar: el gesto de apretar los tornillos. En bucle porque hay que mantenerlo
  // un compas completo, y el jugador debe VER que esta haciendo algo todo ese rato.
  [STATE.REPAIR]:      { clip: 'magic_heal',         loop: true,  fade: 0.12, speed: 1.0, noHold: true },
  // Recibir el manotazo del robot. No mata: empuja.
  [STATE.STUMBLE]:     { clip: 'stumble_backwards',  loop: false, fade: 0.06, speed: 1.2 },
  // Romper el suelo. Acelerado a 1,4 porque el gesto tiene que sentirse decidido: el
  // clip natural dura casi dos segundos y a esa velocidad parece que lo esta pensando.
  // El bloqueo lo pone el juego (`holdState`), no el clip, para poder meter el
  // hitstop exactamente en el frame del impacto.
  [STATE.STOMP]:       { clip: 'stomp',              loop: false, fade: 0.06, speed: 1.4 },
  // Lanzar. `noHold` porque el bloqueo lo pone el juego con su propio tiempo de
  // recarga: retener el clip entero (1,5 s) haria el lanzamiento inutilizable.
  // Dos lanzamientos, dos clips. `throw` es a una mano y va acelerado para que el
  // gesto rapido se sienta rapido; `throw_in` es a dos manos y se deja casi a
  // velocidad natural, porque su lentitud ES lo que lo diferencia.
  [STATE.THROW]:       { clip: 'throw',              loop: false, fade: 0.05, speed: 2.2, noHold: true },
  [STATE.THROW_HEAVY]: { clip: 'throw_in',           loop: false, fade: 0.06, speed: 1.5, noHold: true },
  /**
   * Abrir un portal. NO es un hechizo: en el canon del cuento estos clips son los
   * gestos de manejar el Proyector de Ideas, la maquina que construyo Bradislav.
   *
   * `speed` 2.0 y no 1.25. El clip dura 3,567 s naturales, asi que a 1,25 el gesto
   * duraba **2,85 s** — y de esos, 2,57 con el control bloqueado. Casi tres segundos
   * quieto por pulsar una tecla, tres veces por partida. A 2,0 el gesto dura 1,78 s y
   * se lee como una orden dada al aparato, que es lo que es; a 1,25 se leia como que
   * el personaje lo estaba pensando.
   */
  [STATE.CAST]:        { clip: 'wide_arm_spell_casting', loop: false, fade: 0.08, speed: 2.0, noHold: true },
  // Empujar, en dos estados.
  //
  //   `pushing`    el personaje AVANZA con la caja. Su cadencia se DERIVA de la
  //                velocidad de empuje: cambiarla en un sitio y no en el otro hace
  //                que los pies patinen, asi que no hay dos numeros que cuadrar.
  //   `push_stop`  apoyado y sin avanzar: cuando la caja topa con algo. Es lo que
  //                evita que siga andando contra una pared.
  // `matchSpeed`, igual que caminar y correr: la cadencia del clip la fija la
  // velocidad REAL del personaje contra la velocidad natural del clip. Es el unico
  // modo de que las dos magnitudes no puedan separarse — antes habia una constante
  // aparte y bastaba tocar una para que los pies patinaran.
  [STATE.PUSH]:        { clip: 'pushing',            loop: true,  fade: 0.14,
                         matchSpeed: true, speedRange: [1.0, 4.0] },
  [STATE.PUSH_STOP]:   { clip: 'push_stop',          loop: true,  fade: 0.12, speed: 0.8 },
  // Cierre del nivel: primero saluda a los amigos, luego se arranca a bailar.
  [STATE.WAVE]:        { clip: 'waving',             loop: false, fade: 0.14, speed: 1.0 },
  [STATE.CELEBRATE]:   { clip: 'breakdance_ending_2',loop: false, fade: 0.16, speed: 1.0 },
};

export class Animator {
  constructor(root, clips, options = {}) {
    this.mixer = new THREE.AnimationMixer(root);
    this.clips = new Map(clips.map((c) => [c.name, c]));
    this.actions = new Map();
    this.current = null;
    this.currentName = null;
    this.speedScaleRange = options.speedScaleRange || [0.7, 1.7];
    this.missing = new Set();
  }

  _action(name) {
    if (this.actions.has(name)) return this.actions.get(name);
    const clip = this.clips.get(name);
    if (!clip) {
      if (!this.missing.has(name)) {
        console.warn('[animator] clip inexistente:', name);
        this.missing.add(name);
      }
      return null;
    }
    const action = this.mixer.clipAction(clip);
    this.actions.set(name, action);
    return action;
  }

  /** @param {string} state  @param {number} speed  velocidad horizontal en m/s */
  apply(state, speed = 0) {
    const entry = STATE_CLIPS[state];
    if (!entry) return;

    const action = this._action(entry.clip);
    if (!action) return;

    if (entry.matchSpeed) {
      const natural = CLIP_SPEED[entry.clip] || 1;
      // Rango propio si el estado lo declara. Hace falta porque el margen global
      // [0,7 – 1,7] esta pensado para caminar y correr, cuyos clips ya van a una
      // velocidad parecida a la del juego. `pushing` esta autorado a 0,40 m/s, muy
      // por debajo de cualquier ritmo jugable, y el clamp global lo dejaba a la
      // mitad de lo que hace falta.
      const [min, max] = entry.speedRange || this.speedScaleRange;
      action.timeScale = Math.max(min, Math.min(max, Math.abs(speed) / natural));
    } else {
      action.timeScale = entry.speed || 1;
    }

    if (this.currentName === entry.clip) return;

    action.reset();
    action.setLoop(entry.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = !entry.loop;
    action.enabled = true;
    action.setEffectiveWeight(1);
    action.play();

    if (this.current && this.current !== action) {
      this.current.crossFadeTo(action, entry.fade, false);
    }

    this.current = action;
    this.currentName = entry.clip;
  }

  /**
   * Cuanto dura la animacion de un estado, ya ajustada por su `speed`.
   * Devuelve 0 si el clip es en bucle: esos no retienen.
   */
  holdSecondsFor(state) {
    const entry = STATE_CLIPS[state];
    if (!entry || entry.loop || entry.noHold) return 0;
    return this.clipSecondsFor(state);
  }

  /**
   * Duracion del clip de un estado, ya ajustada por su `speed`, SIN mirar si el
   * estado retiene o no.
   *
   * Existe aparte de `holdSecondsFor` porque son dos preguntas distintas:
   * "¿cuanto debe bloquearse el estado?" (0 si es `noHold`) y "¿cuanto dura la
   * animacion?". Los lanzamientos son `noHold` pero necesitan lo segundo para
   * cuadrar la suelta del proyectil con el momento en que la mano llega arriba.
   * Usar la primera devolvia 0 y la suelta se desincronizaba del gesto.
   */
  clipSecondsFor(state) {
    const entry = STATE_CLIPS[state];
    if (!entry) return 0;
    const clip = this.clips.get(entry.clip);
    if (!clip) return 0;
    return clip.duration / (entry.speed || 1);
  }

  update(dt) { this.mixer.update(dt); }
}
