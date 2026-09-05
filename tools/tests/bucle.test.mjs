// El bucle de evolución: los CUATRO criterios de parada, el circuit breaker y
// el registro visual.
//
// Un criterio de parada que solo se ha visto "no parar" no está probado: hay que
// verlo PARAR, y por la razón correcta.

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CircuitBreaker, ESTADO_TAREA, RAZON, evaluarParada } from '../lib/parada.mjs';
import { RegistroVisual } from '../lib/capturas.mjs';
import { Bucle } from '../lib/bucle.mjs';

const T0 = Date.parse('2026-09-05T10:00:00Z');
const pto = (i, v, min = 0, tokens = 0) => ({
  iteracion: i, valor: v, tokens,
  ts: new Date(T0 + min * 60_000).toISOString(),
});

const OBJ = {
  target: 0.95, direction: 'maximize',
  max_iterations: 25, patience: 5, epsilon: 0.005, divergence_k: 3,
};

// ===========================================================================
describe('§6.2 — los CUATRO criterios de parada', () => {
  test('1. objetivo alcanzado: exige DOS iteraciones seguidas, no una', () => {
    const unaSola = evaluarParada([pto(1, 0.80), pto(2, 0.96)], OBJ);
    assert.equal(unaSola.parar, false, 'una sola podría ser ruido');

    const dos = evaluarParada([pto(1, 0.80), pto(2, 0.96), pto(3, 0.97)], OBJ);
    assert.equal(dos.parar, true);
    assert.equal(dos.razon, RAZON.OBJETIVO);
  });

  test('1b. con direction minimize, alcanzar es estar POR DEBAJO', () => {
    const obj = { ...OBJ, target: 0.05, direction: 'minimize' };
    const r = evaluarParada([pto(1, 0.5), pto(2, 0.04), pto(3, 0.03)], obj);
    assert.equal(r.parar, true);
    assert.equal(r.razon, RAZON.OBJETIVO);
    assert.equal(r.mejor.valor, 0.03, 'el mejor es el MENOR');
  });

  test('2. meseta: mejora < epsilon durante `patience` iteraciones', () => {
    const h = [pto(1, 0.700), pto(2, 0.701), pto(3, 0.7015), pto(4, 0.702),
               pto(5, 0.7021), pto(6, 0.7022)];
    const r = evaluarParada(h, OBJ);
    assert.equal(r.parar, true);
    assert.equal(r.razon, RAZON.MESETA);
    assert.match(r.detalle, /modelo superior o pedir input humano/);
  });

  test('2b. una mejora real por encima de epsilon NO es meseta', () => {
    const h = [pto(1, 0.70), pto(2, 0.71), pto(3, 0.72), pto(4, 0.73),
               pto(5, 0.74), pto(6, 0.76)];
    assert.equal(evaluarParada(h, OBJ).parar, false);
  });

  test('3. divergencia: k empeoramientos seguidos y ROLLBACK al mejor', () => {
    const h = [pto(1, 0.60), pto(2, 0.90), pto(3, 0.80), pto(4, 0.70), pto(5, 0.60)];
    const r = evaluarParada(h, OBJ);
    assert.equal(r.parar, true);
    assert.equal(r.razon, RAZON.DIVERGENCIA);
    assert.equal(r.rollback.iteracion, 2, 'vuelve al campeón, no a la iteración previa');
    assert.equal(r.rollback.valor, 0.90);
  });

  test('3b. un bajón aislado no es divergencia', () => {
    const h = [pto(1, 0.60), pto(2, 0.90), pto(3, 0.80), pto(4, 0.92), pto(5, 0.93)];
    assert.notEqual(evaluarParada(h, OBJ).razon, RAZON.DIVERGENCIA);
  });

  test('4. presupuesto por iteraciones: para y entrega el MEJOR con su número', () => {
    const h = Array.from({ length: 25 }, (_, i) => pto(i + 1, 0.5 + i * 0.001));
    const r = evaluarParada(h, OBJ);
    assert.equal(r.parar, true);
    assert.equal(r.razon, RAZON.PRESUPUESTO);
    assert.match(r.detalle, /Mejor: 0\.524/);
  });

  test('4b. presupuesto por tokens', () => {
    const h = [pto(1, 0.5, 0, 300_000), pto(2, 0.6, 1, 300_000)];
    const r = evaluarParada(h, { ...OBJ, max_tokens: 500_000 });
    assert.equal(r.razon, RAZON.PRESUPUESTO);
    assert.match(r.detalle, /tokens/);
  });

  test('4c. presupuesto por tiempo de reloj', () => {
    const h = [pto(1, 0.5, 0), pto(2, 0.6, 150)];
    const r = evaluarParada(h, { ...OBJ, max_wallclock_min: 120 });
    assert.equal(r.razon, RAZON.PRESUPUESTO);
    assert.match(r.detalle, /min/);
  });

  test('INVARIANTE: el campeón nunca lo pisa una iteración que empeora', () => {
    const h = [pto(1, 0.60), pto(2, 0.94), pto(3, 0.20), pto(4, 0.30)];
    assert.equal(evaluarParada(h, OBJ).mejor.valor, 0.94);
  });

  test('el presupuesto se comprueba ANTES que la meseta', () => {
    // Con el tope alcanzado Y meseta a la vez, manda el presupuesto: es el que
    // obliga a entregar el mejor resultado en vez de seguir en silencio.
    const h = Array.from({ length: 25 }, (_, i) => pto(i + 1, 0.70));
    assert.equal(evaluarParada(h, OBJ).razon, RAZON.PRESUPUESTO);
  });
});

