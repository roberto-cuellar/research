/**
 * Coreografia audio-reactiva por etapas.
 *
 * Port del sistema de Unity (CoreografiaManager), con tres cambios deliberados:
 *
 *  1. Los marcadores vienen HORNEADOS en JSON. Unity escaneaba dos WAV enteros al
 *     empezar la oleada, bloqueando el hilo principal.
 *  2. El reloj es `AudioContext.currentTime`, con precision de muestra. Unity usaba
 *     `AudioSource.time`, cuyo jitter es el del frame (~16 ms a 60 fps).
 *  3. El loop usa `loopStart`/`loopEnd` nativos: sin costura y sin rebobinados audibles.
 *     Unity reasignaba `_music.time`, que produce un salto seco.
 *
 * Y arregla lo que en Unity quedo sin conectar: ReleaseCurrentLoop() no tenia ni un
 * solo llamador. La musica entraba en su primer loop y se quedaba ahi para siempre
 * mientras el gameplay avanzaba por su cuenta. Aqui el loop lo SUELTA la etapa al
 * superarse, que es lo que da nombre al sistema.
 */

/** Cuanto se hunde la musica en pausa, como factor de la ganancia elegida. */
const PAUSE_DUCK = 0.26;

/**
 * EL GESTO DE DUCKING (R4 §6, cierra TDB-020).
 *
 * Cuando habla alguien, la musica se aparta. Hasta ahora esto lo hacia `game.js`
 * escribiendo el `GainNode` a mano con dos literales — `0.30` al entrar y `0.85` al
 * salir — y eran los mismos dos literales que ya habian causado TDB-004: se volvia a
 * borrar la preferencia del jugador en cuanto hablaba alguien. Con el deslizador de
 * musica al 40 %, la voz terminaba y la musica SUBIA al 85 %.
 *
 * Aqui hay un solo dueño y todo se expresa como FACTOR de `baseGain`, asi que da igual
 * el orden en que ocurran pausa, preferencia y voz.
 *
 * Dos cosas a la vez, que es lo que R4 pide y lo que hace que la voz se entienda sin
 * que la musica desaparezca:
 *
 *   1. **Baja** el nivel a `VOICE_DUCK` (-7,5 dB). Solo bajar deja la musica presente.
 *   2. **Ahueca** la banda de la palabra con una campana a 1,9 kHz. Bajar sin ahuecar
 *      obliga a hundir mucho mas el nivel para el mismo resultado — que es justamente
 *      lo que se oia como "la musica esta muy alta cuando habla".
 *
 * La envolvente es asimetrica y cuantizada al pulso: entra en 1/4 de pulso para que
 * no se coma la primera silaba, y sale en 1,5 pulsos para que la musica no bombee al
 * final de cada frase.
 */
const VOICE_DUCK = 0.42;        // factor de ganancia: -7,5 dB
const VOICE_NOTCH_HZ = 1900;    // centro de la banda de la palabra
const VOICE_NOTCH_DB = -7;      // cuanto se ahueca

export class Choreography {
  constructor(options = {}) {
    this.jsonUrl = options.jsonUrl || './public/audio/choreography.json';
    this.audioUrl = options.audioUrl || './public/audio/master.wav';

    this.ctx = null;
    this.buffer = null;
    this.source = null;
    this.gain = null;
    this.filter = null;

    this.data = null;
    this.ready = false;
    this.playing = false;

    this.anchor = 0;           // ctx.currentTime en el que la pista estaba en 0
    this.nextMoment = 0;       // cursor monotono: cada momento suena una sola vez
    this.currentIndex = -1;
    this.lockedLoop = null;    // {start, end, name}
    this.armedLoop = false;    // hay loop disponible, esperando a que la etapa lo cierre
    this.pendingRelease = false;

    /**
     * Ganancia de la musica que el JUGADOR ha elegido. Fuente unica de verdad.
     *
     * Antes no existia, y ese era el bug: `applyVolumes()` escribia
     * `0.85 * musica * master` directamente sobre el nodo, y `setPaused(false)`
     * rampaba a un `0.85` LITERAL. Dos escritores sobre el mismo `AudioParam` sin
     * dueño. Al cerrar el modal de pausa con Esc, la rampa de salida borraba la
     * preferencia: el deslizador de musica no controlaba nada en cuanto habias
     * abierto la pausa una vez — que es justo cuando se toca. (TDB-004)
     *
     * Ahora la pausa MULTIPLICA esto en vez de sustituirlo, asi que da igual en que
     * orden ocurran las cosas.
     */
    this.baseGain = 0.85;

    /**
     * Los dos factores que se multiplican sobre `baseGain`. Nunca se escribe el nodo
     * desde fuera: se cambia uno de estos y se llama a `_aplicarGanancia()`.
     */
    this.paused = false;
    this.ducked = false;

    this.onMoment = options.onMoment || null;
    this.onBeat = options.onBeat || null;
    this._lastBeat = -1;
  }

