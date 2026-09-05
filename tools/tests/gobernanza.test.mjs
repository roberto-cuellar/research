// Fase 2c — la gobernanza, probada.
//
// Hasta esta suite, verify.mjs y los .yml eran código y datos que decidían si
// todo lo demás pasaba, sin un solo test propio. Un gate que solo se ha visto
// pasar no está probado: hay que verlo DENEGAR.
//
// Cubre los DOS tracks: los ficheros de política, los GOALS de juegos y los de
// investigación, el parser del lock y el hook de pre-escritura.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { YamlError, parseYaml, leerYaml } from '../lib/yaml.mjs';
import {
  CHECKS_IMPLEMENTADOS, validarClaims, validarGoals, validarLock,
  validarQualityGates, validarRequirements, validarResearchContract,
} from '../lib/esquemas.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const P = (...s) => join(RAIZ, ...s);

// ===========================================================================
describe('parser YAML — falla cerrado', () => {
  test('parsea mapas, listas, anidamiento y tipos', () => {
    const d = parseYaml(`
version: 1
lease:
  maximumActiveIssues: 1
  activo: true
lista:
  - uno
  - dos
objetos:
  - id: a
    valor: 3.5
  - id: b
    valor: 7
`);
    assert.equal(d.version, 1);
    assert.equal(d.lease.maximumActiveIssues, 1);
    assert.equal(d.lease.activo, true);
    assert.deepEqual(d.lista, ['uno', 'dos']);
    assert.equal(d.objetos[1].valor, 7);
    assert.equal(typeof d.objetos[0].valor, 'number');
  });

  test('une escalares planos multilínea con un espacio', () => {
    const d = parseYaml(`nota: primera parte
  segunda parte
otra: x`);
    assert.equal(d.nota, 'primera parte segunda parte');
    assert.equal(d.otra, 'x');
  });

  test('respeta los # dentro de comillas y quita los comentarios reales', () => {
    const d = parseYaml(`a: "vale # esto no es comentario"   # esto sí\nb: 2`);
    assert.equal(d.a, 'vale # esto no es comentario');
    assert.equal(d.b, 2);
  });

  // Lo que hace aceptable un parser propio: rechaza lo que no entiende.
  for (const [nombre, texto] of [
    ['anclas', 'a: &ancla\n  b: 1'],
    ['alias', 'a: 1\nb: *ancla'],
    ['bloques literales', 'a: |\n  texto'],
    ['multi-documento', '---\na: 1'],
    ['tabuladores', 'a:\n\tb: 1'],
  ]) {
    test(`rechaza ${nombre} en vez de parsear a medias`, () => {
      assert.throws(() => parseYaml(texto), YamlError,
        'un fichero de política parseado a medias autoriza sin que nadie lo sepa');
    });
  }
});

// ===========================================================================
describe('esquemas — cada validador debe DENEGAR', () => {
  test('lock: rechaza sha256 que no es 64 hex', () => {
    const e = validarLock({ frozen: [{ path: 'a.md', sha256: 'abc', reason: 'x', unlock_requires: 'human_approval' }] });
    assert.ok(e.some((m) => m.includes('64 hex')));
  });

  test('lock: rechaza congelar sin motivo', () => {
    const e = validarLock({ frozen: [{ path: 'a.md', sha256: 'f'.repeat(64), unlock_requires: 'human_approval' }] });
    assert.ok(e.some((m) => m.includes('reason')), 'congelar sin motivo no es auditable');
  });

  test('lock: rechaza auto-desbloqueo', () => {
    const e = validarLock({ frozen: [{ path: 'a.md', sha256: 'f'.repeat(64), reason: 'x', unlock_requires: 'auto' }] });
    assert.ok(e.some((m) => m.includes('human_approval')), '§14.5: el agente nunca se auto-aprueba');
  });

  test('quality-gates: un gate sin condiciones aprueba todo, y eso es un fallo', () => {
    assert.ok(validarQualityGates({ gate: { required: [] } }).some((m) => m.includes('aprueba todo')));
  });

  test('quality-gates: caza un typo en un id de check', () => {
    const e = validarQualityGates({ gate: { required: ['lock_integrity', 'tests_verdes'] } });
    assert.ok(e.some((m) => m.includes('tests_verdes') && m.includes('typo')));
  });

  test('task-policy: rechaza más de un trabajo activo', () => {
    assert.ok(validarTaskPolicyErr({ lease: { maximumActiveIssues: 2 } }).some((m) => m.includes('debe ser 1')));
  });

  test('task-policy: rechaza contar un fallo de red como fallo de código', () => {
    const e = validarTaskPolicyErr({ circuitBreaker: { notCountedAsCodeFailure: { state: 'failed' } } });
    assert.ok(e.some((m) => m.includes('waiting')));
  });

  test('research-contract: exige las 7 condiciones de §10.1', () => {
    const e = validarResearchContract({ contrato: [{ id: 'determinista' }] });
    assert.equal(e.filter((m) => m.includes('§10.1')).length, 6, 'faltan 6 de las 7');
  });

  test('research-contract: rechaza relajar la regla anti-autoengaño', () => {
    const e = validarResearchContract({ superacion: { exige_misma_metrica: false } });
    assert.ok(e.some((m) => m.includes('mismo protocolo')));
  });

  test('GOALS: rechaza una métrica sin verificador', () => {
    const e = validarGoals(
      { project: 'p', objective: 'o', metrics: [{ name: 'm', target: 1 }], stopping: st() },
      'games/x/GOALS.yml',
    );
    assert.ok(e.some((m) => m.includes('verifier')), '§2 principio 2: sin verificador no hay tarea');
  });

  test('GOALS: rechaza un proyecto sin métricas', () => {
    const e = validarGoals({ project: 'p', objective: 'o', stopping: st() }, 'games/x/GOALS.yml');
    assert.ok(e.some((m) => m.includes('no arranca')));
  });

  test('GOALS: exige los CUATRO criterios de parada, no solo max_iterations', () => {
    const e = validarGoals(
      { project: 'p', objective: 'o', metrics: [{ name: 'm', verifier: 'v', target: 1 }], stopping: { max_iterations: 10 } },
      'games/x/GOALS.yml',
    );
    assert.equal(e.filter((m) => m.includes('stopping.')).length, 3);
  });

  test('GOALS de investigación: exige paper y claims', () => {
    const e = validarGoals(
      { project: 'p', objective: 'o', metrics: [{ name: 'm', verifier: 'v', target: 1 }], stopping: st() },
      'research/tema/paper/GOALS.yml',
    );
    assert.ok(e.some((m) => m.includes('paper.titulo')));
    assert.ok(e.some((m) => m.includes('paper.claims')));
  });

  test('CLAIMS: rechaza una afirmación sin página ni estado', () => {
    const e = validarClaims('### C1 — algo\n\nTexto suelto sin nada.\n');
    assert.ok(e.some((m) => m.includes('página')));
    assert.ok(e.some((m) => m.includes('estado')));
  });

  test('requirements: rechaza >= porque convierte la réplica en una lotería', () => {
    assert.ok(validarRequirements('numpy>=2.0\n').some((m) => m.includes('==')));
    assert.equal(validarRequirements('# comentario\nnumpy==2.5.2\n').length, 0);
  });
});

