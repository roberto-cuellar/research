/**
 * Efectos de sonido.
 *
 * Comparte el AudioContext de la coreografia a proposito: dos contextos no comparten
 * reloj, y todo el juego esta cronometrado sobre ese reloj. Los SFX cuelgan de su
 * propio bus de ganancia para poder mezclarlos aparte de la musica.
 *
 * Los pasos se emiten POR DISTANCIA RECORRIDA, no por tiempo: asi la cadencia sigue
 * sola a la velocidad del personaje sin tener que sincronizar con la animacion.
 * Es el mismo principio que `rateOverDistance` en las particulas de Unity.
 */

const V = (base, n) => Array.from({ length: n }, (_, i) => `${base}_00${i}.ogg`);

/** Banco de sonidos. Cada entrada es una lista de variantes que se alternan. */
export const BANK = {
  // Pasos por superficie. La superficie la entrega la colision del nivel.
  step_tierra: V('footstep_concrete', 5),
  step_madera: V('footstep_wood', 5),
  step_hierba: V('footstep_grass', 5),
  step_tejado: V('footstep_concrete', 5),
  step_metal: V('impactMetal_light', 4),
  step_agua: V('footstep_snow', 5),      // provisional: aun no hay chapoteo

  land_soft: V('impactGeneric_light', 3),
  land_hard: V('impactPlate_heavy', 3),

  portal_enter: V('forceField', 4),
  portal_exit: ['doorOpen_000.ogg', 'doorOpen_001.ogg'],

  // El pack de interfaz empieza en _001, no en _000.
  spark: ['confirmation_001.ogg', 'confirmation_002.ogg', 'confirmation_003.ogg'],
  achievement: ['bong_001.ogg'],
};

export class Sfx {
  /**
   * @param {AudioContext} ctx  el mismo de la coreografia
   * @param {string} baseUrl
   */
  constructor(ctx, baseUrl = './public/sfx/') {
    this.ctx = ctx;
    this.baseUrl = baseUrl;
    this.buffers = new Map();   // nombre de archivo -> AudioBuffer
    this.lastVariant = new Map();
    this.ready = false;

    this.bus = ctx.createGain();
    this.bus.gain.value = 0.55;
    this.bus.connect(ctx.destination);
    this.baseGain = 0.55;   // fuente unica de verdad, igual que `Choreography.baseGain`
    this.ducked = false;

    // Cadencia de pasos por distancia.
    this.stepDistance = 0.92;   // metros entre pisada
    this._travel = 0;
  }

  async load() {
    const files = new Set();
    for (const list of Object.values(BANK)) list.forEach((f) => files.add(f));

    const jobs = [...files].map(async (file) => {
      try {
        const bytes = await (await fetch(this.baseUrl + file)).arrayBuffer();
        this.buffers.set(file, await this.ctx.decodeAudioData(bytes));
      } catch {
        // Un sonido que falte no puede tumbar el juego.
      }
    });

    await Promise.all(jobs);
    this.ready = true;
    return this.buffers.size;
  }

  /** Elige variante sin repetir la anterior: si no, suena a ametralladora. */
  _pick(key) {
    const list = BANK[key];
    if (!list || !list.length) return null;
    if (list.length === 1) return list[0];

    const last = this.lastVariant.get(key);
    let file = list[(Math.random() * list.length) | 0];
    if (file === last) file = list[(list.indexOf(file) + 1) % list.length];
    this.lastVariant.set(key, file);
    return file;
  }

  /**
   * @param {string} key
   * @param {{volume?:number, pitch?:number, spread?:number}} options
   *   `spread` es la variacion aleatoria de tono, en semitonos.
   */
  play(key, options = {}) {
    if (!this.ready) return null;
    const file = this._pick(key);
    const buffer = file && this.buffers.get(file);
    if (!buffer) return null;

    const { volume = 1, pitch = 1, spread = 0 } = options;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const semitones = spread ? (Math.random() * 2 - 1) * spread : 0;
    source.playbackRate.value = pitch * Math.pow(2, semitones / 12);

    const gain = this.ctx.createGain();
    gain.gain.value = volume;

    source.connect(gain).connect(this.bus);
    source.start();
    source.onended = () => { source.disconnect(); gain.disconnect(); };
    return source;
  }

  /**
   * Alimenta el sistema de pasos. Se llama cada frame con el desplazamiento
   * horizontal y el estado del jugador.
   */
  updateFootsteps(distance, grounded, surface, speed) {
    if (!grounded || !surface) { this._travel = 0; return; }

    this._travel += Math.abs(distance);
    if (this._travel < this.stepDistance) return;
    this._travel = 0;

    // Al correr el paso es mas seco y algo mas agudo que al caminar.
    const running = Math.abs(speed) > 4.2;
    this.play('step_' + surface, {
      volume: running ? 0.5 : 0.34,
      pitch: running ? 1.06 : 1.0,
      spread: 1.6,
    });
  }

  /**
   * Volumen elegido por el jugador. Igual que en la musica, es la FUENTE UNICA: el
   * ducking multiplica esto, nunca lo sustituye. `s_sfx.js:136` tenia el mismo patron
   * latente que causo TDB-004 en la musica y se cierra aqui antes de que muerda.
   */
  setVolume(value) {
    this.baseGain = value;
    this._aplicar(0.05);
  }

  /**
   * El ambiente y los SFX tambien se apartan cuando habla alguien (R4 §6). Menos que
   * la musica —0,55 contra 0,42— porque un paso o un impacto que desaparece del todo
   * mientras alguien habla desconecta la imagen del sonido.
   */
  setVoiceDuck(active) {
    this.ducked = !!active;
    this._aplicar(active ? 0.05 : 0.24);
  }

  _aplicar(tau) {
    const base = this.baseGain ?? 0.55;
    const objetivo = base * (this.ducked ? 0.55 : 1);
    this.bus.gain.setTargetAtTime(objetivo, this.ctx.currentTime, tau);
  }
}
