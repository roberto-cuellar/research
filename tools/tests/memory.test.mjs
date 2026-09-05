// Gate de la Fase 1 (§13): se puede escribir y RECUPERAR una lección por
// error_signature sin cargar el JSONL entero, con las 6 reglas de §7.5.
//
// Mismo estilo que MrHector\game\tests\: node:test + node:assert/strict.

import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { errorSignature, failureFingerprint, normalizeError, taskSignature } from '../lib/signature.mjs';
import { ESTADO, LIMITES, redact, truncar } from '../lib/store.mjs';
import { Memoria } from '../lib/memory.mjs';

let raiz;

/** Etiqueta alfabética única: los números no sirven para generar firmas distintas. */
function etiqueta(n) {
  const abc = 'abcdefghijklmnopqrstuvwxyz';
  let s = '';
  do { s = abc[n % 26] + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}

beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), 'sem-mem-'));
  delete process.env.SEM_MEMORY_DISABLED;
});

function attemptBase(over = {}) {
  return {
    project: 'games/pixel-borislov',
    iteration: 1,
    task_signature: taskSignature('collision', 'player-wall'),
    action: { type: 'edit', target: 'src/p_physics.js', summary: 'raycast previo al move' },
    model: { role: 'coder', name: 'qwen2.5-coder:7b' },
    result: 'fail',
    metrics: { collision_error: 0.42 },
    tokens: { in: 8412, out: 1203, cached: 6100 },
    ...over,
  };
}

// --------------------------------------------------------------------------
describe('signature — normalización y firmas', () => {
  test('dos ejecuciones del mismo fallo dan la misma firma', () => {
    const a = 'Error: ENOENT C:\\Users\\Roberto\\proj\\src\\a.js:42:7 at 2026-09-04T10:22:11Z (pid 8123)';
    const b = 'Error: ENOENT C:\\Users\\Otro\\otro\\src\\b.js:99:1 at 2026-09-05T23:01:44Z (pid 442)';
    assert.equal(errorSignature(a), errorSignature(b));
  });

  test('errores distintos dan firmas distintas', () => {
    assert.notEqual(errorSignature('tunneling at high velocity'), errorSignature('null pointer on spawn'));
  });

  test('la normalización borra rutas, timestamps, hashes y números', () => {
    const n = normalizeError('fail at C:\\Users\\R\\x.js sha 4cf41b3ac9e1 on 2026-09-04T10:22:11Z count 57');
    assert.ok(!n.includes('roberto'), 'no debe quedar el usuario');
    assert.ok(!n.includes('2026'), 'no debe quedar el timestamp');
    assert.ok(!n.includes('57'), 'no deben quedar números');
  });

  test('taskSignature es legible y comparable por prefijo de dominio', () => {
    assert.equal(taskSignature('collision', 'Player Wall'), 'collision:player-wall');
    assert.ok(taskSignature('collision', 'Otra Cosa').startsWith('collision:'));
  });

  test('la huella del breaker distingue la misma causa en operaciones distintas', () => {
    const err = 'ECONNREFUSED';
    assert.notEqual(
      failureFingerprint({ operation: 'build', exitCode: 1, error: err }),
      failureFingerprint({ operation: 'test', exitCode: 1, error: err }),
    );
  });
});

