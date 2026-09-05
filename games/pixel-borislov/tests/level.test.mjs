/**
 * Invariantes de los datos del nivel — `docs/SINCRONIA.md` §7.
 *
 * Es la mitad estatica del validador que pide la spec 034: lo que se puede
 * comprobar sin simular. La otra mitad —recorrer el nivel de verdad— necesita el
 * playsim headless de la 035.
 *
 * **Ya no hay ninguno marcado `todo`.** Hubo cinco —TDB-001, 002, 012, 013 y 014—, y
 * la politica era: un invariante que se relaja para que la suite este verde deja de
 * ser un invariante, asi que se marcan, salen en el informe, no rompen la suite, y el
 * dia que se arregla el nivel se quitan las marcas y pasan a proteger. Ese dia fue el
 * 23 de agosto de 2026 (spec 034).
 *
 * Cinco de estas pruebas encontraron defectos que nadie conocia, ninguno visible
 * jugando: dos chispas inalcanzables, un portal que teletransportaba al vacio, una
 * meta sobre el aire y cuatro lineas de dialogo que se tragaban en silencio.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NIVEL_CAPRILOPOLIS_1 as L } from '../src/w_level.js';
import { LINES } from '../src/s_dialogue.js';
import { CollisionWorld } from '../src/p_physics.js';
import { TUNING } from '../src/p_player.js';
import { TRANSITIONS } from '../src/r_transitions.js';

const CORO = JSON.parse(readFileSync(new URL('../public/audio/choreography.json', import.meta.url)));

/**
 * Holgura del presupuesto de recorrido (`SINCRONIA.md` §6).
 *
 * Nadie recorre un nivel en linea recta a velocidad maxima: hay saltos, huecos y
 * cambios de altura. El 0,75 es lo que cubre esa diferencia.
 */
const HOLGURA = 0.75;

const mundo = new CollisionWorld(L.solids);
const momento = (n) => CORO.moments.find((m) => m.name === n);

/**
 * Techo solido mas alto bajo esa x que no pase de `techo`, o null si no hay nada.
 *
 * No sirve `groundHeightAt`: devuelve el mas alto de TODOS, aunque este por encima
 * del objeto. Con la repisa secreta de la zona A (top 3,0) sobre el puente trasero
 * (top 0,4), preguntaba por la caja de x=29 y contestaba la repisa — 2,6 m por
 * encima de ella. Es la misma clase de error que el `fallback` que hacia flotar las
 * banderas: una sonda que contesta a otra pregunta.
 */
function sueloBajo(x, capa, techo = Number.POSITIVE_INFINITY) {
  let mejor = null;
  for (const sol of L.solids) {
    if (sol.layer !== undefined && sol.layer !== capa) continue;
    if (x < sol.x || x > sol.x + sol.w) continue;
    const top = sol.y + sol.h;
    if (top > techo + 0.01) continue;
    if (mejor === null || top > mejor) mejor = top;
  }
  return mejor;
}

// ------------------------------------------------------------ 1 · musica

test('cada etapa apunta a un momento que existe', () => {
  for (const s of L.stages) {
    assert.ok(momento(s.moment), `la etapa ${s.id} apunta a '${s.moment}', que no esta horneado`);
  }
});

test('toda etapa con loop declara su puerta', () => {
  for (const s of L.stages) {
    if (!momento(s.moment)?.loop) continue;
    assert.ok(s.gate?.x !== undefined,
              `${s.id} retiene la musica y no dice donde empieza el reto (falta gate.x)`);
  }
});

test('la puerta esta antes del objetivo, no despues', () => {
  for (const s of L.stages) {
    if (s.gate?.x === undefined || s.objective?.x === undefined) continue;
    assert.ok(s.gate.x <= s.objective.x,
              `${s.id}: la puerta (${s.gate.x}) esta pasado el objetivo (${s.objective.x})`);
  }
});

