/**
 * Sistema de dialogo con variantes.
 *
 * Tres cosas que lo definen (plan §18, §19.3):
 *
 *  1. Casi todo el dialogo es DIALOGUE_SOFT: suena mientras juegas. De las 24 lineas
 *     del guion solo ~8 caen dentro de cinematica. (Aqui ponia 33 y en INDEX.md 52:
 *     tres cifras del mismo banco, TDB-035. La buena es 24, y hay un invariante que
 *     comprueba que toda linea invocada existe.) Tratar cada linea como cinematica
 *     es el error clasico: acabas quitandole el control al jugador cada 30 segundos.
 *  2. Las lineas tienen VARIANTES segun el resultado (a la primera, tras 3 intentos,
 *     sin dano...). El juego elige una y la marca como usada.
 *  3. Una linea nunca se repite en la misma partida. Si su variante ya sono, se cae a
 *     la siguiente o se calla. El silencio siempre es mejor que la repeticion.
 *
 * Bradislav habla por radio: el filtro se aplica EN TIEMPO REAL, no horneado, para
 * poder quitarlo en cinematicas donde se le vea la cara y ajustarlo sin regrabar.
 */

export const SPEAKER = {
  BORISLOV: 'borislov',
  BRADISLAV: 'bradislav',
};

const SPEAKER_STYLE = {
  [SPEAKER.BORISLOV]: { name: 'Borislov', color: '#F59E0B' },
  [SPEAKER.BRADISLAV]: { name: 'Bradislav', color: '#2ED8EE' },
};

/**
 * Banco de lineas. `audio` null = grabada aun no disponible: se muestra el subtitulo
 * igual, asi el guion se puede probar entero antes de tener todas las voces.
 */
export const LINES = {
  'BR-01': { speaker: SPEAKER.BRADISLAV, audio: 'br-01.wav', text: 'Borislov, ven. Llevo toda la mañana con esto.' },
  'BO-01': { speaker: SPEAKER.BORISLOV, audio: 'bo-01.wav', text: '¿Otro invento? A ver si este sí funciona.' },
  'BR-02': { speaker: SPEAKER.BRADISLAV, audio: 'br-02.wav', text: 'Se llama el Proyector de Ideas. Lo que imaginemos… se puede caminar. Yo te guío desde aquí.' },
  'BR-03': { speaker: SPEAKER.BRADISLAV, audio: 'br-03.wav', text: '¿Ves el arco? Es un Portal de Idea. Delante está lo que pasa. Detrás, lo que estamos imaginando. Puedes cruzar.' },
  'BO-02': { speaker: SPEAKER.BORISLOV, audio: 'bo-02.wav', text: '¡Espera! ¿Puedo pasar al otro lado? ¡Eso es un truco de nivel buenísimo!' },
  'BO-03': { speaker: SPEAKER.BORISLOV, audio: 'bo-03.wav', text: '¡Guau! ¡Es toda Caprilópolis!' },
  'BO-04': { speaker: SPEAKER.BORISLOV, audio: 'bo-04.wav', text: '…¿Y eso?' },
  'BR-05': { speaker: SPEAKER.BRADISLAV, audio: 'br-05.wav', text: '¡Es solo un robot de limpieza, está haciendo su trabajo! ¡Corre y no mires atrás!' },
  'BO-05': { speaker: SPEAKER.BORISLOV, audio: 'bo-05.wav', text: '¡Ay! ¡Bradislav, esa cosa es enorme!' },
  'BR-07': { speaker: SPEAKER.BRADISLAV, audio: 'br-07.wav', text: '¡No! ¡No lo golpees! Está descalibrado, tiene miedo. Busca los tornillos… hay que repararlo.' },
  'BO-06': { speaker: SPEAKER.BORISLOV, audio: 'bo-06.wav', text: 'Ya está… ya está. Tranquilo, grandote.' },
  'BO-07': { speaker: SPEAKER.BORISLOV, audio: 'bo-07.wav', text: '¡Hola! ¡Vengan, tienen que ver esto!' },

  // Variantes aun sin grabar: se muestran como subtitulo (tanda 3 del guion).
  'BR-04a': { speaker: SPEAKER.BRADISLAV, audio: null, text: '…¿Ya? Vale. Tú siempre tan rápido.' },
  'BR-04b': { speaker: SPEAKER.BRADISLAV, audio: null, text: 'Tranquilo. Pensamos, hablamos, y buscamos la solución con calma.' },
  'BR-04c': { speaker: SPEAKER.BRADISLAV, audio: null, text: 'Oye. Nunca nos rendimos, ¿verdad? Mírale al otro lado otra vez.' },
  'BR-04d': { speaker: SPEAKER.BRADISLAV, audio: null, text: '¡Ahí está! Te dije que aparecería.' },
  'BR-06a': { speaker: SPEAKER.BRADISLAV, audio: null, text: 'Otra vez. Tú tienes la idea, yo la mejoro. Ahora ve.' },
  'BR-06b': { speaker: SPEAKER.BRADISLAV, audio: null, text: 'No pasa nada, el robot no muerde. Solo aspira.' },
  'BR-06c': { speaker: SPEAKER.BRADISLAV, audio: null, text: 'Espera… voy a bajarle la velocidad. No se lo digas a nadie.' },
  'BR-06d': { speaker: SPEAKER.BRADISLAV, audio: null, text: '¡Sin un rasguño! ¿Eso lo ensayaste?' },
  'BR-08a': { speaker: SPEAKER.BRADISLAV, audio: null, text: 'Lo hiciste. Y esto es solo el principio… muy pronto conocerás a mis amigos.' },
  'BR-08b': { speaker: SPEAKER.BRADISLAV, audio: null, text: 'Las encontraste todas. Todas. Eres imposible… y esto es solo el principio.' },
  'BR-08d': { speaker: SPEAKER.BRADISLAV, audio: null, text: '¿Ves? Al final siempre hay una manera de seguir adelante.' },
  'BR-11': { speaker: SPEAKER.BRADISLAV, audio: null, text: 'Guardado. Respira.' },
};