// ===========================================================================
describe('§6.2.1 — circuit breaker', () => {
  let cb;
  beforeEach(() => { cb = new CircuitBreaker(); });

  const fallo = (evidencia = null) => cb.registrar({
    operation: 'build', exitCode: 1, error: 'TypeError: x is not a function', evidencia,
  });

  test('el primer fallo es reintentable', () => {
    const r = fallo();
    assert.equal(r.estado, ESTADO_TAREA.ACTIVA);
    assert.equal(r.reintentable, true);
  });

  test('el SEGUNDO sin evidencia nueva NO es reintentable', () => {
    fallo();
    const r = fallo();
    assert.equal(r.reintentable, false);
    assert.match(r.motivo, /sin evidencia diagnóstica nueva/);
  });

  test('con evidencia nueva, el segundo intento sí se permite', () => {
    fallo('logs/traza-1.txt');
    const r = fallo('logs/traza-2.txt');
    assert.equal(r.reintentable, true, 'aportar evidencia es lo que distingue aprender de repetir');
  });

  test('al TERCER fallo idéntico: cuarentena', () => {
    fallo('e1'); fallo('e2');
    const r = fallo('e3');
    assert.equal(r.estado, ESTADO_TAREA.CUARENTENA);
    assert.equal(r.reintentable, false);
    assert.match(r.motivo, /evidencia preservada/);
    assert.match(r.motivo, /humano alertado/);
  });

  test('huellas distintas no se contaminan entre sí', () => {
    cb.registrar({ operation: 'build', exitCode: 1, error: 'error A' });
    cb.registrar({ operation: 'build', exitCode: 1, error: 'error A' });
    const otra = cb.registrar({ operation: 'build', exitCode: 1, error: 'error B totalmente distinto' });
    assert.equal(otra.reintentable, true);
  });

  test('la misma causa en operaciones distintas son fallos distintos', () => {
    cb.registrar({ operation: 'build', exitCode: 1, error: 'boom' });
    cb.registrar({ operation: 'build', exitCode: 1, error: 'boom' });
    const otra = cb.registrar({ operation: 'test', exitCode: 1, error: 'boom' });
    assert.equal(otra.reintentable, true);
  });

  for (const [nombre, err] of [
    ['red', 'connect ECONNREFUSED 127.0.0.1:11434'],
    ['límite de tasa', 'HTTP 429 Too Many Requests'],
    ['cola de CI', 'runner unavailable, job queued'],
    ['modelo no cargado', 'model not found: ollama is not running'],
  ]) {
    test(`${nombre} es 'waiting', NO cuenta como fallo de código`, () => {
      const r = cb.registrar({ operation: 'llamada', exitCode: 1, error: err });
      assert.equal(r.estado, ESTADO_TAREA.ESPERANDO);
      assert.equal(r.reintentable, true);
      assert.ok(r.backoff_ms > 0, 'con backoff');
      assert.match(r.motivo, /NO cuenta como fallo de código/);
    });
  }

  test('diez fallos de red seguidos NO abren el circuito', () => {
    for (let i = 0; i < 10; i++) {
      const r = cb.registrar({ operation: 'x', exitCode: 1, error: 'ETIMEDOUT' });
      assert.notEqual(r.estado, ESTADO_TAREA.CUARENTENA,
        'confundir red con código hace saltar el breaker por causas ajenas al trabajo');
    }
  });

  test('el backoff crece pero está acotado', () => {
    assert.ok(CircuitBreaker.backoffMs(1) < CircuitBreaker.backoffMs(5));
    assert.equal(CircuitBreaker.backoffMs(99, 30), 30 * 60_000);
  });
});

