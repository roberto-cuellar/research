/**
 * Movimiento del jugador, contra los numeros del plan §25.
 *
 * Se simula a 60 Hz, que es el paso fijo real del juego. Las tolerancias son
 * generosas a proposito: lo que se protege es que el salto siga midiendo ~2,4 m,
 * no el tercer decimal de la integracion.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld, SURFACE } from '../src/p_physics.js';
import { Player, STATE, TUNING } from '../src/p_player.js';

const DT = 1 / 60;

/**
 * Entrada falsa con el MISMO contrato que `Input`.
 *
 * `justPressed` tiene que ser un FLANCO, no un estado. Devolviendolo `true` mientras
 * la tecla esta pulsada, el salto encadenaba solo con el doble salto y media 2,72 m
 * en vez de 2,4 — lo cual no era un fallo del motor, sino de la prueba.
 */
class EntradaFalsa {
  constructor() { this.held = new Set(); this.nuevas = new Set(); this.sueltas = new Set(); }
  isDown(a) { return this.held.has(a); }
  justPressed(a) { return this.nuevas.has(a); }
  justReleased(a) { return this.sueltas.has(a); }
  get axisX() { return (this.held.has('right') ? 1 : 0) - (this.held.has('left') ? 1 : 0); }

  /** Deja pulsadas exactamente estas, generando los flancos que toquen. */
  solo(...as) {
    for (const a of [...this.held]) if (!as.includes(a)) { this.held.delete(a); this.sueltas.add(a); }
    for (const a of as) if (!this.held.has(a)) { this.held.add(a); this.nuevas.add(a); }
  }
  endFrame() { this.nuevas.clear(); this.sueltas.clear(); }
}

/** Avanza `n` ticks con esas teclas pulsadas. Devuelve la altura maxima alcanzada. */
function correr(p, n, ...pulsadas) {
  const e = p._entrada ?? (p._entrada = new EntradaFalsa());
  let alto = -Infinity;
  for (let i = 0; i < n; i += 1) {
    e.solo(...pulsadas);
    p.update(e, DT);
    e.endFrame();
    alto = Math.max(alto, p.body.y);
  }
  return alto;
}

function mundo() {
  return new CollisionWorld([{ x: -50, y: -1, w: 200, h: 1, surface: SURFACE.TIERRA, layer: 0 }]);
}

/** Deja al jugador quieto y apoyado. */
function enSuelo(w = mundo(), x = 10) {
  const p = new Player(w, { x, y: 0 });
  correr(p, 30);
  return p;
}

test('aparece apoyado y quieto', () => {
  const p = enSuelo();
  assert.equal(p.grounded, true);
  assert.equal(p.state, STATE.IDLE);
  assert.ok(Math.abs(p.velocity.x) < 0.01);
});

test('el salto sube ~2,4 m', () => {
  const p = enSuelo();
  const y0 = p.body.y;
  const alto = correr(p, 120, 'jump');     // mantenido: salto completo
  const h = alto - y0;
  assert.ok(h > 2.2 && h < 2.7, `altura de salto ${h.toFixed(2)} m, se esperaba ~2,4`);
});

test('el toque corto sube ~0,9 m, mucho menos que el completo', () => {
  const corto = (() => {
    const p = enSuelo();
    const y0 = p.body.y;
    correr(p, 1, 'jump');                  // un solo tick pulsado
    return correr(p, 120) - y0;            // y se suelta
  })();
  const largo = (() => {
    const p = enSuelo();
    const y0 = p.body.y;
    return correr(p, 120, 'jump') - y0;
  })();

  assert.ok(corto > 0.6 && corto < 1.4, `el toque corto sube ${corto.toFixed(2)} m, se esperaba ~0,9`);
  assert.ok(corto < largo * 0.6, `${corto.toFixed(2)} debe quedarse muy por debajo de ${largo.toFixed(2)}`);
});

/**
 * Coyote time.
 *
 * OJO al escribir estas pruebas: fuera de la ventana el salto NO desaparece — entra
 * el doble salto, que tambien gana altura. Lo que distingue a uno de otro es la
 * velocidad inicial (10,66 contra 8,5) y el estado que dispara. Medir solo "sube o
 * no sube" da un falso verde.
 */
test('coyote time: dentro de la ventana, sale el salto de SUELO', () => {
  const w = new CollisionWorld([{ x: 0, y: -1, w: 10, h: 1, layer: 0 }]);
  const p = enSuelo(w, 9.5);
  assert.equal(p.grounded, true);

  // Se anda hasta dejar el borde. Cuantos ticks tarda depende de la aceleracion, asi
  // que se avanza HASTA que despega en vez de contar a ojo.
  let ticks = 0;
  while (p.grounded && ticks < 60) { correr(p, 1, 'right'); ticks += 1; }
  assert.ok(!p.grounded && ticks < 60, 'deberia haber dejado el borde');

  correr(p, 1, 'right', 'jump');           // dentro de los 0,12 s
  assert.equal(p.state, STATE.JUMP, 'dentro de la ventana es un salto de suelo, no el doble');
  assert.ok(Math.abs(p.velocity.y - TUNING.jumpVelocity) < 0.5,
            `deberia salir a ${TUNING.jumpVelocity}, sale a ${p.velocity.y.toFixed(2)}`);
  assert.equal(p._jumps, 1, 'y consume el primer salto, no el segundo');
});

