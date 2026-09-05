// Trampolín — estados Idle/Jump del pack CC0.
//
// §2 principio 2: este fichero existe ANTES que src/p_trampolin.js. Ahora mismo
// falla porque el módulo no existe, y eso es exactamente el FAIL_TO_PASS de
// §8.3.1: un test que fallaba antes del cambio y pasa después.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { TUNING_TRAMPOLIN, actualizarTrampolines, crearTrampolin } from '../../src/p_trampolin.js';

// El trampolín de las pruebas ocupa y 2.0..2.4, luego su cara superior está en
// 2.4. Un cuerpo "pisándolo" tiene su BASE justo encima: y = 2.5, no 2.9 —
// medio tile por encima no es contacto, es flotar.
const cuerpo = (x, y, vy) => ({ cuerpo: { x, y, w: 0.55, h: 1.48 }, vy });

describe('trampolín', () => {
  test('impulsa hacia arriba al pisarlo CAYENDO', () => {
    const t = [crearTrampolin({ x: 5, y: 2 })];
    const { cuerpo: c, vy } = cuerpo(5.1, 2.5, -12);
    const r = actualizarTrampolines(t, c, vy, 1 / 60);
    assert.ok(r.vy > 0, 'debe salir despedido hacia arriba');
    assert.equal(r.vy, TUNING_TRAMPOLIN.impulso);
    assert.equal(t[0].estado, 'jump');
  });

  test('NO impulsa si sube: se atraviesa desde abajo', () => {
    const t = [crearTrampolin({ x: 5, y: 2 })];
    const { cuerpo: c, vy } = cuerpo(5.1, 2.5, +8);
    assert.equal(actualizarTrampolines(t, c, vy, 1 / 60).vy, 8, 'la velocidad no se toca');
    assert.equal(t[0].estado, 'idle');
  });

  test('NO impulsa si el jugador está lejos', () => {
    const t = [crearTrampolin({ x: 5, y: 2 })];
    const { cuerpo: c, vy } = cuerpo(20, 2.9, -12);
    assert.equal(actualizarTrampolines(t, c, vy, 1 / 60).vy, -12);
  });

  test('el impulso es FIJO, no depende de la velocidad de llegada', () => {
    // Si dependiera, caer desde más alto botaría más alto y el nivel dejaría de
    // ser diseñable: la altura de rebote es una constante de diseño.
    const suave = actualizarTrampolines([crearTrampolin({ x: 5, y: 2 })], cuerpo(5.1, 2.5, -3).cuerpo, -3, 1 / 60);
    const fuerte = actualizarTrampolines([crearTrampolin({ x: 5, y: 2 })], cuerpo(5.1, 2.5, -22).cuerpo, -22, 1 / 60);
    assert.equal(suave.vy, fuerte.vy);
  });

  test('el impulso supera al salto normal: para eso está', () => {
    assert.ok(TUNING_TRAMPOLIN.impulso > 10.66, 'jumpVelocity del jugador es 10.66');
  });

  test('vuelve a idle tras la animación, y puede volver a usarse', () => {
    const t = [crearTrampolin({ x: 5, y: 2 })];
    actualizarTrampolines(t, cuerpo(5.1, 2.5, -12).cuerpo, -12, 1 / 60);
    assert.equal(t[0].estado, 'jump');

    // 20 FPS del pack = 50 ms por frame. La animación Jump dura lo que dure,
    // pero el trampolín debe volver a estar disponible.
    let pasos = 0;
    while (t[0].estado !== 'idle' && pasos++ < 200) {
      actualizarTrampolines(t, cuerpo(50, 50, 0).cuerpo, 0, 1 / 60);
    }
    assert.equal(t[0].estado, 'idle', `no volvió a idle en ${pasos} pasos`);

    const r = actualizarTrampolines(t, cuerpo(5.1, 2.5, -12).cuerpo, -12, 1 / 60);
    assert.ok(r.vy > 0, 'debe poder volver a impulsar');
  });

  test('no se dispara dos veces en el mismo contacto', () => {
    const t = [crearTrampolin({ x: 5, y: 2 })];
    const c = cuerpo(5.1, 2.5, -12).cuerpo;
    const primero = actualizarTrampolines(t, c, -12, 1 / 60);
    const segundo = actualizarTrampolines(t, c, primero.vy, 1 / 60);
    assert.equal(segundo.vy, primero.vy, 'ya está en jump: no re-impulsa');
  });
});