// -------------------------------------------- 2 · presupuesto de recorrido

test('presupuesto de recorrido de las etapas lineales', () => {
  // Solo se comprueban las que NO retienen: las que tienen loop estan a salvo por
  // construccion, porque la musica espera.
  for (const s of L.stages) {
    const m = momento(s.moment);
    if (!m || m.loop) continue;
    if (s.objective?.type !== 'reachX') continue;

    // En un RUNNER el juego fija la velocidad, asi que la holgura del 0,75 no aplica:
    // esa holgura existe porque un jugador pierde velocidad al saltar, girar y
    // cambiar de altura, y con el acelerador bloqueado no la pierde.
    //
    // Pero SI hay que descontar el arranque. `runner.startBars` es lo que el
    // auto-scroll espera antes de tirar del personaje —la transicion de entrada, la
    // camara llegando y la senal de Bradislav—, y durante esos compases el jugador no
    // avanza. Contarlos como tiempo util es exactamente el error de TDB-001 con otro
    // disfraz: numeros que viven en archivos distintos y que nadie cruza.
    const desde = s.runner?.from ?? 0;
    const arranque = (s.runner?.startBars ?? 0) * CORO.barSeconds;
    const util = m.duration - arranque;
    const distancia = s.objective.x - desde;
    const exige = distancia / util;
    const disponible = s.runner
      ? s.runner.speed
      : TUNING.runSpeed * HOLGURA;

    assert.ok(exige <= disponible,
      `${s.id}: ${distancia} m en ${util.toFixed(2)} s utiles `
      + `(${m.duration.toFixed(2)} menos ${arranque.toFixed(2)} de arranque) `
      + `exigen ${exige.toFixed(2)} m/s, y solo hay ${disponible.toFixed(2)} m/s`);
  }
});

test('un runner declara desde donde corre, o el presupuesto miente', () => {
  // Sin `from`, la distancia se mide desde x=0 y sale un numero que no es el del
  // tramo. Es exactamente como TDB-001 paso desapercibido: la aritmetica se hacia
  // sobre numeros que vivian en archivos distintos y nadie los cruzaba.
  for (const s of L.stages) {
    if (!s.runner) continue;
    assert.equal(typeof s.runner.from, 'number', `${s.id}: runner sin 'from'`);
    assert.ok(s.runner.speed > 0, `${s.id}: runner sin velocidad`);
    assert.ok(s.retry, `${s.id}: un runner que se falla tiene que decir donde reinicia`);
    // El arranque tiene que cubrir la transicion de entrada, o el personaje echa a
    // correr con la camara todavia girando y sin haber vuelto sobre el.
    if (s.transition) {
      const t = TRANSITIONS[s.transition];
      const dura = t.bars[0] + t.bars[1];
      assert.ok((s.runner.startBars ?? 0) >= dura,
        `${s.id}: espera ${s.runner.startBars} compases y su transicion '${s.transition}' dura ${dura}`);
    }
    // Y la animacion tiene que poder seguir esa velocidad, o el personaje patina.
    assert.ok(s.runner.speed <= TUNING.runnerMaxSpeed,
      `${s.id}: corre a ${s.runner.speed} m/s y el techo de cadencia es ${TUNING.runnerMaxSpeed}`);
  }
});

// ------------------------------------------------------- 3 · colocacion

test('todo objetivo posicional cae sobre suelo firme', () => {
  for (const s of L.stages) {
    if (s.objective?.type !== 'reachX') continue;
    const capa = s.objective.layer ?? 0;
    assert.ok(sueloBajo(s.objective.x, capa) !== null,
      `${s.id}: la meta esta en x=${s.objective.x}, donde no hay suelo en la capa ${capa}`);
  }
});

