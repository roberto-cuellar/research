/**
 * Particulas de superficie: polvo al correr, anillos al aterrizar, chispas.
 *
 * Un solo sistema con pool fijo y UN draw call (plan §8b.4). Nada se asigna en
 * runtime: todas las particulas existen desde el arranque y se reciclan.
 *
 * Se emiten POR DISTANCIA RECORRIDA, igual que los pasos, para que la cantidad siga
 * sola a la velocidad. Es el equivalente de `rateOverDistance` en Unity.
 *
 * El color y el comportamiento salen del atributo `surface` que trae la colision del
 * nivel, que es el mismo contrato que ya usan los pasos.
 */

import * as THREE from 'three';
import { SURFACE } from './p_physics.js';

/** Aspecto de cada superficie: color, tamano y cuanto flota. */
const LOOK = {
  [SURFACE.TIERRA]: { color: 0xc4a884, size: 0.22, rise: 0.5, life: 0.55 },
  [SURFACE.MADERA]: { color: 0xb98a5a, size: 0.18, rise: 0.4, life: 0.45 },
  [SURFACE.METAL]: { color: 0xffd9a0, size: 0.10, rise: 1.2, life: 0.32 },
  [SURFACE.TEJADO]: { color: 0xc98a78, size: 0.20, rise: 0.5, life: 0.50 },
  [SURFACE.HIERBA]: { color: 0x86c060, size: 0.16, rise: 0.7, life: 0.60 },
  [SURFACE.AGUA]: { color: 0x8fd0f0, size: 0.20, rise: 1.6, life: 0.45 },
};

const MAX = 480;

/**
 * Color de trabajo, reutilizado. Ver `_spawn`: crear un `THREE.Color` por particula
 * era la unica asignacion que quedaba en el bucle de emision.
 */
const _color = new THREE.Color();

/**
 * Aspectos derivados, calculados UNA vez.
 *
 * `airBurst`, `wallScrape` y `burst` construian su `look` con un literal o un spread
 * en cada llamada. `wallScrape` se llama mientras se resbala por una pared —o sea,
 * potencialmente cada frame— asi que era un objeto por frame para no cambiar nada
 * salvo dos numeros. Se precalculan aqui y el bucle deja de generar basura.
 */
const LOOK_AIR = {};
const LOOK_SCRAPE = {};
for (const [superficie, base] of Object.entries(LOOK)) {
  LOOK_AIR[superficie] = { ...base, life: base.life * 0.7, size: base.size * 1.15 };
  LOOK_SCRAPE[superficie] = { ...base, size: base.size * 0.75, life: base.life * 0.6 };
}

/** El de `burst` no depende de la superficie: sólo cambia el color, y se sobrescribe. */
const LOOK_BURST = { color: 0xffffff, size: 0.13, rise: 0, life: 0.5 };

/** Techo de velocidad del polvo de ambiente, en m/s. Ver las guardas de saneamiento. */
const MAX_DRIFT = 22;

/**
 * Paleta de fiesta para el polvo de ambiente.
 *
 * En la coda, el polvo suspendido HACE de confeti: es el mismo sistema, la misma
 * cuenta de particulas y el mismo draw call. Lo unico que cambia es el color — y
 * cambiarlo es lo que convierte "polvo flotando" en "confeti", sin añadir nada.
 */
const FIESTA = [
  [0.96, 0.62, 0.04],   // dorado
  [0.18, 0.85, 0.93],   // cian
  [0.90, 0.16, 0.62],   // rosa
  [0.49, 0.23, 0.93],   // violeta
  [1.00, 0.95, 0.80],   // crema, para que la mezcla respire
];

/**
 * Textura de respaldo, generada al vuelo.
 *
 * La buena viene del pack de particulas de Kenney (`particle_dust.png`); esta solo
 * existe para que el sistema funcione si el PNG no esta, sin romper nada.
 */
