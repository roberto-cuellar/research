/**
 * LA ARQUITECTURA, COMPROBADA. No documentada: comprobada.
 *
 * `docs/conventions.md` y la constitucion describen las capas y quien puede importar a
 * quien. Un documento que describe una regla no la impide: el siguiente agente —o el
 * mismo dentro de dos semanas— importa `r_particles.js` desde un `p_*` porque le hace
 * falta una nubecilla, la spec no dice nada al respecto en ese momento, y el playsim
 * deja de poder simularse en Node. El dano no se ve hasta meses despues, cuando alguien
 * quiere una prueba headless y ya no la puede escribir.
 *
 * Por eso estas reglas viven aqui y no solo en el markdown. `tools/dep-graph.mjs` ya
 * sabia calcularlas; lo que faltaba era que ALGO FALLARA cuando se incumplen.
 *
 * Si una de estas pruebas te molesta, la conversacion es sobre la regla —una spec— no
 * sobre la prueba. Relajarla para poner la suite en verde es exactamente lo que este
 * archivo existe para hacer imposible sin que se note.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(RAIZ, 'src');

/**
 * LAS CAPAS, y quien puede importar a quien.
 *
 * El orden es de dentro afuera: cada capa puede importar de las de su derecha y nunca
 * de las de su izquierda. Es la regla de la spec 035 y el motivo de los prefijos.
 */
const CAPAS = Object.freeze({
  w: { nombre: 'datos del mundo', puede: ['w'] },
  p: { nombre: 'playsim', puede: ['p', 'w'] },
  s: { nombre: 'sonido', puede: ['s', 'w'] },
  r: { nombre: 'render', puede: ['r', 'p', 'w'] },
  hu: { nombre: 'HUD', puede: ['hu', 'w'] },
  i: { nombre: 'plataforma', puede: ['i', 'w'] },
  d: { nombre: 'director', puede: ['d', 'p', 'w'] },
  g: { nombre: 'partida', puede: ['g', 'r', 'p', 's', 'hu', 'i', 'd', 'w'] },
});

/** Los tres sin prefijo son de antes de la spec 035. No se les exige capa. */
const SIN_CLASIFICAR = new Set(['game.js', 'portal.js', 'drone.js']);

function capaDe(archivo) {
  const m = archivo.match(/^([a-z]{1,2})_/);
  return m ? m[1] : null;
}

const archivos = readdirSync(SRC).filter((f) => f.endsWith('.js'));

