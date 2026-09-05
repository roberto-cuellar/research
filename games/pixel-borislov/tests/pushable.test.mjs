/**
 * Cajas empujables — la logica, sin navegador.
 *
 * Esta mecanica ha costado mas depuracion que ninguna otra, y toda a mano: abrir el
 * juego, teletransportar al personaje con la consola, mirar la traza. Estos casos
 * fijan lo que se aprendio, y a partir de ahora se comprueba en 30 ms.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Pushables, PUSH_SPEED } from '../src/p_pushable.js';
import { CollisionWorld } from '../src/p_physics.js';
import { SURFACE } from '../src/w_contracts.js';

const DT = 1 / 60;
const suelo = (x, y, w, h, capa = 0) => ({ x, y, w, h, surface: SURFACE.TIERRA, layer: capa });

/** Mundo con suelo largo y la caja dentro de sus solidos, como en el juego. */
function montar(cajas, solids = [suelo(-10, -1, 100, 1)]) {
  const world = new CollisionWorld(solids.slice());
  const p = new Pushables(cajas, world);
  world.solids = solids.concat(p.solids);   // las cajas SON solidos, como en game.js
  return { p, world };
}

/** Jugador falso: al empujable solo le importan posicion, capa, ancho y si pisa. */
function jugador(x, y = 0, layer = 0) {
  return { position: { x, y }, body: { x: x - 0.275, y },
           layer, velocity: { x: 0, y: 0 }, grounded: true, width: 0.55, height: 1.48 };
}

const teclas = (axisX) => ({ axisX });

/**
 * Empuja durante `n` ticks, avanzando TAMBIEN al jugador.
 *
 * Es lo que hace `game.js`: cuando hay empuje, iguala la velocidad del jugador a la
 * de la caja. Sin eso el jugador se queda atras, se pierde el contacto y el empuje
 * termina — que fue exactamente uno de los cuatro fallos encadenados que impedian
 * ver la animacion de `pushing`.
 */
function empujar(p, j, n, dir = 1, tope = Infinity) {
  for (let i = 0; i < n; i += 1) {
    const movida = p.update(DT, j, teclas(dir));
    if (movida) {
      j.position.x = Math.min(j.position.x + dir * PUSH_SPEED * DT, tope);
      j.body.x = j.position.x - 0.275;
    }
  }
}

test('empujar mueve la caja a PUSH_SPEED', () => {
  const { p } = montar([{ x: 5, y: 0, size: 0.75, layer: 0 }]);
  const j = jugador(5 - 0.375 - 0.765);          // justo al alcance del brazo
  const antes = p.items[0].box.x;
  empujar(p, j, 60);
  const recorrido = p.items[0].box.x - antes;
  assert.ok(Math.abs(recorrido - PUSH_SPEED) < 0.05,
    `en 1 s deberia recorrer ${PUSH_SPEED} m y recorrio ${recorrido.toFixed(2)}`);
});

test('sin dirección no se empuja', () => {
  const { p } = montar([{ x: 5, y: 0, size: 0.75, layer: 0 }]);
  const j = jugador(5 - 0.375 - 0.765);
  const antes = p.items[0].box.x;
  for (let i = 0; i < 60; i += 1) p.update(DT, j, teclas(0));
  assert.equal(p.items[0].box.x, antes);
});

test('empujar hacia el lado contrario no la arrastra', () => {
  const { p } = montar([{ x: 5, y: 0, size: 0.75, layer: 0 }]);
  const j = jugador(5 - 0.375 - 0.765);
  const antes = p.items[0].box.x;
  for (let i = 0; i < 60; i += 1) p.update(DT, j, teclas(-1));
  assert.equal(p.items[0].box.x, antes, 'alejarse no tira de ella');
});

test('REGRESION · el modelo NO se mete en la caja: se retiene al alcance del brazo', () => {
  // El bug que costo mas iteraciones. La colision del jugador mide 0,55, asi que la
  // fisica lo frena con su centro a 0,275 de la cara — pero el personaje DIBUJADO
  // llega a 0,765 en la pose de empuje, medido aplicando el esqueleto vertice a
  // vertice. Sin esta retencion, 20 cm de modelo quedaban dentro de la caja.
  const { p } = montar([{ x: 5, y: 0, size: 0.75, layer: 0 }]);
  const j = jugador(4.0);
  for (let i = 0; i < 120; i += 1) {
    j.velocity.x = 3;
    p.update(DT, j, teclas(1));
    j.position.x += j.velocity.x * DT;           // el jugador empuja de verdad
    j.body.x = j.position.x - 0.275;
  }
  const cara = p.items[0].box.x;                 // cara izquierda de la caja
  const hueco = cara - j.position.x;
  assert.ok(hueco > 0.70, `el modelo llega a 0,765 y solo hay ${hueco.toFixed(3)} m: se incrusta`);
});

