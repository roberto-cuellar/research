/**
 * Grafo de dependencias de `src/`.
 *
 * Existe para contestar la pregunta que hay que hacerse ANTES de mover un archivo:
 * quien se rompe. Y de paso hace cumplir las fronteras entre subsistemas de la
 * spec 035, que sin esto serian una intencion escrita en un documento.
 *
 * Es el equivalente del `npm run dep-graph` de la plataforma (su spec 004), con
 * las mismas dos reglas duras:
 *
 *   1. El documento que genera es GENERADO. No se edita a mano. Nunca.
 *   2. Todo modulo nuevo o movido lo regenera en el MISMO commit. Un grafo que va
 *      una spec por detras es peor que no tenerlo, porque se le cree.
 *
 * Uso:
 *   node tools/dep-graph.mjs                 regenera el documento
 *   node tools/dep-graph.mjs --verificar     sale != 0 si hay violaciones o ciclos
 *   node tools/dep-graph.mjs --quien <ruta>  que se rompe si lo muevo
 *
 * Por que basta una expresion regular y no hace falta parsear: los `import` de ES
 * modules son estaticos, van al principio del archivo y aqui siempre llevan
 * extension. Un parser completo seria mas correcto y no encontraria nada mas.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(RAIZ, 'src');
const SALIDA = join(RAIZ, 'docs', 'technical', 'grafo-de-dependencias.md');

/**
 * Que puede importar cada subsistema (spec 035).
 *
 * La frontera que importa es la de `p_`: el playsim no conoce al render. Es lo que
 * en Doom permitio demos y juego en red, y aqui es lo que permite simular el nivel
 * sin dibujarlo.
 */
export const PUEDE_IMPORTAR = {
  // `w_` es datos Y vocabulario: las enumeraciones compartidas viven aqui, asi que
  // puede importarse a si mismo. No importa nada mas.
  w_: ['w_'],
  // `i_` traduce teclas a acciones, y para eso necesita el vocabulario de acciones.
  // Nada mas del juego: es la capa que toca el navegador.
  i_: ['w_'],
  p_: ['p_', 'w_'],                          // LA FRONTERA DURA
  s_: ['s_', 'w_'],
  d_: ['d_', 'p_', 's_', 'w_'],
  r_: ['r_', 'p_', 's_', 'd_', 'w_'],        // el render lee el mundo, nunca al reves
  hu_: ['hu_', 'p_', 'd_', 's_', 'i_', 'w_'],
  g_: ['*'],                                 // el ensamblaje puede con todo
  '': ['*'],                                 // sin clasificar: todavia no migrado
};

const SUBSISTEMAS = {
  w_: 'datos del mundo',
  i_: 'plataforma',
  p_: 'playsim',
  s_: 'sonido',
  d_: 'director',
  r_: 'render',
  hu_: 'HUD',
  g_: 'partida',
  '': 'sin clasificar',
};

/**
 * Three.js cuenta como `r_`.
 *
 * Es la pieza clave de la verificacion: un `import * as THREE` dentro de un archivo
 * `p_*` es exactamente la violacion que buscamos, y asi sale del mismo mecanismo que
 * las demas en vez de necesitar un test aparte.
 */
const EXTERNOS = { three: 'r_' };

function prefijoDe(nombre) {
  const m = nombre.match(/^(hu_|[a-z]_)/);
  return m ? m[1] : '';
}

