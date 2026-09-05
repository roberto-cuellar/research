/**
 * Dron de limpieza: el perseguidor de la etapa 2 (GDD §10.7c).
 *
 * No persigue a velocidad constante: crucero a 5,4 m/s (por DEBAJO de los 6,0 del
 * jugador), goma elastica para no perderte de vista, y embestidas cada pocos
 * compases. De ahi salen los momentos de tension y de respiro. Corriendo limpio se
 * le gana; parandote, no.
 *
 * Tres formas de escapar, y las tres son mecanicas del juego:
 *   - correr bien, encadenando rodadas en vez de aterrizajes duros
 *   - cambiar de capa: tarda 0,75 s en reaccionar y otro tanto en maniobrar
 *   - rodearlo: entonces da media vuelta y vuelve, no te deja en paz
 *
 * La etapa es lineal porque su momento musical no tiene loop, asi que la presion
 * temporal es lo que la sostiene.
 *
 * No mata: te aspira y te devuelve al checkpoint. En este juego nadie muere.
 */

import * as THREE from 'three';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';

export class Drone {
  constructor(scene, options = {}) {
    this.modelUrl = options.modelUrl || './public/models/drone.glb';
    // Crucero POR DEBAJO de los 6,0 m/s del jugador: corriendo limpio se le gana.
    // La presion la ponen las embestidas y la goma, no una ventaja bruta.
    this.cruise = options.speed ?? 5.4;
    this.speed = this.cruise;      // compatibilidad: applyHelp sigue tocando esto
    this.leash = options.leash ?? 11;   // a partir de aqui acelera para no perderte
    this.vx = this.cruise;
    this.surgePhase = 0;
    this.facing = 1;
    this.stunned = 0;
    this.waiting = false;
    this.spinUp = 0;
    this.captureRadius = options.captureRadius ?? 0.8;
    this.startOffset = options.startOffset ?? -9;
    this.hoverHeight = options.hoverHeight ?? 1.5;

    this.active = false;
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.layer = 0;
    this.pendingLayer = null;
    this.reaction = 0;
    // Tiempo que tarda en darse cuenta de que has cruzado. Es la ventana de escape.
    this.reactionTime = options.reactionTime ?? 0.75;
    // Mundo de colision: si se le pasa, el dron vuela por encima del terreno.
    this.world = options.world || null;
    this.helped = false;      // la ayuda de Bradislav se aplica una sola vez
    this.captures = 0;

    const body = new THREE.Group();

    const hull = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.42, 0.34, 4, 12),
      new THREE.MeshStandardMaterial({
        color: 0x8a93ad, metalness: 0.75, roughness: 0.35,
        emissive: 0xe62a9e, emissiveIntensity: 0.5,
      })
    );
    hull.rotation.z = Math.PI / 2;
    hull.castShadow = true;
    body.add(hull);

    // El ojo delata hacia donde mira y late: es el aviso visual de que se acerca.
    this.eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xe62a9e })
    );
    this.eye.position.set(0.42, 0, 0);
    body.add(this.eye);

    this.group = body;
    this.group.visible = false;
    this.placeholder = hull;
    scene.add(this.group);

    // Modelo real. La forma provisional se queda como respaldo si no carga.
    new GLTFLoader().load(this.modelUrl, (gltf) => {
      const model = gltf.scene;
      model.updateWorldMatrix(true, true);

      // Se mide sobre las GEOMETRIAS, no con Box3.setFromObject.
      // En una malla con esqueleto ese metodo devuelve la caja de la pose de bind
      // sin las transformadas de los huesos, y da una altura falsa: el dron salia
      // escalado a casi nada y solo quedaba a la vista el ojo — la "esfera voladora".
      const box = new THREE.Box3();
      const tmp = new THREE.Box3();
      model.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.frustumCulled = false;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
        box.union(tmp);

        // El material que trae el modelo se ve casi negro contra el cielo de la
        // etapa 2. Se sustituye por uno metalico con un emisivo rosa tenue: asi se
        // lee la silueta de lejos y se identifica como maquina de Bradislav.
        // Emisivo MUY bajo: la etapa 2 corre con el bloom a 4.0, el mas alto del
        // juego, y a 0,35 el dron se convertia en una mancha rosa que tapaba media
        // pantalla. El color identificativo lo pone el ojo, que es pequeño y puede
        // permitirse florecer.
        o.material = new THREE.MeshStandardMaterial({
          color: 0x99a3bd, metalness: 0.8, roughness: 0.4,
          emissive: new THREE.Color(0xe62a9e), emissiveIntensity: 0.08,
        });
      });

      const size = box.getSize(new THREE.Vector3());
      const target = options.size ?? 1.4;
      const scale = target / Math.max(size.y, 0.001);
      model.scale.setScalar(scale);
      model.rotation.y = Math.PI / 2;
      // Se centra sobre el pivote del grupo, que es lo que persigue al jugador.
      const center = box.getCenter(new THREE.Vector3()).multiplyScalar(scale);
      model.position.set(-center.x, -center.y, -center.z);

      this.group.remove(this.placeholder);
      this.group.add(model);
      this.model = model;
      // El ojo se adelanta al morro del modelo real; con la capsula estaba en 0,42
      // y ahi se quedaba dentro del casco.
      this.eye.position.set(target * 0.55, 0, 0);
      this.eye.scale.setScalar(0.85);

      // Preferimos un vuelo en reposo; si no existe, el primero que haya.
      if (gltf.animations && gltf.animations.length) {
        this.mixer = new THREE.AnimationMixer(model);
        const byName = (frag) => gltf.animations.find(
          (a) => a.name.toLowerCase().includes(frag)
        );
        const clip = byName('idle') || byName('run') || gltf.animations[0];
        this.mixer.clipAction(clip).play();
      }
    }, undefined, () => { /* sin modelo: se usa la forma provisional */ });
  }

  /**
   * Aparece por detras del jugador, pero EN ESPERA.
   *
   * No persigue hasta que se le suelta con `release()`. Antes arrancaba a la vez que
   * la etapa, asi que durante la cinematica —cuando el jugador no tiene control— ya
   * te estaba alcanzando: perder sin poder hacer nada frustra y no enseña nada.
   * Ahora se ve llegar, se queda flotando, y arranca cuando Bradislav grita "¡Corre!".
   */
  start(playerX, layerZ, layer = 0) {
    this.active = true;
    this.waiting = true;
    this.spinUp = 0;
    this.x = playerX + this.startOffset;
    this.vx = this.cruise;
    this.surgePhase = 0;
    this.layer = layer;
    this.z = layerZ;
    this.targetZ = layerZ;
    this.pendingLayer = null;
    this.reaction = 0;
    this.y = (this.world ? this.world.groundHeightAt(this.x, layer) : 0) + this.hoverHeight;
    this.group.visible = true;
    this.group.position.set(this.x, this.y, this.z);
  }

  /**
   * El dron sigue al jugador de capa, pero NO al instante.
   *
   * Tiene que darse cuenta (tiempo de reaccion) y luego maniobrar. Ese hueco es lo
   * que convierte el cambio de capa en una via de escape de verdad: si copiara la
   * capa en el mismo frame, cruzar un portal no serviria absolutamente de nada.
   */
  setLayer(layer, layerZ) {
    this.playerZ = layerZ;
    if (layer === this.layer) { this.reaction = 0; this.targetZ = layerZ; return; }
    this.pendingLayer = layer;
    this.pendingZ = layerZ;
  }

  /**
   * Suelta la persecucion, pero no de inmediato.
   *
   * Entre el aviso y la primera embestida hay un compas de ARRANQUE: el dron
   * chirria, el ojo pasa de ambar a rojo y solo entonces se lanza. Sin esa pausa el
   * grito de Bradislav y la persecucion ocurren a la vez, y el jugador no llega a
   * procesar ninguna de las dos — que es lo que se sentia como "no hay pausa".
   *
   * @param {number} spinUp segundos de arranque (un compas a 111 BPM = 2,16 s)
   */
  release(spinUp = 2.16) {
    if (!this.waiting) return false;
    this.waiting = false;
    this.spinUp = spinUp;
    this.vx = 0;                   // arranca PARADO y acelera: se ve coger carrera
    return true;
  }

  /**
   * Lo aturde: se para y chispea. No lo destruye — aqui no se destruye nada, solo
   * se gana tiempo. Es lo que convierte las Chispas recogidas en herramienta en vez
   * de puntuacion, y le da al jugador una salida ACTIVA a la persecucion.
   */
  stun(seconds = 1.4) {
    this.stunned = Math.max(this.stunned, seconds);
  }

  stop() {
    this.active = false;
    this.group.visible = false;
  }

  /**
   * Ayuda de Bradislav: −15 % de velocidad y −10 % de radio, UNA sola vez.
   * Deliberadamente por debajo del umbral de "me lo estan regalando".
   */
  applyHelp() {
    if (this.helped) return false;
    this.helped = true;
    this.cruise *= 0.85;
    this.speed = this.cruise;
    this.captureRadius *= 0.90;
    return true;
  }

  /**
   * @param {import('./r_particles.js').Particles} [particles] emisor de la estela
   * @returns {boolean} true si acaba de atrapar al jugador
   */
  update(dt, playerX, playerY, layerZ, elapsed, particles) {
    if (this.mixer) this.mixer.update(dt);
    if (!this.active) return false;

    const prevX = this.x;

    // Arranque: ya esta suelto pero todavia no persigue. Vibra en el sitio y el ojo
    // se calienta de ambar a rojo — el aviso de que esto va a empezar.
    if (this.spinUp > 0) {
      this.spinUp -= dt;
      const k = 1 - Math.max(0, this.spinUp) / 2.16;
      const ground = this.world ? this.world.groundHeightAt(this.x, this.layer) : 0;
      this.y += ((ground + this.hoverHeight) - this.y) * Math.min(1, dt * 3);
      this.z += (layerZ - this.z) * Math.min(1, dt * 2.2);
      // La vibracion crece con el arranque: se oye y se ve que esta cargando.
      const buzz = k * 0.12;
      this.group.position.set(
        this.x + Math.sin(elapsed * 40) * buzz,
        this.y + Math.sin(elapsed * 33) * buzz,
        this.z
      );
      this.group.rotation.z = Math.sin(elapsed * 26) * 0.06 * k;
      // Ambar -> rojo.
      this.eye.material.color.setRGB(0.9, 0.76 - 0.5 * k, 0.16 - 0.06 * k);
      return false;      // durante el arranque tampoco captura
    }

    // En espera: flota en su sitio, mirando al jugador, y NO puede capturar.
    if (this.waiting) {
      const ground = this.world ? this.world.groundHeightAt(this.x, this.layer) : 0;
      this.y += ((ground + this.hoverHeight) - this.y) * Math.min(1, dt * 3);
      this.z += (layerZ - this.z) * Math.min(1, dt * 2.2);
      this.group.position.set(this.x, this.y + Math.sin(elapsed * 2.2) * 0.14, this.z);
      this.group.rotation.z = Math.sin(elapsed * 1.6) * 0.05;
      this.eye.material.color.setHex(0xe6c22a);   // ambar: aun no persigue
      return false;
    }

    // Aturdido: se queda quieto, cabeceando, y no puede capturar.
    if (this.stunned > 0) {
      this.stunned -= dt;
      this.vx *= 1 - Math.min(1, dt * 6);
      this.group.position.set(this.x, this.y + Math.sin(elapsed * 22) * 0.09, this.z);
      this.group.rotation.z = Math.sin(elapsed * 17) * 0.3;
      this.eye.material.color.setHex(0x2ed8ee);
      return false;
    }

    // ---- velocidad: persigue por tramos, no a ritmo constante ----
    //
    // A velocidad fija por encima de la del jugador no hay escape posible: te
    // alcanza siempre, y entonces la etapa no es un reto, es una cuenta atras.
    // El comportamiento que si funciona tiene tres piezas:
    //
    //   1. Crucero por DEBAJO del maximo del jugador. Corriendo limpio se le gana.
    //   2. Goma elastica: si se queda muy atras acelera, si se pega afloja. Asi
    //      nunca se pierde de vista ni te agarra por inercia.
    //   3. Embestidas al compas: cada pocos segundos pega un aceleron y luego
    //      frena. Son los "momentos de persecucion" — la tension sube y baja en
    //      vez de ser una linea plana.
    const gap = playerX - this.x;                 // >0 el jugador va delante
    const t = this.cruise * 0.35;

    let want = this.cruise;
    if (gap < -1.5) {
      // El jugador se le ha quedado ATRAS: lo ha esquivado. Da media vuelta y
      // vuelve a por el. Sin esto seguia de largo hacia la derecha para siempre y
      // la persecucion se acababa sola en cuanto lo rodeabas una vez.
      want = -this.cruise * 0.85;
    } else if (gap > this.leash) want = this.cruise + t * 1.4;  // se descuelga: acelera
    else if (gap > this.leash * 0.5) want = this.cruise + t * 0.6;
    else if (gap < 1.5) want = this.cruise - t * 1.1;           // encima: afloja

    // Embestida: dura ~1 compas de cada 3. `surgePhase` avanza con el reloj propio
    // para no depender de la musica, que en esta etapa no tiene loop.
    this.surgePhase = (this.surgePhase + dt / 2.16) % 3;
    // La embestida solo sirve para CERRAR distancia, nunca para agarrarte: si ya lo
    // tiene encima, no acelera. Sin esta condicion no existe ventana de escape —
    // te alcanza en mitad de un salto y no hay nada que el jugador pueda hacer.
    if (this.surgePhase < 1 && gap > 3.0) want += t * 0.9;

    // Aceleracion limitada: es lo que hace que se vea acelerar y frenar en vez de
    // teletransportarse entre velocidades.
    const accel = want > this.vx ? 3.2 : 5.0;     // frena mas rapido de lo que acelera
    this.vx += Math.max(-accel * dt, Math.min(accel * dt, want - this.vx));

    // El morro apunta hacia donde va: es como se lee que ha dado la vuelta.
    if (Math.abs(this.vx) > 0.3) this.facing = Math.sign(this.vx);

    this.x += this.vx * dt;

    // Estela: humo emitido POR DISTANCIA, igual que los pasos. Asi la densidad
    // sigue sola a la velocidad y el dron se lee como una maquina que resopla,
    // no como una esfera deslizandose.
    if (particles) {
      this._trail = (this._trail || 0) + Math.abs(this.x - prevX);
      while (this._trail >= 0.42) {
        this._trail -= 0.42;
        particles.airBurst(
          this.x - 0.55, this.y - 0.15, layerZ,
          0x9aa6c4, 2, 1.1
        );
      }
    }

    // Altura: vuela por encima del terreno, no lo atraviesa.
    //
    // Sondea el suelo un poco POR DELANTE de si mismo, no bajo sus pies: asi sube
    // antes de llegar al obstaculo, como haria un piloto. Sondear solo debajo hace
    // que se meta en la pared y salga por arriba de golpe.
    let clearance = this.hoverHeight;
    if (this.world) {
      const ahead = this.x + 1.8;
      const ground = Math.max(
        this.world.groundHeightAt(this.x, this.layer),
        this.world.groundHeightAt(ahead, this.layer)
      );
      clearance = ground + this.hoverHeight;
    }
    // Persigue la altura del jugador, pero nunca por debajo del terreno.
    const wanted = Math.max(clearance, playerY + this.hoverHeight * 0.75);
    // Sube rapido (no puede quedarse dentro de un tejado) y baja despacio.
    const rate = wanted > this.y ? 9.0 : 2.6;
    this.y += (wanted - this.y) * Math.min(1, dt * rate);

    // ---- cambio de capa: reaccion + maniobra ----
    if (this.pendingLayer !== null && this.pendingLayer !== this.layer) {
      this.reaction += dt;
      if (this.reaction >= this.reactionTime) {
        this.layer = this.pendingLayer;
        this.targetZ = this.pendingZ;
        this.pendingLayer = null;
        this.reaction = 0;
      }
    }
    // Interpola hacia SU capa, no hacia la del jugador: mientras no haya decidido
    // cruzar se queda donde estaba, que es justo lo que abre la ventana de escape.
    this.z += ((this.targetZ ?? layerZ) - this.z) * Math.min(1, dt * 2.2);
    // Distancia al plano del jugador: decide si puede capturar y si va maniobrando.
    const offLayer = Math.abs(this.z - layerZ);
    if (offLayer > 0.5) this.x -= this.vx * dt * 0.45;

    this.group.position.set(this.x, this.y + Math.sin(elapsed * 3.1) * 0.22, this.z);
    this.group.rotation.z = Math.sin(elapsed * 2.4) * 0.08;
    // Gira sobre si mismo para mirar en la direccion de marcha.
    const wantY = this.facing >= 0 ? 0 : Math.PI;
    this.group.rotation.y += (wantY - this.group.rotation.y) * Math.min(1, dt * 6);
    this.eye.material.color.setHex(
      Math.abs(playerX - this.x) < 3.0 ? 0xff3060 : 0xe62a9e
    );

    // Captura: hace falta estar cerca EN LAS TRES dimensiones. Antes solo se
    // miraban X e Y, asi que el dron te aspiraba desde la otra capa y cambiar de
    // plano no servia para nada.
    const dx = playerX - this.x;
    const dy = playerY + 0.7 - this.y;
    if (offLayer < 1.2 && Math.hypot(dx, dy) < this.captureRadius + 0.5) {
      this.captures += 1;
      return true;
    }
    return false;
  }

  /** Distancia del jugador al dron; negativa si el dron ya le paso. */
  gapTo(playerX) { return playerX - this.x; }
}
