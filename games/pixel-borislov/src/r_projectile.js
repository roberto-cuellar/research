/**
 * Proyectiles — como se ven.
 *
 * La otra mitad de `p_projectile.js`: lee las posiciones y las dibuja.
 *
 * Un draw call por chorro vivo, y como mucho son cuatro. La geometria, el degradado
 * y los materiales se crean UNA vez en el constructor y se reutilizan — el pool no
 * asigna nada en vuelo.
 */

import * as THREE from 'three';

/** Degradado radial para el halo. Se genera para no depender de ningun PNG. */
function makeGlowTexture(size = 64) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0.0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,.55)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class ProjectileViews {
  /**
   * @param {THREE.Scene} scene
   * @param {Array} shots  los tiros de `p_projectile.js`, por referencia
   * @param {object} [options]
   * @param {number} [options.color] color del chorro
   * @param {number[]} [options.layerZ]
   * @param {object} [options.particles] para la estela
   * @param {number} [options.trailStep] cada cuantos metros deja una particula
   */
  constructor(scene, shots, options = {}) {
    this.shots = shots;
    this.color = options.color ?? 0x2ed8ee;
    this.layerZ = options.layerZ ?? [0, -6.5];
    this.particles = options.particles || null;
    this.trailStep = options.trailStep ?? 0.28;

    const geo = new THREE.SphereGeometry(0.2, 10, 8);
    const haloGeo = new THREE.PlaneGeometry(1.0, 1.0);
    const haloTex = makeGlowTexture();

    this.vistas = shots.map(() => {
      const group = new THREE.Group();

      const core = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.95, fog: false,
      }));
      group.add(core);

      // Halo aditivo con billboard: es lo que hace que se vea de lejos y que se lea
      // como energia en vez de como una bola de plastico.
      const halo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({
        map: haloTex, color: this.color, transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      }));
      group.add(halo);

      const light = new THREE.PointLight(this.color, 1.8, 4.5, 2);
      group.add(light);

      group.visible = false;
      scene.add(group);
      return { group, core, halo, light, trail: 0 };
    });
  }

  update() {
    for (let i = 0; i < this.shots.length; i += 1) {
      const s = this.shots[i];
      const v = this.vistas[i];

      if (!s.alive) {
        if (v.group.visible) { v.group.visible = false; v.trail = 0; }
        continue;
      }

      const z = this.layerZ[s.layer] ?? 0;
      v.group.visible = true;
      v.group.position.set(s.x, s.y, z);

      // Se orienta segun su velocidad: al subir apunta arriba y al caer, abajo. Es
      // lo que hace VISIBLE la parabola — una esfera girando no la cuenta.
      const speed = Math.hypot(s.vx, s.vy);
      v.group.rotation.z = Math.atan2(s.vy, s.vx);
      v.core.scale.set(1 + speed * 0.06, Math.max(0.45, 1 - speed * 0.025), 1);
      v.halo.scale.setScalar(1 + Math.sin(s.life * 22) * 0.12);
      v.light.intensity = 1.4 + Math.sin(s.life * 22) * 0.5;

      // Estela por DISTANCIA, no por tiempo: asi la densidad es la misma vaya rapido
      // o lento, y el rastro dibuja el arco que ha seguido.
      if (!this.particles) continue;
      v.trail += Math.hypot(s.x - s.prevX, s.y - s.prevY);
      while (v.trail >= this.trailStep) {
        v.trail -= this.trailStep;
        this.particles.airBurst(s.prevX, s.prevY, z, this.color, 1, 0.5);
      }
    }
  }

  /** Encara los halos a la camara. Un plano de canto no se ve. */
  faceCamera(camera) {
    for (let i = 0; i < this.shots.length; i += 1) {
      if (this.shots[i].alive) this.vistas[i].halo.lookAt(camera.position);
    }
  }
}