// --------------------------------------------------------------------------
describe('§7.5 — las seis reglas', () => {
  test('regla 1: redacta secretos y el home del usuario ANTES de persistir', async () => {
    const mem = await new Memoria(raiz).abrir();
    await mem.registrarIntento(attemptBase({
      action: {
        type: 'run',
        target: `${process.env.USERPROFILE ?? process.env.HOME}/x.js`,
        summary: 'token ghp_abcdefghijklmnop1234 y password: superclave123',
      },
    }));
    const crudo = await readFile(mem.rutas.attempts, 'utf8');
    assert.ok(!crudo.includes('ghp_abcdefghijklmnop1234'), 'el token no puede llegar a disco');
    assert.ok(crudo.includes('<REDACTED:github-token>'));
    assert.ok(crudo.includes('<REDACTED>'), 'la password debe quedar redactada');
    assert.ok(!crudo.includes('Roberto'), 'el home del usuario debe quedar como ~');
  });

  test('regla 1: redact es idempotente', () => {
    const una = redact('token ghp_abcdefghijklmnop1234');
    assert.equal(redact(una), una);
  });

  test('regla 2: un store corrupto no crashea ni se sobrescribe al leerlo', async () => {
    const mem = await new Memoria(raiz).abrir();
    await mem.registrarIntento(attemptBase());
    await writeFile(mem.rutas.attempts, `${await readFile(mem.rutas.attempts, 'utf8')}{ esto no es json\n`);
    const antes = (await stat(mem.rutas.attempts)).size;
    const s = await mem.stats();
    assert.equal(s.attempts, 1, 'la línea buena sigue leyéndose');
    assert.equal(s.attempts_corruptos, 1, 'la corrupta se cuenta, no se traga');
    assert.equal((await stat(mem.rutas.attempts)).size, antes, 'leer NO debe reescribir el fichero');
  });

  test('regla 3: el desbordamiento falla cerrado y da una indicación', async () => {
    const mem = await new Memoria(raiz).abrir();
    // OJO: los errores deben diferir en LETRAS, no en números. El normalizador
    // sustituye todo dígito por <N>, así que `fallo 1` y `fallo 2` son la MISMA
    // firma — que es justo lo que debe hacer, pero invalida el dato de prueba.
    for (let i = 0; i < LIMITES.MAX_ENTRADAS; i++) {
      await mem.destilar({ taskSignature: 'x:y', error: `fallo de tipo ${etiqueta(i)}`, leccion: `l${i}` });
    }
    await assert.rejects(
      () => mem.destilar({ taskSignature: 'x:y', error: 'uno mas totalmente nuevo aqui', leccion: 'z' }),
      /tope de 200 lecciones activas/,
    );
  });

  test('regla 3: números distintos NO son errores distintos (por diseño)', async () => {
    const mem = await new Memoria(raiz).abrir();
    const a = await mem.destilar({ taskSignature: 'x:y', error: 'timeout tras 30 s', leccion: 'sube el timeout' });
    const b = await mem.destilar({ taskSignature: 'x:y', error: 'timeout tras 90 s', leccion: 'sube el timeout' });
    assert.equal(a.id, b.id, 'el mismo fallo con otro número es el mismo fallo');
  });

  test('regla 3: el texto se trunca con marca visible', () => {
    const t = truncar('a'.repeat(5000));
    assert.ok(t.length <= LIMITES.MAX_CHARS_ENTRADA);
    assert.ok(t.includes('<TRUNCADO:5000>'));
  });

  test('regla 4: toda entrada lleva timestamp ISO y git HEAD', async () => {
    const mem = await new Memoria(raiz).abrir();
    const r = await mem.registrarIntento(attemptBase());
    assert.match(r.ts, /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(r.git_head && r.git_head.length > 0, 'sin git HEAD no se sabe si la lección sigue aplicando');
  });

  test('regla 5: archivar deja tombstone, no borra', async () => {
    const mem = await new Memoria(raiz).abrir();
    const l = await mem.destilar({ taskSignature: 'a:b', error: 'boom concreto', leccion: 'no hagas eso' });
    await mem.archivar(l.id, ESTADO.FORGOTTEN, 'ya no aplica');
    const crudo = await readFile(mem.rutas.lessons, 'utf8');
    assert.ok(crudo.includes(l.id), 'la entrada sigue en el fichero');
    assert.ok(crudo.includes('forgottenAt'), 'con marca de cuándo se olvidó');
    assert.equal(await mem.leccionPara('boom concreto'), null, 'pero ya no se recupera');
  });

  test('regla 6: el kill switch desactiva la memoria sin romper al agente', async () => {
    process.env.SEM_MEMORY_DISABLED = '1';
    const mem = await new Memoria(raiz).abrir();
    assert.equal(mem.desactivada, true);
    assert.deepEqual(await mem.registrarIntento(attemptBase()), { skipped: 'SEM_MEMORY_DISABLED' });
    assert.equal(await mem.leccionPara('lo que sea'), null);
    assert.deepEqual(await mem.recall({ taskSignature: 'a:b' }), []);
  });
});

// --------------------------------------------------------------------------
describe('§7.2 — attempts.jsonl', () => {
  test('rechaza un attempt sin los campos obligatorios', async () => {
    const mem = await new Memoria(raiz).abrir();
    await assert.rejects(
      () => mem.registrarIntento({ project: 'x' }),
      /faltan campos obligatorios/,
    );
  });

  test('registra PASS_TO_PASS y FAIL_TO_PASS por iteración (§8.3.1)', async () => {
    const mem = await new Memoria(raiz).abrir();
    const r = await mem.registrarIntento(attemptBase({
      result: 'pass',
      pass_to_pass: { total: 171, verdes: 171 },
      fail_to_pass: { total: 3, verdes: 3 },
    }));
    assert.equal(r.pass_to_pass.verdes, 171);
    assert.equal(r.fail_to_pass.verdes, 3);
  });
});

// --------------------------------------------------------------------------
describe('§7.6 — recuperación', () => {
  test('GATE: recupera por error_signature SIN cargar el JSONL entero', async () => {
    const mem = await new Memoria(raiz).abrir();

    // 1.000 attempts para que el fichero sea grande de verdad.
    for (let i = 0; i < 1000; i++) {
      await mem.registrarIntento(attemptBase({ iteration: i, error: `ruido irrelevante de clase ${etiqueta(i)}` }));
    }
    const aguja = 'El movimiento por delta atraviesa paredes finas por encima de 12 u/s';
    await mem.destilar({
      taskSignature: taskSignature('collision', 'player-wall'),
      error: aguja,
      leccion: 'Usar raycast continuo (sweep test), no comprobación de posición final.',
      confidence: 'high',
    });

    const tamAttempts = (await stat(mem.rutas.attempts)).size;
    assert.ok(tamAttempts > 100_000, `el JSONL debe ser grande para que la prueba valga (${tamAttempts} B)`);

    // Instrumentamos readFile: si la recuperación lo usa, es que carga ficheros enteros.
    const fsp = await import('node:fs/promises');
    const original = fsp.default.readFile;
    let leidosEnteros = 0;
    fsp.default.readFile = async (...args) => { leidosEnteros++; return original(...args); };
    let recuperada;
    try {
      recuperada = await mem.leccionPara(aguja);
    } finally {
      fsp.default.readFile = original;
    }

    assert.ok(recuperada, 'la lección debe recuperarse');
    assert.match(recuperada.lesson, /sweep test/);
    assert.equal(leidosEnteros, 0, 'la recuperación no puede leer ningún fichero entero');
  });

  test('§7.4 paso 3: una error_signature repetida NO crea lección nueva, incrementa hits', async () => {
    const mem = await new Memoria(raiz).abrir();
    const err = 'tunneling at high velocity en la pared norte';
    const a = await mem.destilar({ taskSignature: 'collision:player-wall', error: err, leccion: 'usar sweep' });
    const b = await mem.destilar({ taskSignature: 'collision:player-wall', error: err, leccion: 'usar sweep continuo' });

    assert.equal(a.id, b.id, 'debe ser la misma lección');
    assert.equal(b.hits, 2, 'y sus hits deben subir');
    assert.match(b.lesson, /continuo/, 'el texto se refina');

    const { entradas } = await import('../lib/store.mjs').then((m) => m.readJsonl(mem.rutas.lessons));
    assert.equal(entradas.filter((l) => l.status === ESTADO.ACTIVE).length, 1, 'y solo debe haber una');
  });

  test('§14.8: detecta la reincidencia como bug del sistema de memoria', async () => {
    const mem = await new Memoria(raiz).abrir();
    const err = 'ya documentado y bien conocido aqui';
    assert.equal((await mem.esReincidencia(err)).reincidencia, false);
    await mem.destilar({ taskSignature: 'a:b', error: err, leccion: 'no repitas esto' });
    const r = await mem.esReincidencia(err);
    assert.equal(r.reincidencia, true);
    assert.match(r.leccion.lesson, /no repitas/);
  });

  test('recall respeta el tope duro K<=5 aunque se pidan más', async () => {
    const mem = await new Memoria(raiz).abrir();
    const tarea = taskSignature('collision', 'player-wall');
    for (let i = 0; i < 9; i++) {
      await mem.destilar({ taskSignature: tarea, error: `fallo unico de clase ${etiqueta(i)}`, leccion: `leccion ${i}` });
    }
    assert.equal((await mem.recall({ taskSignature: tarea, k: 50 })).length, 5);
  });

  test('recall corta por presupuesto de caracteres antes que por K', async () => {
    const mem = await new Memoria(raiz).abrir();
    const tarea = taskSignature('visual', 'render-drift');
    for (let i = 0; i < 5; i++) {
      await mem.destilar({ taskSignature: tarea, error: `distinto de clase ${etiqueta(i)}`, leccion: 'x'.repeat(300) });
    }
    assert.ok((await mem.recall({ taskSignature: tarea, k: 5, maxChars: 700 })).length <= 2);
  });

  test('recall ordena por hits y no devuelve archivadas', async () => {
    const mem = await new Memoria(raiz).abrir();
    const tarea = taskSignature('collision', 'player-wall');
    await mem.destilar({ taskSignature: tarea, error: 'error uno aqui', leccion: 'poco usada' });
    const dos = await mem.destilar({ taskSignature: tarea, error: 'error dos alla', leccion: 'muy usada' });
    await mem.destilar({ taskSignature: tarea, error: 'error dos alla', leccion: 'muy usada' });
    const tres = await mem.destilar({ taskSignature: tarea, error: 'error tres alli', leccion: 'archivada' });
    await mem.archivar(tres.id);

    const top = await mem.recall({ taskSignature: tarea });
    assert.equal(top[0].id, dos.id, 'la de más hits va primero');
    assert.ok(!top.some((l) => l.id === tres.id), 'la archivada no aparece');
  });

  test('archivarSinUso retira las de hits insuficientes', async () => {
    const mem = await new Memoria(raiz).abrir();
    await mem.destilar({ taskSignature: 'a:b', error: 'sola y unica aqui', leccion: 'nunca sirvió' });
    assert.equal((await mem.archivarSinUso({ minHits: 2 })).length, 1);
    assert.equal((await mem.stats()).lecciones_activas, 0);
  });
});
