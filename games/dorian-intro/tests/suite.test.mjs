// Guardas de la suite de vitrales. Lo que NO puede romperse mientras el bucle
// añade cuadros.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const leer = (...p) => JSON.parse(readFileSync(join(RAIZ, ...p), 'utf8'));

const guion = leer('assets', 'guion.json');
const tweaks = leer('tweaks.json');

describe('guion — es datos, y esta completo', () => {
  test('los seis cuadros tienen texto, mascara y paleta', () => {
    assert.equal(guion.cuadros.length, 6);
    for (const c of guion.cuadros) {
      assert.ok(c.texto?.trim(), `${c.id} sin texto`);
      assert.ok(existsSync(join(RAIZ, 'assets', c.mascara)), `${c.id}: falta ${c.mascara}`);
      assert.ok(existsSync(join(RAIZ, 'assets', c.paleta)), `${c.id}: falta ${c.paleta}`);
    }
  });

  test('los ids son unicos: el orden de la cinematica depende de ellos', () => {
    const ids = guion.cuadros.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('cada paleta tiene rampa de oscuro a claro y color de plomo', () => {
    for (const c of guion.cuadros) {
      const p = leer('assets', c.paleta);
      assert.ok(p.rampa.length >= 3, `${p.id}: la rampa necesita al menos 3 tonos`);
      assert.match(p.plomo, /^#[0-9a-f]{6}$/i);
    }
  });
});

describe('tweaks — TODO el ritmo vive aqui, nada en el codigo', () => {
  test('los tiempos del cuadro son positivos', () => {
    for (const [k, v] of Object.entries(tweaks.cuadro)) {
      if (k.startsWith('_')) continue;
      assert.ok(typeof v === 'number' && v > 0, `cuadro.${k} = ${v}`);
    }
  });

  test('la duracion de un cuadro deja tiempo real de lectura', () => {
    const t = tweaks.cuadro;
    const total = t.fundido_entrada + t.espera_antes_del_texto + t.lectura
                + t.espera_despues_del_texto + t.fundido_salida;
    assert.ok(total > 4, `un cuadro dura ${total}s: muy poco para leerlo`);
    assert.ok(total < 20, `un cuadro dura ${total}s: se hace eterno`);
  });

  test('el texto en modo maquina avanza a una velocidad legible', () => {
    const cps = tweaks.texto.caracteres_por_segundo;
    assert.ok(cps >= 15 && cps <= 60, `${cps} cps queda fuera de lo legible`);
  });

  test('el texto mas largo CABE en el tiempo de lectura', () => {
    // Si no cupiera, la slide cortaria el texto a media frase.
    const largo = Math.max(...guion.cuadros.map((c) => c.texto.length));
    const seg = largo / tweaks.texto.caracteres_por_segundo;
    assert.ok(seg <= tweaks.cuadro.lectura + tweaks.cuadro.espera_despues_del_texto,
      `el texto mas largo tarda ${seg.toFixed(1)}s y solo hay `
      + `${tweaks.cuadro.lectura + tweaks.cuadro.espera_despues_del_texto}s`);
  });

  test('el parallax es sutil: una deriva, no un barrido', () => {
    assert.ok(tweaks.parallax.amplitud > 0 && tweaks.parallax.amplitud < 0.15);
  });
});

describe('capas horneadas', () => {
  const horneados = guion.cuadros.filter((c) =>
    existsSync(join(RAIZ, 'assets', 'vitrales', c.id, 'manifiesto.json')));

  test('cada cuadro horneado tiene sus TRES capas con contenido', () => {
    for (const c of horneados) {
      const dir = join(RAIZ, 'assets', 'vitrales', c.id);
      const man = JSON.parse(readFileSync(join(dir, 'manifiesto.json'), 'utf8'));
      assert.equal(man.capas.length, 3, `${c.id}: se esperan fondo, medio y figura`);
      for (const capa of man.capas) {
        const png = join(dir, capa.png);
        assert.ok(existsSync(png), `${c.id}: falta ${capa.png}`);
        // Un PNG totalmente transparente comprime por debajo de 2 KB: se
        // genera igual de bien con el shader roto.
        assert.ok(statSync(png).size > 2048, `${c.id}/${capa.png} esta vacio`);
      }
    }
  });

  test('los factores de parallax van de fondo a figura, de menor a mayor', () => {
    for (const c of horneados) {
      const man = JSON.parse(readFileSync(
        join(RAIZ, 'assets', 'vitrales', c.id, 'manifiesto.json'), 'utf8'));
      const f = Object.fromEntries(man.capas.map((x) => [x.capa, x.parallax]));
      assert.ok(f.fondo < f.medio && f.medio <= f.figura,
        `${c.id}: el fondo debe moverse MENOS que la figura, no al reves`);
    }
  });

  test('el horneado declara su determinismo', () => {
    for (const c of horneados) {
      const man = JSON.parse(readFileSync(
        join(RAIZ, 'assets', 'vitrales', c.id, 'manifiesto.json'), 'utf8'));
      assert.equal(typeof man.determinismo.semilla, 'number');
    }
  });
});
