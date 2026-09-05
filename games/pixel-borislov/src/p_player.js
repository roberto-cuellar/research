/**
 * Movimiento del jugador y maquina de estados.
 *
 * Los valores salen del plan §25, que a su vez adapta los de BASE_2D_PLATAFORMER
 * (ya afinados jugando) a metros y segundos.
 *
 * Detalle deliberado: el arco del salto dura 1,5 pulsos a 111 BPM (0,81 s). Todo el
 * juego esta cronometrado a la musica, asi que si el salto tambien cae en la rejilla,
 * el movimiento se siente coreografiado sin que el jugador sepa por que.
 */

import { ACTIONS } from './w_contracts.js';

export const STATE = {
  IDLE: 'idle',
  WALK: 'walk',
  RUN: 'run',
  JUMP: 'jump',
  DOUBLE_JUMP: 'doubleJump',
  FALL: 'fall',
  LAND: 'land',
  HARD_LANDING: 'hardLanding',
  ROLL: 'roll',
  WALL_SLIDE: 'wallSlide',
  // Estados dirigidos por el juego, no por el input: los fuerza el director o el
  // clímax. El jugador no puede entrar en ellos por su cuenta.
  REPAIR: 'repair',
  STUMBLE: 'stumble',
  /**
   * Romper el suelo. El GESTO de cobro del GDD §7.
   *
   * El clip `stomp` llevaba horneado y en el set de gameplay desde el principio, y no
   * habia ningun estado que lo usara: la propia investigacion lo señalaba como "existe
   * y falta el estado que lo use". Este es ese estado.
   */
  STOMP: 'stomp',
  THROW: 'throw',         // lanzamiento rapido
  THROW_HEAVY: 'throwHeavy',  // lanzamiento cargado
  CAST: 'cast',           // abrir un Portal de Idea temporal
  PUSH: 'push',           // empujar una caja en marcha
  PUSH_STOP: 'pushStop',  // apoyado en ella, sin avanzar
  WAVE: 'wave',           // saludar: "¡Hola! ¡Vengan, tienen que ver esto!"
  CELEBRATE: 'celebrate', // el baile de cierre
};

export const TUNING = {
  // Locomocion
  walkSpeed: 3.2,
  runSpeed: 6.0,
  /**
   * Techo de la velocidad AUTORAL — la que fija el juego en un tramo con `runner`, no
   * la que alcanza el jugador por su cuenta.
   *
   * Existe para que `r_animator.js` pueda dimensionar la cadencia de los clips sin
   * conocer el nivel. Si un tramo declara una velocidad por encima de esto, la
   * animacion se queda corta y el personaje patina: subir el runner es subir tambien
   * este numero. Hoy el mayor es el tramo 5, a 7,6.
   */
  runnerMaxSpeed: 8.0,
  runRampTime: 0.40,      // sin boton de correr: se acelera sola manteniendo direccion
  accelGround: 40,
  accelAir: 20,
  frictionGround: 30,
  frictionAir: 6,
  turnBoost: 2.0,
  turnBoostTime: 0.10,

  // Salto: h=2,4 m con gravedad asimetrica -> 0,81 s de arco
  jumpHeight: 2.4,
  jumpVelocity: 10.66,
  gravityUp: 23.7,
  gravityDown: 36.8,
  shortHopMultiplier: 3.0,  // al soltar, la subida se corta
  coyoteTime: 0.12,
  jumpBuffer: 0.12,
  apexThreshold: 1.5,
  apexGravityScale: 0.6,
  apexTime: 0.08,

  doubleJumpVelocity: 8.5,
  maxJumps: 2,
  doubleJumpLockout: 0.10,

  // Aterrizaje
  hardLandingDrop: 3.0,
  hardLandingTime: 0.25,
  landTime: 0.10,
  rollTime: 0.45,

  // Pared
  wallSlideMaxFall: 2.0,
  // Con 9.5 el salto de pared subia 1,90 m, MENOS que un salto normal (2,40): se
  // sentia como un tropiezo en vez de un impulso. Con 11.2 sube 2,65 m, un punto por
  // encima del salto normal, que es lo que un pateo de pared debe dar.
  wallJumpX: 6.5,
  wallJumpY: 11.2,
  wallJumpLockout: 0.18,

  // Bordillos de hasta esta altura se suben andando. Sin esto, un escalon de 40 cm
  // es un muro y el personaje se siente torpe.
  maxStep: 0.42,

  maxFallSpeed: 24,
};

export class Player {
  constructor(world, options = {}) {
    this.world = world;
    this.tuning = { ...TUNING, ...(options.tuning || {}) };

    this.width = options.width ?? 0.55;
    this.height = options.height ?? 1.48;

    this.body = { x: options.x ?? 0, y: options.y ?? 0, w: this.width, h: this.height };
    this.velocity = { x: 0, y: 0 };

    this.layer = options.layer ?? 0;
    this.facing = 1;
    this.state = STATE.IDLE;
    this.previousState = STATE.IDLE;

    this.grounded = false;
    this.surface = null;
    this.wall = 0;

    this._coyote = 0;
    this._buffer = 0;
    this._jumps = 0;
    this._apex = 0;
    this._runRamp = 0;
    this._turnBoost = 0;
    this._stateTimer = 0;
    this._hold = 0;
    this._lockout = 0;
    this._jumpHeld = false;
    this._peakY = this.body.y;

    // Telemetria para el HUD de depuracion.
    this.debug = { fallDrop: 0, lastLanding: '-' };
  }

