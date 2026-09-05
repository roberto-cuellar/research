/**
 * Diccionario de transiciones de cámara.
 *
 * Todas son trucos de cámara y post-proceso: no tocan la escena, no descargan nada y
 * no quitan el control. Y todas tienen el mismo trabajo doble — decir algo
 * (desconcierto, impulso, revelación) y **tapar** un cambio de assets en el instante
 * en que la imagen es ilegible.
 *
 * Cada entrada declara sus parámetros y NADA más: ajustar una transición es editar
 * números aquí, no tocar el motor. Esa es la razón de que exista el diccionario.
 *
 * ── Vocabulario ──────────────────────────────────────────────────────────────
 *
 *   roll      giro sobre el eje de la cámara, en radianes. Es el que convierte un
 *             desenfoque en desorientación; sin él, el blur se lee como tirón.
 *   dolly     alejamiento o acercamiento físico de la cámara, en metros.
 *   fov       cambio de campo de visión, en grados. Con `dolly` opuesto da el
 *             *dolly zoom* de Vértigo: el sujeto no cambia y el fondo se abalanza.
 *   blur      desenfoque direccional 0..1, el sustituto del motion blur.
 *   shake     sacudida puntual 0..1, en el instante de la ocultación.
 *   tremor    sacudida SOSTENIDA 0..1 durante toda la transición. Distinta del
 *             anterior: aquella es un golpe, esta es un temblor que acompaña. Y
 *             alimenta un poco el desenfoque, porque una cámara que tiembla
 *             emborrona — ligarlas es lo que hace que se lea como una sola cosa.
 *   warp      distorsión de lente (barril) durante la transición. Es lo que curva
 *             la imagen: sin ella el giro se lee como una foto que rota, con ella
 *             se lee como pasar POR algo. Va en la misma unidad que la distorsión
 *             sostenida de los momentos.
 *   flash     destello a pantalla completa 0..1 en el punto de ocultación.
 *   duckDb    cuánto se hunde el brillo de la música, en dB.
 *   hide      0..1 — en qué punto del recorrido se cambian los assets. 0,5 es el
 *             pico; valores altos lo dejan para la salida.
 *   bars      duración en compases, entrada y salida. Todo el juego está
 *             cronometrado a 111 BPM, así que nada dura "medio segundo".
 *   ease      curva. `suave` (smoothstep) para respirar, `latigo` para el golpe.
 */

/** Curvas. `latigo` sube casi de golpe y baja despacio: es la del whip pan. */
export const EASE = {
  suave: (k) => k * k * (3 - 2 * k),
  latigo: (k) => 1 - Math.pow(1 - k, 4),
  golpe: (k) => (k < 0.5 ? 8 * k * k * k * k : 1 - Math.pow(-2 * k + 2, 4) / 2),
  lineal: (k) => k,
};

export const TRANSITIONS = {
  /**
   * WHIP PAN — el barrido.
   *
   * El truco más usado del cine de acción para ocultar un corte: la cámara barre a
   * una velocidad que la imagen no puede resolver, y en el borrón se cambia el
   * plano. Aquí es *el* recurso para pasar de etapa sin que se vea el cambio.
   */
  whip: {
    label: 'Barrido',
    bars: [0.75, 0.75],
    roll: 0.05, dolly: 0.8, fov: 5, blur: 1.0,
    shake: 0.25, tremor: 0.5, warp: 0.22, flash: 0.15, duckDb: -16,
    hide: 0.5, ease: 'latigo',
  },

  /**
   * TRANCE — el sueño.
   *
   * Giro largo con desenfoque sostenido. Es lento a propósito: comunica que el mundo
   * está cambiando, no que la cámara se ha movido. Para entrar al Proyector y para
   * los cambios de escenario que el jugador debe *notar*.
   */
  trance: {
    label: 'Trance',
    bars: [1.0, 1.0],
    // ---- atravesar un portal ----
    //
    // Historial de este numero, porque es facil pasarse: 0,22 rad (12 grados) era el
    // valor de partida y sabia a poco; media vuelta (3,14) marea y ademas aleja
    // tanto la escena que la transicion deja de tapar nada, que era su trabajo.
    //
    // El punto esta en 0,26 — el original mas un 20 %. Suficiente para que el
    // horizonte se incline y el cambio se lea como consecuencia del cruce, sin que
    // el jugador pierda la referencia de donde esta.
    //
    // El alejamiento va emparejado: 3 m. El desenfoque y la curvatura hacen el resto
    // del trabajo de ocultar, y son mucho mas baratos de leer que un giro grande.
    roll: 0.26, dolly: 3.0, fov: 6, blur: 1.0,
    shake: 0.35, tremor: 0.45, warp: 0.42, flash: 0.55, duckDb: -22,
    hide: 0.5, ease: 'suave',
  },

  /**
   * CRASH ZOOM — el puñetazo.
   *
   * Golpe de FOV muy corto hacia dentro y vuelta. Sin desenfoque y sin giro: lo que
   * comunica es urgencia, no confusión. Para una aparición o un susto.
   */
  crash: {
    label: 'Zoom seco',
    bars: [0.25, 0.5],
    roll: 0, dolly: -3.5, fov: -12, blur: 0.25,
    shake: 0.8, warp: 0.3, flash: 0.0, duckDb: -8,
    hide: 0.35, ease: 'golpe',
  },

  /**
   * VÉRTIGO — el dolly zoom de Hitchcock.
   *
   * La cámara se aleja mientras la FOV se cierra: el sujeto conserva su tamaño y lo
   * que se deforma es el fondo. Es el plano de "algo va mal" y no debe usarse para
   * nada más, o deja de significarlo.
   */
  vertigo: {
    label: 'Vértigo',
    bars: [1.5, 1.0],
    roll: 0, dolly: 4.5, fov: -11, blur: 0.0,
    shake: 0.15, tremor: 0.18, warp: 0.16, flash: 0.0, duckDb: -6,
    hide: 0.85, ease: 'suave',
  },

  /**
   * PUSH IN — el acercamiento.
   *
   * Lento, sin efectos. Concentra la atención en algo concreto. Es el más discreto
   * del diccionario y el único que se puede repetir sin cansar.
   */
  push: {
    label: 'Acercamiento',
    bars: [1.0, 0.75],
    roll: 0, dolly: -5.0, fov: 0, blur: 0.0,
    shake: 0.0, flash: 0.0, duckDb: 0,
    hide: 0.9, ease: 'suave',
  },

  /**
   * FLASH CUT — el fogonazo.
   *
   * El más barato y el más honesto: un destello tapa el cambio y ya está. Cuando la
   * transición no tiene que decir nada, esta es la correcta — las demás añaden
   * significado que a veces sobra.
   */
  flash: {
    label: 'Fogonazo',
    bars: [0.25, 0.5],
    roll: 0, dolly: 0, fov: 0, blur: 0.35,
    shake: 0.35, warp: 0.25, flash: 1.0, duckDb: -12,
    hide: 0.5, ease: 'golpe',
  },
};

