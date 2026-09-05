/**
 * El reloj musical: momentos, pulsos y el ciclo del loop-lock.
 *
 * `Choreography` no importa Three, pero si depende de Web Audio, que en Node no
 * existe. En vez de simularlo entero se inyecta lo minimo —un reloj y unos nodos
 * tontos— y se prueba la LOGICA, que es lo que se rompe: el cursor de momentos, la
 * posicion con el bucle cerrado, y quien arma, cierra y suelta.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Choreography } from '../src/s_choreo.js';

/** Los 9 momentos y 2 loops reales del nivel 1, con sus tiempos horneados. */
const DATOS = {
  bpm: 111,
  beatsPerBar: 4,
  beatSeconds: 0.540541,
  barSeconds: 2.162162,
  totalBars: 49,
  duration: 105.9516,
  moments: [
    { index: 0, name: 'presentacion', time: 0.0005, duration: 17.2973, bar: 1, loop: null },
    { index: 1, name: 'precombate1', time: 17.2978, duration: 8.6486, bar: 9, loop: null },
    { index: 2, name: 'combate1', time: 25.9464, duration: 17.2973, bar: 13, loop: 'loopcombate1' },
    { index: 3, name: 'postcombate1', time: 43.2437, duration: 8.6486, bar: 21, loop: null },
    { index: 4, name: 'contraste_pre_climax', time: 51.8923, duration: 2.1622, bar: 25, loop: null },
    { index: 5, name: 'climax_salvaje', time: 54.0545, duration: 17.2973, bar: 26, loop: null },
    { index: 6, name: 'contraste_oscuro', time: 71.3518, duration: 2.1622, bar: 34, loop: null },
    { index: 7, name: 'combate2', time: 73.514, duration: 17.2973, bar: 35, loop: 'loopcombate2' },
    { index: 8, name: 'postcombate2', time: 90.8113, duration: 15.1403, bar: 43, loop: null },
  ],
  loops: [
    { name: 'loopcombate1', start: 25.9464, end: 34.5950 },
    { name: 'loopcombate2', start: 73.5140, end: 82.1626 },
  ],
};

/**
 * Coreografia con el audio sustituido por dobles.
 *
 * `posicion(t)` mueve el reloj: es lo unico que hace falta para probar el resto.
 */
function coreografia() {
  const c = new Choreography();
  c.data = DATOS;
  c.ready = true;
  c.playing = true;
  const fuente = () => ({ loop: false, loopStart: 0, loopEnd: 0,
                          start() {}, stop() {}, connect() {} });
  // `seekMoment` descarta la fuente y crea otra: hay que poder fabricarlas.
  c.ctx = { currentTime: 0, createBufferSource: fuente };
  c.buffer = {};
  c.source = fuente();
  const nodo = () => ({
    value: 0, cancelScheduledValues() {}, setValueAtTime() {},
    linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {},
  });
  c.filter = { frequency: nodo(), type: 'lowpass' };
  c.shelf = { gain: nodo() };
  c.voiceNotch = { gain: nodo(), frequency: nodo(), Q: nodo() };
  c.gain = { gain: nodo() };
  c.anchor = 0;
  c.posicion = (t) => { c.ctx.currentTime = t + c.anchor; };
  return c;
}

/**
 * Avanza el reloj hasta `t` como lo haria el bucle: en pasos, con un `update()` por
 * paso.
 *
 * Hace falta porque `update()` dispara **un momento por llamada** — el cursor
 * `nextMoment` sube de uno en uno. Saltar de golpe a t=26 y llamar update() una vez
 * solo dispara `presentacion`, no `combate1`.
 */
function hasta(c, t, paso = 0.1) {
  for (let x = c.position; x <= t; x += paso) { c.posicion(x); c.update(); }
  c.posicion(t); c.update();
}