  async load() {
    this.data = await (await fetch(this.jsonUrl)).json();
    const bytes = await (await fetch(this.audioUrl)).arrayBuffer();

    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.buffer = await this.ctx.decodeAudioData(bytes);

    // Cadena: fuente -> paso bajo -> ganancia -> salida.
    // El paso bajo se usa para las transiciones de momento y para la pausa (plan §20.3).
    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 20000;

    // EQ de barrido: un shelf de agudos que se hunde en las transiciones. Es mas
    // musical que un paso bajo — no tapa la mezcla, solo le quita el aire — y es
    // justo lo que hace que un portal se sienta como cruzar a otro sitio.
    this.shelf = this.ctx.createBiquadFilter();
    this.shelf.type = 'highshelf';
    this.shelf.frequency.value = 1100;
    this.shelf.gain.value = 0;

    // Campana en la banda de la palabra. En reposo vale 0 dB, asi que mientras nadie
    // hable esta cadena es acusticamente transparente: no colorea la mezcla.
    this.voiceNotch = this.ctx.createBiquadFilter();
    this.voiceNotch.type = 'peaking';
    this.voiceNotch.frequency.value = VOICE_NOTCH_HZ;
    this.voiceNotch.Q.value = 0.9;
    this.voiceNotch.gain.value = 0;

    this.gain = this.ctx.createGain();
    this.gain.gain.value = this.baseGain;

    this.filter.connect(this.shelf).connect(this.voiceNotch)
      .connect(this.gain).connect(this.ctx.destination);
    this.ready = true;
    return this.data;
  }

  /** Los navegadores exigen un gesto del usuario antes de sonar. */
  async play(offset = 0) {
    if (!this.ready) return false;
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    if (this.playing) return true;

    this.source = this.ctx.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.connect(this.filter);
    this.source.start(0, offset);

    this.anchor = this.ctx.currentTime - offset;
    this.playing = true;
    return true;
  }

  stop() {
    if (this.source) { try { this.source.stop(); } catch { /* ya parada */ } }
    this.playing = false;
  }

  /**
   * Posicion real dentro de la pista, teniendo en cuenta el bucle nativo.
   *
   * El nodo reproduce 0 -> loopEnd y a partir de ahi da vueltas entre loopStart y
   * loopEnd, asi que el tiempo transcurrido y la posicion dejan de coincidir.
   */
  get position() {
    if (!this.playing) return 0;
    const raw = this.ctx.currentTime - this.anchor;
    const loop = this.lockedLoop;
    if (!loop || raw <= loop.end) return raw;
    const span = loop.end - loop.start;
    return loop.start + ((raw - loop.end) % span);
  }

  get beatIndex() { return Math.floor(this.position / this.data.beatSeconds); }
  get barIndex() { return Math.floor(this.position / this.data.barSeconds) + 1; }
  get beatInBar() { return (this.beatIndex % this.data.beatsPerBar) + 1; }
  /** 0..1 dentro del pulso actual: sirve para latir cosas al compas. */
  get beatPhase() {
    const t = this.position / this.data.beatSeconds;
    return t - Math.floor(t);
  }

  get currentMoment() {
    return this.currentIndex >= 0 ? this.data.moments[this.currentIndex] : null;
  }