  get position() { return { x: this.body.x + this.width / 2, y: this.body.y }; }

  setState(next) {
    if (this.state === next) return;
    this.previousState = this.state;
    this.state = next;
    this._stateTimer = 0;
    // El bloqueo pertenece al estado que lo pidio. Sin esto, el de `jump` sobrevivia
    // al aterrizaje y dejaba al personaje clavado casi un segundo tras caer.
    this._hold = 0;
    this._holdMomentum = false;
  }

  /**
   * Retiene el estado hasta que su animacion termine.
   *
   * Sin esto, una rodada de 1,8 s se cortaba a los 0,45 s porque el estado volvia a
   * `walk` en cuanto habia velocidad: se veia al personaje empezar a rodar y saltar
   * de golpe a caminar. Lo fija el juego, que es quien conoce la duracion del clip.
   */
  holdState(seconds, keepMomentum = false) {
    this._hold = Math.max(this._hold || 0, seconds);
    this._holdMomentum = keepMomentum;
  }

  update(input, dt) {
    const t = this.tuning;
    this._stateTimer += dt;
    if (this._lockout > 0) this._lockout -= dt;
    if (this._hold > 0) this._hold -= dt;

    // Mientras una animacion retiene el estado, el jugador NO controla. Si no, se ve
    // al personaje rodando por el suelo mientras camina hacia donde quiere.
    // El bloqueo por animacion tiene dos sabores. Sin `keepMomentum` ademas de
    // fijar el estado ANULA el eje, que es lo que hace falta en una rodada o un
    // aterrizaje duro. Con `keepMomentum` solo fija el estado y deja andar — es lo
    // que necesita empujar: si se le quita el eje al jugador, la caja se le escapa,
    // se pierde el contacto y el estado oscila entre `push` y `walk` varias veces
    // por segundo, con la animacion reiniciandose sin llegar a verse nunca.
    const held = this._hold > 0 && this.grounded && !this._holdMomentum;
    const axis = (this._lockout > 0 || held) ? 0 : input.axisX;

    // ---------------------------------------------------------------- suelo
    const surfaceUnder = this.world.isGrounded(this.body, this.layer);
    const wasGrounded = this.grounded;
    this.grounded = surfaceUnder !== null && this.velocity.y <= 0.001;
    this.surface = surfaceUnder;

    if (this.grounded) {
      this._coyote = t.coyoteTime;
      this._jumps = 0;
    } else if (this._coyote > 0) {
      this._coyote -= dt;
    }

    // Altura de caida, para distinguir aterrizaje suave de duro.
    if (!this.grounded && this.velocity.y > 0) this._peakY = Math.max(this._peakY, this.body.y);
    if (!this.grounded) this._peakY = Math.max(this._peakY, this.body.y);

    // ------------------------------------------------------------ horizontal
    const targetTop = t.walkSpeed + (t.runSpeed - t.walkSpeed) * this._runRamp;

    if (axis !== 0) {
      if (Math.sign(axis) !== Math.sign(this.velocity.x) && this.velocity.x !== 0) {
        this._turnBoost = t.turnBoostTime;
        this._runRamp = 0;
      }
      this.facing = Math.sign(axis);
      this._runRamp = Math.min(1, this._runRamp + dt / t.runRampTime);

      let accel = this.grounded ? t.accelGround : t.accelAir;
      if (this._turnBoost > 0) { accel *= t.turnBoost; this._turnBoost -= dt; }

      this.velocity.x += axis * accel * dt;
      this.velocity.x = Math.max(-targetTop, Math.min(targetTop, this.velocity.x));
    } else {
      this._runRamp = Math.max(0, this._runRamp - dt / t.runRampTime);
      // La rodada CONSERVA el impulso (plan §25.2): es la recompensa por mantener la
      // direccion al caer. Con friccion normal se pararia en seco a mitad del giro.
      const drag = (held && this._holdMomentum)
        ? t.frictionGround * 0.12
        : (this.grounded ? t.frictionGround : t.frictionAir);
      const friction = drag * dt;
      if (Math.abs(this.velocity.x) <= friction) this.velocity.x = 0;
      else this.velocity.x -= Math.sign(this.velocity.x) * friction;
    }

    // ----------------------------------------------------------------- pared
    this.wall = this.world.wallSide(this.body, this.layer);
    const wallSliding = !this.grounded && this.wall !== 0
      && this.velocity.y < 0 && Math.sign(axis) === this.wall;

    // ----------------------------------------------------------------- salto
    if (input.justPressed(ACTIONS.JUMP)) this._buffer = t.jumpBuffer;
    if (this._buffer > 0) this._buffer -= dt;
    if (input.justPressed(ACTIONS.JUMP)) this._jumpHeld = true;
    if (input.justReleased(ACTIONS.JUMP)) this._jumpHeld = false;

    const wantsJump = this._buffer > 0;
    if (wantsJump) {
      if (wallSliding) {
        this.velocity.x = -this.wall * t.wallJumpX;
        this.velocity.y = t.wallJumpY;
        this._lockout = t.wallJumpLockout;
        this._buffer = 0;
        this._jumps = 1;
        this.facing = -this.wall;
        this.setState(STATE.JUMP);
      } else if (this.grounded || this._coyote > 0) {
        this.velocity.y = t.jumpVelocity;
        this._coyote = 0;
        this._buffer = 0;
        this._jumps = 1;
        this._peakY = this.body.y;
        this.setState(STATE.JUMP);
      } else if (this._jumps < t.maxJumps && this._stateTimer > t.doubleJumpLockout) {
        this.velocity.y = t.doubleJumpVelocity;
        this._buffer = 0;
        this._jumps += 1;
        this.setState(STATE.DOUBLE_JUMP);
      }
    }

    // -------------------------------------------------------------- gravedad
    let gravity = this.velocity.y > 0 ? t.gravityUp : t.gravityDown;

    // Toque corto: al soltar en plena subida, se corta el salto.
    if (this.velocity.y > 0 && !this._jumpHeld) gravity *= t.shortHopMultiplier;

    // Flotacion en el apice: es lo que hace que un salto se sienta "bueno".
    if (Math.abs(this.velocity.y) < t.apexThreshold && !this.grounded) {
      this._apex = Math.min(t.apexTime, this._apex + dt);
      gravity *= t.apexGravityScale;
    } else {
      this._apex = 0;
    }

    if (!this.grounded) {
      this.velocity.y -= gravity * dt;
      if (wallSliding) this.velocity.y = Math.max(this.velocity.y, -t.wallSlideMaxFall);
      this.velocity.y = Math.max(this.velocity.y, -t.maxFallSpeed);
    } else if (this.velocity.y < 0) {
      this.velocity.y = 0;
    }

    // ------------------------------------------------------------ resolucion
    const hit = this.world.move(this.body, this.velocity, dt, this.layer, {
      // Solo se sube solo si vas por el suelo: en el aire un bordillo si te frena.
      maxStep: this.grounded ? t.maxStep : 0,
    });
    if (hit.grounded) this.grounded = true;

    // ---------------------------------------------------------- aterrizajes
    if (!wasGrounded && this.grounded) {
      const drop = this._peakY - this.body.y;
      this.debug.fallDrop = drop;
      // OJO: se mira la INTENCION del jugador, no el eje ya enmascarado por el
      // bloqueo. Si no, un bloqueo activo al tocar suelo convierte toda rodada en
      // aterrizaje duro, que es justo lo contrario de lo que el jugador pidio.
      const holdingDirection = input.axisX !== 0;
      if (drop >= t.hardLandingDrop) {
        // Mantener la direccion al caer convierte el castigo en recompensa:
        // ruedas y no pierdes velocidad. Es lo que permite encadenar la carrera.
        this.setState(holdingDirection ? STATE.ROLL : STATE.HARD_LANDING);
        this.debug.lastLanding = holdingDirection ? 'rodada' : 'duro';
        if (!holdingDirection) this._lockout = t.hardLandingTime;
      } else {
        this.setState(STATE.LAND);
        this.debug.lastLanding = 'suave';
      }
      this._peakY = this.body.y;
    }

    // ------------------------------------------------------- estado visible
    this._resolveState(axis, wallSliding);
  }

