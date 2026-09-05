#!/usr/bin/env node
// CLI del SEM (§12).
//
// Requisito de visibilidad: el humano debe poder ver, en cualquier momento y sin
// leer JSONL a mano, en qué iteración va, cuál es la métrica actual vs. objetivo,
// qué se intentó y falló, y qué está esperando aprobación.
//
// Esta CLI y el MCP de `tools/mcp/` comparten UNA sola capa de lógica: la de
// `tools/lib/`. Nunca se duplica comportamiento entre los dos frentes.

import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Memoria } from '../lib/memory.mjs';
import { readJsonl } from '../lib/store.mjs';
import { errorSignature, taskSignature } from '../lib/signature.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// --- presentación -----------------------------------------------------------
const C = process.stdout.isTTY
  ? { dim: '\x1b[2m', b: '\x1b[1m', r: '\x1b[0m', v: '\x1b[32m', x: '\x1b[31m', a: '\x1b[33m' }
  : { dim: '', b: '', r: '', v: '', x: '', a: '' };

const out = (s = '') => process.stdout.write(`${s}\n`);
const err = (s) => process.stderr.write(`${s}\n`);

function tabla(filas) {
  if (!filas.length) return;
  const cols = Object.keys(filas[0]);
  const anchos = cols.map((c) => Math.max(c.length, ...filas.map((f) => String(f[c] ?? '').length)));
  out(`${C.dim}${cols.map((c, i) => c.padEnd(anchos[i])).join('  ')}${C.r}`);
  for (const f of filas) out(cols.map((c, i) => String(f[c] ?? '').padEnd(anchos[i])).join('  '));
}

// --- comandos ---------------------------------------------------------------

async function cmdStatus() {
  const mem = await new Memoria(RAIZ).abrir();
  const s = await mem.stats();

  out(`${C.b}SEM — estado${C.r}  ${C.dim}${RAIZ}${C.r}\n`);

  if (s.desactivada) out(`${C.a}⚠ memoria DESACTIVADA por SEM_MEMORY_DISABLED${C.r}\n`);

  out(`${C.b}Memoria${C.r}`);
  tabla([{
    attempts: s.attempts,
    corruptos: s.attempts_corruptos,
    'lecciones activas': s.lecciones_activas,
    archivadas: s.lecciones_archivadas,
    // Son dos índices distintos: uno mapea firmas de INTENTO a su offset, el
    // otro las lecciones. Mostrarlos con la misma etiqueta hacía parecer que
    // una lección recuperable estaba sin indexar.
    'firmas de intento': s.indice.firmas_error,
    'lecciones indexadas': s.indice.lecciones,
  }]);

  const proyectos = await listarProyectos();
  out(`\n${C.b}Proyectos${C.r}`);
  if (!proyectos.length) {
    out(`${C.dim}  ninguno. Un proyecto no arranca sin su GOALS.yml (§4).${C.r}`);
  } else {
    tabla(proyectos);
  }

  const lock = join(RAIZ, 'governance', 'policy', 'GOVERNANCE.lock.yml');
  out(`\n${C.b}Gobernanza${C.r}`);
  out(existsSync(lock)
    ? `  lock: ${C.v}presente${C.r}`
    : `  lock: ${C.a}ausente${C.r} ${C.dim}(Fase 2 pendiente)${C.r}`);

  const aprob = join(RAIZ, 'governance', 'approvals');
  const pend = existsSync(aprob)
    ? (await readdir(aprob)).filter((f) => f.endsWith('.yml') || f.endsWith('.json'))
    : [];
  out(`  aprobaciones registradas: ${pend.length}`);
}