function makePuffTexture(size = 64) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0.0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Particles {
  constructor(scene, options = {}) {
    this.textureUrl = options.textureUrl || './public/textures/particle_dust.png';
    /**
     * CENITAL: el polvo de ambiente vive sobre un tablero en XZ, no en un plano XY.
     *
     * `updateAmbient` esta escrito para el nivel 1, que es de perfil: su `m.x`/`m.y` son
     * las dos de pantalla y `m.z` es la capa. El laberinto se mira desde arriba, asi que
     * sus dos ejes de tablero son X y Z del mundo y la vertical es Y. Sin esta bandera,
     * conectar el polvo al laberinto lo pintaba de canto — una cortina vertical en medio
     * del tablero en vez de una nube sobre el.
     *
     * Cambia UNICAMENTE como se vuelcan las tres coordenadas al buffer, al final de
     * `updateAmbient`. Toda la fisica (deriva, estela, turbulencia, reciclado) es la
     * misma, porque es 2D y no le importa como se llamen sus ejes.
     */
    this.cenital = !!options.cenital;
    this.geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(MAX * 3);
    this.colors = new Float32Array(MAX * 3);
    this.sizes = new Float32Array(MAX);
    this.alphas = new Float32Array(MAX);

    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));

    // Shader minimo: puntos con tamano por particula y atenuacion por distancia.
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        // Arranca con la de respaldo y se sustituye por la de Kenney al cargar.
        uMap: { value: makePuffTexture() },
        // Escala de proyeccion: altura del viewport / (2 * tan(fov/2)). Con una
        // constante arbitraria las particulas salen minusculas o gigantes segun la
        // camara; asi el tamano en metros es el que se pide de verdad.
        uScale: { value: 1000 },
      },
      vertexShader: /* glsl */`
        attribute float aSize;
        attribute float aAlpha;
        uniform float uScale;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = color;
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(-mv.z, 0.001);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec4 t = texture2D(uMap, gl_PointCoord);
          if (t.a * vAlpha < 0.01) discard;
          gl_FragColor = vec4(vColor, t.a * vAlpha);
        }`,
      transparent: true,
      depthWrite: false,
      vertexColors: true,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);

    // Estado por particula, fuera de los atributos.
    this.pool = Array.from({ length: MAX }, () => ({
      life: 0, maxLife: 1, vx: 0, vy: 0, size: 0,
    }));
    this.cursor = 0;
    this._travel = 0;
    this.emitDistance = 0.55;   // metros entre nubecillas al correr

    new THREE.TextureLoader().load(this.textureUrl, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      this.material.uniforms.uMap.value = tex;
    });

    // Motas de ambiente: reservadas al final del pool para que las de gameplay
    // nunca las pisen al reciclar.
    this.ambientCount = 0;
    this._ambient = [];
  }

  /**
   * Ajusta el area del polvo al encuadre REAL de la camara, con un 25 % de margen
   * para que el reciclado ocurra fuera de pantalla. Sin esto el area era un valor
   * fijo que no cubria el ancho visible y el polvo se veia solo en una franja.
   */
  fitTo(camera, distance) {
    const h = 2 * distance * Math.tan((camera.fov * Math.PI) / 360);
    // Se muta en sitio: crear un objeto nuevo aqui son 60 asignaciones por segundo
    // que el recolector tiene que barrer para nada.
    this.area.w = h * camera.aspect * 1.25;
    this.area.h = h * 1.25;
  }

  /**
   * Modo fiesta del polvo de ambiente: 0 polvo, 1 confeti.
   *
   * Se pasa el objetivo y se interpola aqui, no de golpe: el cambio brusco de color
   * de doscientas motas a la vez se ve como un parpadeo de pantalla.
   */
  setFiesta(target, dt = 0.016) {
    this._fiesta += ((target ? 1 : 0) - this._fiesta) * Math.min(1, dt * 3.5);
  }

  /** Velocidad horizontal del personaje: decide el sentido y la fuerza del giro. */
  setFieldSpeed(vx) { this._fieldSpeed = vx; }

  /**
   * Polvo suspendido en el aire.
   *
   * No es decoracion pasiva: las motas responden al CAMPO del personaje — se
   * congregan a su alrededor y giran en el sentido en que se mueve. Es lo que hace
   * que el mundo se sienta con volumen en vez de un telon, y cuesta lo mismo que
   * tenerlas quietas.
   */
  enableAmbient(count = 70, area = { w: 34, h: 12 }) {
    this.ambientCount = Math.min(count, MAX - 40);
    this.area = area;
    this._fieldSpeed = 0;
    this._fiesta = 0;
    this._ambient = Array.from({ length: this.ambientCount }, () => ({
      x: 0, y: 0, z: 0, vx: 0, vy: 0, phase: Math.random() * Math.PI * 2,
      size: 0.05 + Math.random() * 0.07,
      // Color de fiesta FIJO por mota: si se sorteara cada frame, el confeti
      // parpadearia como una guirnalda rota en vez de flotar.
      fiesta: FIESTA[Math.floor(Math.random() * FIESTA.length)],
      seeded: false,
    }));
    // Ocupan el final del pool; el cursor de gameplay nunca llega ahi.
    this._gameplayMax = MAX - this.ambientCount;
  }

  /**
   * Empuja el polvo SUSPENDIDO desde un punto: es la onda de choque hecha visible.
   *
   * Solo afecta a las motas de ambiente, no a las de salto o aterrizaje: esas ya
   * tienen su propio impulso y volverian a barrerse. Asi el shockwave deja de ser un
   * efecto de pantalla y pasa a tener consecuencias en el mundo.
   */
  shockwaveAmbient(x, y, strength = 1) {
    if (!this.ambientCount) return;
    for (const m of this._ambient) {
      if (!m.seeded) continue;
      const dx = m.x - x;
      const dy = m.y - y;
      const dist = Math.hypot(dx, dy);
      if (dist > 14 || dist < 1e-4) continue;
      // Cae con la distancia, pero sin anularse: la onda barre toda la pantalla.
      const push = (1 - dist / 14) * 16 * strength;
      m.vx += (dx / dist) * push;
      m.vy += (dy / dist) * push * 0.7;
    }
  }

  updateAmbient(dt, centerX, centerY, playerX, playerY, layerZ) {
    if (!this.ambientCount) return;
    const base = this._gameplayMax;
    const { w, h } = this.area;

    for (let n = 0; n < this.ambientCount; n += 1) {
      const m = this._ambient[n];
      const i = base + n;

      if (!m.seeded) {
        m.x = centerX + (Math.random() - 0.5) * w;
        m.y = centerY + (Math.random() - 0.5) * h;
        m.z = layerZ + (Math.random() - 0.5) * 3.0;
        m.seeded = true;
      }

      // Deriva lenta y ondulante.
      m.phase += dt * 0.6;
      m.x += (Math.sin(m.phase) * 0.12 + m.vx) * dt;
      m.y += (Math.cos(m.phase * 0.7) * 0.09 + m.vy) * dt;

      // ---- estela del personaje ----
      // No es un iman ni una orbita: es alguien cruzando corriendo un aire con
      // polvo. Perturba la corriente. Por eso TODO va multiplicado por su
      // velocidad — parado no mueve nada, y es al correr cuando se nota.
      const dx = m.x - playerX;
      const dy = m.y - (playerY + 0.8);
      const dist = Math.hypot(dx, dy);
      const spd = Math.abs(this._fieldSpeed);
      const dir = this._fieldSpeed >= 0 ? 1 : -1;
      const R = 3.4;

      if (dist < R && dist > 1e-4 && spd > 0.25) {
        const falloff = 1 - dist / R;
        const nx = dx / dist;
        const ny = dy / dist;
        // Proyeccion sobre la marcha: >0 esta delante, <0 se quedo detras.
        const ahead = (dx * dir) / dist;

        // 1. Onda de proa: lo que tiene delante se aparta de su paso.
        const push = falloff * spd * 1.5;
        m.vx += nx * push * dt;
        m.vy += ny * push * 0.8 * dt;

        // 2. Arrastre: lo que deja atras se lo lleva la estela. Es el efecto
        //    principal, y por eso pesa cinco veces mas detras que delante.
        const wake = falloff * spd * (ahead < 0 ? 2.8 : 0.55);
        m.vx += dir * wake * dt;
        m.vy += falloff * spd * 0.5 * dt;      // el polvo se levanta un poco

        // 3. Turbulencia: una estela no es limpia, se riza. Sin esto el polvo se
        //    mueve en bloque y se ve artificial.
        const curl = falloff * spd * 2.0;
        m.vy += Math.sin(m.phase * 3.1 + m.x * 0.9) * curl * dt;
        m.vx += Math.cos(m.phase * 2.3 + m.y * 1.1) * curl * 0.45 * dt;

        // 4. Remolino residual: queda la mecanica de giro, pero discreta y solo
        //    como rizo de la estela, no como orbita.
        const spin = falloff * spd * 0.6 * dir;
        m.vx += -ny * spin * dt;
        m.vy += nx * spin * dt;
      }
      m.vx *= 1 - dt * 1.4;   // el aire vuelve a la calma
      m.vy *= 1 - dt * 1.4;

      // --- guardas de saneamiento ---
      // El pool es fijo y no asigna nada en runtime, asi que no puede crecer. Lo que
      // SI puede degenerar es el estado de una mota: una onda de choque le mete
      // velocidad de golpe y, como el reciclado solo la teletransporta sin frenarla,
      // se quedaria cruzando la pantalla a toda velocidad para siempre.
      m.vx = Math.max(-MAX_DRIFT, Math.min(MAX_DRIFT, m.vx));
      m.vy = Math.max(-MAX_DRIFT, Math.min(MAX_DRIFT, m.vy));

      // Y si algo se va a NaN o a una posicion absurda, se resiembra en vez de
      // arrastrar el error el resto de la partida.
      if (!Number.isFinite(m.x) || !Number.isFinite(m.y) ||
          Math.abs(m.x - centerX) > w * 4 || Math.abs(m.y - centerY) > h * 4) {
        m.seeded = false;
        m.vx = 0;
        m.vy = 0;
      }

      // Reciclado: si se aleja del encuadre, vuelve a entrar por el otro lado.
      //
      // Al reentrar pierde casi todo el impulso — si no, volveria a salirse en el
      // frame siguiente y se veria parpadear de un lado a otro.
      //
      // Y se ALEATORIZA el otro eje. Es lo que evita el grumo: cuando una onda de
      // choque empuja cincuenta motas a la vez, todas cruzan el borde en el mismo
      // instante y, sin esto, reaparecen sobre la misma linea formando una nube
      // compacta que se ve como un manchon de tierra flotando fuera de sitio.
      if (Math.abs(m.x - centerX) > w * 0.5) {
        m.x = centerX - Math.sign(m.x - centerX) * w * 0.5;
        m.y = centerY + (Math.random() - 0.5) * h;
        m.vx *= 0.1;
        m.vy *= 0.1;
      }
      if (Math.abs(m.y - centerY) > h * 0.5) {
        m.y = centerY - Math.sign(m.y - centerY) * h * 0.5;
        m.x = centerX + (Math.random() - 0.5) * w;
        m.vx *= 0.1;
        m.vy *= 0.1;
      }

      // En cenital, `m.z` guarda la ALTURA sobre el tablero y `m.y` es la profundidad
      // (la Z del mundo). Ver la bandera `cenital` en el constructor.
      this.positions[i * 3] = m.x;
      this.positions[i * 3 + 1] = this.cenital ? m.z : m.y;
      this.positions[i * 3 + 2] = this.cenital ? m.y : m.z;
      // Del polvo al confeti, interpolado: la fiesta entra y sale sin cortar.
      const f = this._fiesta;
      this.colors[i * 3]     = 0.86 + (m.fiesta[0] - 0.86) * f;
      this.colors[i * 3 + 1] = 0.88 + (m.fiesta[1] - 0.88) * f;
      this.colors[i * 3 + 2] = 1.00 + (m.fiesta[2] - 1.00) * f;
      // Y de paso engordan y se encienden: el confeti es mas grande que el polvo.
      this.sizes[i] = m.size * (1 + f * 1.4);
      // Se atenuan al alejarse del centro: entran y salen sin aparecer de golpe.
      const fade = 1 - Math.abs(m.x - centerX) / (w * 0.5);
      this.alphas[i] = (0.28 + f * 0.5) * Math.max(0, fade);
      this.pool[i].life = 0;   // el sistema de gameplay las ignora
    }
  }

  /**
   * Golpe de impulso del doble salto.
   *
   * Sin esto el doble salto se ve flotado: el personaje sube sin nada de que
   * empujarse. El polvo sale HACIA ABAJO y en corona, como si pisara aire.
   */
  airBurst(x, y, z, surface) {
    const look = LOOK_AIR[surface] || LOOK_AIR[SURFACE.TIERRA];
    for (let i = 0; i < 14; i += 1) {
      const a = Math.PI + (i / 13) * Math.PI;   // media corona, hacia abajo
      this._spawn(x, y + 0.12, z, look, {
        vx: Math.cos(a) * (1.6 + Math.random() * 1.4),
        vy: Math.sin(a) * (1.4 + Math.random() * 1.2),
        scale: 1.1,
      });
    }
  }

  _spawn(x, y, z, look, options = {}) {
    const limit = this._gameplayMax || MAX;
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % limit;

    const p = this.pool[i];
    p.maxLife = look.life * (0.75 + Math.random() * 0.5);
    p.life = p.maxLife;
    p.vx = (options.vx ?? 0) + (Math.random() - 0.5) * 0.9;
    p.vy = (options.vy ?? look.rise) * (0.6 + Math.random() * 0.8);
    p.size = look.size * (0.7 + Math.random() * 0.6) * (options.scale ?? 1);

    this.positions[i * 3] = x + (Math.random() - 0.5) * (options.spread ?? 0.18);
    this.positions[i * 3 + 1] = y + Math.random() * 0.08;
    this.positions[i * 3 + 2] = z;

    // `new THREE.Color(...)` en cada particula era una asignacion POR PARTICULA en el
    // bucle, y la cabecera de este archivo promete justo lo contrario: "nada se asigna
    // en runtime". Corriendo se emiten 3 nubecillas por paso, mas los aterrizajes, los
    // estallidos y el roce de pared: son cientos de objetos por segundo que sólo
    // existen para leerles tres numeros, y todos acaban en el recolector. Un color de
    // trabajo reutilizado hace exactamente lo mismo sin asignar nada — `setHex`
    // conserva la conversion de espacio de color, que es la razon de usar THREE.Color
    // y no desmontar el hexadecimal a mano.
    _color.setHex(look.color);
    this.colors[i * 3] = _color.r;
    this.colors[i * 3 + 1] = _color.g;
    this.colors[i * 3 + 2] = _color.b;
  }

  /**
   * CHAPOTEO. Gotas, no polvo.
   *
   * La diferencia con `land()` no es el color: es la forma. El polvo sale en anillo
   * hacia los lados y se queda flotando; el agua sale hacia ARRIBA en un cono
   * estrecho, sube deprisa y vuelve a caer. Es lo que separa "una nube azul" de "ha
   * caido algo al agua".
   *
   * Reutiliza el pool de siempre: mismo draw call, misma cuenta de particulas, cero
   * asignaciones. Lo unico propio es la forma en que salen.
   *
   * @param {number} fuerza 0..1 — de una pisada a un chorro del robot
   */
  salpicadura(x, y, z, fuerza = 1) {
    const base = LOOK[SURFACE.AGUA];
    const n = Math.round(4 + fuerza * 16);
    for (let i = 0; i < n; i += 1) {
      // Cono estrecho alrededor de la vertical: +-35 grados. Mas abierto se lee como
      // una explosion; mas cerrado, como un surtidor.
      const a = Math.PI / 2 + (Math.random() - 0.5) * 1.22;
      const v = (2.2 + Math.random() * 3.4) * (0.55 + fuerza * 0.75);
      this._spawn(x, y, z, base, {
        vx: Math.cos(a) * v * 0.55,
        vy: Math.sin(a) * v,
        // Gotas pequeñas y desiguales: unas cuantas gordas y muchas finas es lo que
        // hace que se lea como agua y no como una nube uniforme.
        scale: 0.45 + Math.random() * Math.random() * 1.3,
        spread: 0.10 + fuerza * 0.25,
      });
    }
  }

  /**
   * Nubecilla de paso. Se llama con la distancia recorrida en el frame.
   *
   * @param {number} [canal] quien anda. UN ACUMULADOR POR PERSONAJE.
   *
   * El acumulador era uno solo, y con un unico caminante bastaba. En el laberinto andan
   * DOS —el jugador y el rival— y compartirlo los mezcla: el que cruza el umbral emite
   * en SU sitio con la distancia sumada de los dos, asi que el polvo aparece a saltos y
   * en el personaje equivocado. Cada canal lleva su cuenta.
   *
   * Se indexa un array reservado y no un objeto por nombre: esto corre en el bucle.
   */
  footstep(distance, grounded, surface, x, y, z, speed, canal = 0) {
    if (!this._travelCanal) this._travelCanal = new Float32Array(4);
    const c = canal % this._travelCanal.length;
    if (!grounded || !surface) { this._travelCanal[c] = 0; return; }
    this._travelCanal[c] += Math.abs(distance);
    if (this._travelCanal[c] < this.emitDistance) return;
    this._travelCanal[c] = 0;

    const look = LOOK[surface] || LOOK[SURFACE.TIERRA];
    // Al correr se levanta mas polvo, y sale hacia atras.
    const n = Math.abs(speed) > 4.2 ? 3 : 1;
    for (let i = 0; i < n; i += 1) {
      this._spawn(x, y, z, look, { vx: -Math.sign(speed) * (0.6 + Math.random()), scale: 0.9 });
    }
  }

  /** Anillo de aterrizaje: sale hacia los lados, no hacia arriba. */
  land(x, y, z, surface, hard) {
    const look = LOOK[surface] || LOOK[SURFACE.TIERRA];
    const n = hard ? 16 : 7;
    for (let i = 0; i < n; i += 1) {
      const side = i % 2 === 0 ? 1 : -1;
      this._spawn(x, y, z, look, {
        vx: side * (1.2 + Math.random() * 2.2) * (hard ? 1.5 : 1),
        vy: 0.25 + Math.random() * 0.5,
        scale: hard ? 1.5 : 1,
      });
    }
  }

  /**
   * Roce contra pared: sale del punto de contacto y hacia AFUERA, no hacia arriba.
   * @param {number} side -1 pared a la izquierda, 1 a la derecha
   */
  wallScrape(x, y, z, side, surface) {
    const look = LOOK_SCRAPE[surface] || LOOK_SCRAPE[SURFACE.METAL];
    for (let i = 0; i < 3; i += 1) {
      this._spawn(x, y - Math.random() * 0.5, z, look, {
        vx: -side * (0.5 + Math.random() * 1.1),
        vy: -0.4 - Math.random() * 0.8,      // el polvo cae, no sube
        scale: 0.85,
      });
    }
  }

  /** Estallido puntual, para portales y recogidas. */
  burst(x, y, z, color, count = 12, power = 2.0) {
    const look = LOOK_BURST;
    look.color = color;          // se reutiliza: `_spawn` lo lee y no lo guarda
    for (let i = 0; i < count; i += 1) {
      const a = (i / count) * Math.PI * 2;
      this._spawn(x, y, z, look, {
        vx: Math.cos(a) * power, vy: Math.sin(a) * power, scale: 1,
      });
    }
  }

  update(dt) {
    const limit = this._gameplayMax || MAX;
    for (let i = 0; i < limit; i += 1) {
      const p = this.pool[i];
      if (p.life <= 0) { this.alphas[i] = 0; continue; }

      p.life -= dt;
      const k = Math.max(0, p.life / p.maxLife);

      this.positions[i * 3] += p.vx * dt;
      this.positions[i * 3 + 1] += p.vy * dt;
      p.vy -= 1.6 * dt;          // gravedad suave: el polvo cae
      p.vx *= 1 - dt * 2.2;      // y se frena con el aire

      this.sizes[i] = p.size * (1.5 - k * 0.5);   // se expande al desvanecerse
      this.alphas[i] = k * k;
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
    this.geometry.attributes.aAlpha.needsUpdate = true;
  }

  /** Se llama al arrancar y en cada resize: el tamano depende de camara y viewport. */
  setProjection(viewportHeight, fovDegrees) {
    const halfFov = (fovDegrees * Math.PI) / 360;
    this.material.uniforms.uScale.value = viewportHeight / (2 * Math.tan(halfFov));
  }

  get alive() { return this.pool.reduce((n, p) => n + (p.life > 0 ? 1 : 0), 0); }
}

