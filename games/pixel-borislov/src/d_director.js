/**
 * Director del nivel: etapas, objetivos, dialogo y control del jugador.
 *
 * Es el pegamento entre la musica y el juego. La coreografia dice en que momento
 * estamos; el director decide que se pide al jugador, quien habla y si tiene el
 * control. Todo se declara en datos (`level.beats` y `level.stages`), no en codigo,
 * para poder montar los mundos siguientes sin tocar el motor.
 */

/**
 * Estados de control. El error clasico es tratar todo dialogo como cinematica:
 * de las 33 lineas del guion solo ~8 quitan el control. El resto suenan jugando.
 */
export const CONTROL = {
  PLAYING: 'playing',
  DIALOGUE_SOFT: 'dialogue',   // habla alguien, pero sigues jugando
  SCRIPTED_MOVE: 'scripted',   // el personaje se mueve solo
  CINEMATIC: 'cinematic',      // control bloqueado, HUD oculto
};

export class Director {
  constructor(level, player, choreo, dialogue, options = {}) {
    this.level = level;
    this.player = player;
    this.choreo = choreo;
    this.dialogue = dialogue;

    this.stage = null;
    this.stageIndex = -1;
    this.stagesCleared = 0;
    this.attempts = new Map();     // intentos por etapa, para elegir variante
    this.control = CONTROL.PLAYING;
    this.cinematicUntil = 0;
    this.finished = false;

    this._firedBeats = new Set();
    this._momentStartedAt = 0;
    this._currentMoment = null;

    this.onStageChange = options.onStageChange || null;
    this.onFinish = options.onFinish || null;
    this.onCinematic = options.onCinematic || null;
    this.onLoopLocked = options.onLoopLocked || null;
    this.onBeat = options.onBeat || null;
  }

  /**
   * Arranca una cinematica. Separado de `enterMoment` porque ahora hay dos formas
   * de entrar: por momento musical y por posicion del jugador.
   */
  _startCinematic(cine) {
    this.control = CONTROL.CINEMATIC;
    // Se guarda la DURACION, no un instante absoluto. La posicion de la musica
    // retrocede cuando el loop-lock rebobina, asi que comparar contra un instante
    // futuro podia no cumplirse nunca y dejaba al jugador sin control para siempre.
    this.cinematicLeft = cine.bars * this.choreo.barSeconds;
    this.cinematicUntil = this.choreo.position + this.cinematicLeft;
    if (this.onCinematic) this.onCinematic(cine);
  }

  /** Lo llama la coreografia al entrar un momento nuevo. */
  enterMoment(moment) {
    this._currentMoment = moment.name;
    this._momentStartedAt = this.choreo.position;

    const stage = (this.level.stages || []).find((s) => s.moment === moment.name);
    if (stage) {
      this.stage = stage;
      this.stageIndex = this.level.stages.indexOf(stage);
      if (!this.attempts.has(stage.id)) this.attempts.set(stage.id, 0);
      if (this.onStageChange) this.onStageChange(stage);
    }

    // Cinematicas por MOMENTO. Las que traen `atX` no entran aqui: esas esperan a
    // que el jugador llegue, y las dispara `update`.
    const cine = (this.level.cinematics || [])
      .find((c) => c.moment === moment.name && c.atX === undefined);
    if (cine) this._startCinematic(cine);
  }

  /** Progreso del objetivo actual: {label, done, total} o null. */
  get objective() {
    if (!this.stage || !this.stage.objective) return null;
    const o = this.stage.objective;
    const ctx = this._context || {};
    let done = 0;
    let total = o.count;
    if (o.type === 'reachX') { done = Math.min(o.x, Math.round(this.player.position.x)); total = o.x; }
    else if (o.type === 'sparks') done = ctx.sparks || 0;
    else if (o.type === 'crossings') done = ctx.crossings || 0;
    else if (o.type === 'repair') { done = ctx.screws || 0; total = o.screws; }
    else if (o.type === 'crossAndReturn') {
      // Se muestra como dos pasos, que es como lo vive el jugador.
      done = (this._visitedBack ? 1 : 0) + (this._visitedBack && this.player.layer === 0 ? 1 : 0);
      total = 2;
      return {
        label: this._visitedBack ? 'Vuelve al frente y sigue' : o.label,
        done, total,
      };
    }
    return { label: o.label, done, total };
  }

  _objectiveMet(ctx) {
    const o = this.stage && this.stage.objective;
    if (!o) return false;

    if (o.type === 'reachX') return this.player.position.x >= o.x;
    if (o.type === 'sparks') return (ctx.sparks || 0) >= o.count;
    if (o.type === 'crossings') return (ctx.crossings || 0) >= o.count;

    // Objetivo del GDD para la etapa 1: no basta con llegar. Hay que haber pasado por
    // la capa trasera Y volver al frente. Volver es parte del objetivo, no un extra.
    if (o.type === 'crossAndReturn') {
      return this._visitedBack
        && this.player.layer === (o.layer ?? 0)
        && this.player.position.x >= o.x;
    }

    // Etapa 3: devolver los tornillos y reparar.
    if (o.type === 'repair') {
      return (ctx.screws || 0) >= o.screws && (ctx.repaired || false);
    }
    return false;
  }

