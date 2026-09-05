/**
 * Placas de presion — como se ven.
 *
 * La otra mitad de `p_plate.js`. Aqui no se decide nada: se lee el estado de las
 * placas y se dibuja.
 *
 * Diegeticamente son parte del Proyector: Bradislav sujeta con un campo lo que aun
 * no toca coger, y el campo se alimenta de estos contactos. Por eso la placa y el
 * campo son del mismo violeta y estan unidos por un haz — el jugador tiene que poder
 * trazar la causa con la mirada, sin que nadie se lo cuente.
 */

import * as THREE from 'three';

const COLOR_ESPERA = 0xe62a9e;   // rosa: falta algo
const COLOR_LISTA = 0x2ed8ee;    // cian: hecho

export class PlateViews {
  /**
   * @param {THREE.Scene} scene
   * @param {Array} items  las placas de `p_plate.js`, por referencia
   * @param {number[]} layerZ  Z de cada capa
   */
  constructor(scene, items = [], layerZ = [0, -6.5]) {
    this.vistas = items.map((it) => {
      const group = new THREE.Group();
      group.position.set(it.x, it.y, layerZ[it.layer ?? 0]);
      scene.add(group);

      // Base: una chapa fina que asoma del fondo. Fina a proposito — la caja tiene
      // que quedar a ras del suelo cuando encaje, y una placa gruesa la levantaria.
      const base = new THREE.Mesh(
        new THREE.BoxGeometry(it.w, 0.06, it.w * 0.8),
        new THREE.MeshStandardMaterial({
          color: 0x3a4260, roughness: 0.4, metalness: 0.8,
          emissive: COLOR_ESPERA, emissiveIntensity: 0.5,
        })
      );
      base.position.y = 0.03;
      base.receiveShadow = true;
      group.add(base);

      // Anillo en el suelo: es lo que se ve desde arriba al asomarse al hueco, que
      // es como el jugador lo va a mirar la primera vez.
      const anillo = new THREE.Mesh(
        new THREE.RingGeometry(it.w * 0.22, it.w * 0.34, 24),
        new THREE.MeshBasicMaterial({
          color: COLOR_ESPERA, transparent: true, opacity: 0.9,
          side: THREE.DoubleSide, depthWrite: false, fog: false,
        })
      );
      anillo.rotation.x = -Math.PI / 2;
      anillo.position.y = 0.07;
      group.add(anillo);

      // Haz vertical: sube de la placa hacia el campo. Es el cable que hace legible
      // la causa. Mientras espera es tenue; al activarse pega un fogonazo y se apaga,
      // porque ya no tiene nada que anunciar.
      const haz = new THREE.Mesh(
        new THREE.CylinderGeometry(it.w * 0.16, it.w * 0.30, 6.0, 12, 1, true),
        new THREE.MeshBasicMaterial({
          color: COLOR_ESPERA, transparent: true, opacity: 0.10,
          side: THREE.DoubleSide, depthWrite: false, fog: false,
          blending: THREE.AdditiveBlending,
        })
      );
      haz.position.y = 3.0;
      group.add(haz);

      const luz = new THREE.PointLight(COLOR_ESPERA, 1.6, 6, 2);
      luz.position.y = 0.5;
      group.add(luz);

      return { it, group, base, anillo, haz, luz, flash: 0, encendida: false };
    });
  }

  update(dt, beatPulse = 0) {
    for (const v of this.vistas) {
      if (!v.it.pressed) {
        // Late al pulso mientras espera: una placa quieta se lee como decoracion.
        v.anillo.material.opacity = 0.35 + beatPulse * 0.55;
        v.haz.material.opacity = 0.06 + beatPulse * 0.10;
        v.luz.intensity = 1.0 + beatPulse * 1.4;
        v.base.material.emissiveIntensity = 0.35 + beatPulse * 0.4;
        continue;
      }

      // Primer frame tras hundirse: cambia de color y arranca el fogonazo.
      if (!v.encendida) {
        v.encendida = true;
        v.flash = 1;
        v.base.material.emissive.setHex(COLOR_LISTA);
        v.anillo.material.color.setHex(COLOR_LISTA);
        v.haz.material.color.setHex(COLOR_LISTA);
        v.luz.color.setHex(COLOR_LISTA);
      }

      // El fogonazo se apaga y la placa se queda encendida en fijo. El haz
      // desaparece — su trabajo era decir "mira arriba", y ya se ha mirado.
      v.flash = Math.max(0, v.flash - dt * 1.6);
      v.luz.intensity = 1.2 + v.flash * 6.0;
      v.haz.material.opacity = v.flash * 0.5;
      v.anillo.material.opacity = 0.55 + v.flash * 0.45;
      v.anillo.scale.setScalar(1 + v.flash * 0.6);
      v.base.material.emissiveIntensity = 0.6 + v.flash * 1.2;
    }
  }
}