/** Lee `src/` y devuelve el grafo: nodos con sus importaciones resueltas. */
export function construir(dir = SRC) {
  const archivos = readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
  const nodos = new Map();

  for (const archivo of archivos) {
    const texto = readFileSync(join(dir, archivo), 'utf8');
    const lineas = texto.split('\n').length;

    // `import ... from '...'` y `export ... from '...'`, en una o varias lineas.
    const importa = [];
    const externos = [];
    const re = /(?:^|\n)\s*(?:import|export)\b[\s\S]*?from\s+['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(texto)) !== null) {
      const destino = m[1];
      if (destino.startsWith('.')) importa.push(basename(destino));
      else externos.push(destino);
    }

    nodos.set(archivo, {
      archivo,
      prefijo: prefijoDe(archivo),
      lineas,
      importa: [...new Set(importa)].sort(),
      externos: [...new Set(externos)].sort(),
      afectados: [],   // se rellena abajo
    });
  }

  // Mapa inverso: quien me importa a MI. Es la columna que se consulta antes de
  // mover un archivo, y la razon de ser de esta herramienta.
  for (const nodo of nodos.values()) {
    for (const dep of nodo.importa) {
      const destino = nodos.get(dep);
      if (destino) destino.afectados.push(nodo.archivo);
    }
  }
  for (const nodo of nodos.values()) nodo.afectados.sort();

  return nodos;
}

/** Violaciones de la tabla de capas, incluidas las de Three.js. */
export function violaciones(nodos) {
  const fallos = [];
  for (const nodo of nodos.values()) {
    const permitidos = PUEDE_IMPORTAR[nodo.prefijo] ?? ['*'];
    if (permitidos.includes('*')) continue;

    for (const dep of nodo.importa) {
      const p = prefijoDe(dep);
      // Importar algo sin clasificar no es violacion mientras dure la migracion:
      // es el estado intermedio esperado. Lo que no se tolera es lo tipado.
      if (p === '') continue;
      if (!permitidos.includes(p)) {
        fallos.push({ de: nodo.archivo, a: dep, motivo: `${nodo.prefijo} no puede importar ${p}` });
      }
    }
    for (const ext of nodo.externos) {
      const p = EXTERNOS[ext];
      if (p && !permitidos.includes(p)) {
        fallos.push({ de: nodo.archivo, a: ext, motivo: `${nodo.prefijo} no puede importar '${ext}' (cuenta como ${p})` });
      }
    }
  }
  return fallos;
}

/** Ciclos de importacion. Hoy nadie sabe si los hay. */
export function ciclos(nodos) {
  const encontrados = [];
  const estado = new Map();   // 0 sin visitar · 1 en pila · 2 cerrado
  const pila = [];

  function visitar(nombre) {
    estado.set(nombre, 1);
    pila.push(nombre);
    for (const dep of nodos.get(nombre)?.importa ?? []) {
      if (!nodos.has(dep)) continue;
      const e = estado.get(dep) ?? 0;
      if (e === 0) visitar(dep);
      else if (e === 1) {
        const desde = pila.indexOf(dep);
        encontrados.push([...pila.slice(desde), dep]);
      }
    }
    pila.pop();
    estado.set(nombre, 2);
  }

  for (const nombre of nodos.keys()) if ((estado.get(nombre) ?? 0) === 0) visitar(nombre);
  return encontrados;
}

function tabla(nodos) {
  const filas = [...nodos.values()].sort((a, b) => {
    if (a.prefijo !== b.prefijo) return a.prefijo.localeCompare(b.prefijo);
    return b.lineas - a.lineas;
  });

  const celda = (xs) => (xs.length ? xs.map((x) => `\`${x}\``).join(' ') : '—');
  const out = ['| Módulo | Subsistema | Líneas | Importa | Externos | **afectados-por** |',
               '|---|---|---:|---|---|---|'];
  for (const n of filas) {
    out.push(`| \`${n.archivo}\` | ${SUBSISTEMAS[n.prefijo]} | ${n.lineas} | `
           + `${celda(n.importa)} | ${celda(n.externos)} | ${celda(n.afectados)} |`);
  }
  return out.join('\n');
}