/**
 * Reproductor de transiciones.
 *
 * Mantiene el estado de la que esté corriendo y expone los valores que la cámara y
 * el post-proceso tienen que aplicar. No dibuja nada por su cuenta: quien pinta es
 * el bucle, que es donde ya vive la cámara.
 */
export class TransitionPlayer {
  constructor(hooks = {}) {
    this.hooks = hooks;      // {onHide, onFlash, onDuck}
    this.active = null;
    // Valores que lee el bucle cada frame.
    this.roll = 0;
    this.dolly = 0;
    this.fov = 0;
    this.blur = 0;
    this.flash = 0;
    this.tremor = 0;
    this.warp = 0;
  }

  get running() { return this.active !== null; }

  /**
   * @param {string} name  clave de TRANSITIONS
   * @param {number} barSeconds  duración de un compás
   * @param {object} [payload]  lo que se le pasa a `onHide` — típicamente la URL
   *   del escenario nuevo
   * @param {object} [overrides]  ajustes puntuales sin tocar el diccionario
   */
  start(name, barSeconds, payload = null, overrides = null) {
    if (this.active) return false;
    const base = TRANSITIONS[name];
    if (!base) return false;

    const spec = overrides ? { ...base, ...overrides } : base;
    const [inBars, outBars] = spec.bars;
    this.active = {
      spec, payload, t: 0,
      in: inBars * barSeconds,
      out: outBars * barSeconds,
      hidden: false,
    };
    if (spec.duckDb) this.hooks.onDuck?.(spec.duckDb, inBars * barSeconds * 0.8);
    return true;
  }

  update(dt) {
    const a = this.active;
    if (!a) return;
    a.t += dt;

    const total = a.in + a.out;
    // Sube durante la entrada y baja durante la salida.
    const k = a.t <= a.in ? a.t / a.in : Math.max(0, 1 - (a.t - a.in) / a.out);
    const e = (EASE[a.spec.ease] || EASE.suave)(k);

    this.roll = a.spec.roll * e;
    this.dolly = a.spec.dolly * e;
    this.fov = a.spec.fov * e;
    this.blur = a.spec.blur * e;
    this.tremor = (a.spec.tremor || 0) * e;
    this.warp = (a.spec.warp || 0) * e;
    // El temblor aporta desenfoque: una camara que vibra emborrona, y ligarlos hace
    // que las dos cosas se lean como un solo efecto en vez de como dos capas sueltas.
    this.blur = Math.min(1, this.blur + this.tremor * 0.35);
    // El destello es un pico, no una rampa: solo existe alrededor del ocultamiento.
    const dHide = Math.abs(a.t / total - a.spec.hide);
    this.flash = a.spec.flash * Math.max(0, 1 - dHide * 12);

    if (!a.hidden && a.t >= total * a.spec.hide) {
      a.hidden = true;
      this.hooks.onHide?.(a.payload, a.spec);
      if (a.spec.shake) this.hooks.onShake?.(a.spec.shake);
      if (a.spec.duckDb) this.hooks.onDuck?.(0, a.out * 0.9);
    }

    if (a.t >= total) {
      this.active = null;
      this.roll = this.dolly = this.fov = this.blur = this.flash = 0;
      this.tremor = this.warp = 0;
    }
  }
}