/** Recorre games/ y research/ buscando GOALS.yml. Sin métrica declarada, no hay proyecto. */
async function listarProyectos() {
  const filas = [];
  for (const raizRel of ['games', 'research']) {
    const base = join(RAIZ, raizRel);
    if (!existsSync(base)) continue;
    for (const goals of await buscarGoals(base)) {
      const rel = goals.slice(RAIZ.length + 1).replace(/\\/g, '/').replace(/\/GOALS\.yml$/, '');
      filas.push({ proyecto: rel, ...(await resumenGoals(goals, rel)) });
    }
  }
  return filas;
}

async function buscarGoals(dir, prof = 0) {
  if (prof > 3) return [];
  const hallados = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isFile() && e.name === 'GOALS.yml') hallados.push(p);
    else if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') {
      hallados.push(...(await buscarGoals(p, prof + 1)));
    }
  }
  return hallados;
}

/**
 * Lectura deliberadamente mínima del GOALS.yml: objetivo y umbrales.
 * No se añade una dependencia de YAML hasta que el formato lo exija.
 */
async function resumenGoals(ruta, proyecto) {
  const texto = await readFile(ruta, 'utf8');
  const objetivo = texto.match(/^objective:\s*["']?(.+?)["']?\s*$/m)?.[1] ?? '—';
  const maxIter = texto.match(/^\s*max_iterations:\s*(\d+)/m)?.[1] ?? '—';

  const mem = await new Memoria(RAIZ).abrir();
  const { entradas } = await readJsonl(mem.rutas.attempts);
  const mios = entradas.filter((a) => a.project === proyecto);
  const ultima = mios.at(-1);

  return {
    objetivo: objetivo.slice(0, 44),
    iter: ultima ? `${ultima.iteration}/${maxIter}` : `0/${maxIter}`,
    intentos: mios.length,
    ultimo: ultima ? (ultima.result === 'pass' ? `${C.v}pass${C.r}` : `${C.x}${ultima.result}${C.r}`) : '—',
  };
}

async function cmdMemorySearch(args) {
  const q = args.join(' ').trim();
  if (!q) { err('uso: sem memory search <texto del error | err_xxxx | dominio:tarea>'); process.exit(2); }

  const mem = await new Memoria(RAIZ).abrir();

  // Nivel 1 de §7.6: lookup exacto. Cero tokens. Siempre se intenta primero.
  const exacta = await mem.leccionPara(q);
  if (exacta) {
    out(`${C.v}✓ lección exacta${C.r} ${C.dim}(nivel 1: lookup O(1), cero tokens)${C.r}\n`);
    return imprimirLeccion(exacta);
  }

  // Nivel 2: filtro por task_signature o por dominio.
  const [dom, tarea] = q.includes(':') ? q.split(':') : [q, null];
  const lecciones = await mem.recall(tarea ? { taskSignature: q } : { dominio: dom });
  if (!lecciones.length) {
    out(`${C.dim}sin lecciones para "${q}". Firma calculada: ${errorSignature(q) ?? '—'}${C.r}`);
    return;
  }
  out(`${C.b}${lecciones.length} lección(es)${C.r} ${C.dim}(nivel 2: filtro por task_signature, K≤5)${C.r}\n`);
  lecciones.forEach(imprimirLeccion);
}

function imprimirLeccion(l) {
  out(`${C.b}${l.id}${C.r}  ${C.dim}${l.task_signature} · ${l.error_signature} · hits:${l.hits} · ${l.confidence}${C.r}`);
  out(`  ${l.lesson}`);
  if (l.evidence?.length) out(`  ${C.dim}evidencia: ${l.evidence.join(', ')}${C.r}`);
  out();
}

async function cmdMemoryCheck(args) {
  const q = args.join(' ').trim();
  if (!q) { err('uso: sem memory check <texto del error>'); process.exit(2); }
  const mem = await new Memoria(RAIZ).abrir();
  const r = await mem.esReincidencia(q);
  if (!r.reincidencia) {
    out(`${C.v}✓ sin precedente${C.r}  firma: ${errorSignature(q)}`);
    return;
  }
  // §7.4: esto es un bug del sistema de memoria, no un intento más.
  err(`${C.x}✗ REINCIDENCIA${C.r} — esta firma ya estaba en lessons.jsonl.`);
  err(`  ${r.leccion.lesson}`);
  err(`\n  §14.8 prohíbe reintentar sin evidencia diagnóstica nueva.`);
  process.exit(1);
}

async function cmdGoals(args) {
  const proyecto = args[0];
  if (!proyecto) {
    const p = await listarProyectos();
    if (!p.length) out(`${C.dim}ningún proyecto tiene GOALS.yml todavía${C.r}`);
    else tabla(p);
    return;
  }
  const ruta = join(RAIZ, proyecto, 'GOALS.yml');
  if (!existsSync(ruta)) {
    err(`${C.x}${proyecto} no tiene GOALS.yml.${C.r} §14.3: no se crea un proyecto sin su métrica y su verificador.`);
    process.exit(1);
  }
  out(await readFile(ruta, 'utf8'));
}

function cmdNoImplementado(nombre, fase) {
  err(`${C.a}'sem ${nombre}' aún no está implementado${C.r} — llega en la ${fase}.`);
  err(`${C.dim}§14.1: no se afirma que algo funciona sin haberlo ejecutado.${C.r}`);
  process.exit(2);
}

function ayuda() {
  out(`${C.b}sem${C.r} — interfaz humana del Sistema de Evolución Multimodal

${C.b}Disponible${C.r}
  sem status                    estado: memoria, proyectos, gobernanza
  sem goals [proyecto]          objetivo y umbrales declarados
  sem memory search <query>     recupera lecciones (nivel 1 exacto, luego nivel 2)
  sem memory check <error>      ¿esta firma ya falló antes? exit≠0 si reincide
  sem memory stats              contadores del store

${C.b}Pendiente${C.r} ${C.dim}(no fingir que existe)${C.r}
  sem lock <archivo>            congelar en GOVERNANCE.lock.yml     → Fase 2
  sem approve <solicitud>       registrar aprobación humana          → Fase 2
  sem run <proyecto>            ejecutar el bucle de convergencia    → Fase 5
  sem bench vlm                 benchmark de modelos de visión       → Fase 4
  sem report <proyecto>         informe afirmado vs. obtenido        → Fase 5

${C.dim}SEM_MEMORY_DISABLED=1 desactiva la memoria por completo (§7.5 regla 6).${C.r}`);
}

// --- dispatch ---------------------------------------------------------------
const [cmd, sub, ...resto] = process.argv.slice(2);

try {
  switch (cmd) {
    case 'status': await cmdStatus(); break;
    case 'goals': await cmdGoals([sub, ...resto].filter(Boolean)); break;
    case 'memory':
      if (sub === 'search') await cmdMemorySearch(resto);
      else if (sub === 'check') await cmdMemoryCheck(resto);
      else if (sub === 'stats') out(JSON.stringify(await new Memoria(RAIZ).abrir().then((m) => m.stats()), null, 2));
      else { err('uso: sem memory <search|check|stats>'); process.exit(2); }
      break;
    case 'lock': cmdNoImplementado('lock', 'Fase 2'); break;
    case 'approve': cmdNoImplementado('approve', 'Fase 2'); break;
    case 'run': cmdNoImplementado('run', 'Fase 5'); break;
    case 'bench': cmdNoImplementado('bench', 'Fase 4'); break;
    case 'report': cmdNoImplementado('report', 'Fase 5'); break;
    case undefined: case '-h': case '--help': case 'help': ayuda(); break;
    default: err(`comando desconocido: ${cmd}`); ayuda(); process.exit(2);
  }
} catch (e) {
  err(`${C.x}error:${C.r} ${e.message}`);
  err(`${C.dim}firma: ${errorSignature(e.stack ?? e.message)}${C.r}`);
  process.exit(1);
}

export { taskSignature };
