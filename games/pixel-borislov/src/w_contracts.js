/**
 * Vocabulario compartido del mundo.
 *
 * Enumeraciones sin comportamiento: los tipos de suelo que el nivel declara y los
 * verbos que el jugador tiene. No hacen nada, solo nombran.
 *
 * ---- por que existe este archivo ----
 *
 * Al partir el motor en subsistemas (spec 035) aparecieron dos dependencias que
 * cruzaban una frontera dura, y las dos por lo mismo: para leer una constante.
 *
 *   `level.js` importaba `physics.js` solo para `SURFACE`  ->  w_ dependia de p_
 *   `player.js` importaba `input.js`  solo para `ACTIONS`  ->  p_ dependia de i_
 *
 * Ninguna de las dos necesitaba el modulo entero. Sacar el vocabulario a `w_`, que
 * es lo unico que todos pueden importar, deshace las dos de un golpe — y ademas es
 * donde conceptualmente vive: los tipos de superficie son parte del lenguaje con el
 * que se declara un nivel, no de como se resuelve una colision.
 *
 * Los modulos que las definian las siguen **reexportando**, para no obligar a tocar
 * a los veinte sitios que ya las importaban de ahi.
 */

/**
 * Superficies del suelo.
 *
 * Cada segmento de la polilinea de colision trae la suya, y de ella salen el sonido
 * del paso y las particulas (plan §8b.4). Hoy se escriben a mano en el nivel; el
 * horneado desde Blender deberia producirlas (TDB-011).
 */
export const SURFACE = {
  TIERRA: 'tierra',
  MADERA: 'madera',
  METAL: 'metal',
  TEJADO: 'tejado',
  HIERBA: 'hierba',
  AGUA: 'agua',
};

/**
 * Acciones abstractas.
 *
 * Se mapea a acciones y no a teclas para que anadir gamepad o tactil despues no
 * obligue a tocar el resto del motor. El playsim pregunta por el verbo; quien lo
 * traduce desde el teclado es `i_input.js`, y el playsim no sabe que existe.
 */
export const ACTIONS = {
  LEFT: 'left',
  RIGHT: 'right',
  UP: 'up',
  DOWN: 'down',
  JUMP: 'jump',
  ACTION: 'action',
  THROW: 'throw',             // lanzamiento rapido, a una mano
  THROW_HEAVY: 'throwHeavy',  // lanzamiento cargado, a dos manos
  CAST: 'cast',               // abrir un Portal de Idea temporal
  PAUSE: 'pause',
};