function st() {
  return { max_iterations: 25, patience: 5, epsilon: 0.005, divergence_k: 3 };
}
function validarTaskPolicyErr(parcial) {
  // Se completa con lo mínimo válido para que el test aísle UNA violación.
  const base = {
    lease: { maximumActiveIssues: 1 },
    productDecisionBlockReleasesLease: true,
    circuitBreaker: {
      fingerprint: ['operation', 'exitCode', 'normalizedError'],
      attemptsBeforeQuarantine: 3,
      notCountedAsCodeFailure: { state: 'waiting' },
    },
    stopping: { defaults: st(), keepBestCheckpoint: true },
    routing: { maxResidentLargeModels: 1 },
  };
  const mezcla = {
    ...base, ...parcial,
    circuitBreaker: { ...base.circuitBreaker, ...(parcial.circuitBreaker ?? {}) },
  };
  return validarTaskPolicy(mezcla);
}
import { validarTaskPolicy } from '../lib/esquemas.mjs';

// ===========================================================================
describe('los .yml REALES del repo validan — los dos tracks', () => {
  test('GOVERNANCE.lock.yml', async () => {
    assert.deepEqual(validarLock(await leerYaml(P('governance/policy/GOVERNANCE.lock.yml')), RAIZ), []);
  });

  test('quality-gates.yml', async () => {
    assert.deepEqual(validarQualityGates(await leerYaml(P('governance/policy/quality-gates.yml'))), []);
  });

  test('task-policy.yml', async () => {
    assert.deepEqual(validarTaskPolicy(await leerYaml(P('governance/policy/task-policy.yml'))), []);
  });

  test('research-contract.yml', async () => {
    assert.deepEqual(validarResearchContract(await leerYaml(P('governance/policy/research-contract.yml'))), []);
  });

  test('TODOS los GOALS.yml del repo, de ambos tracks', async () => {
    const encontrados = await buscarGoals(RAIZ);
    assert.ok(encontrados.length >= 2, `esperaba al menos un GOALS por track, hallados ${encontrados.length}`);

    const fallos = [];
    for (const ruta of encontrados) {
      const rel = ruta.slice(RAIZ.length + 1).replace(/\\/g, '/');
      const errores = validarGoals(await leerYaml(ruta), rel, RAIZ);
      if (errores.length) fallos.push(`${rel}:\n    ${errores.join('\n    ')}`);
    }
    assert.deepEqual(fallos, [], `GOALS.yml inválidos:\n  ${fallos.join('\n  ')}`);
  });

  test('todo CLAIMS.md del repo declara página y estado por afirmación', async () => {
    const fallos = [];
    for (const ruta of await buscarPorNombre(RAIZ, 'CLAIMS.md')) {
      const errores = validarClaims(await readFile(ruta, 'utf8'));
      if (errores.length) fallos.push(`${ruta.slice(RAIZ.length + 1)}: ${errores.join('; ')}`);
    }
    assert.deepEqual(fallos, []);
  });

  test('todo requirements.txt está anclado con ==', async () => {
    const fallos = [];
    for (const ruta of await buscarPorNombre(RAIZ, 'requirements.txt')) {
      const errores = validarRequirements(await readFile(ruta, 'utf8'));
      if (errores.length) fallos.push(`${ruta.slice(RAIZ.length + 1)}: ${errores.join('; ')}`);
    }
    assert.deepEqual(fallos, []);
  });

  test('los ids de gate.required existen todos en verify.mjs', async () => {
    const gates = await leerYaml(P('governance/policy/quality-gates.yml'));
    for (const id of gates.gate.required) {
      assert.ok(CHECKS_IMPLEMENTADOS.has(id), `"${id}" declarado pero no implementado`);
    }
  });
});