test('todo checkpoint tiene suelo debajo', () => {
  for (const c of L.checkpoints) {
    const alto = sueloBajo(c.x, c.layer ?? 0, c.y);
    assert.ok(alto !== null, `checkpoint en x=${c.x} sin suelo debajo`);
    assert.ok(c.y >= alto - 0.01, `checkpoint en x=${c.x} aparece por debajo del suelo`);
  }
});

/** ¿Ese punto esta DENTRO de un solido? Nada recogible deberia estarlo. */
function dentroDeSolido(x, y, capa) {
  return L.solids.some((s) => (s.layer === undefined || s.layer === capa)
    && x >= s.x && x <= s.x + s.w && y > s.y && y < s.y + s.h);
}

/**
 * ¿Hay suelo al alcance de un salto desde algun sitio cercano?
 *
 * No vale exigir suelo justo debajo: las chispas de RUTA cuelgan sobre los huecos a
 * proposito — marcan el despegue y el apice del salto, que es como enseñan por donde
 * se va. Exigirles suelo debajo marcaba 19 falsos positivos y no habria encontrado
 * ninguno de los dos defectos reales.
 *
 * Lo que si tiene que haber es una plataforma de despegue a tiro: 3 m de alcance
 * horizontal y la altura de un salto.
 */
function alcanzable(x, y, capa) {
  for (let dx = -3; dx <= 3; dx += 0.5) {
    const alto = sueloBajo(x + dx, capa, y);
    if (alto !== null && y - alto <= TUNING.jumpHeight) return true;
  }
  return false;
}

test('nada recogible esta incrustado dentro de la geometria', () => {
  for (const [tipo, lista] of [['chispa', L.sparks], ['tornillo', L.screws]]) {
    for (const it of lista) {
      assert.ok(!dentroDeSolido(it.x, it.y, it.layer ?? 0),
        `${tipo} en x=${it.x} y=${it.y} esta DENTRO de un solido: no se puede coger`);
    }
  }
});

test('todo recogible tiene una plataforma de despegue a tiro', () => {
  for (const [tipo, lista] of [['chispa', L.sparks], ['tornillo', L.screws]]) {
    for (const it of lista) {
      const capa = it.layer ?? 0;
      assert.ok(alcanzable(it.x, it.y, capa),
        `${tipo} en x=${it.x} y=${it.y} (capa ${capa}): no hay desde donde saltar a el`);
    }
  }
});

test('todo prop tiene suelo bajo su pedestal', () => {
  for (const p of L.props) {
    assert.ok(sueloBajo(p.x, p.layer ?? 0, p.y) !== null, `el prop '${p.id}' flota sobre el vacio`);
  }
});

test('toda caja empujable apoya en algo', () => {
  for (const c of L.pushables) {
    const alto = sueloBajo(c.x, c.layer ?? 0, c.y);
    assert.ok(alto !== null, `caja empujable en x=${c.x} sin suelo`);
    assert.ok(Math.abs(c.y - alto) < 0.5,
      `la caja de x=${c.x} nace a ${(c.y - alto).toFixed(2)} m del suelo: se caera sola`);
  }
});

test('INVARIANTE del plan §10.4 · todo portal tiene suelo en las DOS capas', () => {
  // "El validador rechaza el build si un portal teletransporta a un punto sin suelo
  // debajo". Estaba escrito desde el principio y nunca se habia comprobado.
  for (const p of L.portals) {
    for (const capa of [0, 1]) {
      assert.ok(sueloBajo(p.x, capa) !== null,
        `el portal ${p.id} (x=${p.x}) deja al jugador cayendo en la capa ${capa}`);
    }
  }
});

test('toda placa cae dentro de un hueco de su capa', () => {
  for (const pl of L.plates || []) {
    const alto = sueloBajo(pl.x, pl.layer ?? 0, pl.y + 0.01);
    assert.ok(alto !== null, `la placa de x=${pl.x} no tiene fondo`);
    assert.ok(Math.abs(alto - pl.y) < 0.01,
      `la placa de x=${pl.x} dice estar en y=${pl.y} y el fondo esta en ${alto}`);
  }
});