  _resolveState(axis, wallSliding) {
    const t = this.tuning;

    // Retencion por animacion: manda hasta que el clip acaba. Los estados aereos se
    // sueltan igualmente al tocar suelo, porque un volteo no puede seguir en tierra.
    if (this._hold > 0) {
      const airborne = this.state === STATE.JUMP || this.state === STATE.DOUBLE_JUMP
                    || this.state === STATE.FALL;
      if (!(airborne && this.grounded)) return;
      this._hold = 0;
    }

    // Los estados con duracion mandan hasta que se agotan.
    if (this.state === STATE.HARD_LANDING && this._stateTimer < t.hardLandingTime) return;
    if (this.state === STATE.ROLL && this._stateTimer < t.rollTime) return;
    if (this.state === STATE.LAND && this._stateTimer < t.landTime) return;

    if (wallSliding) { this.setState(STATE.WALL_SLIDE); return; }

    if (!this.grounded) {
      if (this.velocity.y > 0) {
        if (this.state !== STATE.DOUBLE_JUMP) this.setState(STATE.JUMP);
      } else {
        this.setState(STATE.FALL);
      }
      return;
    }

    if (axis === 0 && Math.abs(this.velocity.x) < 0.2) this.setState(STATE.IDLE);
    else if (Math.abs(this.velocity.x) > t.walkSpeed * 1.15) this.setState(STATE.RUN);
    else this.setState(STATE.WALK);
  }
}
