/**
 * El director: etapas, objetivos, puertas del bucle, beats de dialogo y control.
 *
 * Es el pegamento entre la musica y el juego, y por eso es donde mas caro sale un
 * fallo: no rompe nada visible, simplemente el nivel deja de significar lo que se
 * diseño. Los casos REGRESION son los que ya se pagaron.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Director, CONTROL } from '../src/d_director.js';

const BAR = 2.162162;

/** Jugador falso: al director solo le importan posicion y capa. */
function jugador(x = 0, layer = 0) {
  return { position: { x, y: 0 }, layer, body: { x, y: 0 } };
}

/** Coreografia falsa: un reloj que se mueve a mano. */
function coreo(pos = 0) {
  return {
    playing: true,
    position: pos,
    barSeconds: BAR,
    armedLoop: false,
    lockedLoop: null,
    _cerrados: 0,
    _sueltos: 0,
    lockCurrentLoop() { this.lockedLoop = { name: 'x' }; this.armedLoop = false; this._cerrados += 1; return true; },
    releaseCurrentLoop() { if (!this.lockedLoop) return false; this.lockedLoop = null; this._sueltos += 1; return true; },
  };
}

/** Dialogo falso: apunta lo que se le pide decir. */
function dialogo() {
  const dicho = [];
  return { dicho, say: (id) => dicho.push(id), update() {} };
}

function montar(level, x = 0, layer = 0) {
  const p = jugador(x, layer);
  const c = coreo();
  const d = dialogo();
  const dir = new Director(level, p, c, d);
  return { dir, p, c, d };
}

// --------------------------------------------------------------- objetivos

test('reachX: se cumple al llegar, no antes', () => {
  const level = { stages: [{ id: 'e', moment: 'm', objective: { type: 'reachX', x: 50, label: 'corre' } }] };
  const { dir, p, c } = montar(level);
  dir.enterMoment({ name: 'm' });
  assert.equal(dir.stage.id, 'e');

  p.position.x = 49;
  dir.update(0.016, {});
  assert.equal(dir.stagesCleared, 0);

  p.position.x = 50;
  dir.update(0.016, {});
  assert.equal(dir.stagesCleared, 1);
  assert.equal(dir.stage, null);
});

test('REGRESION · crossAndReturn no se cumple sin haber pasado por detras', () => {
  // El objetivo del GDD para la etapa 1: no basta con llegar. Hay que cruzar a la
  // capa trasera Y VOLVER. Volver es parte del objetivo, no un extra.
  const level = { stages: [{ id: 'e', moment: 'm',
    objective: { type: 'crossAndReturn', x: 60, layer: 0, label: 'cortado' } }] };
  const { dir, p } = montar(level);
  dir.enterMoment({ name: 'm' });

  p.position.x = 100;                    // llega de sobra, pero por delante
  dir.update(0.016, {});
  assert.equal(dir.stagesCleared, 0, 'llegar sin cruzar no vale');

  p.layer = 1;                           // pasa por detras
  dir.update(0.016, {});
  assert.equal(dir.stagesCleared, 0, 'estar detras tampoco: hay que volver');

  p.layer = 0;                           // y vuelve
  dir.update(0.016, {});
  assert.equal(dir.stagesCleared, 1);
});

test('crossAndReturn: el progreso del HUD va en dos pasos', () => {
  const level = { stages: [{ id: 'e', moment: 'm',
    objective: { type: 'crossAndReturn', x: 60, layer: 0, label: 'cortado' } }] };
  const { dir, p } = montar(level);
  dir.enterMoment({ name: 'm' });
  dir.update(0.016, {});
  assert.deepEqual(
    { d: dir.objective.done, t: dir.objective.total, l: dir.objective.label },
    { d: 0, t: 2, l: 'cortado' });

  p.layer = 1; dir.update(0.016, {});
  assert.equal(dir.objective.done, 1);
  assert.match(dir.objective.label, /Vuelve/, 'el rotulo cambia al volver');
});

