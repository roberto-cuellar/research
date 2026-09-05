/**
 * La frontera playsim -> render.
 *
 * Lo que se protege aqui no es la funcionalidad —es media docena de lineas— sino el
 * PRESUPUESTO: que emitir y vaciar no asignen memoria. Es lo que separa esta cola de
 * un bus de eventos normal, y lo unico que la hace admisible dentro de un bucle de
 * 60 fps.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { EV, emitir, vaciar, pendientes, limpiar, _reset, descartados } from '../src/p_events.js';
import * as eventos from '../src/p_events.js';

test('lo emitido se recibe entero y en orden', () => {
  _reset();
  emitir(EV.PASO, 1, 2, 0, 0.5);
  emitir(EV.ROTURA, 3, 4, 1, 2);
  const visto = [];
  vaciar((t, x, y, capa, mag) => visto.push([t, x, y, capa, mag]));
  assert.deepEqual(visto, [[EV.PASO, 1, 2, 0, 0.5], [EV.ROTURA, 3, 4, 1, 2]]);
});

test('vaciar deja la cola a cero', () => {
  _reset();
  emitir(EV.PASO, 0, 0, 0);
  assert.equal(pendientes(), 1);
  vaciar(() => {});
  assert.equal(pendientes(), 0);
  let veces = 0;
  vaciar(() => { veces += 1; });
  assert.equal(veces, 0, 'vaciar dos veces no repite nada');
});

test('`limpiar` tira lo pendiente sin procesarlo', () => {
  _reset();
  emitir(EV.PASO, 0, 0, 0);
  emitir(EV.PASO, 0, 0, 0);
  limpiar();
  assert.equal(pendientes(), 0);
});

test('al llenarse descarta y lo CUENTA: nunca en silencio', () => {
  _reset();
  for (let i = 0; i < 300; i += 1) emitir(EV.PASO, i, 0, 0);
  assert.equal(pendientes(), 256, 'no crece en runtime');
  assert.equal(eventos.descartados, 44, 'y los que no caben quedan contados');
});

test('PRESUPUESTO · emitir y vaciar no asignan memoria', () => {
  // El invariante que justifica el diseño: un `emit` que crea un objeto por evento se
  // paga en recoleccion de basura, y eso se ve como tirones a 60 fps.
  //
  // Como medirlo sin engañarse: el heap de V8 crece los primeros miles de
  // iteraciones por el JIT, no por el codigo. Medido en frio daba 288 KB para 24.000
  // eventos y solo 15 KB para 240.000 — diez veces mas trabajo, veinte veces menos
  // memoria. Lo que delata una asignacion por evento es que crezca EN PROPORCION, asi
  // que se calienta primero y se mide despues.
  //
  // El callback tambien va fuera del bucle: crear una funcion por frame es
  // exactamente la asignacion que se esta buscando, y la haria la prueba.
  const nada = () => {};
  const rafaga = (frames, porFrame) => {
    for (let f = 0; f < frames; f += 1) {
      for (let i = 0; i < porFrame; i += 1) emitir(EV.PASO, i, 1, 0, 0.5);
      vaciar(nada);
    }
  };

  _reset();
  rafaga(500, 40);                      // calentamiento
  if (typeof global.gc === 'function') global.gc();

  const antes = process.memoryUsage().heapUsed;
  rafaga(6000, 40);                     // 240.000 eventos, 100 s de juego
  const porEvento = (process.memoryUsage().heapUsed - antes) / 240_000;

  assert.ok(porEvento < 1,
    `${porEvento.toFixed(2)} bytes por evento: la cola esta asignando algo`);
});

test('los tipos son numeros unicos', () => {
  const vals = Object.values(EV);
  assert.equal(new Set(vals).size, vals.length);
  for (const v of vals) assert.ok(Number.isInteger(v) && v > 0 && v < 256, 'caben en un Uint8Array');
});