  /** Sube el contador de intentos de la etapa activa: elige la variante de animo. */
  registerAttempt() {
    if (!this.stage) return;
    const n = (this.attempts.get(this.stage.id) || 0) + 1;
    this.attempts.set(this.stage.id, n);

    const encourage = this.stage.encourage;
    if (!encourage) return;
    /**
     * `at1` es nuevo y existe por una linea concreta del guion.
     *
     * `BR-06b` —"No pasa nada, el robot no muerde. Solo aspira."— estaba escrita,
     * grabada en el guion y **nunca se invocaba**: la etapa 2 no declaraba
     * `encourage`, asi que las dos lineas de consuelo de los tejados eran codigo
     * muerto. La primera vez que te atrapan es exactamente cuando hace falta consolar,
     * no la tercera.
     */
    if (n === 1 && encourage.at1) this.dialogue.say(encourage.at1);
    if (n === 3 && encourage.at3) this.dialogue.say(encourage.at3);
    if (n === 6 && encourage.at6) this.dialogue.say(encourage.at6);
  }

  update(dt, ctx) {
    this._context = ctx;
    const pos = this.choreo.playing ? this.choreo.position : 0;

    // Se recuerda haber estado detras: lo consulta el objetivo de "cruzar y volver".
    if (this.player.layer === 1) this._visitedBack = true;

    // ---- fin de cinematica: siempre en el compas, nunca a media frase ----
    // Dos condiciones, y basta con una. La de posicion mantiene el corte en el
    // downbeat cuando la musica corre normal; la cuenta atras es la red de
    // seguridad para cuando la posicion retrocede (loop-lock, `seekMoment`).
    if (this.control === CONTROL.CINEMATIC) {
      this.cinematicLeft = Math.max(0, (this.cinematicLeft ?? 0) - dt);
      if (pos >= this.cinematicUntil || this.cinematicLeft <= 0) {
        this.control = CONTROL.PLAYING;
        this.cinematicLeft = 0;
        if (this.onCinematic) this.onCinematic(null);
      }
    }

    // ---- cinematicas por POSICION ----
    //
    // El GDD las quiere donde el jugador LLEGA, no donde va la musica: una escena
    // que explica un sitio no puede dispararse antes de estar en el sitio. La
    // musica sigue mandando la duracion, que se sigue midiendo en compases.
    if (this.control === CONTROL.PLAYING) {
      for (const cine of this.level.cinematics || []) {
        if (cine.atX === undefined) continue;
        const key = 'cine:' + (cine.id || cine.atX);
        if (this._firedBeats.has(key)) continue;
        if (this.player.position.x < cine.atX) continue;
        // Puede exigir ademas un momento concreto, para no sonar fuera de contexto.
        if (cine.moment && cine.moment !== this._currentMoment) continue;

        this._firedBeats.add(key);
        this._startCinematic(cine);
        break;   // una por frame: dos a la vez se pisarian
      }
    }

    // ---- puerta de entrada al loop ----
    //
    // El bucle no se cierra al cambiar la musica, sino al LLEGAR el jugador al
    // punto donde empieza el reto. Si se cerrara antes, la etapa arrancaria mientras
    // el jugador todavia viene corriendo desde el tramo anterior, y la retencion se
    // gastaria en el camino en vez de en el desafio.
    //
    // Si la etapa no declara puerta, vale su propia posicion de partida.
    if (this.choreo.armedLoop && !this.choreo.lockedLoop && this.stage) {
      const gateX = this.stage.gate?.x;
      if (gateX === undefined || this.player.position.x >= gateX) {
        if (this.choreo.lockCurrentLoop() && this.onLoopLocked) this.onLoopLocked(this.stage);
      }
    }

    // ---- beats de dialogo: declarados por momento y desplazamiento ----
    if (this._currentMoment) {
      const elapsed = pos - this._momentStartedAt;
      for (const beat of this.level.beats || []) {
        if (beat.moment !== this._currentMoment) continue;
        const key = beat.moment + '@' + beat.at;
        if (this._firedBeats.has(key)) continue;
        if (elapsed + 0.02 < beat.at) continue;
        // Un beat puede exigir ademas que el jugador haya llegado a un punto. Asi
        // una linea que explica algo del sitio no suena antes de estar en el sitio.
        if (beat.x !== undefined && this.player.position.x < beat.x) continue;

        this._firedBeats.add(key);
        if (beat.say) this.dialogue.say(beat.say);
        if (this.onBeat) this.onBeat(beat);
      }
    }

    // ---- objetivo cumplido: suelta el loop y avanza ----
    if (this.stage && this._objectiveMet(ctx)) {
      const released = this.choreo.releaseCurrentLoop();
      const stage = this.stage;
      this.stage = null;
      this.stagesCleared += 1;

      if (stage.onClear) {
        const tries = this.attempts.get(stage.id) || 0;
        const pick = tries === 0 ? stage.onClear.first
                   : tries < 4 ? (stage.onClear.retry || stage.onClear.first)
                   : (stage.onClear.late || stage.onClear.retry || stage.onClear.first);
        if (pick) this.dialogue.say(pick);
      }

      if (this.onStageChange) this.onStageChange(null, stage, released);
    }

    // ---- final del nivel ----
    if (!this.finished && this._currentMoment === (this.level.finalMoment || 'postcombate2')) {
      const elapsed = pos - this._momentStartedAt;
      if (elapsed > 4.0) {
        this.finished = true;
        const closing = this.level.closing;
        if (closing) {
          const all = ctx.sparks >= ctx.sparksTotal;
          const rough = [...this.attempts.values()].reduce((a, b) => a + b, 0) >= 4;
          this.dialogue.say(all ? closing.perfect : rough ? closing.rough : closing.normal);
        }
        if (this.onFinish) this.onFinish();
      }
    }

    this.dialogue.update();
  }

  /** ¿Tiene el jugador el control ahora mismo? */
  get playerHasControl() {
    return this.control === CONTROL.PLAYING || this.control === CONTROL.DIALOGUE_SOFT;
  }
}