// ===========================================================================
describe('registro visual — toda captura queda con su historial', () => {
  let raiz, reg;

  async function png(ruta, color = [255, 0, 0]) {
    // PNG 1x1 mínimo válido, construido a mano para no depender de nada.
    const { deflateSync } = await import('node:zlib');
    const { createHash } = await import('node:crypto');
    const crc = (b) => {
      let c = ~0;
      for (const byte of b) {
        c ^= byte;
        for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
      }
      return ~c >>> 0;
    };
    const chunk = (tipo, datos) => {
      const len = Buffer.alloc(4); len.writeUInt32BE(datos.length);
      const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
      const c = Buffer.alloc(4); c.writeUInt32BE(crc(cuerpo));
      return Buffer.concat([len, cuerpo, c]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4);
    ihdr[8] = 8; ihdr[9] = 2;
    const idat = deflateSync(Buffer.from([0, ...color]));
    const buf = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
      chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
    ]);
    await mkdir(join(ruta, '..'), { recursive: true });
    await writeFile(ruta, buf);
    void createHash;
    return ruta;
  }

  beforeEach(async () => {
    raiz = await mkdtemp(join(tmpdir(), 'sem-vis-'));
    reg = new RegistroVisual(raiz);
  });

  test('registra con sha, dimensiones y métricas', async () => {
    const p = await png(join(raiz, 'cap.png'));
    const e = await reg.registrar({
      ruta: p, proyecto: 'games/x', iteracion: 1, tipo: 'render',
      metricas: { mse: 0, ssim: 1.0 },
    });
    assert.match(e.sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(e.dimensiones, { ancho: 1, alto: 1 });
    assert.equal(e.metricas.ssim, 1.0);
    assert.ok(e.git_head, 'procedencia obligatoria');
  });

  test('la descripción del VLM se guarda APARTE de las métricas', async () => {
    const p = await png(join(raiz, 'c.png'));
    const e = await reg.registrar({
      ruta: p, proyecto: 'games/x', iteracion: 1,
      metricas: { ssim: 0.97 },
      descripcion: 'la caja se movió a la derecha',
      modelo_descriptor: 'qwen3-vl:4b-instruct',
    });
    // Separados a propósito: nadie debe poder confundir descripción con veredicto.
    assert.equal(e.descripcion_vlm, 'la caja se movió a la derecha');
    assert.equal(e.modelo_descriptor, 'qwen3-vl:4b-instruct');
    assert.equal(e.metricas.ssim, 0.97);
    assert.ok(!('pasa' in e) && !('veredicto' in e), 'el registro no emite veredictos');
  });

  test('deduplica por contenido: dos capturas idénticas, una sola imagen', async () => {
    const a = await png(join(raiz, 'a.png'));
    const b = await png(join(raiz, 'b.png'));   // mismo contenido
    const e1 = await reg.registrar({ ruta: a, proyecto: 'p', iteracion: 1 });
    const e2 = await reg.registrar({ ruta: b, proyecto: 'p', iteracion: 2 });

    assert.equal(e1.sha256, e2.sha256);
    assert.equal(e1.deduplicada, false);
    assert.equal(e2.deduplicada, true, 'la segunda no se vuelve a copiar');

    const s = await reg.stats();
    assert.equal(s.registradas, 2);
    assert.equal(s.imagenes_unicas, 1);
    assert.equal(s.ahorro_por_dedup, 1);
  });

  test('detecta si cambió entre iteraciones SIN abrir ficheros', async () => {
    await reg.registrar({ ruta: await png(join(raiz, '1.png'), [255, 0, 0]), proyecto: 'p', iteracion: 1 });
    await reg.registrar({ ruta: await png(join(raiz, '2.png'), [255, 0, 0]), proyecto: 'p', iteracion: 2 });
    await reg.registrar({ ruta: await png(join(raiz, '3.png'), [0, 255, 0]), proyecto: 'p', iteracion: 3 });

    const c = await reg.cambios({ proyecto: 'p' });
    assert.deepEqual(c.map((x) => x.cambio), [false, true]);
  });

  test('el historial se filtra por proyecto y por tipo', async () => {
    await reg.registrar({ ruta: await png(join(raiz, 'x.png'), [1, 2, 3]), proyecto: 'a', iteracion: 1, tipo: 'render' });
    await reg.registrar({ ruta: await png(join(raiz, 'y.png'), [4, 5, 6]), proyecto: 'b', iteracion: 1, tipo: 'screenshot' });
    assert.equal((await reg.historial({ proyecto: 'a' })).length, 1);
    assert.equal((await reg.historial({ tipo: 'screenshot' })).length, 1);
  });

  test('una captura que no existe se rechaza en vez de registrarse a medias', async () => {
    await assert.rejects(
      () => reg.registrar({ ruta: join(raiz, 'no-existe.png'), proyecto: 'p', iteracion: 1 }),
      /no existe la captura/,
    );
  });
});