/**
 * VIENTO — partículas extruidas.
 *
 * Una mota de polvo no dice velocidad: dice que hay polvo. Lo que dice velocidad es
 * una mota **estirada en el sentido en que se mueve**, que es como se dibuja el viento
 * en animación desde siempre y como funciona una foto con obturación lenta.
 *
 * ## Por qué segmentos y no puntos
 *
 * El sistema de arriba dibuja `Points`, y un punto de WebGL es un cuadrado alineado a
 * la pantalla: **no se puede estirar**. Ni rotar. Para extruir una partícula hacen
 * falta dos vértices, así que esto es un `LineSegments` aparte — un solo draw call
 * más, sin texturas, sin depth write y sin geometría por partícula.
 *
 * ## Por qué es tan barato
 *
 * No hay estado por partícula más allá de su posición y un multiplicador de velocidad
 * propio. No hay vida, ni muerte, ni reciclado por eventos: las estelas viajan con la
 * cámara y **se envuelven por módulo** al salir de la caja, exactamente el mismo truco
 * que las bandas de atmósfera del parallax. Cero asignaciones en el bucle, un
 * `Float32Array` fijo, y con `fuerza` a 0 el objeto se apaga entero y ni siquiera se
 * recorre.
 *
 * ## Dónde se usa
 *
 * En los tejados (`stages[].viento`) y en la caída, donde es lo único que comunica que
 * se está cayendo aparte del fondo. La dirección es libre: horizontal en los tejados,
 * vertical en la caída.
 */
