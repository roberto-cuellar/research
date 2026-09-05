/**
 * Post-procesado reactivo.
 *
 * Replica la capa de post-proceso de Unity (Volume de URP con 9 presets por momento)
 * usando los pases que ya trae three.js: sin dependencias nuevas.
 *
 *   Unity                 ->  aqui
 *   Bloom                 ->  UnrealBloomPass
 *   FilmGrain             ->  FilmPass
 *   LensDistortion        ->  incluido en el pase de shockwave (mismo shader)
 *   MotionBlur            ->  NO existe en three.js; se sustituye por estela de camara
 *
 * El shockwave es el port directo de tu ShockwaveShader.shadergraph: distancia radial
 * al centro, onda seno, y desplazamiento de UV a lo largo del radio. Mismos parametros.
 */

import * as THREE from 'three';
import { EffectComposer } from '../vendor/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/postprocessing/RenderPass.js';
import { ShaderPass } from '../vendor/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from '../vendor/postprocessing/UnrealBloomPass.js';
import { FilmPass } from '../vendor/postprocessing/FilmPass.js';
import { OutputPass } from '../vendor/postprocessing/OutputPass.js';

/**
 * Onda expansiva + distorsion de lente en un solo pase.
 * Equivalencias con tu Shader Graph: _Center->uCenter, _MaxDistance->uMaxRadius,
 * _Frequency->uFrequency, _Amplitude->uAmplitude, _WaveTime->uProgress.
 */
