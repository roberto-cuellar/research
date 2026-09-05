/**
 * Reactividad secundaria: orejas, barba y cola que se mueven solas.
 *
 * Es la mitad de runtime de la spec 022. La otra mitad es el handler de vista previa de
 * Blender, y las dos leen las MISMAS constantes de `assets3d/rig/secondary_motion.json`
 * — un parámetro, un dueño. Ajustar el bamboleo se hace ahí, nunca aquí.
 *
 * POR QUE ESTO SALE CASI GRATIS
 * -----------------------------
 * Parecía el problema difícil —"cómo mezclo la inercia de una oreja con la animación de
 * correr"— y resulta que no hay nada que mezclar. **Ningún clip de Mixamo toca estos
 * huesos**: los 69 clips de `rig/clips.json` animan los 25 huesos del contrato y punto.
 * `ear_*`, `beard_*` y `tail_*` están en el contrato precisamente porque Mixamo no los
 * conoce, así que nadie escribe en ellos y la inercia se SUMA en vez de competir.
 *
 * COMO SE MUEVE
 * -------------
 * Un muelle amortiguado por hueso, empujado por la aceleración del padre y aplicado
 * **en contra**:
 *
 *   ω += (−k·θ − c·ω + g·a_local) · dt
 *   θ += ω · dt
 *
 * De ahí sale lo que se pedía: la oreja se queda atrás cuando el personaje arranca y se
 * adelanta cuando frena. No hay que autorar nada; el movimiento del cuerpo lo produce.
 *
 * Y los **impulsos** son otra cosa, a propósito: `impulse()` mete velocidad angular de
 * golpe para un acento de animación —una oreja que se levanta al oír algo—. Una cosa es
 * el socket y otra la animación, y aquí están separadas.
 *
 * PRESUPUESTO
 * -----------
 * Pool fijo, cero asignación en el bucle: los vectores de trabajo se reservan al
 * construir. Son ~9 huesos con tres flotantes cada uno; el coste está en el orden del
 * ruido, pero asignar en el bucle se paga en recolección de basura y se ve como tirones
 * (constitución, PRESUPUESTO DE RENDIMIENTO).
 */

import * as THREE from 'three';

/**
 * Constantes por defecto, copiadas de `assets3d/rig/secondary_motion.json`.
 *
 * Los números salen de un barrido contra los clips reales, no de la intuición: con
 * `k=42, g=9,0, d=7,5` la base de la oreja llega a 11,6° en `running` y a 29,7° en
 * `jumping`, por debajo del tope de 34° — así que no recorta ni se queda plantada en el
 * límite, que es como se ve un muelle mal puesto.
 *
 * Están aquí porque el juego no lee archivos del pipeline en runtime: el GLB y sus datos
 * llegan horneados. `SecondarySystem` acepta una tabla en el constructor para poder
 * cargarla desde el nivel si algún día conviene, pero el dueño del número sigue siendo
 * el JSON — esto es una copia, y al cambiarlo allí hay que traerlo aquí.
 */
export const CADENAS = {
  ear: {
    huesos: ['ear_l_01', 'ear_l_02', 'ear_r_01', 'ear_r_02'],
    stiffness: 42.0, damping: 7.5, gain: 9.0, maxAngle: 34.0, herencia: 0.55,
  },
  beard: {
    huesos: ['beard_01', 'beard_02'],
    stiffness: 30.0, damping: 6.0, gain: 6.8, maxAngle: 26.0, herencia: 0.6,
  },
  tail: {
    huesos: ['tail_01', 'tail_02', 'tail_03'],
    stiffness: 26.0, damping: 5.2, gain: 8.2, maxAngle: 30.0, herencia: 0.62,
  },
};

const DT_MAX = 0.05;
const ACEL_MAX = 60.0;
const REPOSO = 0.0008;
const GRADO = Math.PI / 180;

// Vectores de trabajo. Se reservan una vez: medir en el bucle no debe asignar.
const _pos = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _acc = new THREE.Vector3();
const _local = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();

export class SecondarySystem {
  /**
   * @param {THREE.Object3D} avatar  raíz del personaje, ya cargada
   * @param {object} [tabla]         constantes; por defecto las de `CADENAS`
   */
  constructor(avatar, tabla = CADENAS) {
    this.avatar = avatar;
    this.huesos = [];

    // Índice por nombre canónico, igual que hace `r_equip.js`: el GLB puede traer los
    // huesos con prefijo `mixamorig:` o sin él según por dónde haya pasado.
    const porNombre = new Map();
    avatar.traverse((o) => {
      if (o.isBone) porNombre.set(o.name.replace(/^mixamorig[:_]?/i, '').toLowerCase(), o);
    });

    for (const [cadena, cfg] of Object.entries(tabla)) {
      cfg.huesos.forEach((nombre, i) => {
        const bone = porNombre.get(nombre.toLowerCase());
        if (!bone || !bone.parent) return;
        this.huesos.push({
          cadena,
          bone,
          padre: bone.parent,
          cfg,
          // La punta de la cadena hereda menos empuje que la base: es lo que hace que
          // la oreja se doble como un látigo en vez de girar como una tabla.
          peso: cfg.herencia ** i,
          base: bone.quaternion.clone(),
          theta: new THREE.Vector3(),
          omega: new THREE.Vector3(),
          posPrev: new THREE.Vector3(),
          velPrev: new THREE.Vector3(),
          arrancado: false,
        });
      });
    }

    this.activo = this.huesos.length > 0;
  }

