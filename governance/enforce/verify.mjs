#!/usr/bin/env node
// CAPA 3 — EL gate. Corre en local Y en CI.
//
// Por qué un solo script: si el gate de CI y el local divergen, el agente
// aprende a pasar el local y el de CI se convierte en ruido. Un único verify.mjs
// hace que "pasa en mi máquina" signifique exactamente lo mismo que "pasa en CI".
//
// Tres puntos de invocación, de más temprano a más tarde:
//   1. PreToolUse hook   — previene la escritura antes de que ocurra
//   2. pre-commit de git — red de seguridad si el hook se saltó
//   3. workflow de CI    — autoridad final
//
// AND booleano, sin puntuaciones (§8.3.2).
//
//   uso: node governance/enforce/verify.mjs [--staged] [--only <id,id>] [--json]

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sha256Contenido, sha256Fichero } from '../../tools/lib/hash.mjs';
import { parseYaml } from '../../tools/lib/yaml.mjs';
import {
  validarClaims, validarGoals, validarLock, validarQualityGates,
  validarRequirements, validarResearchContract, validarTaskPolicy,
} from '../../tools/lib/esquemas.mjs';

const NUL = String.fromCharCode(0);
const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCK = join(RAIZ, 'governance', 'policy', 'GOVERNANCE.lock.yml');
const GATES = join(RAIZ, 'governance', 'policy', 'quality-gates.yml');
const BASELINE = join(RAIZ, 'governance', 'policy', 'baseline.json');

const args = process.argv.slice(2);
const SOLO_STAGED = args.includes('--staged');
const JSON_OUT = args.includes('--json');
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;