  /**
   * Cierra el loop si esta armado y el jugador aun esta a tiempo.
   *
   * "A tiempo" importa: la region de `combate1` dura 8,6 s, asi que si nadie lo
   * cierra antes de su punto de salida la musica sigue de largo y la etapa pierde
   * su capacidad de retener. Por eso `update()` lo cierra igualmente en el ultimo
   * momento aunque no se haya pasado la puerta — ver `_autoLockIfLate`.
   */
  lockCurrentLoop() {
    const moment = this.currentMoment;
    if (!moment || !moment.loop || this.lockedLoop) return false;
    const loop = this.data.loops.find((l) => l.name === moment.loop);
    if (!loop) return false;

    this.lockedLoop = loop;
    this.armedLoop = false;
    this.source.loopStart = loop.start;
    this.source.loopEnd = loop.end;
    this.source.loop = true;
    this.pendingRelease = false;
    return true;
  }

  /**
   * Suelta el loop: la musica sigue hacia el siguiente momento.
   * Esta es la llamada que en Unity no existia en ningun sitio.
   */
  releaseCurrentLoop() {
    if (!this.lockedLoop) return false;

    // Re-anclar antes de soltar: la posicion ya no es el tiempo transcurrido, y sin
    // esto el reloj daria un salto al desactivar el bucle.
    const pos = this.position;
    this.source.loop = false;
    this.anchor = this.ctx.currentTime - pos;
    this.lockedLoop = null;

    // Barrido de paso bajo de medio compas, para que la salida no chirrie.
    this.duckFilter(this.data.barSeconds * 0.5);
    return true;
  }

  /**
   * Barrido del shelf de agudos.
   * @param {number} gainDb  0 = plano, negativo = se apaga el brillo
   * @param {number} seconds duracion del barrido
   */
  rampShelf(gainDb, seconds = 0.35) {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    const g = this.shelf.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(gainDb, now + Math.max(0.01, seconds));
  }

  /** Duracion de un pulso y de un compas, para cuantizar automatizaciones. */
  get beatSeconds() { return this.data ? this.data.beatSeconds : 0.54; }
  get barSeconds() { return this.data ? this.data.barSeconds : 2.16; }

  /**
   * Rebobina al inicio de un momento con nombre.
   *
   * Lo usa la etapa 2: al fallar la carrera, la musica vuelve al compas 26 y el tramo
   * se reintenta desde el MISMO punto musical, no desde donde estuviera sonando.
   * Se acompana de un paso bajo de medio compas para que el salto no chirrie.
   */
  seekMoment(name) {
    if (!this.playing) return false;
    const index = this.data.moments.findIndex((m) => m.name === name);
    if (index < 0) return false;

    const moment = this.data.moments[index];
    const offset = moment.time + 0.001;

    try { this.source.stop(); } catch { /* ya parada */ }
    this.lockedLoop = null;
    this.armedLoop = false;   // se re-arma cuando el momento vuelva a entrar

    this.source = this.ctx.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.connect(this.filter);
    this.source.start(0, offset);
    this.anchor = this.ctx.currentTime - offset;

    // El cursor retrocede para que el momento vuelva a dispararse.
    this.nextMoment = index;
    this.currentIndex = index - 1;
    this._lastBeat = -1;

    this.duckFilter(this.data.barSeconds * 0.5);
    return true;
  }

  /** Paso bajo momentaneo, cuantizado en duracion al tempo. */
  duckFilter(seconds = 0.5, floorHz = 700) {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    const f = this.filter.frequency;
    f.cancelScheduledValues(now);
    f.setValueAtTime(floorHz, now);
    f.exponentialRampToValueAtTime(20000, now + seconds);
  }

  /**
   * Fija la ganancia elegida por el jugador y la aplica sin pisar la pausa.
   *
   * Se rampa en 60 ms en vez de asignar: mover un deslizador escribe decenas de
   * veces por segundo, y asignar `.value` en cada una produce chasquidos.
   */
  /**
   * La ganancia que debe sonar AHORA: la preferencia del jugador por los dos factores.
   *
   * Es una funcion pura de estado, y esa es toda la gracia. Antes cada situacion
   * escribia su propio numero absoluto y el resultado dependia del ORDEN en que
   * ocurrieran las cosas: mover el deslizador con la pausa abierta, o que terminara
   * una linea de voz mientras el jugador bajaba la musica, dejaban la ganancia en el
   * valor de quien escribio el ultimo. (TDB-004 y su recaida en `onDuck`.)
   */
  get targetGain() {
    return this.baseGain
      * (this.paused ? PAUSE_DUCK : 1)
      * (this.ducked ? VOICE_DUCK : 1);
  }