// ===========================================================================
describe('Bucle — verificador primero, memoria antes de actuar', () => {
  let raiz;

  async function proyecto(goalsYml, { conVerificador = true } = {}) {
    raiz = await mkdtemp(join(tmpdir(), 'sem-bucle-'));
    await mkdir(join(raiz, 'games', 'demo'), { recursive: true });
    await writeFile(join(raiz, 'games', 'demo', 'GOALS.yml'), goalsYml, 'utf8');
    if (conVerificador) {
      await mkdir(join(raiz, 'games', 'demo', 'tests'), { recursive: true });
      await writeFile(join(raiz, 'games', 'demo', 'tests', 'v.mjs'), '// verificador\n', 'utf8');
    }
    return new Bucle({ raiz, proyecto: 'games/demo' });
  }

  const GOALS = `project: games/demo
objective: "algo medible"
metrics:
  - name: similitud
    verifier: games/demo/tests/v.mjs
    target: 0.95
    direction: maximize
stopping:
  max_iterations: 25
  patience: 5
  epsilon: 0.005
  divergence_k: 3
`;

  test('sin GOALS.yml no arranca', async () => {
    const r = await mkdtemp(join(tmpdir(), 'sem-vacio-'));
    const b = new Bucle({ raiz: r, proyecto: 'games/demo' });
    await assert.rejects(() => b.cargarObjetivo(), /no tiene GOALS\.yml/);
  });

  test('§2 principio 2: si el VERIFICADOR no existe, no hay tarea', async () => {
    const b = await proyecto(GOALS, { conVerificador: false });
    await assert.rejects(() => b.cargarObjetivo(),
      /verificador que NO EXISTE[\s\S]*Escríbelo antes de iterar/);
  });

  test('con verificador presente, carga el objetivo y sus criterios', async () => {
    const b = await proyecto(GOALS);
    const o = await b.cargarObjetivo();
    assert.equal(o.name, 'similitud');
    assert.equal(o.target, 0.95);
    assert.equal(o.divergence_k, 3, 'los criterios de parada vienen del GOALS');
  });

  test('itera, registra el intento y mueve el campeón solo si mejora', async () => {
    const b = await proyecto(GOALS);
    await b.cargarObjetivo();
    const valores = [0.70, 0.88, 0.60];
    for (const v of valores) {
      await b.iterar(async () => ({ valor: v }), { dominio: 'visual', sujeto: 'demo' });
    }
    assert.equal(b.iteracion, 3);
    assert.equal(b.campeon.valor, 0.88, 'una iteración que empeora no pisa al campeón');
  });

  test('para con razón OBJETIVO tras dos iteraciones buenas seguidas', async () => {
    const b = await proyecto(GOALS);
    await b.cargarObjetivo();
    await b.iterar(async () => ({ valor: 0.80 }), { dominio: 'v', sujeto: 'd' });
    await b.iterar(async () => ({ valor: 0.96 }), { dominio: 'v', sujeto: 'd' });
    const r = await b.iterar(async () => ({ valor: 0.97 }), { dominio: 'v', sujeto: 'd' });
    assert.equal(r.parar, true);
    assert.equal(r.razon, RAZON.OBJETIVO);
  });

  test('un bloqueo de producto para SIN adivinar y deja la pregunta', async () => {
    const b = await proyecto(`${GOALS}bloqueo:
  pregunta: "cual es el valor de M?"
  a_quien: usuario
`);
    await b.cargarObjetivo();
    const r = await b.iterar(async () => ({ valor: 1 }), { dominio: 'v', sujeto: 'd' });
    assert.equal(r.parar, true);
    assert.equal(r.razon, RAZON.BLOQUEO);
    assert.match(r.pregunta, /valor de M/);
  });

  test('un fallo repetido abre el circuito y para el bucle', async () => {
    const b = await proyecto(GOALS);
    await b.cargarObjetivo();
    let r;
    for (let i = 0; i < 3; i++) {
      r = await b.iterar(
        async () => { throw new Error('siempre el mismo fallo aqui'); },
        { dominio: 'v', sujeto: 'd' },
      );
    }
    assert.equal(r.parar, true);
    assert.equal(r.razon, RAZON.BREAKER);
  });

  test('un fallo de red NO abre el circuito: queda esperando', async () => {
    const b = await proyecto(GOALS);
    await b.cargarObjetivo();
    let r;
    for (let i = 0; i < 5; i++) {
      r = await b.iterar(
        async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:11434'); },
        { dominio: 'v', sujeto: 'd' },
      );
    }
    assert.equal(r.parar, false, 'cinco fallos de red no paran el bucle');
    assert.equal(r.esperando, true);
    assert.ok(r.breaker.backoff_ms > 0, 'espera con backoff en vez de reintentar en bucle cerrado');
  });

  test('cada iteración escribe SIEMPRE en attempts.jsonl, exito o fallo', async () => {
    const b = await proyecto(GOALS);
    await b.cargarObjetivo();
    const ok = await b.iterar(async () => ({ valor: 0.5 }), { dominio: 'v', sujeto: 'd' });
    const mal = await b.iterar(async () => { throw new Error('vaya'); }, { dominio: 'v', sujeto: 'd' });
    assert.equal(ok.attempt.result, 'pass');
    assert.equal(mal.attempt.result, 'fail');
    assert.ok(mal.attempt.error_signature, 'el fallo lleva su firma para el breaker');
  });
});