test('no se empuja desde otra capa', () => {
  const { p } = montar([{ x: 5, y: 0, size: 0.75, layer: 1 }],
                       [suelo(-10, -1, 100, 1, 0), suelo(-10, -1, 100, 1, 1)]);
  const j = jugador(5 - 0.375 - 0.765, 0, 0);
  const antes = p.items[0].box.x;
  for (let i = 0; i < 60; i += 1) p.update(DT, j, teclas(1));
  assert.equal(p.items[0].box.x, antes);
});

test('no se empuja en el aire', () => {
  const { p } = montar([{ x: 5, y: 0, size: 0.75, layer: 0 }]);
  const j = jugador(5 - 0.375 - 0.765);
  j.grounded = false;
  const antes = p.items[0].box.x;
  for (let i = 0; i < 60; i += 1) p.update(DT, j, teclas(1));
  assert.equal(p.items[0].box.x, antes, 'empujar en el aire seria empujar con los pies');
});

test('la caja cae si se queda sin suelo, y no se apoya en si misma', () => {
  const { p } = montar([{ x: 5, y: 3, size: 0.75, layer: 0 }]);
  const j = jugador(-50);                        // lejos: nadie la toca
  for (let i = 0; i < 120; i += 1) p.update(DT, j, teclas(0));
  assert.ok(Math.abs(p.items[0].box.y) < 0.05,
    `deberia haber caido al suelo (y=0) y esta en ${p.items[0].box.y.toFixed(2)}`);
});

test('la caja encaja en un hueco de su tamaño y queda a ras', () => {
  // El encaje de las botas: fondo a -0,35 y caja de 0,75, asi que su tapa acaba en
  // 0,4, justo el nivel del suelo. Encajada se convierte en camino.
  const { p } = montar([{ x: 32, y: 0.4, size: 0.75, layer: 0 }], [
    suelo(20, -1, 14, 1.4),                      // 20..34, top 0.4
    suelo(34, -1.35, 0.95, 1.0),                 // fondo del encaje, top -0.35
    suelo(34.95, -1, 3, 1.4),                    // sigue el suelo
  ]);
  const j = jugador(32 - 0.375 - 0.765, 0.4);
  for (let i = 0; i < 400; i += 1) {
    p.update(DT, j, teclas(1));
    j.position.x = Math.min(j.position.x + PUSH_SPEED * DT, 33.6);
    j.body.x = j.position.x - 0.275;
  }
  const it = p.items[0];
  assert.ok(it.box.y < 0, `deberia haber caido al encaje, esta en y=${it.box.y.toFixed(2)}`);
  assert.ok(Math.abs(it.box.y + it.size - 0.4) < 0.02,
    `su tapa deberia quedar a ras del suelo (0,4) y esta en ${(it.box.y + it.size).toFixed(2)}`);
});

test('`blocked` avisa cuando se empuja y no cede', () => {
  const { p } = montar([{ x: 5, y: 0, size: 0.75, layer: 0 }],
                       [suelo(-10, -1, 100, 1), suelo(6, 0, 2, 3)]);   // muro pegado
  const j = jugador(5 - 0.375 - 0.765);
  empujar(p, j, 120);
  assert.ok(p.blocked, 'la caja topa con el muro y hay que poder animar el apoyo');
});

test('`nearby` se recuerda aunque no se esté empujando', () => {
  // Es lo que dispara el aviso de "camina contra ella", que hace falta porque
  // empujar no tiene tecla propia.
  const { p } = montar([{ x: 5, y: 0, size: 0.75, layer: 0 }]);
  const j = jugador(5 - 0.375 - 0.765);
  p.update(DT, j, teclas(0));
  assert.ok(p.nearby, 'estando al lado, se sabe');
});

test('las cajas entran en el mundo de colision con su superficie', () => {
  const { p } = montar([{ x: 5, y: 0, size: 0.75, layer: 0 }]);
  const s = p.solids;
  assert.equal(s.length, 1);
  assert.equal(s[0].surface, SURFACE.METAL, 'metal, no madera: es lo que la distingue');
  assert.equal(s[0].w, 0.75);
});