test('repair: exige tornillos Y haberlo reparado', () => {
  const level = { stages: [{ id: 'e', moment: 'm',
    objective: { type: 'repair', screws: 3, label: 'tornillos' } }] };
  const { dir } = montar(level);
  dir.enterMoment({ name: 'm' });

  dir.update(0.016, { screws: 3, repaired: false });
  assert.equal(dir.stagesCleared, 0, 'tener los tornillos no basta');
  dir.update(0.016, { screws: 2, repaired: true });
  assert.equal(dir.stagesCleared, 0, 'repararlo con dos tampoco cumple el objetivo declarado');
  dir.update(0.016, { screws: 3, repaired: true });
  assert.equal(dir.stagesCleared, 1);
});

test('sparks y crossings cuentan desde el contexto', () => {
  for (const [tipo, campo] of [['sparks', 'sparks'], ['crossings', 'crossings']]) {
    const level = { stages: [{ id: 'e', moment: 'm', objective: { type: tipo, count: 3, label: 'x' } }] };
    const { dir } = montar(level);
    dir.enterMoment({ name: 'm' });
    dir.update(0.016, { [campo]: 2 });
    assert.equal(dir.stagesCleared, 0, tipo);
    dir.update(0.016, { [campo]: 3 });
    assert.equal(dir.stagesCleared, 1, tipo);
  }
});

// ------------------------------------------------------ el ciclo del bucle

test('la puerta: el bucle no se cierra hasta llegar a `gate.x`', () => {
  const level = { stages: [{ id: 'e', moment: 'm', gate: { x: 26 },
                             objective: { type: 'reachX', x: 999, label: 'x' } }] };
  const { dir, p, c } = montar(level);
  dir.enterMoment({ name: 'm' });
  c.armedLoop = true;                    // la musica lo ha armado

  p.position.x = 20;
  dir.update(0.016, {});
  assert.equal(c.lockedLoop, null, 'antes de la puerta no se cierra');

  p.position.x = 26;
  dir.update(0.016, {});
  assert.ok(c.lockedLoop, 'al pasar la puerta, se cierra');
});

test('sin `gate`, el bucle se cierra en cuanto esta armado', () => {
  const level = { stages: [{ id: 'e', moment: 'm', objective: { type: 'reachX', x: 999, label: 'x' } }] };
  const { dir, c } = montar(level);
  dir.enterMoment({ name: 'm' });
  c.armedLoop = true;
  dir.update(0.016, {});
  assert.ok(c.lockedLoop);
});

test('cumplir el objetivo SUELTA el bucle', () => {
  const level = { stages: [{ id: 'e', moment: 'm', objective: { type: 'reachX', x: 10, label: 'x' } }] };
  const { dir, p, c } = montar(level);
  dir.enterMoment({ name: 'm' });
  c.armedLoop = true;
  dir.update(0.016, {});
  assert.ok(c.lockedLoop);

  p.position.x = 10;
  dir.update(0.016, {});
  assert.equal(c._sueltos, 1, 'lo suelta el objetivo, no la musica');
});

// ------------------------------------------------------------ cinematicas

test('cinematica por momento: entra sola y quita el control', () => {
  const level = { stages: [], cinematics: [{ moment: 'm', bars: 5, label: 'apertura' }] };
  const { dir } = montar(level);
  assert.equal(dir.control, CONTROL.PLAYING);
  dir.enterMoment({ name: 'm' });
  assert.equal(dir.control, CONTROL.CINEMATIC);
  assert.equal(dir.playerHasControl, false);
});

test('cinematica por POSICION: espera a que el jugador llegue', () => {
  const level = { stages: [], cinematics: [{ id: 'c1', atX: 40, bars: 2 }] };
  const { dir, p } = montar(level);
  dir.update(0.016, {});
  assert.equal(dir.control, CONTROL.PLAYING, 'todavia no ha llegado');

  p.position.x = 40;
  dir.update(0.016, {});
  assert.equal(dir.control, CONTROL.CINEMATIC);
});

test('una cinematica de posicion no se repite', () => {
  const level = { stages: [], cinematics: [{ id: 'c1', atX: 40, bars: 1 }] };
  const { dir, p } = montar(level);
  p.position.x = 40;
  dir.update(0.016, {});
  for (let i = 0; i < 200; i += 1) dir.update(0.016, {});   // se agota y vuelve el control
  assert.equal(dir.control, CONTROL.PLAYING);

  for (let i = 0; i < 60; i += 1) dir.update(0.016, {});
  assert.equal(dir.control, CONTROL.PLAYING, 'no vuelve a dispararse');
});