export class Dialogue {
  /**
   * @param {AudioContext} ctx  el mismo de la musica
   * @param {HTMLElement} subtitleEl
   */
  constructor(ctx, subtitleEl, options = {}) {
    this.ctx = ctx;
    this.el = subtitleEl;
    this.baseUrl = options.baseUrl || './public/voices/';
    this.buffers = new Map();
    this.used = new Set();
    this.current = null;
    this.queue = [];
    this.onDuck = options.onDuck || null;

    // Las voces ya salen del procesado con pico a -1 dBFS, asi que aqui NO hay que
    // amplificar: hay que dejar margen. Medido en destino: ~-5 dBFS de pico.
    this.bus = ctx.createGain();
    this.bus.gain.value = 0.62;

    // Radio de Bradislav.
    //
    // OJO: un solo `bandpass` se lleva demasiada energia y la voz deja de oirse.
    // Un walkie de verdad es un paso alto y un paso bajo EN SERIE, que recortan los
    // extremos pero dejan intacto el medio, mas un realce de presencia para que la
    // palabra siga siendo inteligible sobre la musica.
    this.radioHP = ctx.createBiquadFilter();
    this.radioHP.type = 'highpass';
    this.radioHP.frequency.value = 300;

    this.radioLP = ctx.createBiquadFilter();
    this.radioLP.type = 'lowpass';
    this.radioLP.frequency.value = 3600;

    this.radioPresence = ctx.createBiquadFilter();
    this.radioPresence.type = 'peaking';
    this.radioPresence.frequency.value = 2100;
    this.radioPresence.Q.value = 1.1;
    this.radioPresence.gain.value = 5;

    // El realce de presencia ya aporta +5 dB, asi que la compensacion es menor de lo
    // que parece: con 2.2 el pico se iba a +10 dBFS y distorsionaba.
    this.radioBus = ctx.createGain();
    this.radioBus.gain.value = 0.40;

    this.radio = this.radioHP;        // punto de entrada de la cadena
    this.radioHP.connect(this.radioLP).connect(this.radioPresence)
      .connect(this.radioBus).connect(ctx.destination);
    this.bus.connect(ctx.destination);

    // Analizador sobre el bus de radio.
    //
    // Sirve para que el recuadro de Bradislav reaccione a la voz DE VERDAD en vez
    // de con una animacion falsa: las barras siguen la envolvente real, asi que se
    // paran en las pausas y suben en las silabas fuertes. Es lo que hace creer que
    // hay alguien al otro lado.
    //
    // 256 muestras es deliberadamente poco: se quiere la energia, no el espectro,
    // y cuanto menor el tamaño menor el coste por frame.
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.55;
    this.radioBus.connect(this.analyser);
    this._levels = new Uint8Array(this.analyser.frequencyBinCount);

    /**
     * Analizador de LIP SYNC, sobre las DOS cadenas.
     *
     * El de arriba cuelga solo del bus de radio y sirve al recuadro de Bradislav. Este
     * escucha tambien la voz directa, porque el que mueve la boca en pantalla es
     * Borislov y su voz no pasa por la radio.
     *
     * `fftSize` 512 y no 256: para abrir la boca basta la energia, pero para
     * distinguir una "a" de una "i" hace falta saber DONDE esta esa energia, y con
     * 128 bandas cada una cubre 172 Hz — demasiado grueso para separar la zona grave
     * de la aguda con algo de fiabilidad.
     */
    this.mouthAnalyser = ctx.createAnalyser();
    this.mouthAnalyser.fftSize = 512;
    this.mouthAnalyser.smoothingTimeConstant = 0.35;
    this.bus.connect(this.mouthAnalyser);
    this.radioBus.connect(this.mouthAnalyser);
    this._mouthTime = new Uint8Array(this.mouthAnalyser.fftSize);
    this._mouthFreq = new Uint8Array(this.mouthAnalyser.frequencyBinCount);
  }

