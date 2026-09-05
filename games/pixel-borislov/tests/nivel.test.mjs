// El puente nivel -> motor. FAIL_TO_PASS de esta iteración.
//
// Lo que hace falta probar no es que convierta, sino que el resultado sea
// JUGABLE: que CollisionWorld lo acepte y que el jugador se apoye donde debe.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SURFACE } from '../src/w_contracts.js';
import { CollisionWorld } from '../src/p_physics.js';
import { fusionarTiles, informeConversion, nivelDesdeTiles } from '../src/w_nivel.js';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const DEF = JSON.parse(readFileSync(join(RAIZ, 'assets', 'levels', 'nivel-01.json'), 'utf8'));

describe('fusión de tiles', () => {
  test('fusiona contiguos de la misma fila y superficie en una tira', () => {
    const s = fusionarTiles([
      { x: 0, y: 0, surface: 'HIERBA' },
      { x: 1, y: 0, surface: 'HIERBA' },
      { x: 2, y: 0, surface: 'HIERBA' },
    ]);
    assert.equal(s.length, 1);
    assert.deepEqual(s[0], { x: 0, y: 0, w: 3, h: 1, surface: SURFACE.HIERBA, layer: 0 });
  });

  test('NO fusiona a través de un cambio de superficie', () => {
    // Fusionar aquí haría que el jugador resbalase en madera sobre un tramo de
    // hierba: el nivel se jugaría distinto de lo que dice su fichero.
    const s = fusionarTiles([
      { x: 0, y: 0, surface: 'HIERBA' },
      { x: 1, y: 0, surface: 'MADERA' },
    ]);
    assert.equal(s.length, 2);
    assert.equal(s[0].surface, SURFACE.HIERBA);
    assert.equal(s[1].surface, SURFACE.MADERA);
  });

  test('NO fusiona a través de un hueco', () => {
    const s = fusionarTiles([
      { x: 0, y: 0, surface: 'HIERBA' },
      { x: 5, y: 0, surface: 'HIERBA' },
    ]);
    assert.equal(s.length, 2, 'un hueco es por donde el jugador cae; fusionarlo lo taparía');
  });

  test('filas distintas nunca se fusionan entre sí', () => {
    const s = fusionarTiles([
      { x: 0, y: 0, surface: 'HIERBA' },
      { x: 0, y: 1, surface: 'HIERBA' },
    ]);
    assert.equal(s.length, 2);
  });

  test('una superficie desconocida falla ruidosamente, no cae a TIERRA', () => {
    assert.throws(
      () => fusionarTiles([{ x: 0, y: 0, surface: 'LAVA_DE_QUESO' }]),
      /superficie desconocida/,
    );
  });

  test('el resultado es determinista: mismo JSON, mismo array', () => {
    const a = JSON.stringify(fusionarTiles(DEF.terreno));
    const b = JSON.stringify(fusionarTiles([...DEF.terreno].reverse()));
    assert.equal(a, b, 'el orden de entrada no puede cambiar la salida');
  });
});

