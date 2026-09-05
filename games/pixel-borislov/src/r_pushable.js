/**
 * Cajas empujables — como se ven.
 *
 * La otra mitad de `p_pushable.js`. Aqui esta todo el trabajo de que se distingan a
 * la primera, que es lo unico que importa de su aspecto.
 *
 * Empujable y rompible se parecen demasiado si las dos son "una caja", y el jugador
 * tiene que saber cual va a ceder ANTES de saltarle encima. La diferencia se marca
 * por tres canales a la vez, para que no dependa de acertar con uno solo: material
 * metalico frente a madera, un marco cian brillante en las aristas, y flechas que
 * dicen literalmente hacia donde se empuja.
 */

import * as THREE from 'three';

export class PushableViews {
  /**
   * @param {THREE.Scene} scene
   * @param {Array} items  las cajas de `p_pushable.js`, por referencia
   * @param {number[]} layerZ
   */
  constructor(scene, items = [], layerZ = [0, -6.5]) {
    this.vistas = items.map((it) => {
      const size = it.size;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size, size, size),
        new THREE.MeshStandardMaterial({
          color: 0x6f7ea6, roughness: 0.35, metalness: 0.7,
          emissive: 0x2ed8ee, emissiveIntensity: 0.18,
        })
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      // Marco de aristas: la silueta la delata incluso a contraluz.
      const marco = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry),
        new THREE.LineBasicMaterial({ color: 0x2ed8ee, transparent: true, opacity: 0.9 })
      );
      mesh.add(marco);

      // ---- flechas: en la cara de delante, nunca sobresaliendo ----
      //
      // Estaban en las caras laterales y 2 cm POR FUERA de ellas. Dos problemas a la
      // vez. Uno: la punta acababa 11,8 cm mas alla de la cara, y como la colision
      // frena al jugador a 4 cm de esa cara, la flecha le entraba dentro del cuerpo —
      // el modelo del personaje y el de la caja se cruzaban a la vista.
      //
      // Dos: con camara lateral esas caras se ven de canto, asi que lo unico que se
      // apreciaba de la flecha era justamente el trozo que sobresalia del contorno.
      // Marcaban mal y encima estorbaban.
      //
      // Aqui van planas contra la cara frontal, que es la que mira a camara, y con su
      // ancho dentro de la huella de la caja: ±0,31 de 0,375. No pueden tocar nada.
      const flechaGeo = new THREE.ConeGeometry(size * 0.15, size * 0.26, 3);
      for (const lado of [-1, 1]) {
        const flecha = new THREE.Mesh(
          flechaGeo,
          new THREE.MeshBasicMaterial({ color: 0x2ed8ee, fog: false })
        );
        flecha.rotation.z = lado > 0 ? -Math.PI / 2 : Math.PI / 2;
        flecha.position.set(lado * size * 0.28, 0, size / 2 + 0.012);
        flecha.scale.z = 0.18;   // aplastada: es un dibujo sobre la cara, no un pincho
        mesh.add(flecha);
      }

      scene.add(mesh);
      return { it, mesh, z: layerZ[it.layer ?? 0] ?? 0 };
    });
  }

  /**
   * @param {number} beat  0..1 del pulso. Late para reforzar que es interactiva y no
   *   parte del decorado.
   */
  update(beat = 0) {
    for (const v of this.vistas) {
      v.mesh.position.set(v.it.box.x + v.it.size / 2, v.it.box.y + v.it.size / 2, v.z);
      v.mesh.material.emissiveIntensity = 0.14 + beat * 0.22;
    }
  }
}
