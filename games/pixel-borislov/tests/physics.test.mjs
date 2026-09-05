/**
 * Colision: AABB con barrido, ejes separados, asistencia de escalon y sondas.
 *
 * Los casos marcados REGRESION son bugs que ya se pagaron una vez. Van aqui para
 * que no vuelvan: son el motivo principal de que este archivo exista.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld, SURFACE, aabb, overlaps } from '../src/p_physics.js';

const suelo = (x, y, w, h, s = SURFACE.TIERRA, capa = 0) => ({ x, y, w, h, surface: s, layer: capa });

test('LIMITE · la colision es discreta, no barrida: a dt grande se atraviesa', () => {
  // El comentario de cabecera de physics.js dice "AABB con barrido", y no lo es:
  // `move` desplaza el cuerpo y DESPUES resuelve el solapamiento. A 60 Hz da igual
  // —la caida maxima son 24 m/s, o sea 0,4 m por tick contra solidos de 1,4 m—, pero
  // conviene tenerlo escrito: si algun dia algo va mas rapido, tunelea.
  const w = new CollisionWorld([suelo(0, 0, 10, 1)]);
  const body = aabb(2, 5, 0.55, 1.48);
  const r = w.move(body, { x: 0, y: -20 }, 1, 0);   // 20 m de golpe
  assert.equal(r.grounded, false, 'lo atraviesa: es el limite conocido, no un fallo');
});

test('overlaps: se tocan pero no se solapan', () => {
  assert.equal(overlaps(aabb(0, 0, 1, 1), aabb(1, 0, 1, 1)), false);
  assert.equal(overlaps(aabb(0, 0, 1, 1), aabb(0.99, 0, 1, 1)), true);
});

test('el suelo detiene la caida y reporta su superficie', () => {
  const w = new CollisionWorld([suelo(0, 0, 10, 1, SURFACE.METAL)]);
  const body = aabb(2, 1.2, 0.55, 1.48);
  const v = { x: 0, y: -20 };
  const r = w.move(body, v, 1 / 60, 0);
  assert.equal(r.grounded, true);
  assert.equal(r.surface, SURFACE.METAL);
  assert.equal(body.y, 1);
  assert.equal(v.y, 0);
});

test('una pared frena en X y anula la velocidad', () => {
  const w = new CollisionWorld([suelo(0, 0, 5, 1), suelo(5, 1, 1, 3)]);
  const body = aabb(4.3, 1, 0.55, 1.48);
  const v = { x: 10, y: 0 };
  const r = w.move(body, v, 1 / 60, 0);
  assert.equal(r.wall, 1);
  assert.equal(v.x, 0);
  assert.ok(body.x + body.w <= 5.0001, `deberia parar en x=5, esta en ${body.x + body.w}`);
});

test('solo colisiona la capa del jugador', () => {
  const w = new CollisionWorld([suelo(0, 0, 10, 1, SURFACE.TIERRA, 1)]);
  const body = aabb(2, 5, 0.55, 1.48);
  const r = w.move(body, { x: 0, y: -20 }, 1, 0);   // el jugador va en la capa 0
  assert.equal(r.grounded, false, 'un solido de la capa 1 no debe frenar al de la 0');
});

test('un solido sin capa vale para las dos', () => {
  const w = new CollisionWorld([{ x: 0, y: 0, w: 10, h: 1 }]);
  for (const capa of [0, 1]) {
    const r = w.move(aabb(2, 1.2, 0.55, 1.48), { x: 0, y: -20 }, 1 / 60, capa);
    assert.equal(r.grounded, true);
  }
});

test('REGRESION · la asistencia de escalon sube 0,42 y no 0,43', () => {
  const maxStep = 0.42;
  // Escalon justo en el limite: se sube.
  const cabe = new CollisionWorld([suelo(0, -1, 5, 1), suelo(5, -1, 5, 1.42)]);
  const b1 = aabb(4.6, 0, 0.55, 1.48);
  const r1 = cabe.move(b1, { x: 2, y: 0 }, 0.1, 0, { maxStep });
  assert.equal(r1.stepped, true, 'un escalon de 0,42 se sube solo');

  // Un centimetro mas: es un muro.
  const noCabe = new CollisionWorld([suelo(0, -1, 5, 1), suelo(5, -1, 5, 1.43)]);
  const b2 = aabb(4.6, 0, 0.55, 1.48);
  const r2 = noCabe.move(b2, { x: 2, y: 0 }, 0.1, 0, { maxStep });
  assert.equal(r2.stepped, false, 'un escalon de 0,43 NO se sube');
  assert.equal(r2.wall, 1);
});

test('no se sube un escalon si no cabe encima', () => {
  const w = new CollisionWorld([
    suelo(0, -1, 5, 1),
    suelo(5, -1, 5, 1.4),      // top 0.4, subible
    suelo(5, 0.5, 5, 3),       // pero justo encima hay techo
  ]);
  const b = aabb(4.6, 0, 0.55, 1.48);
  const r = w.move(b, { x: 2, y: 0 }, 0.1, 0, { maxStep: 0.42 });
  assert.equal(r.stepped, false, 'sin hueco arriba no se sube');
});

test('REGRESION · groundHeightAt: `fallback` NO es un minimo', () => {
  // Fue un bug real: al inicializar el maximo con `fallback`, pasarle un valor alto
  // lo imponia sobre el suelo de verdad, y las banderas acababan flotando 0,6 m
  // sobre el terreno, a la altura de reaparicion del checkpoint.
  const w = new CollisionWorld([suelo(0, -1, 10, 1)]);   // top = 0
  assert.equal(w.groundHeightAt(5, 0, 3.0), 0, 'manda el suelo real, no el fallback');
  assert.equal(w.groundHeightAt(50, 0, 3.0), 3.0, 'el fallback solo si NO hay nada bajo esa x');
});

test('groundHeightAt devuelve el techo mas ALTO bajo esa x', () => {
  const w = new CollisionWorld([suelo(0, -1, 10, 1), suelo(2, 0, 3, 0.5)]);   // tops 0 y 0.5
  assert.equal(w.groundHeightAt(3, 0, -2), 0.5);
  assert.equal(w.groundHeightAt(8, 0, -2), 0);
});

test('isGrounded y wallSide son sondas: no mueven nada', () => {
  const w = new CollisionWorld([suelo(0, 0, 10, 1), suelo(5, 1, 1, 3)]);
  const body = aabb(4.43, 1, 0.55, 1.48);
  const antes = { ...body };
  assert.equal(w.isGrounded(body, 0), SURFACE.TIERRA);
  assert.equal(w.wallSide(body, 0), 1);
  assert.deepEqual(body, antes, 'las sondas no deben tocar el cuerpo');
});