// --------------------------------------------------------- 4 · el guion

test('ningun beat se programa despues del final de su momento', () => {
  for (const b of L.beats) {
    const m = momento(b.moment);
    assert.ok(m, `el beat de '${b.moment}' apunta a un momento que no existe`);
    assert.ok(b.at < m.duration,
      `el beat '${b.say}' suena a los ${b.at} s de un momento que dura ${m.duration.toFixed(2)}: no sonaria nunca`);
  }
});

test('toda cinematica cabe en su momento', () => {
  for (const c of L.cinematics) {
    if (!c.moment) continue;
    const m = momento(c.moment);
    assert.ok(m, `la cinematica de '${c.moment}' apunta a un momento inexistente`);
    const dura = c.bars * CORO.barSeconds;
    assert.ok(dura <= m.duration + 0.01,
      `la cinematica de '${c.moment}' dura ${dura.toFixed(2)} s y su momento ${m.duration.toFixed(2)}`);
  }
});

test('las cinematicas duran compases ENTEROS', () => {
  for (const c of L.cinematics) {
    assert.equal(c.bars, Math.round(c.bars),
      `la cinematica de '${c.moment ?? c.atX}' dura ${c.bars} compases: debe acabar en downbeat`);
  }
});

test('los objetivos declaran un tipo que el director sabe resolver', () => {
  const CONOCIDOS = new Set(['reachX', 'sparks', 'crossings', 'crossAndReturn', 'repair']);
  for (const s of L.stages) {
    if (!s.objective) continue;
    assert.ok(CONOCIDOS.has(s.objective.type),
      `la etapa ${s.id} pide un objetivo '${s.objective.type}' que nadie implementa`);
  }
});

test('el punto de aparicion tiene suelo', () => {
  assert.ok(sueloBajo(L.spawn.x, L.spawn.layer ?? 0) !== null, 'se aparece sobre el vacio');
});

test('el punto de reinicio de un tramo tiene suelo', () => {
  // Mismo invariante que los checkpoints, y por la misma razon: reiniciar un tramo
  // cayendo al vacio es un bucle de muerte.
  for (const s of L.stages) {
    if (!s.retry) continue;
    const alto = sueloBajo(s.retry.x, s.retry.layer ?? 0, s.retry.y);
    assert.ok(alto !== null, `${s.id}: reinicia en x=${s.retry.x}, donde no hay suelo`);
  }
});

// ------------------------------------------------- 5 · el guion, una sola vez

test('cada linea del guion se declara UNA sola vez en todo el nivel', () => {
  /**
   * La regla del GDD §10.4. Era el fallo mas caro del guion y el mas invisible:
   * `Dialogue.say()` marca cada linea como usada y nunca la repite, asi que una linea
   * declarada dos veces **suena la primera vez y se traga en silencio la segunda**.
   * Cuatro beats del guion no hacian nada y nadie podia verlo jugando.
   */
  const vistas = new Map();
  const anotar = (id, donde) => {
    if (!id) return;
    if (!vistas.has(id)) vistas.set(id, []);
    vistas.get(id).push(donde);
  };

  for (const b of L.beats) anotar(b.say, `beat ${b.moment}@${b.at}`);
  for (const c of L.cinematics) {
    for (const paso of c.track || []) anotar(paso.say, `cinematica ${c.id ?? c.moment}@${paso.at}`);
  }

  const dobles = [...vistas].filter(([, donde]) => donde.length > 1);
  assert.equal(dobles.length, 0,
    'lineas declaradas dos veces (la segunda no suena):\n'
    + dobles.map(([id, d]) => `  ${id}: ${d.join('  Y  ')}`).join('\n'));
});