const ShockwaveShader = {
  uniforms: {
    tDiffuse: { value: null },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uProgress: { value: 1.0 },      // 0 = recien disparada, 1 = terminada
    uAmplitude: { value: 0.035 },
    uFrequency: { value: 26.0 },
    uMaxRadius: { value: 0.85 },
    uThickness: { value: 0.12 },
    uAspect: { value: 1.0 },
    uDistortion: { value: 0.0 },    // distorsion de lente sostenida, por momento
    // Viñeta: apertura y dureza del borde. Es una PUPILA — se cierra cuando la
    // camara se aleja y se abre cuando se acerca.
    uVignette: { value: 0.0 },      // 0 = sin viñeta, 1 = cerrada del todo
    uVignetteSoft: { value: 0.45 }, // cuanto se difumina el borde
    /**
     * CENTRO de la pupila, en coordenadas de pantalla (0..1).
     *
     * Por defecto el centro del encuadre, que es como se ha comportado siempre. Poder
     * moverlo es lo que convierte la pupila en una LINTERNA: se ancla al jugador y lo
     * que queda fuera del circulo se apaga, asi que hay que recordar el camino en vez
     * de leerlo. Es la misma mascara, con el centro como dato.
     */
    uFoco: { value: new THREE.Vector2(0.5, 0.5) },
    /** Luz que queda FUERA del circulo. 0 = negro absoluto, como siempre. */
    uFocoMin: { value: 0.0 },
    /**
     * RADIO del circulo, en fracciones de la ALTURA de pantalla. 0 = la pupila de
     * siempre, con su apertura derivada de `uVignette`.
     *
     * Existe porque la pupila no sirve para una linterna. Su apertura sale de
     * `mix(1.35, 0.42, uVignette)` y toca fondo en 0,42: ni con el cierre al maximo baja
     * de 488 px de diametro. Medido en el reto 1 de linterna: circulo de 704 px sobre un
     * tablero de 632 px de ancho — la linterna cubria el tablero entero y no habia nada
     * que descubrir.
     *
     * Con un radio propio, 0,13 son ~215 px de diametro: un pasillo y sus vecinos.
     */
    uFocoRadio: { value: 0.0 },
    // Viñeta de ESQUINAS: otra cosa distinta, aunque comparta nombre. Ver el shader.
    uCorners: { value: 0.0 },       // 0 = sin marco, 1 = esquinas cerradas
    uCornersSoft: { value: 0.55 },
    uCornerPulse: { value: 0.0 },   // cuanto late; 0 = quieto
    uCornerTint: { value: new THREE.Color(0, 0, 0) },
    uTime: { value: 0.0 },
    // Aberracion cromatica. Por IMPULSO, nunca sostenida (R2 §3.3).
    uAberration: { value: 0.0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 uCenter;
    uniform float uProgress, uAmplitude, uFrequency, uMaxRadius, uThickness, uAspect, uDistortion;
    uniform float uVignette, uVignetteSoft;
    uniform vec2 uFoco;
    uniform float uFocoMin;
    uniform float uFocoRadio;
    uniform float uCorners, uCornersSoft, uCornerPulse, uTime, uAberration;
    uniform vec3 uCornerTint;
    varying vec2 vUv;

    void main() {
      vec2 uv = vUv;

      // --- distorsion de lente sostenida (barril) ---
      if (uDistortion > 0.0001) {
        vec2 c = uv - 0.5;
        c.x *= uAspect;
        float r2 = dot(c, c);
        c *= 1.0 + uDistortion * r2;
        c.x /= uAspect;
        uv = c + 0.5;
      }

      // --- onda expansiva ---
      if (uProgress < 1.0) {
        vec2 d = uv - uCenter;
        d.x *= uAspect;
        float dist = length(d);
        float ring = dist - uProgress * uMaxRadius;
        // La onda se apaga con la distancia y con el propio avance.
        float mask = smoothstep(uThickness, 0.0, abs(ring)) * (1.0 - uProgress);
        vec2 dir = d / max(dist, 1e-5);
        dir.x /= uAspect;
        uv += dir * sin(ring * uFrequency) * uAmplitude * mask;
      }

      vec2 uvSafe = clamp(uv, 0.001, 0.999);
      vec4 col;

      // --- aberracion cromatica ---
      //
      // Los tres canales se muestrean con un desplazamiento RADIAL distinto, que es
      // como se comporta una lente de verdad: nulo en el centro y creciente hacia el
      // borde. Un desplazamiento constante se lee como una imagen mal registrada; el
      // radial se lee como cristal.
      //
      // Va SIEMPRE por impulso y decae (R2 §3.3): en un juego infantil una aberracion
      // permanente no se lee como estilo, se lee como que el render esta roto. Aqui
      // dispara en los cambios de etapa y en los golpes, y a los 0,4 s ya no esta.
      if (uAberration > 0.0001) {
        vec2 radial = uvSafe - 0.5;
        radial.x *= uAspect;
        float k = uAberration * 0.018 * dot(radial, radial) * 4.0;
        vec2 off = normalize(radial + 1e-6) * k;
        off.x /= uAspect;
        col = vec4(
          texture2D(tDiffuse, clamp(uvSafe + off, 0.001, 0.999)).r,
          texture2D(tDiffuse, uvSafe).g,
          texture2D(tDiffuse, clamp(uvSafe - off, 0.001, 0.999)).b,
          1.0);
      } else {
        col = texture2D(tDiffuse, uvSafe);
      }

      // --- viñeta / pupila ---
      //
      // Cierra el encuadre por los bordes. Tiene un trabajo concreto ademas del
      // estetico: en las esquinas es donde se ve como esta construido el mundo —
      // el final de una banda de parallax, el borde de una plataforma, el vacio
      // detras. Oscurecerlas tapa la costura sin quitar nada de lo que importa,
      // que siempre esta en el centro.
      if (uVignette > 0.001) {
        // El centro es uFoco y no 0.5 fijo: con el foco en el jugador esto es la
        // linterna, y con el foco en el centro es la pupila de siempre.
        vec2 v = vUv - uFoco;
        v.x *= uAspect;
        float d = length(v) * 1.42;                 // 1 en la esquina
        // El radio de apertura se encoge con uVignette. OJO: nada de comillas
        // invertidas en los comentarios del shader — el GLSL vive dentro de un
        // template literal y una comilla ahi corta la cadena en seco.
        // Con uFocoRadio la apertura es un RADIO de verdad (en alturas de pantalla) y
        // no la curva de la pupila, que no baja de 0.42. Ver el uniform.
        float apertura = uFocoRadio > 0.0 ? uFocoRadio * 1.42 : mix(1.35, 0.42, uVignette);
        float mask = smoothstep(apertura, apertura - uVignetteSoft, d);
        // SUELO DE LA MASCARA. A 0 (el valor de siempre) fuera del circulo queda negro
        // absoluto. La linterna lo sube un poco, y no por estetica: el RASTRO de por
        // donde has pasado vive fuera del circulo — es su razon de ser—, y con negro
        // absoluto la linterna apagaba justo la pista que el rastro existe para dar.
        // Con un suelo bajo, el camino pisado se sigue intuyendo y el resto no.
        col.rgb *= mix(uFocoMin, 1.0, mask);
      }

      // --- viñeta de ESQUINAS, animada ---
      //
      // No es la de arriba con otro nombre: la pupila es una MASCARA CIRCULAR
      // CENTRADA que dice "el mundo se estrecha", y esto es un MARCO que dice "esto
      // es un plano". Comparten palabra en castellano y no comparten nada mas, que es
      // justo por lo que hacia falta separarlas (R2 §3.2, TDB-025).
      //
      // La funcion de distancia es el PRODUCTO de las dos coordenadas normalizadas,
      // asi que solo vale 1 donde las dos son grandes — la esquina. Con una suma se
      // oscurecerian tambien los bordes centrales y el efecto seria un tunel.
      //
      // Y late. Cada esquina con su propia fase (un cuarto de vuelta de diferencia),
      // porque las cuatro latiendo a la vez se leen como un parpadeo de brillo de
      // pantalla, y desfasadas se leen como que el marco RESPIRA. Es la interfaz del
      // Proyector, y una interfaz que respira es lo que pide el canon del GDD §1.1.
      if (uCorners > 0.001) {
        vec2 dd = vUv - 0.5;
        vec2 q = abs(dd) * 2.0;
        float esquina = q.x * q.y;

        float fase = (dd.x > 0.0 ? 1.5708 : 0.0) + (dd.y > 0.0 ? 3.1416 : 0.0);
        float latido = 1.0 + uCornerPulse * 0.30 * sin(uTime * 2.2 + fase);
        float k = clamp(uCorners * latido, 0.0, 1.4);

        // El borde interior del marco se mueve con la apertura: cuanto mas cerrado,
        // mas adentro empieza a morder.
        float borde = mix(0.95, 0.16, clamp(k, 0.0, 1.0));
        float m = smoothstep(borde - uCornersSoft * 0.5, borde + uCornersSoft * 0.5, esquina);
        col.rgb = mix(col.rgb, uCornerTint, m * clamp(k, 0.0, 1.0));
      }

      gl_FragColor = col;
    }`,
};

/**
 * Desenfoque direccional — el sustituto del MotionBlur de URP.
 *
 * Es un barrido de 6 muestras a lo largo de un vector, no un blur gaussiano. Eso
 * importa por dos razones: da la estela en el sentido del movimiento (que es lo que
 * se quiere) y cuesta seis texturas por pixel en vez de las decenas de un blur
 * separable en dos pases. Con `uAmount` a 0 se salta el bucle entero, asi que
 * mientras no haya movimiento el pase es practicamente gratis.
 *
 * Ademas se atenua hacia el centro (`uCenter`): el sujeto queda nitido y lo que se
 * arrastra son los bordes, que es como se lee la velocidad sin marear.
 */
const DirectionalBlurShader = {
  uniforms: {
    tDiffuse: { value: null },
    uAmount: { value: 0.0 },                       // 0..1, longitud del barrido
    uDir: { value: new THREE.Vector2(1, 0) },      // direccion, normalizada
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uAmount;
    uniform vec2 uDir;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      if (uAmount < 0.001) { gl_FragColor = base; return; }

      // El centro se queda nitido; el arrastre crece hacia los bordes.
      float edge = smoothstep(0.10, 0.62, length(vUv - 0.5));
      float len = uAmount * 0.035 * edge;

      vec4 sum = base;
      for (int i = 1; i < 6; i++) {
        float k = float(i) / 5.0;
        sum += texture2D(tDiffuse, vUv - uDir * len * k);
      }
      gl_FragColor = sum / 6.0;
    }`,
};

/**
 * Deformacion de celebracion: separacion RGB + onda radial.
 *
 * Distinto de la aberracion cromatica del ShockwaveShader: esa es un impulso radial
 * que decae, y esta es una deformacion sostenida con onda seno que se intensifica.
 * Se activa al superar un reto y se desvanece en ~1,5 s.
 */
const CelebrationDeformationShader = {
  uniforms: {
    tDiffuse: { value: null },
    uIntensity: { value: 0.0 },
    uTime: { value: 0.0 },
    uAspect: { value: 1.0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uIntensity;
    uniform float uTime;
    uniform float uAspect;
    varying vec2 vUv;

    void main() {
      if (uIntensity < 0.001) {
        gl_FragColor = texture2D(tDiffuse, vUv);
        return;
      }
      vec2 centered = vUv - 0.5;
      centered.x *= uAspect;
      float dist = length(centered);
      float angle = atan(centered.y, centered.x);
      float wave = sin(dist * 30.0 - uTime * 8.0) * uIntensity * 0.04;
      float radialPush = sin(angle * 3.0 + uTime * 5.0) * uIntensity * 0.015;
      vec2 offset = normalize(centered + 1e-6) * (wave + radialPush);
      offset.x /= uAspect;
      float rgbSplit = uIntensity * 0.012 * dist;
      vec2 splitDir = normalize(centered + 1e-6) * rgbSplit;
      splitDir.x /= uAspect;
      float r = texture2D(tDiffuse, clamp(vUv + offset + splitDir, 0.001, 0.999)).r;
      float g = texture2D(tDiffuse, clamp(vUv + offset, 0.001, 0.999)).g;
      float b = texture2D(tDiffuse, clamp(vUv + offset - splitDir, 0.001, 0.999)).b;
      gl_FragColor = vec4(r, g, b, 1.0);
    }`,
};

export class PostFX {
  /** Calibrado a ojo comparando con la referencia de Unity: 4.0 en URP ~ 1.4 aqui. */
  static BLOOM_URP_TO_THREE = 0.35;

  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.0,    // strength: lo maneja la coreografia
      0.55,   // radius
      0.72    // threshold: solo lo verdaderamente brillante florece
    );
    this.composer.addPass(this.bloom);

    // Desenfoque direccional: el sustituto del MotionBlur de URP, que three.js no
    // trae. Va ANTES del shockwave para que la onda no se emborrone con el.
    this.motion = new ShaderPass(DirectionalBlurShader);
    this.composer.addPass(this.motion);

    this.shock = new ShaderPass(ShockwaveShader);
    this.composer.addPass(this.shock);

    this.deform = new ShaderPass(CelebrationDeformationShader);
    this.composer.addPass(this.deform);

    this.film = new FilmPass(0.08, false);
    this.composer.addPass(this.film);

    this.composer.addPass(new OutputPass());

    // Estado interpolado: nada salta de golpe, todo mezcla en ~1 s como en Unity.
    this.current = { bloom: 0, grain: 0.08, distortion: 0 };
    this.target = { bloom: 0, grain: 0.08, distortion: 0 };

    this.shockTime = 1;
    this.shockDuration = 0.75;

    // Aberracion: impulso que decae, igual que `shakeImpulse`. 2,6/s deja el efecto
    // en ~0,4 s desde 1,0 — el tiempo de un golpe, no el de un tramo.
    this._aberration = 0;
    this._aberrationDecay = 2.6;
    // Marco de esquinas: estado interpolado, como el resto del `look`.
    this._corners = 0;
    this._cornersTarget = 0;
    this._reloj = 0;
    this._deformation = 0;
    this._shakeX = 0;
    this._shakeZ = 0;
    this._shakeDecay = 5.0;
    this.userData = { shakeX: 0, shakeZ: 0 };
  }

  /**
   * Preset del momento actual.
   *
   * OJO: los valores de la tabla son los de Unity/URP, que NO mapean 1:1 con
   * UnrealBloomPass. En URP un bloom de 4 es intenso; aqui lava la imagen entera.
   * Se convierte con un factor unico para poder mantener la tabla igual a la
   * referencia y que la conversion quede en un solo sitio, documentada.
   */
  setLook({ bloom = 0, grain = 0.08, distortion = 0 } = {}) {
    this.target.bloom = bloom * PostFX.BLOOM_URP_TO_THREE;
    this.target.grain = grain;
    this.target.distortion = distortion;
  }

  /**
   * Dispara una onda. `x`/`y` en coordenadas normalizadas de pantalla (0..1).
   * Regla del plan §8b.2: como maximo una activa a la vez, y solo en eventos gordos.
   */
  shockwave(x = 0.5, y = 0.5, strength = 1) {
    this.shock.uniforms.uCenter.value.set(x, y);
    this.shock.uniforms.uAmplitude.value = 0.030 * strength;
    this.shockTime = 0;
  }

  /**
   * Dispara un pico de aberracion cromatica. `strength` 0..1.
   *
   * Se toma el MAXIMO en vez de sumar: dos impulsos seguidos no deben acumularse
   * hasta descomponer la imagen. Es la misma politica que `shakeImpulse`.
   */
  aberrationImpulse(strength = 1) {
    this._aberration = Math.max(this._aberration, Math.min(1.4, strength));
  }

  /**
   * Marco de esquinas. `amount` 0 abierto, 1 cerrado; `pulse` cuanto respira.
   *
   * @param {number} amount
   * @param {number} [pulse] 0..1
   * @param {number} [soft] difuminado del borde interior
   * @param {number} [tint] color del marco; negro por defecto
   */
  setCorners(amount, pulse = 0, soft = 0.55, tint = null) {
    this._cornersTarget = amount;
    this.shock.uniforms.uCornerPulse.value = pulse;
    this.shock.uniforms.uCornersSoft.value = soft;
    if (tint !== null) this.shock.uniforms.uCornerTint.value.setHex(tint);
  }

  update(dt) {
    const blend = Math.min(1, dt * 1.1);
    this.current.bloom += (this.target.bloom - this.current.bloom) * blend;
    this.current.grain += (this.target.grain - this.current.grain) * blend;
    this.current.distortion += (this.target.distortion - this.current.distortion) * blend;

    this.bloom.strength = this.current.bloom;
    this.film.uniforms.intensity.value = this.current.grain;
    this.shock.uniforms.uDistortion.value = this.current.distortion + (this._warp || 0);

    // El marco mezcla en ~1 s como el resto del ambiente: un marco que salta de golpe
    // se lee como un fallo de render, no como un cambio de plano.
    this._corners += (this._cornersTarget - this._corners) * blend;
    this.shock.uniforms.uCorners.value = this._corners;

    this._reloj += dt;
    this.shock.uniforms.uTime.value = this._reloj;

    this._aberration = Math.max(0, this._aberration - dt * this._aberrationDecay);
    this.shock.uniforms.uAberration.value = this._aberration;

    if (this.shockTime < 1) {
      this.shockTime = Math.min(1, this.shockTime + dt / this.shockDuration);
      this.shock.uniforms.uProgress.value = this.shockTime;
    }

    // Deformacion de celebracion: decae suavemente.
    this._deformation = Math.max(0, this._deformation - dt * 0.8);
    this.deform.uniforms.uIntensity.value = this._deformation;
    this.deform.uniforms.uTime.value = this._reloj;

    // Shake: decae con fuerza. Se expone en `userData` para que el anfitrion pueda
    // aplicarlo a su camara desde fuera del bucle del motor (laberinto_fiesta).
    this._shakeX *= Math.max(0, 1 - dt * this._shakeDecay);
    this._shakeZ *= Math.max(0, 1 - dt * this._shakeDecay);
    this.userData.shakeX = this._shakeX;
    this.userData.shakeZ = this._shakeZ;
  }

  setSize(width, height) {
    this.composer.setSize(width, height);
    this.bloom.setSize(width, height);
    this.shock.uniforms.uAspect.value = width / height;
    this.deform.uniforms.uAspect.value = width / height;
  }

  /**
   * Ajusta el desenfoque a partir de la velocidad del jugador.
   *
   * Solo entra por encima de `threshold`, para que caminar no emborrone nada: es un
   * efecto de VELOCIDAD, y si esta siempre puesto deja de comunicarla.
   *
   * @param {number} vx velocidad horizontal en m/s
   * @param {number} [max] velocidad a la que el efecto llega al maximo
   */
  setMotion(vx, max = 6.0) {
    // Un forzado manda sobre la velocidad: lo usa la transicion de etapa, que
    // necesita el desenfoque al maximo aunque el personaje este quieto.
    if (this._motionOverride !== null && this._motionOverride !== undefined) {
      this._motionAmount = this._motionOverride;
      this.motion.uniforms.uAmount.value = this._motionAmount;
      return;
    }
    const threshold = 3.4;
    const speed = Math.abs(vx);
    const k = Math.max(0, (speed - threshold) / Math.max(0.001, max - threshold));
    // Rampa suave: si saltara de golpe al cruzar el umbral se veria un parpadeo.
    const target = Math.min(1, k) * 0.85;
    this._motionAmount = (this._motionAmount ?? 0) + (target - (this._motionAmount ?? 0)) * 0.18;
    this.motion.uniforms.uAmount.value = this._motionAmount;
    if (speed > 0.1) this.motion.uniforms.uDir.value.set(Math.sign(vx), 0);
  }

  /**
   * Fuerza el desenfoque direccional, ignorando la velocidad.
   * @param {number|null} amount 0..1, o null para devolver el control a la velocidad
   * @param {number} [dirX] sentido del barrido
   */
  forceMotion(amount, dirX = 1, dirY = 0) {
    this._motionOverride = amount;
    if (amount === null) return;
    // La direccion admite componente vertical desde el set piece de caida: ahi todo
    // el fotograma se mueve hacia arriba, y un barrido horizontal no diria nada.
    // Se normaliza porque el shader avanza `uDir * len` y una diagonal sin normalizar
    // barreria mas que un eje puro.
    const x = dirY === 0 ? (Math.sign(dirX) || 1) : dirX;
    const largo = Math.hypot(x, dirY) || 1;
    this.motion.uniforms.uDir.value.set(x / largo, dirY / largo);
  }

  /**
   * Apertura de la viñeta.
   * @param {number} amount 0 abierta del todo, 1 cerrada
   * @param {number} [soft] difuminado del borde
   */
  /**
   * Distorsion EXTRA, sin interpolar.
   *
   * La de `setLook` mezcla en ~1 s porque es el tono de un tramo entero. Una
   * transicion dura menos que eso, asi que su curvatura tiene que aplicarse en el
   * frame — pasarla por la interpolacion la dejaba llegando tarde y saliendo tarde.
   */
  setWarp(amount) { this._warp = amount || 0; }

  /**
   * LINTERNA: cierra la pupila alrededor de un punto de la PANTALLA.
   *
   * @param {number} x        0..1; 0.5 es el centro
   * @param {number} y        0..1 en coordenadas de TEXTURA: **0 abajo, 1 arriba**.
   *   No es la Y de pantalla. Se compara contra `vUv` dentro del shader, y pasarle la
   *   de pantalla deja la linterna en espejo — ya paso.
   * @param {number} cierre   0 = nada, 1 = cerrada del todo
   * @param {number} [suave]  difuminado del borde del circulo
   * @param {number} [minimo] luz que queda fuera del circulo (0 = negro absoluto)
   *
   * Escribe los mismos uniforms que la pupila porque ES la pupila: lo unico que cambia
   * es que su centro deja de ser fijo. Apagarla es `cierre` 0, y entonces el foco vuelve
   * al centro para no dejar la mascara descolocada si alguien la enciende luego.
   */
  setLinterna(x, y, cierre, suave, minimo, radio) {
    const u = this.shock.uniforms;
    const c = Math.min(1, Math.max(0, cierre || 0));
    u.uVignette.value = c;
    if (suave !== undefined) u.uVignetteSoft.value = suave;
    u.uFocoMin.value = c > 0.001 ? (minimo ?? 0) : 0;
    u.uFocoRadio.value = c > 0.001 ? (radio ?? 0) : 0;
    if (c <= 0.001) { u.uFoco.value.set(0.5, 0.5); return; }
    u.uFoco.value.set(x, y);
  }

  /**
   * Deformacion de celebracion: separacion RGB + onda radial sostenida.
   * @param {number} intensity 0..1
   */
  setDeformation(intensity) { this._deformation = Math.min(1.4, Math.max(0, intensity)); }

  /**
   * Impulso de shake de pantalla.
   * @param {number} force amplitud del temblor (0..1 recomendado)
   */
  setShake(force) {
    this._shakeX = (Math.random() - 0.5) * 2 * force;
    this._shakeZ = (Math.random() - 0.5) * 2 * force;
  }

  setVignette(amount, soft = 0.45) {
    this.shock.uniforms.uVignette.value = amount;
    this.shock.uniforms.uVignetteSoft.value = soft;
  }

  render() { this.composer.render(); }

  dispose() { this.composer.dispose?.(); }
}