function documento(nodos) {
  const fallos = violaciones(nodos);
  const ciclosHallados = ciclos(nodos);
  const total = [...nodos.values()].reduce((a, n) => a + n.lineas, 0);
  const sinClasificar = [...nodos.values()].filter((n) => n.prefijo === '').length;
  const hoja = [...nodos.values()].filter((n) => n.afectados.length === 0).map((n) => n.archivo);

  return `---
scope: juego
reads-when: ANTES de renombrar, mover o borrar un archivo de src/
tokens-hint: bajo
generado-por: tools/dep-graph.mjs
updated: ${new Date().toISOString().slice(0, 10)}
---

# Grafo de dependencias — \`src/\`

> ⚠️ **GENERADO POR SCRIPT. NO SE EDITA A MANO.**
> Se regenera con \`node tools/dep-graph.mjs\`, y **en el mismo commit** que cualquier módulo nuevo o
> movido. Un grafo que va una spec por detrás es peor que no tenerlo, porque se le cree.

${nodos.size} módulos · ${total.toLocaleString('es')} líneas · ${sinClasificar} sin clasificar

## Cómo se usa

\`\`\`bash
node tools/dep-graph.mjs --quien src/player.js   # que se rompe si lo muevo
node tools/dep-graph.mjs --verificar             # violaciones de capa y ciclos
\`\`\`

La columna **\`afectados-por\`** es la que se consulta antes de tocar un archivo: son los módulos que
dejan de compilar si cambia de nombre o desaparece.

## Módulos

${tabla(nodos)}

## Violaciones de capa

${fallos.length === 0
  ? '✅ Ninguna.'
  : `🔴 **${fallos.length}**. Reglas en \`PUEDE_IMPORTAR\` (\`tools/dep-graph.mjs\`) y en la spec 035.\n\n`
    + fallos.map((f) => `- \`${f.de}\` → \`${f.a}\` — ${f.motivo}`).join('\n')}

## Ciclos

${ciclosHallados.length === 0
  ? '✅ Ninguno.'
  : `🔴 **${ciclosHallados.length}**.\n\n`
    + ciclosHallados.map((c) => `- ${c.map((x) => `\`${x}\``).join(' → ')}`).join('\n')}

## Hojas

Nadie los importa. Son los más baratos de mover, y el sitio por donde empezar una migración:

${hoja.length ? hoja.map((h) => `\`${h}\``).join(' · ') : '—'}
`;
}

// ----------------------------------------------------------------- linea de comandos

const args = process.argv.slice(2);
const nodos = construir();

if (args[0] === '--quien') {
  const objetivo = basename(args[1] ?? '');
  const nodo = nodos.get(objetivo);
  if (!nodo) {
    console.error(`No existe src/${objetivo}`);
    process.exit(2);
  }
  console.log(`${objetivo}  (${SUBSISTEMAS[nodo.prefijo]}, ${nodo.lineas} lineas)\n`);
  console.log(`  importa    : ${nodo.importa.join(', ') || '—'}`);
  console.log(`  externos   : ${nodo.externos.join(', ') || '—'}`);
  console.log(`  SE ROMPEN  : ${nodo.afectados.join(', ') || 'nadie, es una hoja'}`);
} else if (args[0] === '--verificar') {
  const fallos = violaciones(nodos);
  const cs = ciclos(nodos);
  for (const f of fallos) console.error(`violacion: ${f.de} -> ${f.a}  (${f.motivo})`);
  for (const c of cs) console.error(`ciclo: ${c.join(' -> ')}`);
  const sinClasificar = [...nodos.values()].filter((n) => n.prefijo === '').length;
  console.log(`\n${nodos.size} modulos · ${fallos.length} violaciones · ${cs.length} ciclos`
            + ` · ${sinClasificar} sin clasificar`);
  process.exit(fallos.length + cs.length === 0 ? 0 : 1);
} else {
  writeFileSync(SALIDA, documento(nodos), 'utf8');
  const fallos = violaciones(nodos);
  const cs = ciclos(nodos);
  console.log(`docs/technical/grafo-de-dependencias.md regenerado`);
  console.log(`  ${nodos.size} modulos · ${fallos.length} violaciones · ${cs.length} ciclos`);
}