/**
 * Como `hasta`, pero haciendo de director: suelta el bucle en cuanto se cierra.
 *
 * Sin esto la musica NO avanza — se queda dando vueltas en su seccion, que es
 * exactamente lo que tiene que hacer. Para recorrer la pieza entera hace falta que
 * alguien cumpla los objetivos.
 */
function hastaConDirector(c, t, paso = 0.1) {
  let reloj = 0;
  for (let x = 0; x <= t; x += paso) {
    reloj += paso;
    c.posicion(reloj);
    c.update();
    if (c.lockedLoop) { c.releaseCurrentLoop(); reloj = c.position; c.anchor = c.ctx.currentTime - reloj; }
  }
}

test('la rejilla: pulso, compas y fase', () => {
  const c = coreografia();
  c.posicion(0);
  assert.equal(c.beatIndex, 0);
  assert.equal(c.barIndex, 1);
  assert.equal(c.beatInBar, 1);

  // Se mide 1 ms DENTRO del compas, no justo en la frontera: `barSeconds` y
  // `beatSeconds` se hornean redondeados por separado, asi que 4 pulsos suman
  // 2,162164 y un compas dice 2,162162. Dos microsegundos de desfase, irrelevantes
  // al jugar, suficientes para que `floor()` conteste 3 en vez de 4 justo en el
  // borde. Ninguna logica del juego mira exactamente la frontera; una prueba, si.
  c.posicion(DATOS.barSeconds + 0.001);
  assert.equal(c.barIndex, 2);
  assert.equal(c.beatInBar, 1);
  assert.ok(c.beatPhase < 0.01, 'en el downbeat la fase es ~0');

  c.posicion(DATOS.beatSeconds * 2.5);
  assert.ok(Math.abs(c.beatPhase - 0.5) < 0.01, 'a mitad de pulso la fase es ~0,5');
});

test('REGRESION · sin nadie que lo suelte, el bucle retiene la musica para siempre', () => {
  // Es el fallo que se arrastraba de Unity, visto del derecho: alli el bucle se
  // cerraba y `ReleaseCurrentLoop()` no tenia un solo llamador, asi que la musica se
  // quedaba en su primera seccion mientras el gameplay seguia por su cuenta. Aqui
  // ese comportamiento es CORRECTO y es la mecanica: la etapa retiene hasta que la
  // superas. Esta prueba fija que retener funciona.
  const c = coreografia();
  const oidos = [];
  c.onMoment = (m) => oidos.push(m.name);

  hasta(c, 106);
  assert.deepEqual(oidos, ['presentacion', 'precombate1', 'combate1'],
                   'se queda en combate1: nadie ha cumplido su objetivo');
  assert.ok(c.lockedLoop, 'y el bucle sigue cerrado');
});

test('con un director que suelta, la pieza avanza de principio a fin', () => {
  const c = coreografia();
  const oidos = [];
  c.onMoment = (m) => oidos.push(m.name);

  hastaConDirector(c, 130);
  assert.deepEqual(oidos, DATOS.moments.map((m) => m.name));
});

test('un momento con loop se ARMA, no se cierra solo', () => {
  const c = coreografia();
  hasta(c, 26.0);                          // entra combate1
  assert.equal(c.currentMoment.name, 'combate1');
  assert.equal(c.armedLoop, true, 'armado');
  assert.equal(c.lockedLoop, null, 'pero NO cerrado: eso lo decide la etapa');
});

test('cerrar el bucle activa el loop nativo', () => {
  const c = coreografia();
  hasta(c, 26.0);
  assert.equal(c.lockCurrentLoop(), true);
  assert.equal(c.source.loop, true);
  assert.equal(c.source.loopStart, 25.9464);
  assert.equal(c.source.loopEnd, 34.5950);
  assert.equal(c.armedLoop, false);
});