test('REGRESION · la cinematica TERMINA aunque la posicion musical retroceda', () => {
  // El bloqueo de control permanente. La posicion vuelve atras cuando el bucle
  // rebobina, asi que comparar contra un instante futuro absoluto puede no cumplirse
  // nunca. Por eso se guarda ademas una DURACION que decrece con `dt`.
  const level = { stages: [], cinematics: [{ moment: 'm', bars: 2 }] };
  const { dir, c } = montar(level);
  dir.enterMoment({ name: 'm' });
  assert.equal(dir.control, CONTROL.CINEMATIC);

  // El reloj musical retrocede: nunca alcanzara `cinematicUntil`.
  for (let i = 0; i < 400; i += 1) {
    c.position = Math.max(0, c.position - 0.01);
    dir.update(0.016, {});
  }
  assert.equal(dir.control, CONTROL.PLAYING,
               'la cuenta atras por dt es la red de seguridad y tiene que devolver el control');
});

test('la duracion de una cinematica va en compases', () => {
  const level = { stages: [], cinematics: [{ moment: 'm', bars: 2 }] };
  const { dir } = montar(level);
  dir.enterMoment({ name: 'm' });
  assert.ok(Math.abs(dir.cinematicLeft - 2 * BAR) < 0.001);
});

// ------------------------------------------------------- beats de dialogo

test('un beat suena en su momento y a su tiempo', () => {
  const level = { stages: [], beats: [{ moment: 'm', at: 0.5, say: 'BR-02' }] };
  const { dir, c, d } = montar(level);
  dir.enterMoment({ name: 'm' });

  dir.update(0.016, {});
  assert.deepEqual(d.dicho, [], 'todavia no toca');
  c.position = 0.6;
  dir.update(0.016, {});
  assert.deepEqual(d.dicho, ['BR-02']);

  c.position = 5;
  dir.update(0.016, {});
  assert.deepEqual(d.dicho, ['BR-02'], 'y no se repite');
});

test('un beat con `x` espera ademas a que el jugador llegue', () => {
  const level = { stages: [], beats: [{ moment: 'm', at: 0, x: 30, say: 'BR-05' }] };
  const { dir, p, c, d } = montar(level);
  dir.enterMoment({ name: 'm' });
  c.position = 1;
  dir.update(0.016, {});
  assert.deepEqual(d.dicho, [], 'la linea explica un sitio: no suena antes de estar en el');

  p.position.x = 30;
  dir.update(0.016, {});
  assert.deepEqual(d.dicho, ['BR-05']);
});

// -------------------------------------------------------------- variantes

test('los intentos eligen la variante de animo', () => {
  const level = { stages: [{ id: 'e', moment: 'm', encourage: { at3: 'BR-04b', at6: 'BR-04c' },
                             objective: { type: 'reachX', x: 999, label: 'x' } }] };
  const { dir, d } = montar(level);
  dir.enterMoment({ name: 'm' });
  for (let i = 0; i < 6; i += 1) dir.registerAttempt();
  assert.deepEqual(d.dicho, ['BR-04b', 'BR-04c'], 'una a los 3 intentos y otra a los 6');
});

test('onClear elige linea segun lo que costo', () => {
  const casos = [[0, 'first'], [2, 'retry'], [5, 'late']];
  for (const [intentos, esperada] of casos) {
    const level = { stages: [{ id: 'e', moment: 'm',
      onClear: { first: 'first', retry: 'retry', late: 'late' },
      objective: { type: 'reachX', x: 10, label: 'x' } }] };
    const { dir, p, d } = montar(level);
    dir.enterMoment({ name: 'm' });
    for (let i = 0; i < intentos; i += 1) dir.registerAttempt();
    d.dicho.length = 0;
    p.position.x = 10;
    dir.update(0.016, {});
    assert.deepEqual(d.dicho, [esperada], `con ${intentos} intentos`);
  }
});
