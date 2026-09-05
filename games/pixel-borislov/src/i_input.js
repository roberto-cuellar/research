/**
 * Entrada de teclado -> acciones abstractas.
 *
 * Se mapea a acciones y no a teclas para que anadir gamepad o tactil despues
 * no obligue a tocar el resto del motor.
 */

/**
 * Vive en `w_contracts.js` desde la spec 035: el playsim necesita el verbo, no el
 * teclado, y asi deja de depender de este modulo (que es de plataforma).
 */
export { ACTIONS } from './w_contracts.js';
import { ACTIONS } from './w_contracts.js';

const DEFAULT_MAP = {
  ArrowLeft: ACTIONS.LEFT,
  KeyA: ACTIONS.LEFT,
  ArrowRight: ACTIONS.RIGHT,
  KeyD: ACTIONS.RIGHT,
  ArrowUp: ACTIONS.UP,
  KeyW: ACTIONS.UP,
  ArrowDown: ACTIONS.DOWN,
  KeyS: ACTIONS.DOWN,
  Space: ACTIONS.JUMP,
  KeyE: ACTIONS.ACTION,
  KeyQ: ACTIONS.THROW,
  KeyF: ACTIONS.THROW_HEAVY,
  KeyR: ACTIONS.CAST,
  Escape: ACTIONS.PAUSE,
  KeyP: ACTIONS.PAUSE,
};

export class Input {
  constructor(target = window, map = DEFAULT_MAP) {
    this.map = map;
    this.held = new Set();
    this.pressedThisFrame = new Set();
    this.releasedThisFrame = new Set();

    this._onDown = (event) => {
      const action = this.map[event.code];
      if (!action) return;
      // Space hace scroll y las flechas mueven la pagina: se cortan aqui.
      event.preventDefault();
      if (!this.held.has(action)) this.pressedThisFrame.add(action);
      this.held.add(action);
    };

    this._onUp = (event) => {
      const action = this.map[event.code];
      if (!action) return;
      event.preventDefault();
      this.held.delete(action);
      this.releasedThisFrame.add(action);
    };

    // Si la ventana pierde el foco, se sueltan todas: evita quedarse corriendo solo.
    this._onBlur = () => {
      for (const action of this.held) this.releasedThisFrame.add(action);
      this.held.clear();
    };

    target.addEventListener('keydown', this._onDown);
    target.addEventListener('keyup', this._onUp);
    window.addEventListener('blur', this._onBlur);
    this._target = target;

    /**
     * EJES ANALOGICOS, para el joystick tactil.
     *
     * El teclado solo sabe decir -1, 0 o 1; un joystick dice cuanto. Se guarda aparte y
     * `axisX`/`axisY` lo prefieren cuando esta activo, asi que el playsim sigue leyendo
     * lo mismo que siempre y no se entera de que hay tactil — que es la razon por la que
     * este modulo mapea a ACCIONES y no a teclas desde el primer dia.
     */
    this._eje = { x: 0, y: 0, activo: false };
  }

  /**
   * Escribe los ejes desde un mando analogico (joystick tactil o gamepad).
   *
   * @param {number} x -1..1
   * @param {number} y -1..1, con ARRIBA negativo (misma convencion que `axisY`)
   */
  setEje(x, y) {
    const m = Math.hypot(x, y);
    // Zona muerta: un dedo apoyado sin intencion mueve el stick unos pocos pixeles, y
    // sin esto el personaje deriva solo. 0,12 es la que no se nota al empujar.
    if (m < 0.12) { this._eje.x = 0; this._eje.y = 0; this._eje.activo = false; return; }
    // Se recorta a la circunferencia: en diagonal, dos ejes a 1 darian 1,41 y el
    // personaje correria mas en diagonal que en recto.
    const k = m > 1 ? 1 / m : 1;
    this._eje.x = x * k;
    this._eje.y = y * k;
    this._eje.activo = true;
  }

  /** Suelta el joystick: vuelve a mandar el teclado. */
  soltarEje() { this._eje.x = 0; this._eje.y = 0; this._eje.activo = false; }

  /**
   * Pulsa una accion desde la interfaz (un boton en pantalla).
   *
   * Entra por la MISMA puerta que una tecla —`held` y `pressedThisFrame`—, asi que
   * `justPressed` funciona igual y no hay una segunda ruta que mantener.
   */
  pulsar(accion) {
    if (!this.held.has(accion)) this.pressedThisFrame.add(accion);
    this.held.add(accion);
  }

  /** Suelta una accion pulsada desde la interfaz. */
  soltar(accion) {
    if (!this.held.has(accion)) return;
    this.held.delete(accion);
    this.releasedThisFrame.add(accion);
  }

  isDown(action) { return this.held.has(action); }
  justPressed(action) { return this.pressedThisFrame.has(action); }
  justReleased(action) { return this.releasedThisFrame.has(action); }

  /** Eje horizontal en [-1, 1]. El joystick manda si esta activo; si no, el teclado. */
  get axisX() {
    if (this._eje.activo) return this._eje.x;
    return (this.isDown(ACTIONS.RIGHT) ? 1 : 0) - (this.isDown(ACTIONS.LEFT) ? 1 : 0);
  }

  /**
   * Eje vertical en [-1, 1], para el plano cenital del laberinto (spec 038).
   *
   * ARRIBA es NEGATIVO a proposito: en el laberinto la fila 0 de la rejilla es la de
   * arriba de la pantalla, asi que subir es ir a una `y` MENOR. Que el signo del
   * input y el de los datos coincidan evita la conversion que siempre se olvida en
   * algun sitio.
   *
   * En el platformer nadie lo usa: alli ARRIBA/ABAJO no mueven, y el salto es JUMP.
   */
  get axisY() {
    if (this._eje.activo) return this._eje.y;
    return (this.isDown(ACTIONS.DOWN) ? 1 : 0) - (this.isDown(ACTIONS.UP) ? 1 : 0);
  }

  /** Se llama al final de cada tick logico, no de cada frame de render. */
  endFrame() {
    this.pressedThisFrame.clear();
    this.releasedThisFrame.clear();
  }

  dispose() {
    this._target.removeEventListener('keydown', this._onDown);
    this._target.removeEventListener('keyup', this._onUp);
    window.removeEventListener('blur', this._onBlur);
  }
}