test('toda linea que el nivel invoca existe en el banco', () => {
  const invocadas = new Set();
  for (const b of L.beats) if (b.say) invocadas.add(b.say);
  for (const c of L.cinematics) for (const p of c.track || []) if (p.say) invocadas.add(p.say);
  for (const s of L.stages) {
    for (const v of Object.values(s.encourage || {})) invocadas.add(v);
    for (const v of Object.values(s.onClear || {})) if (v) invocadas.add(v);
  }
  for (const v of Object.values(L.closing || {})) invocadas.add(v);

  for (const id of invocadas) {
    assert.ok(LINES[id], `el nivel invoca '${id}' y no esta en el banco de \`s_dialogue.js\``);
  }
});

// -------------------------------------------- 6 · etapas, vistas y logros

test('toda etapa declara su regimen, y es uno de los dos', () => {
  // El campo que pide R4 §9.2 y que el GDD §3 convierte en enmienda constitucional:
  // `coreografiada` cuantiza al compas, `ambiental` deja mandar a la fisica.
  for (const s of L.stages) {
    assert.ok(['coreografiada', 'ambiental'].includes(s.regimen),
      `la etapa ${s.id} declara regimen '${s.regimen}'`);
  }
});

test('cada etapa tiene una vista distinta de la anterior', () => {
  // Si dos tramos seguidos comparten encuadre, el cambio de etapa no se ve. Es la
  // misma regla que la constitucion aplica al post-proceso: un efecto que se usa en
  // todos los momentos deja de significar algo.
  for (let i = 1; i < L.stages.length; i += 1) {
    const a = L.stages[i - 1].vista;
    const b = L.stages[i].vista;
    assert.ok(a && b, `las etapas ${L.stages[i - 1].id}/${L.stages[i].id} necesitan \`vista\``);
    const cambia = Math.abs(a.fov - b.fov) >= 2 || Math.abs(a.dist - b.dist) >= 1.5;
    assert.ok(cambia,
      `${L.stages[i].id} tiene la misma vista que ${L.stages[i - 1].id}: el cambio no se veria`);
  }
});

test('todo logro que una etapa promete existe', () => {
  for (const s of L.stages) {
    if (!s.logro) continue;
    assert.ok(L.logros?.[s.logro], `la etapa ${s.id} promete el logro '${s.logro}', que no existe`);
  }
  for (const d of L.diggables || []) {
    if (!d.logro) continue;
    assert.ok(L.logros[d.logro], `la grieta '${d.id}' promete el logro '${d.logro}', que no existe`);
  }
});

test('todo logro entrega algo, no solo un cartel', () => {
  // R5 §3: el eslabon roto es la recompensa sin significado. Un logro que solo saca
  // un cartel es reconocimiento, no recompensa.
  for (const [id, l] of Object.entries(L.logros || {})) {
    assert.ok(l.da && Object.keys(l.da).length > 0, `el logro '${id}' no entrega nada`);
    assert.ok(l.titulo && l.cuando, `el logro '${id}' no dice que es ni quien lo dispara`);
  }
});

test('toda grieta tiene suelo, esta en su capa y descubre algo que existe', () => {
  for (const d of L.diggables || []) {
    const alto = sueloBajo(d.x, d.layer ?? 0, d.y + 0.01);
    assert.ok(alto !== null, `la grieta '${d.id}' no tiene suelo debajo`);
    const premio = L.screws.find((s) => s.buried === d.reveals);
    assert.ok(premio, `la grieta '${d.id}' dice descubrir '${d.reveals}' y nada lo declara`);
    assert.equal(premio.layer ?? 0, d.layer ?? 0,
      `la grieta '${d.id}' y su premio estan en capas distintas`);
  }
});

test('nada enterrado es alcanzable sin romper su grieta', () => {
  const grietas = new Set((L.diggables || []).map((d) => d.reveals));
  for (const s of L.screws) {
    if (!s.buried) continue;
    assert.ok(grietas.has(s.buried),
      `el tornillo enterrado '${s.buried}' no tiene grieta: no se podria coger nunca`);
  }
});
