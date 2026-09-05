/**
 * Rompibles — la logica, sin navegador.
 *
 * Otra que antes no se podia escribir: `breakables.js` importaba Three, y `hit()`
 * medía contra `mesh.position`. Ahora mide contra el centro geometrico y se puede
 * comprobar sin dibujar nada.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Breakables, KINDS, KIND_ID } from '../src/p_breakables.js';
import { EV, vaciar, _reset } from '../src/p_events.js';

const caja = (x = 10, y = 0, layer = 0) => ({ x, y, kind: 'caja', layer });

test('un golpe rompe una caja; hacen falta dos para un barril', () => {
  _reset();
  const b = new Breakables([caja(), { x: 20, y: 0, kind: 'barril', layer: 0 }]);
  assert.equal(b.hit(10, 0.45, 0.7, 1, 0), true, 'la caja cede al primero');

  assert.equal(b.hit(20, 0.55, 0.7, 1, 0), false, 'el barril aguanta el primero');
  assert.ok(b.items[1].shake > 0, 'pero acusa el golpe: se sacude');
  assert.equal(b.hit(20, 0.55, 0.7, 1, 0), true, 'y cede al segundo');
});

test('el pisoton del robot vale por dos golpes', () => {
  _reset();
  const b = new Breakables([{ x: 20, y: 0, kind: 'barril', layer: 0 }]);
  assert.equal(b.hit(20, 0.55, 1.8, 2, 0), true, 'un barril entero de una');
});

test('no se golpea a traves de las capas', () => {
  _reset();
  const b = new Breakables([caja(10, 0, 1)]);
  assert.equal(b.hit(10, 0.45, 0.7, 1, 0), false, 'el jugador va por delante');
  assert.equal(b.hit(10, 0.45, 0.7, 1, 1), true, 'y por detras si alcanza');
});

test('el radio del golpe se respeta', () => {
  _reset();
  const b = new Breakables([caja()]);
  assert.equal(b.hit(12.5, 0.45, 0.7, 1, 0), false, 'a 2,5 m no llega');
  assert.equal(b.hit(10.9, 0.45, 0.7, 1, 0), true, 'pegado al borde si');
});

test('romper emite EV.ROTURA con el tipo, para que el render sepa que humo sacar', () => {
  _reset();
  const b = new Breakables([caja(), { x: 30, y: 0, kind: 'maceta', layer: 0 }]);
  b.hit(10, 0.45, 0.7, 1, 0);
  b.hit(30, 0.3, 0.7, 1, 0);

  const vistos = [];
  vaciar((t, x, y, capa, mag) => vistos.push({ t, x: +x.toFixed(2), mag }));
  assert.deepEqual(vistos, [
    { t: EV.ROTURA, x: 10, mag: KIND_ID.caja },
    { t: EV.ROTURA, x: 30, mag: KIND_ID.maceta },
  ]);
});

test('lo que SUELTA va por hook, no por evento', () => {
  // La chispa que cae es estado de partida —se puede recoger, cuenta para el 100 %—
  // no un efecto. El render no tiene por que saber que existen las chispas.
  _reset();
  const sueltos = [];
  const b = new Breakables([caja(), { x: 30, y: 0, kind: 'maceta', layer: 0 }],
                           { onDrop: (x, y, capa, que) => sueltos.push({ x, que }) });
  b.hit(10, 0.45, 0.7, 1, 0);
  b.hit(30, 0.3, 0.7, 1, 0);
  assert.deepEqual(sueltos, [{ x: 10, que: 'chispa' }],
                   'la caja suelta chispa; la maceta es decorativa y no suelta nada');
});

test('los solidos salen y entran del mundo de colision al romperse', () => {
  _reset();
  const b = new Breakables([caja(), { x: 30, y: 0, kind: 'maceta', layer: 0 }]);
  assert.equal(b.solids.length, 1, 'la maceta no es solida: se atraviesa');
  b.hit(10, 0.45, 0.7, 1, 0);
  assert.equal(b.solids.length, 0, 'rota, deja el hueco libre');
});

test('un roto no se vuelve a romper', () => {
  _reset();
  const b = new Breakables([caja()]);
  b.hit(10, 0.45, 0.7, 1, 0);
  vaciar(() => {});
  assert.equal(b.hit(10, 0.45, 0.7, 1, 0), false);
  let veces = 0;
  vaciar(() => { veces += 1; });
  assert.equal(veces, 0, 'y no emite otra vez');
});

test('`remaining` cuenta los que quedan enteros', () => {
  _reset();
  const b = new Breakables([caja(10), caja(20), caja(30)]);
  assert.equal(b.remaining, 3);
  b.hit(20, 0.45, 0.7, 1, 0);
  assert.equal(b.remaining, 2);
});

test('la sacudida se agota sola', () => {
  _reset();
  const b = new Breakables([{ x: 20, y: 0, kind: 'barril', layer: 0 }]);
  b.hit(20, 0.55, 0.7, 1, 0);
  assert.ok(b.items[0].shake > 0);
  for (let i = 0; i < 30; i += 1) b.update(1 / 60);
  assert.equal(b.items[0].shake, 0);
});

test('los tres tipos declaran lo que el render necesita', () => {
  for (const [nombre, k] of Object.entries(KINDS)) {
    assert.ok(Number.isFinite(k.color), `${nombre}: color`);
    assert.equal(k.size.length, 3, `${nombre}: tamaño`);
    assert.ok(k.hp >= 1, `${nombre}: aguante`);
    assert.ok(KIND_ID[nombre] > 0, `${nombre}: id para el evento`);
  }
});
