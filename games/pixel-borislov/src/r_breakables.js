/**
 * Objetos rompibles — como se ven.
 *
 * La otra mitad de `p_breakables.js`. Lee el estado y dibuja: nada de decidir.
 *
 * Los tres tipos se distinguen por color y proporcion —madera, metal, barro— y esa
 * distincion importa: el jugador tiene que saber si algo va a ceder ANTES de
 * saltarle encima. Es la misma regla que separa una caja rompible de una empujable.
 */

import * as THREE from 'three';

export class BreakableViews {
  /**
   * @param {THREE.Scene} scene
   * @param {Array} items  los rompibles de `p_breakables.js`, por referencia
   * @param {number[]} layerZ  Z de cada capa
   */
  constructor(scene, items = [], layerZ = [0, -6.5]) {
    this.vistas = items.map((it) => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(it.w, it.h, it.d),
        new THREE.MeshStandardMaterial({
          color: it.kind.color, roughness: 0.8, metalness: 0.1,
        })
      );
      mesh.position.set(it.cx, it.cy, layerZ[it.layer ?? 0]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      return { it, mesh, oscurecido: false };
    });
  }

  update() {
    for (const v of this.vistas) {
      if (v.it.broken) {
        if (v.mesh.visible) v.mesh.visible = false;
        continue;
      }

      // Aguanto un golpe pero no cedio: se oscurece una vez y se sacude mientras
      // dure el temporizador que armo el playsim.
      if (v.it.shake > 0) {
        if (!v.oscurecido) { v.oscurecido = true; v.mesh.material.color.multiplyScalar(0.75); }
        v.mesh.rotation.z = Math.sin(v.it.shake * 90) * v.it.shake * 0.5;
      } else if (v.mesh.rotation.z !== 0) {
        v.mesh.rotation.z = 0;
        v.oscurecido = false;   // listo para acusar el siguiente golpe
      }
    }
  }
}