  /**
   * Programa la ganancia hacia `targetGain`.
   *
   * Se ancla el valor actual antes de rampar (`setValueAtTime(g.value, now)`): sin
   * eso la rampa arranca desde el ultimo valor *programado*, no desde el que se esta
   * oyendo, y se oye un escalon. Es la regla de GOBERNANZA DE AUDIO.
   */
  _aplicarGanancia(seconds = 0.06) {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    const g = this.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(this.targetGain, now + Math.max(0.01, seconds));
  }

  /**
   * Fija la ganancia elegida por el jugador.
   *
   * Se rampa en 60 ms en vez de asignar: mover un deslizador escribe decenas de
   * veces por segundo, y asignar `.value` en cada una produce chasquidos.
   */
  setBaseGain(value) {
    this.baseGain = value;
    this._aplicarGanancia(0.06);
  }

  /**
   * El gesto de ducking por voz. **Unico llamador legitimo: `Dialogue.onDuck`.**
   *
   * Baja y ahueca a la vez (ver la cabecera del archivo). Devuelve la ganancia
   * objetivo para poder verificarlo desde la consola sin oido.
   */
  setVoiceDuck(active) {
    this.ducked = !!active;
    if (!this.ready) return this.targetGain;

    // Cuantizada al pulso: 1/4 para entrar, 1,5 para salir. Nada dura "medio segundo".
    const beat = this.beatSeconds;
    const seconds = active ? beat * 0.25 : beat * 1.5;
    this._aplicarGanancia(seconds);

    if (!this.voiceNotch) return this.targetGain;
    const now = this.ctx.currentTime;
    const n = this.voiceNotch.gain;
    n.cancelScheduledValues(now);
    n.setValueAtTime(n.value, now);
    n.linearRampToValueAtTime(active ? VOICE_NOTCH_DB : 0, now + seconds);
    return this.targetGain;
  }

  /** Pausa: la musica NO se detiene, se apaga y se ahoga (plan §27.4). */
  setPaused(paused) {
    this.paused = paused;
    if (!this.ready) return;
    // MULTIPLICA la preferencia del jugador, no la sustituye.
    this._aplicarGanancia(0.25);
    const now = this.ctx.currentTime;
    const f = this.filter.frequency;
    f.cancelScheduledValues(now);
    f.setValueAtTime(Math.max(20, f.value), now);
    f.exponentialRampToValueAtTime(paused ? 500 : 20000, now + 0.25);
  }

  /** Se llama cada frame. Dispara momentos y pulsos. */
  update() {
    if (!this.playing) return;
    const t = this.position;
    const EPS = 0.0005;

    // Los momentos suenan una sola vez y en orden, aunque el loop rebobine.
    const moments = this.data.moments;
    if (this.nextMoment < moments.length && t + EPS >= moments[this.nextMoment].time) {
      this.currentIndex = this.nextMoment;
      this.nextMoment += 1;
      const moment = moments[this.currentIndex];
      if (this.onMoment) this.onMoment(moment);

      // El loop se ARMA, no se cierra todavia. Quien decide cuando se cierra es la
      // etapa, normalmente al pasar el jugador por su punto de entrada: entrar al
      // bucle en el mismo instante en que cambia la musica hace que el reto empiece
      // antes de que el jugador haya llegado a el.
      this.armedLoop = !!moment.loop;
    }

    // Red de seguridad: si el loop esta armado y queda menos de medio compas para
    // su punto de salida, se cierra igualmente. Sin esto, un jugador lento veria la
    // musica pasar de largo y la etapa dejaria de retener — que es justo el
    // invariante que sostiene todo el nivel.
    if (this.armedLoop && !this.lockedLoop) {
      const moment = this.currentMoment;
      const loop = moment && moment.loop
        ? this.data.loops.find((l) => l.name === moment.loop) : null;
      if (loop && this.position > loop.end - this.data.barSeconds * 0.5) {
        this.lockCurrentLoop();
      }
    }

    const beat = this.beatIndex;
    if (beat !== this._lastBeat) {
      this._lastBeat = beat;
      if (this.onBeat) this.onBeat(beat, this.beatInBar, this.barIndex);
    }
  }
}
