/**
 * TODO `src/` TIENE QUE PARSEAR.
 *
 * Esta prueba existe por un fallo que se ha cometido TRES veces en este proyecto, y
 * siempre igual: una comilla invertida dentro de un comentario que vive en una plantilla
 * de JavaScript.
 *
 *   shader.fragmentShader = `
 *     // El `uv` de la cara...      <-- esta comilla CIERRA la plantilla
 *     ...
 *   `;
 *
 * Los shaders GLSL y el CSS del HUD viven en plantillas (`` ` ``), y ahi una comilla
 * invertida en un comentario parte la cadena en seco. El resultado no se parece a la
 * causa: el modulo lanza `SyntaxError: Unexpected identifier 'uv'` y el juego se queda
 * en negro o a medias, sin que nada apunte al comentario.
 *
 * No lo cazaba ninguna prueba porque las demas IMPORTAN los modulos, y los que llevan
 * shaders importan Three.js, que en Node no resuelve. `node --check` sobre la entrada
 * estandar resuelve las dos cosas: valida la sintaxis del modulo SIN ejecutarlo y sin
 * resolver ninguna importacion.
 *
 * Es barato (unos milisegundos por archivo) y cubre cualquier error de sintaxis, no solo
 * el de la comilla.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

const archivos = readdirSync(SRC).filter((f) => f.endsWith('.js'));

test('hay modulos que comprobar (si no, la prueba no esta probando nada)', () => {
  assert.ok(archivos.length > 10, `solo se encontraron ${archivos.length} modulos en src/`);
});

for (const nombre of archivos) {
  test(`${nombre} parsea como modulo ES`, () => {
    const fuente = readFileSync(join(SRC, nombre));
    try {
      // `--check` no ejecuta nada: solo parsea. Por stdin para no depender de que la
      // extension sea .mjs ni de que las importaciones se puedan resolver.
      execFileSync(process.execPath, ['--input-type=module', '--check'], {
        input: fuente,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (e) {
      const detalle = String(e.stderr || e.message).split('\n').slice(0, 6).join('\n');
      assert.fail(`${nombre} no parsea:\n${detalle}`);
    }
  });
}

test('ningun comentario dentro de una plantilla lleva comilla invertida', () => {
  /**
   * Cinturon y tirantes. `--check` ya caza el caso que rompe, pero una comilla en un
   * comentario puede tambien NO romper —si casualmente cierra y reabre dejando codigo
   * valido— y entonces el shader queda cortado sin que nadie se entere. Esto lo avisa.
   *
   * El seguimiento de plantillas es deliberadamente simple: cuenta comillas invertidas
   * que no esten escapadas y considera que esta "dentro" con cuenta impar. Suficiente
   * para el patron que se busca, y sin traer un parser.
   */
  const avisos = [];
  for (const nombre of archivos) {
    const texto = readFileSync(join(SRC, nombre), 'utf8');
    const lineas = texto.split('\n');
    let dentro = false;
    lineas.forEach((linea, i) => {
      const comentario = linea.indexOf('//');
      // Si la linea esta DENTRO de una plantilla y su comentario lleva comilla, avisa.
      if (dentro && comentario >= 0 && linea.indexOf('`', comentario) >= 0) {
        avisos.push(`${nombre}:${i + 1} ${linea.trim().slice(0, 90)}`);
      }
      // Y se actualiza el estado con las comillas de ESTA linea.
      for (let k = 0; k < linea.length; k += 1) {
        if (linea[k] === '`' && linea[k - 1] !== '\\') dentro = !dentro;
      }
    });
  }
  assert.deepEqual(avisos, [],
    `comillas invertidas en comentarios dentro de plantillas:\n${avisos.join('\n')}`);
});