test('REGRESION · con el bucle cerrado la posicion RETROCEDE', () => {
  // Es la trampa numero uno del contrato de sincronia: `position` no es el tiempo
  // transcurrido. Comparar contra un instante futuro absoluto puede no cumplirse
  // NUNCA, y eso dejo al jugador sin control para siempre una vez.
  const c = coreografia();
  hasta(c, 26.0);
  c.lockCurrentLoop();

  const span = 34.5950 - 25.9464;
  c.posicion(34.0);
  assert.ok(Math.abs(c.position - 34.0) < 0.01, 'dentro del bucle todavia avanza');

  c.posicion(34.5950 + 1.0);               // un segundo pasado el final
  assert.ok(c.position < 34.0, `deberia haber retrocedido, esta en ${c.position.toFixed(2)}`);
  assert.ok(Math.abs(c.position - (25.9464 + 1.0)) < 0.01, 'vuelve a 1 s del inicio del bucle');

  c.posicion(34.5950 + span + 1.0);        // otra vuelta entera
  assert.ok(Math.abs(c.position - (25.9464 + 1.0)) < 0.01, 'y da vueltas, no se escapa');
});

test('soltar el bucle re-ancla el reloj: la posicion no da un salto', () => {
  const c = coreografia();
  hasta(c, 26.0);
  c.lockCurrentLoop();
  c.posicion(34.5950 + 2.0);
  const antes = c.position;

  assert.equal(c.releaseCurrentLoop(), true);
  assert.equal(c.source.loop, false);
  assert.ok(Math.abs(c.position - antes) < 0.001,
            `sin re-anclar, la posicion saltaria de ${antes.toFixed(2)} a ${c.position.toFixed(2)}`);
  assert.equal(c.lockedLoop, null);
});

test('red de seguridad: el bucle se cierra solo a medio compas del final', () => {
  // Sin esto, un jugador lento veria la musica pasar de largo y la etapa dejaria de
  // retener — que es el invariante que sostiene el nivel entero.
  const c = coreografia();
  hasta(c, 26.0);
  assert.equal(c.lockedLoop, null);

  c.posicion(34.5950 - DATOS.barSeconds * 0.4);   // dentro del ultimo medio compas
  c.update();
  assert.ok(c.lockedLoop, 'deberia haberse cerrado solo');
});

test('seekMoment rebobina y hace que el momento vuelva a sonar', () => {
  const c = coreografia();
  const oidos = [];
  c.onMoment = (m) => oidos.push(m.name);
  hastaConDirector(c, 70);
  assert.equal(oidos.at(-1), 'climax_salvaje');

  const cursorAntes = oidos.length;
  assert.equal(c.seekMoment('climax_salvaje'), true);
  c.anchor = c.ctx.currentTime - 54.0545;
  c.posicion(54.0545 + 0.2); c.update();
  assert.equal(oidos.length, cursorAntes + 1, 'el cursor retrocede y vuelve a dispararlo');
  assert.equal(oidos.at(-1), 'climax_salvaje', 'vuelve a dispararse tras rebobinar');
  assert.equal(c.lockedLoop, null, 'y el bucle queda suelto');
});

test('seekMoment con un nombre que no existe no hace nada', () => {
  const c = coreografia();
  assert.equal(c.seekMoment('no_existe'), false);
});

// ------------------------------------------------- ganancia: un parametro, un dueño

/** Nodo de ganancia que RECUERDA a que valor se le mando ir. */
function gananciaEspia() {
  const g = { value: 0.85, destino: 0.85 };
  return {
    value: 0.85,
    cancelScheduledValues() {},
    setValueAtTime(v) { g.value = v; },
    linearRampToValueAtTime(v) { g.destino = v; this.value = v; },
    exponentialRampToValueAtTime(v) { g.destino = v; },
    get destino() { return g.destino; },
  };
}