/** Importaciones internas (a otro `src/`) por archivo. */
function importacionesDe(archivo) {
  const texto = readFileSync(join(SRC, archivo), 'utf8');
  const out = [];
  // `import ... from './x.js'` y `await import('./x.js')`.
  const re = /(?:from|import)\s*\(?\s*['"]\.\/([\w.-]+\.js)['"]/g;
  let m;
  while ((m = re.exec(texto)) !== null) out.push(m[1]);
  return out;
}

test('ningun modulo importa de una capa que no le corresponde', () => {
  const fallos = [];
  for (const archivo of archivos) {
    if (SIN_CLASIFICAR.has(archivo)) continue;
    const capa = capaDe(archivo);
    if (!capa || !CAPAS[capa]) continue;
    for (const dep of importacionesDe(archivo)) {
      if (SIN_CLASIFICAR.has(dep)) continue;
      const capaDep = capaDe(dep);
      if (!capaDep || !CAPAS[capaDep]) continue;
      if (!CAPAS[capa].puede.includes(capaDep)) {
        fallos.push(`${archivo} (${CAPAS[capa].nombre}) importa ${dep} (${CAPAS[capaDep].nombre})`);
      }
    }
  }
  assert.deepEqual(fallos, [],
    `violaciones de capa:\n${fallos.join('\n')}\n\n`
    + 'Si de verdad hace falta, es una spec: se cambia la tabla CAPAS con su razon.');
});

test('EL PLAYSIM NO TOCA THREE.JS, que es lo que lo hace simulable en Node', () => {
  /**
   * La invariante mas valiosa del proyecto y la mas facil de romper sin querer.
   *
   * `p_*` y `w_*` tienen que poder correr sin navegador: es lo que permite el simulador
   * headless de `maze_retos.test.mjs`, que recorre los catorce retos con la colision de
   * verdad. Un solo `import * as THREE` en un `p_*` lo tira todo, y el sintoma seria
   * "las pruebas no arrancan", no "alguien importo Three".
   */
  const fallos = [];
  for (const archivo of archivos) {
    const capa = capaDe(archivo);
    if (capa !== 'p' && capa !== 'w') continue;
    const texto = readFileSync(join(SRC, archivo), 'utf8');
    if (/from\s+['"]three['"]/.test(texto) || /import\s*\(\s*['"]three['"]/.test(texto)) {
      fallos.push(archivo);
    }
  }
  assert.deepEqual(fallos, [], `estos modulos de playsim/datos importan three: ${fallos.join(', ')}`);
});

test('no hay ciclos de importacion', () => {
  /**
   * Un ciclo en ESM no falla al importar: deja una de las dos mitades a medio inicializar
   * y el sintoma aparece lejos —un `undefined` en una constante que "deberia estar"—.
   * Es de los fallos mas caros de diagnosticar, y de los mas baratos de impedir.
   */
  const grafo = new Map(archivos.map((a) => [a, importacionesDe(a).filter((d) => archivos.includes(d))]));
  const estado = new Map();   // 0 sin ver · 1 en la pila · 2 cerrado
  const ciclos = [];
  const pila = [];
  function visitar(n) {
    estado.set(n, 1);
    pila.push(n);
    for (const dep of grafo.get(n) || []) {
      const e = estado.get(dep) || 0;
      if (e === 1) ciclos.push([...pila.slice(pila.indexOf(dep)), dep].join(' -> '));
      else if (e === 0) visitar(dep);
    }
    pila.pop();
    estado.set(n, 2);
  }
  for (const n of archivos) if ((estado.get(n) || 0) === 0) visitar(n);
  assert.deepEqual(ciclos, [], `ciclos:\n${ciclos.join('\n')}`);
});

test('el grafo de dependencias documentado esta AL DIA', () => {
  /**
   * `docs/technical/grafo-de-dependencias.md` lo genera `tools/dep-graph.mjs`, y su
   * propia cabecera avisa: "un grafo que va una spec por detras es peor que no tenerlo,
   * porque se le cree".
   *
   * Esto lo hace cumplible: si hay un modulo en `src/` que el documento no menciona, la
   * suite falla y el arreglo son diez segundos (`node tools/dep-graph.mjs`). Sin esto, el
   * documento envejece en silencio y el siguiente agente en frio decide a partir de un
   * mapa viejo — que es peor que decidir sin mapa.
   */
  const doc = readFileSync(join(RAIZ, 'docs', 'technical', 'grafo-de-dependencias.md'), 'utf8');
  const ausentes = archivos.filter((a) => !doc.includes(`\`${a}\``));
  assert.deepEqual(ausentes, [],
    `el grafo no menciona: ${ausentes.join(', ')}\n`
    + 'Regeneralo con: node tools/dep-graph.mjs');
});

test('ninguna dependencia nueva sin spec: solo three y sus ejemplos', () => {
  /**
   * "Sin dependencias nuevas sin spec. El juego es Three.js 0.160 vanilla y nada mas, a
   * proposito." (constitucion, ESTILO Y COMENTARIOS.)
   *
   * Se comprueba sobre los IMPORTS y no sobre `package.json` porque es ahi donde entra
   * una dependencia de verdad: un `import` de un CDN o de `node_modules` funciona en el
   * navegador sin tocar el manifiesto, y nadie se enteraria.
   */
  const permitidos = [/^three$/, /^three\/examples\//, /^\.\//, /^\.\.\//];
  const fallos = [];
  for (const archivo of archivos) {
    const texto = readFileSync(join(SRC, archivo), 'utf8');
    const re = /from\s+['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(texto)) !== null) {
      const spec = m[1];
      if (!permitidos.some((p) => p.test(spec))) fallos.push(`${archivo}: ${spec}`);
    }
  }
  assert.deepEqual(fallos, [], `dependencias no permitidas:\n${fallos.join('\n')}`);
});

test('ningun TODO sin su entrada TDB en la deuda tecnica', () => {
  /**
   * "Ningun `// TODO` sin su entrada `TDB-NNN` en `docs/TECH_DEBT.md`." (constitucion.)
   *
   * Un pendiente sin registrar es un pendiente que nadie va a hacer: no sale en ninguna
   * lista y se descubre leyendo el archivo por casualidad.
   *
   * ---- OJO: aqui los comentarios estan en ESPANOL ----
   *
   * Buscar `\bTODO\b` da falsos positivos, y no pocos: "TODO" es una palabra corriente
   * en castellano y se escribe en mayusculas para enfatizar. La primera version de esta
   * prueba cazo cuatro, y los cuatro eran prosa: "paso fijo para TODO el playsim", "una
   * sola malla para TODO el banco".
   *
   * Asi que se exige la forma de MARCADOR —`TODO` justo detras del abrepaz del
   * comentario, o con dos puntos— que es como la constitucion lo escribe. Una prueba que
   * grita en prosa correcta se desactiva a la semana, y entonces ya no protege nada.
   */
  const deuda = readFileSync(join(RAIZ, 'docs', 'TECH_DEBT.md'), 'utf8');
  const fallos = [];
  const MARCADOR = /(?:\/\/|\/\*|^\s*\*)\s*TODO\b|\bTODO:/;
  for (const archivo of archivos) {
    const lineas = readFileSync(join(SRC, archivo), 'utf8').split('\n');
    lineas.forEach((linea, i) => {
      if (!MARCADOR.test(linea)) return;
      const tdb = linea.match(/TDB-(\d+)/);
      if (!tdb) { fallos.push(`${archivo}:${i + 1} TODO sin TDB-NNN`); return; }
      if (!deuda.includes(`TDB-${tdb[1]}`)) {
        fallos.push(`${archivo}:${i + 1} cita TDB-${tdb[1]} y no esta en TECH_DEBT.md`);
      }
    });
  }
  assert.deepEqual(fallos, [], `TODOs sin registrar:\n${fallos.join('\n')}`);
});
