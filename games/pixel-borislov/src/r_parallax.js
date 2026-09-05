/**
 * PARALLAX del laberinto: capas de profundidad delante y detras del tablero.
 *
 * Son planos de motas que derivan a velocidades distintas segun lo lejos que esten. El
 * ojo lee esa diferencia de velocidad como distancia — es el mismo truco que un fondo de
 * scroll de toda la vida, y es lo unico que da profundidad a un vacio negro.
 *
 * ---- por que el parallax de aqui no puede ser el del nivel 1 ----
 *
 * En un platformer la camara VIAJA, asi que basta con mover cada capa una fraccion de lo
 * que se mueve la camara y el efecto sale solo. Aqui la camara ENCUADRA el tablero y se
 * queda quieta todo el reto (`encuadrar()` la coloca una vez), asi que ese mecanismo no
 * produce nada: sin movimiento de camara no hay diferencia que leer.
 *
 * Por eso las capas se mueven SOLAS, a velocidad propia y constante. La profundidad ya no
 * sale de cuanto se desplazan respecto a la camara sino de cuanto se desplazan entre
 * ellas, que es la misma senal por otro camino.
 *
 * ---- y por que hay una capa DELANTE ----
 *
 * Una capa por delante del tablero es lo que convierte un fondo en un espacio: dice que
 * la accion ocurre DENTRO de algo, no contra un telon. Va muy tenue y muy rapida —lo que
 * pasa cerca cruza el encuadre en un momento— y sin tapar nada que haya que leer.
 *
 * ---- coste ----
 *
 * Un `Points` por capa, con la posicion resuelta en el VERTEX SHADER a partir de un
 * tiempo y una semilla por mota. La CPU no toca un solo vertice por frame: escribe un
 * uniform. Son 3 draw calls y cero asignacion en el bucle, que es lo que exige el
 * presupuesto del GDD §10.12.
 */

import * as THREE from 'three';

/**
 * LAS CAPAS. Es CONTENIDO: se edita esta tabla y nada mas.
 *
 * `z` es la altura respecto al plano del tablero (y=0), en metros. Negativa = por debajo
 * y por tanto detras; positiva = por encima, entre la camara y el tablero.
 *
 * `velocidad` y `z` van de la mano y en el mismo sentido, que es la regla del parallax:
 * lo que esta cerca se mueve mas. Romper esa relacion no da un efecto raro, da un efecto
 * NULO — el cerebro deja de leer profundidad y solo ve puntos moviendose.
 */
const CAPAS = Object.freeze([
  /** El fondo del todo: motas grandes, lentisimas, apenas visibles. Es la lejania. */
  { z: -26, motas: 90, tam: 0.85, velocidad: 0.55, alfa: 0.34, deriva: 0.18 },
  /** Capa media: la que de verdad se lee como "hay espacio ahi detras". */
  { z: -13, motas: 70, tam: 0.55, velocidad: 1.30, alfa: 0.46, deriva: -0.30 },
  /**
   * Capa DELANTERA, por encima del tablero. Pocas motas, muy tenues y rapidas.
   *
   * 26 y no mas: por delante de la accion, cualquier cosa que se pueda contar distrae.
   * Tiene que notarse sin llegar a mirarse.
   */
  { z: 9, motas: 26, tam: 1.15, velocidad: 3.10, alfa: 0.20, deriva: 0.62 },
]);

/** Ancho y alto del campo de cada capa, en metros. Cubre el encuadre mas holgado. */
const CAMPO = { w: 120, h: 120 };