describe('nivelDesdeTiles sobre el nivel real', () => {
  const nivel = nivelDesdeTiles(DEF);

  test('reduce 46 tiles a un puñado de sólidos', () => {
    const inf = informeConversion(DEF, nivel);
    assert.equal(inf.tiles, 46);
    assert.ok(nivel.solids.length < 15, `esperaba pocas tiras, hay ${nivel.solids.length}`);
  });

  test('conserva las tres superficies del nivel', () => {
    const s = new Set(nivel.solids.map((x) => x.surface));
    assert.ok(s.has(SURFACE.HIERBA));
    assert.ok(s.has(SURFACE.TIERRA));
    assert.ok(s.has(SURFACE.MADERA), 'la plataforma flotante es de madera');
  });

  test('tiene spawn, checkpoints y meta', () => {
    assert.ok(nivel.spawn.x > 0 && nivel.spawn.y > 0);
    assert.equal(nivel.checkpoints.length, 1);
    assert.ok(nivel.meta, 'sin meta no hay fin de nivel');
  });

  test('killY queda por DEBAJO del suelo más bajo', () => {
    const minSolido = Math.min(...nivel.solids.map((s) => s.y));
    assert.ok(nivel.killY < minSolido, 'si no, el jugador muere pisando el suelo');
  });

  test('los sistemas sin usar son arrays vacíos, no undefined', () => {
    // El motor los recorre; un undefined revienta donde un [] no hace nada.
    for (const k of ['portals', 'pushables', 'breakables', 'plates', 'props']) {
      assert.ok(Array.isArray(nivel[k]), `${k} debe ser array`);
    }
  });

  test('sin marcador de inicio, se rechaza', () => {
    assert.throws(
      () => nivelDesdeTiles({ ...DEF, marcadores: [] }),
      /marcador de tipo "start"/,
    );
  });
});

describe('el nivel es JUGABLE: CollisionWorld lo acepta', () => {
  const nivel = nivelDesdeTiles(DEF);
  const mundo = new CollisionWorld(nivel.solids);

  test('un cuerpo que cae se APOYA en el suelo', () => {
    const cuerpo = { x: nivel.spawn.x, y: nivel.spawn.y + 3, w: 0.55, h: 1.48 };
    let r;
    for (let i = 0; i < 60; i++) r = mundo.move(cuerpo, { x: 0, y: -12 }, 1 / 60, 0);
    assert.equal(r.grounded, true, 'debe quedar apoyado, no seguir cayendo');
    assert.ok(cuerpo.y > nivel.killY, 'y no haber atravesado el nivel');
  });

  test('la superficie bajo el jugador es la del tile que pisa', () => {
    const cuerpo = { x: nivel.spawn.x, y: nivel.spawn.y + 2, w: 0.55, h: 1.48 };
    let r;
    for (let i = 0; i < 60; i++) r = mundo.move(cuerpo, { x: 0, y: -12 }, 1 / 60, 0);
    assert.equal(r.surface, SURFACE.HIERBA, 'el spawn está sobre hierba');
  });

  test('una pared detiene el avance horizontal', () => {
    // Contra el borde izquierdo del tramo elevado final (x=18, altura y=2).
    const cuerpo = { x: 16.0, y: 2.2, w: 0.55, h: 1.48 };
    const antes = cuerpo.x;
    for (let i = 0; i < 40; i++) mundo.move(cuerpo, { x: 6, y: 0 }, 1 / 60, 0);
    assert.ok(cuerpo.x > antes, 'avanza');
    assert.ok(cuerpo.x < 18.6, `no debe atravesar la pared en x=18, quedó en ${cuerpo.x}`);
  });

  test('POR EL HUECO SE CAE: es lo que obliga a saltar', () => {
    // OJO con el convenio: en CollisionWorld `x/y` es la ESQUINA INFERIOR
    // IZQUIERDA, no el centro. Un cuerpo en x=10.5 de ancho 0.55 ocupa hasta
    // 11.05 y toca el sólido que empieza en x=11.
    //
    // El hueco del suelo es [8, 11) y la plataforma de madera cubre x 6..10 a
    // la altura y=4. Aquí: x 9.6..10.15 cae dentro del hueco, e y 2.0..3.48
    // pasa por debajo de la plataforma sin tocarla.
    const cuerpo = { x: 9.6, y: 2.0, w: 0.55, h: 1.48 };
    let r;
    for (let i = 0; i < 120; i++) r = mundo.move(cuerpo, { x: 0, y: -14 }, 1 / 60, 0);
    assert.equal(r.grounded, false, 'sobre el hueco no hay suelo que pisar');
    assert.ok(cuerpo.y < 0, 'y debe haber caído por debajo del nivel del suelo');
  });
});