test('coyote time: pasada la ventana ya no hay salto de suelo', () => {
  const w = new CollisionWorld([{ x: 0, y: -1, w: 10, h: 1, layer: 0 }]);
  const p = enSuelo(w, 9.5);
  let ticks = 0;
  while (p.grounded && ticks < 60) { correr(p, 1, 'right'); ticks += 1; }
  correr(p, 12, 'right');                  // 0,2 s en el aire: pasada la ventana
  correr(p, 1, 'right', 'jump');
  assert.equal(p.state, STATE.DOUBLE_JUMP, 'fuera de la ventana solo queda el doble salto');
  assert.ok(Math.abs(p.velocity.y - TUNING.doubleJumpVelocity) < 0.5,
            `deberia salir a ${TUNING.doubleJumpVelocity}, sale a ${p.velocity.y.toFixed(2)}`);
});

test('la carrera se alcanza sola manteniendo la direccion', () => {
  const p = enSuelo();
  correr(p, 90, 'right');                  // 1,5 s
  assert.ok(Math.abs(p.velocity.x) > TUNING.walkSpeed + 0.5,
            `tras 1,5 s deberia superar la velocidad de andar, va a ${p.velocity.x.toFixed(2)}`);
  assert.ok(Math.abs(p.velocity.x) <= TUNING.runSpeed + 0.01,
            'y nunca por encima de la de carrera');
});

test('la friccion lo para al soltar', () => {
  const p = enSuelo();
  correr(p, 60, 'right');
  correr(p, 30);
  assert.ok(Math.abs(p.velocity.x) < 0.2, `deberia estar parado, va a ${p.velocity.x.toFixed(2)}`);
});

test('`facing` sigue a la direccion', () => {
  const p = enSuelo();
  correr(p, 10, 'right');
  assert.equal(p.facing, 1);
  correr(p, 30, 'left');
  assert.equal(p.facing, -1);
});

test('doble salto: gana altura de verdad', () => {
  const sencillo = (() => {
    const p = enSuelo();
    const y0 = p.body.y;
    return correr(p, 150, 'jump') - y0;
  })();
  const doble = (() => {
    const p = enSuelo();
    const y0 = p.body.y;
    correr(p, 25, 'jump');       // primer salto, mantenido
    correr(p, 1);                // se suelta: hace falta el flanco
    return correr(p, 130, 'jump') - y0;
  })();
  assert.ok(doble > sencillo + 0.5,
            `doble ${doble.toFixed(2)} deberia superar a sencillo ${sencillo.toFixed(2)}`);
});

test('holdState retiene el estado el tiempo pedido', () => {
  const p = enSuelo();
  p.setState(STATE.REPAIR);
  p.holdState(0.2, true);
  correr(p, 6, 'right');                   // 0,1 s
  assert.equal(p.state, STATE.REPAIR, 'dentro de la retencion el estado no cambia');
  correr(p, 20, 'right');
  assert.notEqual(p.state, STATE.REPAIR, 'pasada la retencion, la maquina decide');
});

test('no se cae por debajo de la velocidad terminal', () => {
  const p = new Player(new CollisionWorld([]), { x: 0, y: 0 });   // sin suelo
  correr(p, 600);
  assert.ok(p.velocity.y >= -TUNING.maxFallSpeed - 0.01,
            `la caida se limita a ${TUNING.maxFallSpeed} m/s, va a ${p.velocity.y.toFixed(2)}`);
});

test('la altura de salto NO depende del frame rate', () => {
  // El invariante que justifica el paso fijo de la spec 035: si esto se rompiera, el
  // juego se jugaria distinto en cada monitor.
  const medir = (dt) => {
    const p = new Player(mundo(), { x: 10, y: 0 });
    const e = new EntradaFalsa();
    const paso = (...t) => { e.solo(...t); p.update(e, dt); e.endFrame(); };
    for (let i = 0; i < Math.round(0.5 / dt); i += 1) paso();
    const y0 = p.body.y;
    let alto = y0;
    for (let i = 0; i < Math.round(2 / dt); i += 1) { paso('jump'); alto = Math.max(alto, p.body.y); }
    return alto - y0;
  };
  const a60 = medir(1 / 60);
  const a144 = medir(1 / 144);
  assert.ok(Math.abs(a60 - a144) < 0.15,
            `60 Hz sube ${a60.toFixed(3)} y 144 Hz ${a144.toFixed(3)}: no deben diferir`);
});