const C = process.stdout.isTTY && !JSON_OUT
  ? { v: '\x1b[32m', x: '\x1b[31m', a: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', r: '\x1b[0m' }
  : { v: '', x: '', a: '', d: '', b: '', r: '' };

function git(...a) {
  try {
    return execFileSync('git', a, { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    return e.stdout?.toString().trim() ?? '';
  }
}

// Normaliza CRLF antes de hashear: en Windows el checkout reescribe los saltos
// de línea y el hash de los bytes en disco deja de cuadrar con el del lock.
const sha256 = sha256Fichero;

/**
 * Parser estricto de la secuencia `frozen:` del lock.
 *
 * Deliberadamente NO es un parser de YAML general: solo entiende el esquema de
 * §8.1, y cualquier cosa que no reconozca la trata como error. Fallo cerrado —
 * un lock que no se entiende no puede autorizar nada. El fichero lo genera
 * `sem lock`, así que su forma está bajo control.
 */
function leerLock() {
  if (!existsSync(LOCK)) return { entradas: [], error: null };
  const lineas = readFileSync(LOCK, 'utf8').split(/\r?\n/);
  const entradas = [];
  let dentro = false;
  let actual = null;

  for (const [i, cruda] of lineas.entries()) {
    const linea = cruda.replace(/\s+#.*$/, '');
    if (!linea.trim() || linea.trimStart().startsWith('#')) continue;

    if (/^frozen:\s*$/.test(linea)) { dentro = true; continue; }
    if (/^\w[\w-]*:/.test(linea)) { dentro = false; continue; }
    if (!dentro) continue;

    const item = linea.match(/^\s*-\s+(\w+):\s*(.*)$/);
    if (item) {
      if (actual) entradas.push(actual);
      actual = { [item[1]]: limpiar(item[2]) };
      continue;
    }
    const campo = linea.match(/^\s+(\w+):\s*(.*)$/);
    if (campo && actual) { actual[campo[1]] = limpiar(campo[2]); continue; }

    return { entradas: [], error: `GOVERNANCE.lock.yml línea ${i + 1}: no reconocida -> ${cruda}` };
  }
  if (actual) entradas.push(actual);

  for (const e of entradas) {
    if (!e.path || !e.sha256) {
      return { entradas: [], error: `entrada de lock sin path o sha256: ${JSON.stringify(e)}` };
    }
  }
  return { entradas, error: null };
}

const limpiar = (s) => s.trim().replace(/^["']|["']$/g, '');

/** Rutas que el gate debe vigilar: staged en pre-commit, todo el árbol en CI. */
function rutasModificadas() {
  const salida = SOLO_STAGED
    ? git('diff', '--cached', '--name-only')
    : git('diff', '--name-only', 'HEAD');
  return new Set(salida.split('\n').map((s) => s.trim()).filter(Boolean));
}

// --- comprobaciones ---------------------------------------------------------
// Cada una devuelve { id, ok, detail }. Ninguna lanza: un check que revienta
// es un check que no protege.

function checkLockIntegrity() {
  const { entradas, error } = leerLock();
  if (error) return { id: 'lock_integrity', ok: false, detail: error };
  if (!entradas.length) {
    return { id: 'lock_integrity', ok: true, detail: 'sin ficheros congelados todavía' };
  }
  const rotos = [];
  for (const e of entradas) {
    const abs = join(RAIZ, e.path);
    if (!existsSync(abs)) { rotos.push(`${e.path}: NO EXISTE`); continue; }
    const real = sha256(abs);
    if (real !== e.sha256) rotos.push(`${e.path}: esperado ${e.sha256.slice(0, 12)}… obtenido ${real.slice(0, 12)}…`);
  }
  return rotos.length
    ? { id: 'lock_integrity', ok: false, detail: `alguien tocó un archivo congelado:\n      ${rotos.join('\n      ')}` }
    : { id: 'lock_integrity', ok: true, detail: `${entradas.length} archivo(s) congelado(s), hashes correctos` };
}

/** Hash del contenido que se va a commitear (blob en el índice), no el del disco. */
function sha256Staged(ruta) {
  try {
    const buf = execFileSync('git', ['show', `:${ruta}`], {
      cwd: RAIZ, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    });
    return sha256Contenido(buf);
  } catch {
    return null;   // no está en el índice
  }
}

function checkNoFrozenWrites() {
  const { entradas, error } = leerLock();
  if (error) return { id: 'no_frozen_writes', ok: false, detail: error };

  const porRuta = new Map(entradas.map((e) => [e.path.replace(/\\/g, '/'), e]));
  const violaciones = [];

  for (const p of rutasModificadas()) {
    const rel = p.replace(/\\/g, '/');
    const entrada = porRuta.get(rel);
    if (!entrada) continue;

    // Aparecer en el diff NO es por sí solo una violación: el primer commit de
    // un fichero recién congelado lo hace, y eso es su nacimiento, no una
    // modificación. La autoridad es el sha256 del lock — si el contenido que se
    // va a commitear sigue casando con él, no se ha alterado nada.
    const real = SOLO_STAGED ? sha256Staged(rel) : (existsSync(join(RAIZ, rel)) ? sha256(join(RAIZ, rel)) : null);
    if (real === entrada.sha256) continue;

    violaciones.push(`${rel} (${real ? `hash ${real.slice(0, 12)}…` : 'borrado'} ≠ lock ${entrada.sha256.slice(0, 12)}…)`);
  }

  return violaciones.length
    ? {
        id: 'no_frozen_writes',
        ok: false,
        detail: `escritura a ruta congelada:\n      ${violaciones.join('\n      ')}\n`
              + '      El desbloqueo solo existe como registro en governance/approvals/ (§8.1.5).',
      }
    : { id: 'no_frozen_writes', ok: true, detail: 'ninguna ruta congelada alterada' };
}

/** Regla host-privado del Anexo A.2: el ledger NUNCA puede quedar trackeado. */
function checkLedgerPrivate() {
  const prohibidos = ['memory/attempts.jsonl', 'memory/index.json', 'memory/index.sqlite'];
  const trackeados = prohibidos.filter((p) => git('ls-files', '--', p).length > 0);
  return trackeados.length
    ? {
        id: 'ledger_private',
        ok: false,
        detail: `el ledger no puede estar en git: ${trackeados.join(', ')}\n`
              + '      Sácalo con: git rm --cached <ruta>',
      }
    : { id: 'ledger_private', ok: true, detail: 'attempts.jsonl e índice fuera de git' };
}

const SECRETOS_CONTENIDO = [
  [/\bgh[pousr]_[A-Za-z0-9]{16,}\b/, 'token de GitHub'],
  [/\bsk-[A-Za-z0-9_-]{20,}\b/, 'clave de API'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'clave de AWS'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'clave privada'],
  [/\bxox[abps]-[A-Za-z0-9-]{10,}\b/, 'token de Slack'],
];

function checkSecrets() {
  const gates = existsSync(GATES) ? readFileSync(GATES, 'utf8') : '';
  const permitidas = [...gates.matchAll(/^\s+-\s+"([^"]+)"$/gm)]
    .map((m) => m[1])
    .filter((p) => /governance|PROMPT_MAESTRO|store\.mjs|tools\/tests/.test(p));

  const ficheros = git('ls-files').split('\n').filter(Boolean);
  const hallazgos = [];

  for (const f of ficheros) {
    if (permitidas.some((p) => f.startsWith(p.replace(/\*+$/, '')))) continue;

    if (/(^|\/)(\.env(\..*)?|id_rsa|id_ed25519|credentials(\..*)?)$/.test(f)) {
      hallazgos.push(`${f}: fichero prohibido por nombre`);
      continue;
    }
    const abs = join(RAIZ, f);
    if (!existsSync(abs)) continue;
    let texto;
    try { texto = readFileSync(abs, 'utf8'); } catch { continue; }
    if (texto.indexOf(NUL) !== -1) continue;   // binario: se salta
    for (const [re, que] of SECRETOS_CONTENIDO) {
      if (re.test(texto)) { hallazgos.push(`${f}: posible ${que}`); break; }
    }
  }
  return hallazgos.length
    ? { id: 'secrets_clean', ok: false, detail: hallazgos.join('\n      ') }
    : { id: 'secrets_clean', ok: true, detail: `${ficheros.length} ficheros trackeados, sin secretos` };
}

function ejecutarSuite() {
  try {
    const salida = execFileSync('npm', ['test', '--silent'], {
      cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32',
    });
    return { salida, codigo: 0 };
  } catch (e) {
    return { salida: `${e.stdout ?? ''}${e.stderr ?? ''}`, codigo: e.status ?? 1 };
  }
}

function contar(salida) {
  const n = (re) => Number(salida.match(re)?.[1] ?? -1);
  return { pass: n(/^# pass (\d+)$/m), fail: n(/^# fail (\d+)$/m), total: n(/^# tests (\d+)$/m) };
}

let _suite = null;
const suite = () => (_suite ??= ejecutarSuite());

function checkTestsGreen() {
  const { salida, codigo } = suite();
  const c = contar(salida);
  if (c.total < 0) {
    return { id: 'tests_green', ok: false, detail: `no se pudo leer el resumen de la suite (exit ${codigo})` };
  }
  return codigo === 0 && c.fail === 0
    ? { id: 'tests_green', ok: true, detail: `${c.pass}/${c.total} en verde` }
    : { id: 'tests_green', ok: false, detail: `${c.fail} test(s) en rojo de ${c.total}` };
}

/**
 * §8.3.1 — El mecanismo más importante. Un cambio debe demostrar LAS DOS COSAS:
 * que arregló algo (FAIL_TO_PASS) y que no rompió nada (PASS_TO_PASS).
 */
function checkPassToPass() {
  if (!existsSync(BASELINE)) {
    return {
      id: 'pass_to_pass', ok: false,
      detail: 'no hay baseline.json. Créalo con: node governance/enforce/verify.mjs --baseline',
    };
  }
  const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
  const c = contar(suite().salida);
  return c.pass >= base.pass
    ? { id: 'pass_to_pass', ok: true, detail: `${c.pass} ≥ ${base.pass} (línea base de ${base.registrado})` }
    : {
        id: 'pass_to_pass', ok: false,
        detail: `REGRESIÓN: ${c.pass} verdes ahora, ${base.pass} en la línea base.\n`
              + '      §14.6: un cambio que rompe un golden test se revierte. NO se arregla el test.',
      };
}

function checkFailToPass() {
  if (!existsSync(BASELINE)) return { id: 'fail_to_pass', ok: false, detail: 'sin baseline.json' };
  const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
  const c = contar(suite().salida);
  const nuevos = c.pass - base.pass;
  return nuevos > 0
    ? { id: 'fail_to_pass', ok: true, detail: `+${nuevos} test(s) que antes no pasaban` }
    : {
        id: 'fail_to_pass', ok: false,
        detail: 'ningún test nuevo en verde. Sin FAIL_TO_PASS no se distingue '
              + '"lo arreglé" de "el test siempre pasó" (§8.3.1).',
      };
}


// --- contratos de track ------------------------------------------------------
// research-contract.yml y quality-gates.yml DECLARABAN sin denegar. Estos dos
// checks los hacen ejecutables: sin ellos la gobernanza de los tracks era el
// mismo cartel que §8 advierte.

function ficherosBajo(prefijo) {
  return git('ls-files', prefijo).split('\n').map((s) => s.trim()).filter(Boolean);
}

function leerYamlSeguro(rel) {
  try { return { datos: parseYaml(readFileSync(join(RAIZ, rel), 'utf8')), error: null }; }
  catch (e) { return { datos: null, error: `${rel}: ${e.message}` }; }
}

/** Valida los ficheros de política. Un typo aquí deja el gate sin condiciones. */
function checkPolicySchemas() {
  const fallos = [];
  const pares = [
    ['governance/policy/GOVERNANCE.lock.yml', (d) => validarLock(d, RAIZ)],
    ['governance/policy/quality-gates.yml', validarQualityGates],
    ['governance/policy/task-policy.yml', validarTaskPolicy],
    ['governance/policy/research-contract.yml', validarResearchContract],
  ];
  for (const [rel, validar] of pares) {
    if (!existsSync(join(RAIZ, rel))) { fallos.push(`${rel}: NO EXISTE`); continue; }
    const { datos, error } = leerYamlSeguro(rel);
    if (error) { fallos.push(error); continue; }
    for (const m of validar(datos)) fallos.push(`${rel}: ${m}`);
  }
  return fallos.length
    ? { id: 'policy_schemas', ok: false, detail: fallos.join('\n      ') }
    : { id: 'policy_schemas', ok: true, detail: `${pares.length} ficheros de política válidos` };
}

/** §10.1 ejecutable: sin esto, el contrato de reproducibilidad era prosa. */
function checkResearchContract() {
  const fallos = [];
  const goals = ficherosBajo('research').filter((f) => f.endsWith('GOALS.yml'));

  for (const rel of goals) {
    const { datos, error } = leerYamlSeguro(rel);
    if (error) { fallos.push(error); continue; }
    for (const m of validarGoals(datos, rel, RAIZ)) fallos.push(`${rel}: ${m}`);

    const dir = rel.slice(0, rel.lastIndexOf('/'));
    const claims = join(RAIZ, dir, 'CLAIMS.md');
    if (!existsSync(claims)) {
      fallos.push(`${dir}: falta CLAIMS.md (§10.1 condición 1)`);
    } else {
      for (const m of validarClaims(readFileSync(claims, 'utf8'))) fallos.push(`${dir}/CLAIMS.md: ${m}`);
    }

    const req = join(RAIZ, dir, 'requirements.txt');
    if (existsSync(req)) {
      for (const m of validarRequirements(readFileSync(req, 'utf8'))) fallos.push(`${dir}/requirements.txt: ${m}`);
    }

    const met = join(RAIZ, dir, 'results', 'metrics.json');
    if (existsSync(met)) {
      try { JSON.parse(readFileSync(met, 'utf8')); }
      catch (e) { fallos.push(`${dir}/results/metrics.json: no parseable — ${e.message}`); }
    }
  }
  return fallos.length
    ? { id: 'research_contract', ok: false, detail: fallos.join('\n      ') }
    : { id: 'research_contract', ok: true, detail: `${goals.length} proyecto(s) de investigación conformes` };
}

// §14.11c — los módulos del laberinto NO se reutilizan para el clon plataformer.
const MODULOS_PROHIBIDOS = [
  'g_maze.js', 'r_maze.js', 'w_maze.js', 'w_maze_retos.js', 'hu_maze.js',
  'hu_vallas.js', 'p_maze_mover.js', 'p_maze_reto.js', 'p_maze_rival.js',
  'r_fondo.js', 'r_niebla.js', 'r_aura.js', 'r_cine.js',
  'p_cadena.js', 'r_procanim.js',
];

function checkGameContract() {
  const fallos = [];
  const goals = ficherosBajo('games').filter((f) => f.endsWith('GOALS.yml'));

  for (const rel of goals) {
    const { datos, error } = leerYamlSeguro(rel);
    if (error) { fallos.push(error); continue; }
    for (const m of validarGoals(datos, rel, RAIZ)) fallos.push(`${rel}: ${m}`);
  }

  for (const f of ficherosBajo('games')) {
    const base = f.split('/').pop();
    if (f.includes('/src/') && MODULOS_PROHIBIDOS.includes(base)) {
      fallos.push(`${f}: módulo del laberinto en el clon plataformer (§14.11c)`);
    }
  }

  // §14.11: MrHector es solo lectura. Ninguna ruta trackeada puede apuntar ahí.
  for (const f of git('ls-files').split('\n')) {
    if (/MrHector/i.test(f)) fallos.push(`${f}: ruta a MrHector trackeada (§14.11: es solo lectura)`);
  }

  return fallos.length
    ? { id: 'game_contract', ok: false, detail: fallos.join('\n      ') }
    : { id: 'game_contract', ok: true, detail: `${goals.length} proyecto(s) de juego conformes` };
}

const CHECKS = {
  lock_integrity: checkLockIntegrity,
  no_frozen_writes: checkNoFrozenWrites,
  ledger_private: checkLedgerPrivate,
  secrets_clean: checkSecrets,
  tests_green: checkTestsGreen,
  pass_to_pass: checkPassToPass,
  fail_to_pass: checkFailToPass,
  policy_schemas: checkPolicySchemas,
  research_contract: checkResearchContract,
  game_contract: checkGameContract,
};

// --- modo baseline ----------------------------------------------------------
if (args.includes('--baseline')) {
  const c = contar(suite().salida);
  const contenido = JSON.stringify({
    registrado: new Date().toISOString().slice(0, 10),
    git_head: git('rev-parse', 'HEAD'),
    pass: c.pass, total: c.total,
    nota: 'Línea base de PASS_TO_PASS (§8.3.1). Solo se actualiza tras una consolidación aprobada.',
  }, null, 2);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(BASELINE, `${contenido}\n`);
  console.log(`${C.v}✓${C.r} baseline registrada: ${c.pass}/${c.total} en verde`);
  process.exit(0);
}

// --- ejecución --------------------------------------------------------------
// Qué se exige viene de quality-gates.yml. Si el fichero no está, fallo cerrado.
let requeridos = ['lock_integrity', 'no_frozen_writes', 'ledger_private', 'secrets_clean', 'tests_green'];
if (existsSync(GATES)) {
  const bloque = readFileSync(GATES, 'utf8').match(/^\s*required:\n((?:\s+-\s+\w+.*\n)+)/m);
  if (bloque) requeridos = [...bloque[1].matchAll(/-\s+(\w+)/g)].map((m) => m[1]);
} else {
  console.error(`${C.x}✗${C.r} falta quality-gates.yml — sin política no hay gate.`);
  process.exit(1);
}

// FAIL_TO_PASS pregunta "¿arreglaste algo de verdad?". Esa pregunta pertenece al
// gate de CONSOLIDACIÓN de una iteración del bucle (§8.3.1 habla de registrar
// ambos conjuntos "por iteración"), no a cada commit: un commit de andamiaje o
// de gobernanza no añade tests y no por eso es sospechoso.
//
// quality-gates.yml ya lo declara como `applies_to: [fix, feat]`. Aquí se
// traduce a: obligatorio con --consolidation, informativo en el resto.
const CONSOLIDACION = args.includes('--consolidation');
if (!CONSOLIDACION) requeridos = requeridos.filter((id) => id !== 'fail_to_pass');

// --only es un filtro de DEPURACION: selecciona sobre los checks implementados,
// no sobre `required`. Intersecarlo con `required` impedia probar un check nuevo
// antes de declararlo obligatorio, que es justo cuando hace falta probarlo.
// El gate real (sin --only) sigue usando `required`, que es la autoridad.
const aEjecutar = ONLY
  ? ONLY.filter((id) => CHECKS[id])
  : requeridos.filter((id) => CHECKS[id]);

if (ONLY) {
  const desconocidos = ONLY.filter((id) => !CHECKS[id]);
  if (desconocidos.length) {
    console.error(`--only nombra checks que no existen: ${desconocidos.join(', ')}`);
    process.exit(2);
  }
}
const resultados = aEjecutar.map((id) => {
  try { return CHECKS[id](); } catch (e) { return { id, ok: false, detail: `el check reventó: ${e.message}` }; }
});

// `[].every()` devuelve true: un AND sobre el conjunto vacío aprueba todo. Es
// exactamente el fallo contra el que avisa validarQualityGates, y lo tenía el
// propio gate. Un --only con un id inexistente, o un `required` vacío, daba
// VERDE sin haber comprobado nada.
const todoOk = resultados.length > 0 && resultados.every((r) => r.ok);
if (resultados.length === 0) {
  console.error(`${C.x}✗ el gate no ejecutó NINGUNA comprobación${C.r} — `
    + 'un AND vacío no es una aprobación. Revisa gate.required o el filtro --only.');
}

if (JSON_OUT) {
  console.log(JSON.stringify({ ok: todoOk, modo: SOLO_STAGED ? 'staged' : 'full', checks: resultados }, null, 2));
} else {
  console.log(`${C.b}verify${C.r} ${C.d}${SOLO_STAGED ? 'staged (pre-commit)' : 'árbol completo'}${C.r}\n`);
  for (const r of resultados) {
    console.log(`  ${r.ok ? `${C.v}✓` : `${C.x}✗`}${C.r} ${r.id.padEnd(18)} ${C.d}${r.detail}${C.r}`);
  }
  console.log();
  console.log(todoOk
    ? `${C.v}✓ gate en verde${C.r} ${C.d}(AND de ${resultados.length} condiciones)${C.r}`
    : `${C.x}✗ gate DENEGADO${C.r} — ${resultados.filter((r) => !r.ok).length} de ${resultados.length} condiciones fallan`);
}

process.exit(todoOk ? 0 : 1);
