/**
 * Placas de presion — la logica, sin navegador.
 *
 * Este archivo es la prueba de que la particion sirve para algo. Antes de partir
 * `plate.js` en `p_plate.js` + `r_plate.js`, esto no se podia escribir: el modulo
 * importaba Three.js, y Three.js no existe en Node. La unica forma de comprobar que
 * una caja hunde una placa era abrir el juego, teletransportar al personaje con la
 * consola y mirar.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Plates } from '../src/p_plate.js';
import { EV, vaciar, _reset } from '../src/p_events.js';

/** La placa real del nivel: el encaje de las botas. */
const ENCAJE = { x: 34.475, y: -0.35, w: 0.95, layer: 1, unlocks: 'botas' };

/** Empujables falsos con la misma forma que los de verdad. */
const cajas = (...xs) => ({
  items: xs.map((c) => ({
    size: c.size ?? 0.75,
    layer: c.layer ?? 1,
    box: { x: c.x - (c.size ?? 0.75) / 2, y: c.y, w: c.size ?? 0.75, h: c.size ?? 0.75 },
  })),
});

test('una caja encajada hunde la placa', () => {
  _reset();
  const p = new Plates([ENCAJE]);
  p.update(1 / 60, cajas({ x: 34.475, y: -0.35 }));
  assert.equal(p.items[0].pressed, true);
});

test('la placa avisa por evento Y por hook, y cada uno para lo suyo', () => {
  _reset();
  const p = new Plates([ENCAJE]);
  const abiertos = [];
  p.onPress = (it) => abiertos.push(it.unlocks);

  p.update(1 / 60, cajas({ x: 34.475, y: -0.35 }));

  // El hook lleva la decision de PARTIDA: que prop se abre.
  assert.deepEqual(abiertos, ['botas']);

  // El evento lleva el HECHO, para que el render lo convierta en onda y sonido.
  //
  // Se compara con tolerancia porque la cola guarda las coordenadas en un
  // `Float32Array`: 34,475 vuelve como 34,474998. Un micrometro de error, elegido a
  // cambio de que emitir no asigne memoria — y para colocar una particula sobra.
  const vistos = [];
  vaciar((t, x, y, capa, mag) => vistos.push([t, x, y, capa, mag]));
  assert.equal(vistos.length, 1);
  const [t, x, y, capa, mag] = vistos[0];
  assert.equal(t, EV.PLACA);
  assert.ok(Math.abs(x - 34.475) < 1e-4, `x=${x}`);
  assert.ok(Math.abs(y - (-0.35)) < 1e-4, `y=${y}`);
  assert.deepEqual([capa, mag], [1, 1]);
});

test('no se dispara dos veces', () => {
  _reset();
  const p = new Plates([ENCAJE]);
  let veces = 0;
  p.onPress = () => { veces += 1; };
  const c = cajas({ x: 34.475, y: -0.35 });
  for (let i = 0; i < 30; i += 1) p.update(1 / 60, c);
  assert.equal(veces, 1);
});

test('una caja EN EL AIRE sobre la placa no la hunde', () => {
  // Solo comprobar la x valdria con la caja pasando por encima en pleno vuelo, y
  // entonces el puzle se resolveria de un salto afortunado en vez de encajandola.
  _reset();
  const p = new Plates([ENCAJE]);
  p.update(1 / 60, cajas({ x: 34.475, y: 0.4 }));    // a la altura del suelo, no del fondo
  assert.equal(p.items[0].pressed, false);
});

test('una caja al lado del encaje no la hunde', () => {
  _reset();
  const p = new Plates([ENCAJE]);
  p.update(1 / 60, cajas({ x: 33.0, y: -0.35 }));
  assert.equal(p.items[0].pressed, false);
});

test('una caja de la OTRA capa no cuenta', () => {
  _reset();
  const p = new Plates([ENCAJE]);
  p.update(1 / 60, cajas({ x: 34.475, y: -0.35, layer: 0 }));
  assert.equal(p.items[0].pressed, false);
});

test('el encaje admite la caja sin punteria', () => {
  // 0,95 de ancho para una caja de 0,75. Un encaje justo convertiria un puzle de
  // empujar en uno de alinear, que no es lo que enseña.
  for (const dx of [-0.35, -0.2, 0, 0.2, 0.35]) {
    _reset();
    const p = new Plates([ENCAJE]);
    p.update(1 / 60, cajas({ x: 34.475 + dx, y: -0.35 }));
    assert.equal(p.items[0].pressed, true, `deberia entrar con ${dx} m de desvio`);
  }
});

test('sin empujables no revienta', () => {
  _reset();
  const p = new Plates([ENCAJE]);
  p.update(1 / 60, null);
  p.update(1 / 60, { items: [] });
  assert.equal(p.items[0].pressed, false);
});