// ===========================================================================
describe('hook de pre-escritura — debe denegar y debe permitir', () => {
  const HOOK = P('governance/enforce/pre-write-hook.mjs');

  function ejecutar(payload) {
    try {
      execFileSync('node', [HOOK], { input: JSON.stringify(payload), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      return { code: 0, stderr: '' };
    } catch (e) {
      return { code: e.status, stderr: e.stderr?.toString() ?? '' };
    }
  }

  const congelado = 'governance/AUTONOMY.md';

  test('DENIEGA la escritura a un fichero congelado, con exit 2', () => {
    const r = ejecutar({ tool_name: 'Edit', tool_input: { file_path: congelado } });
    assert.equal(r.code, 2, 'exit 2 = denegar; exit 1 sería "el hook falló", que no es lo mismo');
    assert.match(r.stderr, /DENEGADO/);
    assert.match(r.stderr, /approvals/, 'debe decir cómo desbloquear');
  });

  test('deniega también con la ruta ABSOLUTA equivalente', () => {
    const r = ejecutar({ tool_name: 'Write', tool_input: { file_path: P(congelado) } });
    assert.equal(r.code, 2, 'el lock no se esquiva escribiendo la ruta de otra forma');
  });

  test('deniega con separadores de Windows', () => {
    const r = ejecutar({ tool_name: 'Edit', tool_input: { file_path: congelado.replace(/\//g, '\\') } });
    assert.equal(r.code, 2);
  });

  test('PERMITE escribir en un fichero no congelado', () => {
    assert.equal(ejecutar({ tool_name: 'Edit', tool_input: { file_path: 'tools/lib/memory.mjs' } }).code, 0);
  });

  test('ignora herramientas que no escriben', () => {
    assert.equal(ejecutar({ tool_name: 'Read', tool_input: { file_path: congelado } }).code, 0);
  });

  test('ignora rutas fuera del repo', () => {
    assert.equal(ejecutar({ tool_name: 'Write', tool_input: { file_path: 'C:/otra/cosa.md' } }).code, 0);
  });

  test('un payload ilegible no bloquea el trabajo legítimo: delega en el pre-commit', () => {
    try {
      execFileSync('node', [HOOK], { input: 'esto no es json', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      assert.fail(`debería salir 0, salió ${e.status}`);
    }
  });
});

// ===========================================================================
describe('verify.mjs — el gate sobre el árbol real', () => {
  const VERIFY = P('governance/enforce/verify.mjs');

  function correr(args) {
    try {
      return { code: 0, out: execFileSync('node', [VERIFY, ...args], { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
    } catch (e) {
      return { code: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
  }

  test('lock_integrity pasa con el árbol intacto', () => {
    const r = correr(['--only', 'lock_integrity', '--json']);
    assert.equal(r.code, 0);
    assert.equal(JSON.parse(r.out).checks[0].ok, true);
  });

  test('el gate es un AND: una condición imposible tumba el conjunto', () => {
    // pass_to_pass sin baseline es la forma limpia de forzar un rojo sin tocar
    // ningún fichero del repo.
    const r = correr(['--only', 'lock_integrity,fail_to_pass', '--consolidation', '--json']);
    const d = JSON.parse(r.out);
    assert.equal(d.ok, false, 'con una condición roja, el conjunto es rojo');
    assert.ok(d.checks.some((c) => c.ok === true), 'y aun así las verdes se reportan como verdes');
  });

  test('la salida JSON declara el modo, para que el log sea auditable', () => {
    assert.equal(JSON.parse(correr(['--only', 'lock_integrity', '--json']).out).modo, 'full');
    assert.equal(JSON.parse(correr(['--staged', '--only', 'lock_integrity', '--json']).out).modo, 'staged');
  });

  test('el ledger no está trackeado', () => {
    assert.equal(JSON.parse(correr(['--only', 'ledger_private', '--json']).out).checks[0].ok, true);
  });
});

// ===========================================================================
async function buscarGoals(dir, prof = 0) {
  return buscarPorNombre(dir, 'GOALS.yml', prof);
}

async function buscarPorNombre(dir, nombre, prof = 0) {
  if (prof > 4) return [];
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = join(dir, e.name);
    if (e.isFile() && e.name === nombre) out.push(p);
    else if (e.isDirectory()) out.push(...(await buscarPorNombre(p, nombre, prof + 1)));
  }
  return out;
}