  /** Cuántos huesos secundarios encontró. 0 significa que el GLB no los trae. */
  get count() { return this.huesos.length; }

  /**
   * Un empujón instantáneo a una cadena, para un acento de animación.
   *
   * Separado de la inercia a propósito: la inercia responde al movimiento del cuerpo y
   * no se autora; el impulso es una decisión narrativa —la oreja que se levanta cuando
   * algo suena detrás—. Mezclarlos habría dejado sin forma de pedir lo segundo.
   *
   *   __game.secondary.impulse('ear', 0, 0, 6)
   */
  impulse(cadena, x = 0, y = 0, z = 0) {
    for (const h of this.huesos) {
      if (h.cadena !== cadena) continue;
      h.omega.x += x * h.peso;
      h.omega.y += y * h.peso;
      h.omega.z += z * h.peso;
    }
    return this.huesos.filter((h) => h.cadena === cadena).length;
  }

  /** Devuelve todo a su sitio, sin transición. Para reapariciones y saltos de portal. */
  reset() {
    for (const h of this.huesos) {
      h.theta.set(0, 0, 0);
      h.omega.set(0, 0, 0);
      h.arrancado = false;
      h.bone.quaternion.copy(h.base);
    }
  }

  /**
   * @param {number} dt  segundos reales desde el frame anterior
   */
  update(dt) {
    if (!this.activo || dt <= 0) return;
    // Un frame largo —una pestaña en segundo plano, una carga— daría una aceleración
    // enorme y lanzaría las orejas. Recortar el paso es más barato que subdividirlo y
    // no se nota.
    const h = Math.min(dt, DT_MAX);

    for (const s of this.huesos) {
      s.padre.getWorldPosition(_pos);

      if (!s.arrancado) {
        // El primer frame no tiene historia: sin esto, la posición previa es (0,0,0) y
        // el personaje "aparece" con una aceleración de cientos de m/s².
        s.posPrev.copy(_pos);
        s.velPrev.set(0, 0, 0);
        s.arrancado = true;
        continue;
      }

      _vel.subVectors(_pos, s.posPrev).divideScalar(h);
      _acc.subVectors(_vel, s.velPrev).divideScalar(h);
      s.posPrev.copy(_pos);
      s.velPrev.copy(_vel);

      // Un teletransporte por portal es un salto de POSICIÓN, no una aceleración. Sin
      // este techo, cruzar de capa dispararía las orejas fuera de la cabeza.
      if (_acc.lengthSq() > ACEL_MAX * ACEL_MAX) _acc.setLength(ACEL_MAX);

      // La aceleración va al espacio del HUESO QUE GIRA, no al de su padre.
      //
      // Ahí estaba el error, y costó medirlo: transformando al espacio del padre y
      // aplicando el par en los ejes del hijo, la sacudida vertical de la cabeza caía
      // justo sobre el eje LARGO de la oreja — y una fuerza a lo largo de un hueso no lo
      // puede girar. Medido en Blender: la cabeza acelera entre 3,5 y 11,7 m/s² al
      // correr y la oreja se movía 0,04°.
      //
      // El marco es la pose del padre por la rotación de REPOSO del hijo (`s.base`), no
      // la pose del hijo: usar la del hijo mete su propio giro en la cuenta y el muelle
      // se realimenta.
      s.padre.getWorldQuaternion(_quat).multiply(s.base).invert();
      _local.copy(_acc).applyQuaternion(_quat);

      const { stiffness, damping, gain, maxAngle } = s.cfg;
      const g = gain * s.peso;
      const tope = maxAngle * GRADO;

      // Par de una fuerza sobre un hueso: τ = eje × (−a). El hueso corre a lo largo de su
      // +Y local, así que τ = (−a.z, 0, a.x). El cero del medio no es un olvido: una
      // fuerza lineal no puede hacer girar un hueso sobre su propio eje.
      //
      // El signo negativo es lo que hace que se mueva AL REVÉS que el movimiento.
      s.omega.x += (-stiffness * s.theta.x - damping * s.omega.x - g * _local.z) * h;
      s.omega.z += (-stiffness * s.theta.z - damping * s.omega.z + g * _local.x) * h;
      s.omega.y += (-stiffness * s.theta.y - damping * s.omega.y) * h;

      s.theta.x = clamp(s.theta.x + s.omega.x * h, -tope, tope);
      s.theta.y = clamp(s.theta.y + s.omega.y * h, -tope, tope);
      s.theta.z = clamp(s.theta.z + s.omega.z * h, -tope, tope);

      if (Math.abs(s.theta.x) + Math.abs(s.theta.y) + Math.abs(s.theta.z)
          + Math.abs(s.omega.x) + Math.abs(s.omega.y) + Math.abs(s.omega.z) < REPOSO) {
        continue;                       // parado: no hace falta reescribir la rotación
      }

      _euler.set(s.theta.x, s.theta.y, s.theta.z, 'XYZ');
      _quat.setFromEuler(_euler);
      // Se compone sobre la rotación de REPOSO, no sobre la que hubiera. Acumular sobre
      // el valor ya escrito realimenta y satura, que es el error que la constitución ya
      // documenta para la FOV de la cámara.
      s.bone.quaternion.copy(s.base).multiply(_quat);
    }
  }
}

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