test('REGRESION · TDB-004 · cerrar la pausa NO borra la preferencia de musica', () => {
  // El bug reportado: `applyVolumes()` escribia `0.85 * musica * master` sobre el
  // nodo y `setPaused(false)` rampaba a un `0.85` LITERAL. Dos escritores, ningun
  // dueño. Bajabas la musica al 20 %, cerrabas el modal con Esc, y volvia a sonar
  // alta. La preferencia SI se guardaba en localStorage; lo que no sobrevivia era
  // su aplicacion.
  const c = coreografia();
  c.gain = { gain: gananciaEspia() };

  c.setBaseGain(0.17);                     // el jugador baja la musica al 20 %
  assert.ok(Math.abs(c.gain.gain.destino - 0.17) < 1e-6);

  c.setPaused(true);                       // abre el modal
  assert.ok(c.gain.gain.destino < 0.17, 'en pausa se hunde, pero desde SU valor');

  c.setPaused(false);                      // y lo cierra
  assert.ok(Math.abs(c.gain.gain.destino - 0.17) < 1e-6,
    `deberia volver a 0,17 y vuelve a ${c.gain.gain.destino}`);
});

test('cambiar el volumen CON la pausa abierta respeta las dos cosas', () => {
  const c = coreografia();
  c.gain = { gain: gananciaEspia() };
  c.setPaused(true);
  c.setBaseGain(0.40);
  assert.ok(c.gain.gain.destino < 0.40, 'sigue apagada mientras el modal esta abierto');
  c.setPaused(false);
  assert.ok(Math.abs(c.gain.gain.destino - 0.40) < 1e-6, 'y al cerrar sale al valor nuevo');
});

// --------------------------------------------------- el gesto de ducking (R4 §6)

test('REGRESION · hablar NO borra la preferencia de musica', () => {
  // La recaida de TDB-004 que vivia en `game.js` › `onDuck`: escribia el nodo con
  // `0.30` al entrar y **`0.85` al salir**. Con la musica al 40 %, terminar una linea
  // la SUBIA al 85 %. Ese es el sintoma que se reporto como "la musica esta muy alta
  // cuando suena la voz": no es que no bajara, es que al salir subia sola.
  const c = coreografia();
  c.gain = { gain: gananciaEspia() };
  c.setBaseGain(0.40);

  c.setVoiceDuck(true);
  assert.ok(c.gain.gain.destino < 0.40 * 0.6,
            `hablando deberia hundirse bien por debajo de 0,40 y esta en ${c.gain.gain.destino}`);

  c.setVoiceDuck(false);
  assert.ok(Math.abs(c.gain.gain.destino - 0.40) < 1e-6,
            `al callarse deberia volver a 0,40 y vuelve a ${c.gain.gain.destino}`);
});

test('la voz ahueca la banda de la palabra, no solo baja el nivel', () => {
  // Bajar sin ahuecar obliga a hundir el nivel mucho mas para el mismo resultado.
  const c = coreografia();
  c.voiceNotch = { gain: gananciaEspia() };
  c.setVoiceDuck(true);
  assert.ok(c.voiceNotch.gain.destino < 0, 'la campana de 1,9 kHz deberia estar negativa');
  c.setVoiceDuck(false);
  assert.equal(c.voiceNotch.gain.destino, 0, 'y volver a plana: en reposo no colorea nada');
});

test('pausa y voz se COMPONEN: da igual el orden en que ocurran', () => {
  // Es la propiedad que hace que esto no vuelva a romperse. Antes cada situacion
  // escribia un valor absoluto y ganaba el ultimo en escribir.
  const a = coreografia(); a.gain = { gain: gananciaEspia() };
  a.setBaseGain(0.5); a.setPaused(true); a.setVoiceDuck(true);

  const b = coreografia(); b.gain = { gain: gananciaEspia() };
  b.setBaseGain(0.5); b.setVoiceDuck(true); b.setPaused(true);

  assert.ok(Math.abs(a.gain.gain.destino - b.gain.gain.destino) < 1e-9,
            'el mismo estado debe dar la misma ganancia sea cual sea el orden');

  // Y deshacer una no deshace la otra.
  a.setVoiceDuck(false);
  assert.ok(a.paused && a.gain.gain.destino < 0.5,
            'callarse durante la pausa no debe devolver la musica a plena');
});