  /**
   * La forma de la boca AHORA, a partir de la voz que esta sonando de verdad.
   *
   * Devuelve `{ abierta, ancha, quien }`:
   *
   *   `abierta`  0..1 — cuanto se separa la mandibula. Sale del RMS, no del pico: el
   *              pico salta con cualquier chasquido y la boca daria tirones sin
   *              relacion con la palabra.
   *   `ancha`    0..1 — cuanto se estira la boca a los lados. Sale del centroide
   *              espectral: las vocales cerradas y anteriores ("i", "e") llevan la
   *              energia arriba, las abiertas ("a", "o") abajo. No es un detector de
   *              fonemas — es la aproximacion barata que separa "aaa" de "iii", que
   *              es el 80 % de lo que el ojo nota a esta distancia.
   *
   * Un lip sync de verdad usa visemas horneados con Rhubarb sobre el texto; eso es la
   * spec 028. Esto es el prototipo que demuestra que la cadena funciona: el audio ya
   * pasa por un analizador, el rig ya llega hasta la cabeza, y la boca se mueve con lo
   * que se oye y se para en los silencios sin que nadie autore nada.
   */
  mouthShape() {
    if (!this.mouthAnalyser || !this.current) return { abierta: 0, ancha: 0, quien: null };

    this.mouthAnalyser.getByteTimeDomainData(this._mouthTime);
    let sum = 0;
    for (let i = 0; i < this._mouthTime.length; i += 1) {
      const v = (this._mouthTime[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / this._mouthTime.length);

    this.mouthAnalyser.getByteFrequencyData(this._mouthFreq);
    let energia = 0;
    let pesada = 0;
    for (let i = 1; i < this._mouthFreq.length; i += 1) {
      const a = this._mouthFreq[i];
      energia += a;
      pesada += a * i;
    }
    // Centroide normalizado 0..1 sobre las bandas. El habla se mueve entre 0,04 y
    // 0,22 con este tamaño de FFT; fuera de ahi es ruido o silencio.
    const centroide = energia > 0 ? (pesada / energia) / this._mouthFreq.length : 0;

    return {
      abierta: Math.min(1, rms * 5.0),
      ancha: Math.min(1, Math.max(0, (centroide - 0.05) / 0.16)),
      quien: this.current.line.speaker,
    };
  }

  async load() {
    const files = new Set();
    for (const line of Object.values(LINES)) if (line.audio) files.add(line.audio);

    await Promise.all([...files].map(async (file) => {
      try {
        const bytes = await (await fetch(this.baseUrl + file)).arrayBuffer();
        this.buffers.set(file, await this.ctx.decodeAudioData(bytes));
      } catch { /* sin grabar todavia: se usa solo el subtitulo */ }
    }));

    return this.buffers.size;
  }

  get speaking() { return this.current !== null; }

  /**
   * Elige la primera variante no usada de una lista y la reproduce.
   * @param {string|string[]} ids
   */
  /** Quien esta hablando ahora mismo, o null. */
  get speaking() { return this.current ? this.current.line.speaker : null; }

  /**
   * Nivel de la voz de radio, 0..1. Devuelve 0 si no esta hablando por radio.
   *
   * Se mide como RMS sobre el dominio del tiempo, no como pico: el pico salta con
   * cualquier chasquido y las barras darian tirones sin relacion con la palabra.
   */
  radioLevel() {
    if (!this.analyser || !this.current) return 0;
    if (this.current.line.speaker !== SPEAKER.BRADISLAV) return 0;
    this.analyser.getByteTimeDomainData(this._levels);
    let sum = 0;
    for (let i = 0; i < this._levels.length; i += 1) {
      const v = (this._levels[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / this._levels.length);
    return Math.min(1, rms * 4.5);   // el habla normal se queda sobre 0,2 de RMS
  }

  say(ids, options = {}) {
    const list = Array.isArray(ids) ? ids : [ids];
    const id = list.find((candidate) => !this.used.has(candidate));
    if (!id || !LINES[id]) return false;

    // Una linea en curso solo se interrumpe si la nueva es mas importante.
    if (this.current && !options.priority) { this.queue.push({ id, options }); return false; }

    this._play(id, options);
    return true;
  }

  _play(id, options = {}) {
    const line = LINES[id];
    this.used.add(id);

    const style = SPEAKER_STYLE[line.speaker];
    if (this.el) {
      this.el.innerHTML = `<b style="color:${style.color}">${style.name}</b> ${line.text}`;
      this.el.classList.add('show');
    }

    const buffer = line.audio && this.buffers.get(line.audio);
    // Sin audio, el subtitulo dura segun la longitud del texto: ~14 caracteres/segundo.
    const duration = buffer ? buffer.duration : Math.max(1.6, line.text.length / 14);

    if (buffer) {
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(line.speaker === SPEAKER.BRADISLAV ? this.radio : this.bus);
      source.start();
      this._source = source;
    }

    if (this.onDuck) this.onDuck(true);

    this.current = { id, line, endsAt: this.ctx.currentTime + duration + 0.35 };
  }

  update() {
    if (!this.current) return;
    if (this.ctx.currentTime < this.current.endsAt) return;

    this.current = null;
    this._source = null;
    if (this.el) this.el.classList.remove('show');
    if (this.onDuck) this.onDuck(false);

    const next = this.queue.shift();
    if (next) this._play(next.id, next.options);
  }

  /** Corta lo que suene: se usa al reaparecer o al saltar una cinematica. */
  stop() {
    if (this._source) { try { this._source.stop(); } catch { /* ya parada */ } }
    this.current = null;
    this._source = null;
    this.queue.length = 0;
    if (this.el) this.el.classList.remove('show');
    if (this.onDuck) this.onDuck(false);
  }
}