export class Viento {
  /**
   * @param {THREE.Scene} scene
   * @param {number} count número de estelas. 90 llena el encuadre sin cargarlo
   */
  constructor(scene, count = 90, caja = null) {
    this.count = count;
    this.fuerza = 0;
    this.objetivo = 0;
    this.dirX = -1;
    this.dirY = 0;
    /**
     * Caja donde viven las estelas, en metros.
     *
     * Se puede pasar por constructor desde la spec 038: en el laberinto la vista es
     * CENITAL, asi que el aire tiene que barrer un rectangulo ancho y PLANO en vez de
     * la ventana vertical de un platformer. Con la caja por defecto (26 m de alto) las
     * estelas salian flotando muy por encima del tablero.
     */
    this.caja = caja || { w: 46, h: 26, z: 14 };
    // Azul frío por defecto: es aire, no polvo. `set()` lo cambia por tramo.
    this.tinteR = 0.75; this.tinteG = 0.85; this.tinteB = 1.0;

    this.positions = new Float32Array(count * 2 * 3);
    this.colors = new Float32Array(count * 2 * 3);

    // Semilla: la posición de cada estela dentro de la caja, y su velocidad propia.
    // Sin la variación por estela, las noventa se mueven en bloque y se lee como una
    // rejilla desplazándose, no como aire.
    this.semilla = new Float32Array(count * 4);   // x, y, z, velocidad
    for (let i = 0; i < count; i += 1) {
      this.semilla[i * 4] = (Math.random() - 0.5) * this.caja.w;
      this.semilla[i * 4 + 1] = (Math.random() - 0.5) * this.caja.h;
      this.semilla[i * 4 + 2] = (Math.random() - 0.5) * this.caja.z;
      this.semilla[i * 4 + 3] = 0.55 + Math.random() * 0.9;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));