const VERTEX = /* glsl */`
  attribute float aSemilla;
  attribute float aTam;
  uniform float uTiempo;
  uniform float uVelocidad;
  uniform float uDeriva;
  uniform float uCampoW;
  uniform float uCampoH;
  uniform float uEscala;
  varying float vFade;

  void main() {
    vec3 p = position;

    /**
     * El desplazamiento se resuelve AQUI, no en la CPU.
     *
     * La mota viaja en X y deriva en Z, y al salir por un lado reaparece por el otro con
     * mod(). Hacerlo en el shader es lo que permite que no haya un solo bucle por frame
     * en JavaScript: la unica escritura es el uniform del tiempo.
     */
    p.x = mod(p.x + uTiempo * uVelocidad + uCampoW * 0.5, uCampoW) - uCampoW * 0.5;
    p.z = mod(p.z + uTiempo * uDeriva + uCampoH * 0.5, uCampoH) - uCampoH * 0.5;

    // Latido lento y desfasado por mota: sin el, un campo de puntos identicos se lee
    // como una textura, no como polvo suspendido.
    vFade = 0.45 + 0.55 * sin(uTiempo * 0.7 + aSemilla * 6.2831);

    /**
     * Se DESVANECEN EN EL BORDE del campo.
     *
     * Sin esto se ve el instante en que la mota salta de un lado al otro, y una mota que
     * aparece de la nada delata el truco entero. Es la unica parte del efecto que no es
     * opcional.
     */
    vec2 d = abs(p.xz) / vec2(uCampoW * 0.5, uCampoH * 0.5);
    vFade *= (1.0 - smoothstep(0.72, 1.0, max(d.x, d.y)));

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    // Tamano en perspectiva: lo que esta lejos se ve pequeno, como cualquier otra cosa.
    gl_PointSize = aTam * uEscala / max(0.001, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */`
  uniform vec3 uColor;
  uniform float uAlfa;
  varying float vFade;

  void main() {
    // Disco con el borde suave. Un cuadrado se nota en cuanto la mota crece en pantalla.
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float a = (1.0 - smoothstep(0.12, 0.5, d)) * uAlfa * vFade;
    if (a < 0.002) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

export class Parallax {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this.scene = scene;
    this.grupo = new THREE.Group();
    /**
     * Ni proyecta ni recibe sombra, y no entra en el calculo de bounding.
     *
     * `frustumCulled` a false porque las motas se mueven en el SHADER: la caja que Three
     * calcula es la de las posiciones originales, asi que en cuanto una capa deriva lo
     * suficiente Three la daria por fuera del encuadre y dejaria de dibujarla entera.
     */
    this.grupo.frustumCulled = false;
    scene.add(this.grupo);

    this._t = 0;
    this.capas = CAPAS.map((cfg) => this._crearCapa(cfg));
  }

  _crearCapa(cfg) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(cfg.motas * 3);
    const semillas = new Float32Array(cfg.motas);
    const tams = new Float32Array(cfg.motas);

    for (let i = 0; i < cfg.motas; i += 1) {
      pos[i * 3] = (Math.random() - 0.5) * CAMPO.w;
      pos[i * 3 + 1] = cfg.z + (Math.random() - 0.5) * 6;
      pos[i * 3 + 2] = (Math.random() - 0.5) * CAMPO.h;
      semillas[i] = Math.random();
      // Reparto de tamanos dentro de la capa: todas iguales se lee como una rejilla.
      tams[i] = cfg.tam * (0.55 + Math.random() * 0.9);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSemilla', new THREE.BufferAttribute(semillas, 1));
    geo.setAttribute('aTam', new THREE.BufferAttribute(tams, 1));

    const uniforms = {
      uTiempo: { value: 0 },
      uVelocidad: { value: cfg.velocidad },
      uDeriva: { value: cfg.deriva },
      uCampoW: { value: CAMPO.w },
      uCampoH: { value: CAMPO.h },
      uEscala: { value: 320 },
      uColor: { value: new THREE.Color(0x8fb4ff) },
      uAlfa: { value: cfg.alfa },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      /**
       * ADITIVO y sin escribir profundidad: es luz suspendida, no objetos.
       *
       * `depthTest` se queda ENCENDIDO para que el tablero tape las capas de detras — sin
       * el, las motas del fondo se verian a traves del suelo y el efecto se convertiria
       * en ruido por encima de todo. Lo que se apaga es `depthWrite`, para que las motas
       * no se tapen entre ellas: son translucidas y el orden entre ellas no importa.
       */
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
    });

    const puntos = new THREE.Points(geo, mat);
    puntos.frustumCulled = false;
    puntos.renderOrder = cfg.z < 0 ? -20 : 20;
    this.grupo.add(puntos);
    return { cfg, puntos, uniforms };
  }

  /**
   * Centra las capas en el tablero y ajusta el tamano de mota a la distancia de camara.
   *
   * Se llama en `encuadrar()`, una vez por reto. El tamano depende de la distancia porque
   * `gl_PointSize` se divide por la profundidad: sin corregirlo, un reto grande —que
   * aleja la camara— tendria las motas cuatro veces mas pequenas que uno chico.
   *
   * @param {number} cx  centro del tablero
   * @param {number} cy
   * @param {number} dist distancia de la camara al centro
   */
  encajar(cx, cy, dist) {
    this.grupo.position.set(cx, 0, cy);
    const escala = Math.max(120, dist * 8);
    for (const capa of this.capas) capa.uniforms.uEscala.value = escala;
  }

  /**
   * Tinte de las capas: el del nivel. Se llama al montar el reto.
   *
   * @param {number} hex
   */
  setTinte(hex) {
    if (hex === undefined || hex === null) return;
    for (const capa of this.capas) capa.uniforms.uColor.value.setHex(hex);
  }

  /** Enciende o apaga el efecto entero sin tocar la escena. */
  setVisible(v) { this.grupo.visible = v; }

  /**
   * @param {number} dt segundos
   */
  update(dt) {
    if (!this.grupo.visible) return;
    this._t += dt;
    for (const capa of this.capas) capa.uniforms.uTiempo.value = this._t;
  }

  dispose() {
    for (const capa of this.capas) {
      capa.puntos.geometry.dispose();
      capa.puntos.material.dispose();
    }
    this.scene.remove(this.grupo);
  }
}