    this.material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      // Aditivo: el desvanecido se hace bajando el color a negro, así que la cola de
      // cada estela se apaga sola sin necesitar un canal alfa por vértice.
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });

    this.mesh = new THREE.LineSegments(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /**
   * Cuánto sopla y hacia dónde. Se interpola en `update`: un viento que aparece de
   * golpe se lee como un fallo de render.
   *
   * @param {number} fuerza 0 nada · 1 vendaval
   * @param {number} [dirX] sentido horizontal. Negativo = hacia atrás del corredor
   * @param {number} [dirY] sentido vertical. Positivo = sube, que es lo que se ve al caer
   * @param {number} [tinte] color de la estela
   */
  set(fuerza, dirX = -1, dirY = 0, tinte = 0xbfd8ff) {
    this.objetivo = Math.max(0, Math.min(1, fuerza));
    const largo = Math.hypot(dirX, dirY) || 1;
    this.dirX = dirX / largo;
    this.dirY = dirY / largo;
    _color.setHex(tinte);
    this.tinteR = _color.r;
    this.tinteG = _color.g;
    this.tinteB = _color.b;
  }

  update(dt, camX, camY, camZ = 0) {
    this.fuerza += (this.objetivo - this.fuerza) * Math.min(1, dt * 2.4);
    // Apagado del todo: ni se recorre el bucle. Es lo que hace que el efecto sea
    // gratis en los seis tramos que no lo usan.
    if (this.fuerza < 0.004) { this.mesh.visible = false; return; }
    this.mesh.visible = true;

    const { w, h } = this.caja;
    const avance = 26 * this.fuerza * dt;      // m/s a plena fuerza
    // La estela mide lo que recorrería en ~1/8 de segundo: es la relación que hace
    // que se lea como velocidad y no como una raya pintada.
    const largoBase = 3.2 * this.fuerza;

    for (let i = 0; i < this.count; i += 1) {
      const s = i * 4;
      const propia = this.semilla[s + 3];

      // Avanza en su semilla, no en el mundo: así la caja viaja con la cámara sin que
      // haya que reposicionar nada al moverse el jugador.
      let x = this.semilla[s] + this.dirX * avance * propia;
      let y = this.semilla[s + 1] + this.dirY * avance * propia;

      // Envoltura por módulo, igual que las bandas de atmósfera.
      if (x < -w / 2) x += w; else if (x > w / 2) x -= w;
      if (y < -h / 2) y += h; else if (y > h / 2) y -= h;
      this.semilla[s] = x;
      this.semilla[s + 1] = y;

      const largo = largoBase * propia;
      const v = i * 6;
      // Cabeza
      this.positions[v] = camX + x;
      this.positions[v + 1] = camY + y;
      this.positions[v + 2] = camZ + this.semilla[s + 2];
      // Cola, hacia atrás del movimiento
      this.positions[v + 3] = camX + x - this.dirX * largo;
      this.positions[v + 4] = camY + y - this.dirY * largo;
      this.positions[v + 5] = camZ + this.semilla[s + 2];

      // La cabeza brilla y la cola se apaga: es el degradado lo que da el sentido de
      // marcha. Con las dos puntas iguales se ve una raya y no se sabe hacia dónde va.
      const brillo = this.fuerza * (0.35 + propia * 0.5);
      this.colors[v] = this.tinteR * brillo;
      this.colors[v + 1] = this.tinteG * brillo;
      this.colors[v + 2] = this.tinteB * brillo;
      this.colors[v + 3] = 0;
      this.colors[v + 4] = 0;
      this.colors[v + 5] = 0;
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
  }
}
