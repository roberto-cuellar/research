/**
 * Portal de Idea: cambio entre la capa delantera y la trasera.
 *
 * Es la mecanica que define el juego (plan §25.3). Decisiones clave:
 *
 *  - Se activa SOLO al atravesar el arco, sin boton: un boton mete friccion en algo
 *    que tiene que sentirse fluido.
 *  - CONSERVA EL VECTOR DE VELOCIDAD. Sin esto el portal es una puerta; con esto es
 *    una mecanica: puedes cruzar en pleno salto y aterrizar en la otra capa.
 *  - Mientras estas dentro del arco sin haber cruzado, aparece una SILUETA en la otra
 *    capa, en tu posicion exacta de salida. Sin ese aviso el cambio se siente aleatorio.
 *  - El efecto es disolucion por ruido con `discard`: cero pases nuevos, cero render
 *    targets. Se precompila al cargar para que no haya tiron la primera vez.
 */

import * as THREE from 'three';

/**
 * Profundidad en Z de cada capa jugable.
 *
 * La separacion importa: a -3,4 las dos capas se confundian y no se leia en cual
 * estabas. Con -6,5 mas el velo de niebla intermedio (ver createGame) la lectura es
 * inmediata sin necesidad de desenfoque, que costaria un pase de render.
 */
export const LAYER_Z = [0, -6.5];

export const DISSOLVE_OUT = 0.35;   // segundos que tarda en desaparecer
export const DISSOLVE_IN = 0.35;    // y en volver
export const PORTAL_COOLDOWN = 0.5; // evita el ping-pong si te quedas dentro del arco

const EDGE_COLOR = new THREE.Color(0x2ed8ee);

/**
 * Ruido para la disolucion.
 *
 * OJO: los `noise*.png` de Kenney Planets NO son ruido abstracto, son mapas de
 * superficie planetaria (se ven los continentes). Sirven de maravilla para la
 * membrana del portal —parece una ventana a otro mundo— pero como mascara de
 * disolucion dan zonas enteras a cero y el personaje se tine de golpe.
 *
 * Se genera aqui: 256x256, un canal, ruido con grumos. Pesa 64 KB en memoria,
 * no se descarga nada y es siempre el mismo (semilla fija) => determinista.
 */
export function makeDissolveNoise(size = 256) {
  const data = new Uint8Array(size * size);
  const raw = new Float32Array(size * size);
  let seed = 1337;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  // Rejilla gruesa: menos celdas = grumos mas grandes y disolucion mas organica.
  // Con valores altos el efecto queda moteado, como ruido de television.
  const coarse = 13;
  const grid = new Float32Array(coarse * coarse);
  for (let i = 0; i < grid.length; i += 1) grid[i] = rand();

  const sample = (gx, gy) => grid[(gy % coarse) * coarse + (gx % coarse)];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // Dos octavas: una gruesa que da los grumos y otra fina que rompe el patron.
      const fx = (x / size) * coarse;
      const fy = (y / size) * coarse;
      const x0 = Math.floor(fx); const y0 = Math.floor(fy);
      const tx = fx - x0; const ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const a = sample(x0, y0); const b = sample(x0 + 1, y0);
      const c = sample(x0, y0 + 1); const d = sample(x0 + 1, y0 + 1);
      const coarseValue = (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;

      // Poco ruido fino: solo el justo para romper los bordes de los grumos.
      raw[y * size + x] = coarseValue * 0.88 + rand() * 0.12;
    }
  }

  // Normalizacion imprescindible: interpolar ruidos uniformes concentra los valores
  // alrededor de 0,5, asi que sin estirar el rango el personaje desaparece de golpe
  // en mitad del barrido en vez de disolverse de forma pareja.
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of raw) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = Math.max(1e-6, hi - lo);
  for (let i = 0; i < raw.length; i += 1) {
    data[i] = Math.round(Math.max(0, Math.min(1, (raw[i] - lo) / span)) * 255);
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RedFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.NoColorSpace;   // es un dato, no un color
  texture.needsUpdate = true;
  return texture;
}

/**
 * Inyecta la disolucion en un material estandar sin perder iluminacion ni skinning.
 * Devuelve un objeto con el uniform, para animarlo desde fuera.
 */
export function patchDissolve(material, noiseTexture) {
  const uniforms = {
    uDissolve: { value: 0 },
    uNoise: { value: noiseTexture },
    uEdge: { value: EDGE_COLOR },
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    // La posicion LOCAL antes del skinning: asi el patron se queda pegado al modelo
    // en vez de nadar por la pantalla cuando el personaje se mueve.
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDissolvePos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDissolvePos = transformed;');

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vDissolvePos;
        uniform float uDissolve;
        uniform sampler2D uNoise;
        uniform vec3 uEdge;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        float dNoise = texture2D(uNoise, vDissolvePos.xy * 0.55 + vDissolvePos.z * 0.2).r;
        if (dNoise < uDissolve) discard;`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        // Borde encendido justo en el frente de la disolucion.
        // El guard de uDissolve es imprescindible: sin el, en reposo el smoothstep
        // tine al personaje entero del color del borde.
        if (uDissolve > 0.001) {
          float dEdge = smoothstep(uDissolve, uDissolve + 0.10, dNoise);
          gl_FragColor.rgb = mix(uEdge * 2.2, gl_FragColor.rgb, dEdge);
        }`);
  };

  material.needsUpdate = true;
  return uniforms;
}

export class PortalSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {object} level
   * @param {object} player
   * @param {THREE.Texture} membraneTexture  el planeta de Kenney: la ventana del arco
   */
  constructor(scene, level, player, membraneTexture) {
    this.scene = scene;
    this.level = level;
    this.player = player;
    this.noise = membraneTexture;
    // Mascara de disolucion propia, independiente del arte del portal.
    this.dissolveNoise = makeDissolveNoise(256);

    this.portals = (level.portals || []).map((p) => ({ ...p }));
    this.cooldown = 0;
    this.phase = 'idle';      // idle | out | in
    this.timer = 0;
    this.dissolve = 0;
    this.uniforms = [];       // uniforms del avatar, se registran al cargar el GLB
    this.crossings = 0;
    this.pending = null;
    // Arco que acabamos de usar. Hay que SALIR de el para poder volver a cruzar:
    // solo con cooldown no basta, porque al soltar el control el personaje frena
    // dentro del propio arco y lo dispara otra vez en bucle.
    this.lockedPortal = null;

    this.group = new THREE.Group();
    scene.add(this.group);
    this._buildVisuals();
    this._buildGhost();
  }

  /** Aplica la disolucion a un material suelto — props que se equipan en juego. */
  registerMaterial(material) {
    this.uniforms.push(patchDissolve(material, this.dissolveNoise));
  }

  registerAvatar(avatar) {
    avatar.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => this.uniforms.push(patchDissolve(m, this.dissolveNoise)));
    });
  }

  _buildVisuals() {
    for (const portal of this.portals) {
      const cx = portal.x + portal.w / 2;
      const cy = portal.y + portal.h / 2;

      const holder = new THREE.Group();
      holder.position.set(cx, cy, LAYER_Z[0] * 0.5 + LAYER_Z[1] * 0.5);

      // Arco: un toro de pie. Los robots de Bradislav lo construyeron, asi que
      // no tiene que parecer magia, tiene que parecer una maquina que brilla.
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(portal.h / 2, 0.075, 10, 36),
        new THREE.MeshStandardMaterial({
          color: 0x7c3aed, emissive: 0x7c3aed, emissiveIntensity: 1.6,
          roughness: 0.35, metalness: 0.4,
        })
      );
      holder.add(ring);

      // Membrana: el ruido de Kenney desplazandose por UV. Late, no parpadea.
      const membraneTex = this.noise.clone();
      membraneTex.needsUpdate = true;
      membraneTex.wrapS = membraneTex.wrapT = THREE.RepeatWrapping;
      const membrane = new THREE.Mesh(
        new THREE.CircleGeometry(portal.h / 2 - 0.05, 32),
        new THREE.MeshBasicMaterial({
          map: membraneTex, color: 0x2ed8ee,
          transparent: true, opacity: 0.32,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        })
      );
      holder.add(membrane);

      portal._ring = ring;
      portal._membrane = membrane;
      portal._tex = membraneTex;
      this.group.add(holder);
    }
  }

  /**
   * Abre un Portal de Idea temporal donde el jugador esta.
   *
   * Es el uso caro de las Chispas: los demas quitan un obstaculo, este CAMBIA LA
   * RUTA. Por eso cuesta varias y por eso caduca — un portal permanente donde
   * quieras convertiria las dos capas en una sola.
   *
   * Se construye con las mismas piezas que los fijos, pero en cian y parpadeando
   * cerca del final, para que se distinga de un portal de Bradislav y para que se
   * vea venir que se cierra.
   *
   * **Sólo hay uno a la vez, y el nuevo SUSTITUYE al viejo.**
   *
   * Antes el segundo intento devolvía `null` y no pasaba nada. Combinado con la
   * recarga eso producía una mentira en el HUD: la recarga terminaba antes de que el
   * portal caducara, así que la tecla se pintaba lista y pulsarla no hacía nada — o
   * peor, gastaba las Chispas del contador del juego sin abrir ningún arco.
   *
   * Sustituir es además la decisión de diseño correcta. El coste de mover el portal
   * son **3 Chispas**, que es un recurso de verdad y escaso; el tiempo de espera no
   * añadía decisión, sólo la aplazaba. Sigue habiendo uno solo, que es lo que impide
   * que las dos capas se conviertan en una.
   *
   * @returns {object|null|'sin-suelo'} el portal creado, o por qué no
   */
  openTemporary(x, y, seconds = 12, world = null) {
    const abierto = this.portals.findIndex((p) => p.temporary);
    if (abierto >= 0) {
      // Cruzando no se toca: cerrarlo a media disolución dejaría al jugador a medio
      // camino entre las dos capas. Es el mismo motivo que en `_ageTemporary`.
      if (this.phase !== 'idle') return null;
      this._cerrarTemporal(abierto);
    }

    // Invariante del plan §10.4: un portal NUNCA puede dejar al jugador sin suelo.
    // Aqui importa mas que en los fijos, porque los fijos se colocan a mano y este
    // lo pone el jugador donde quiera — incluido el borde de un tejado con el vacio
    // enfrente. Se comprueba la capa de DESTINO, que es la contraria a la suya.
    if (world) {
      const otherLayer = this.player.layer === 0 ? 1 : 0;
      const ground = world.groundHeightAt(x, otherLayer, -999);
      if (ground < y - 4.0) return 'sin-suelo';
    }

    const portal = {
      id: 'TMP', x: x - 0.55, y, w: 1.1, h: 2.3,
      bidirectional: true, temporary: true, life: seconds, maxLife: seconds,
      // Tiempo de CONSTRUCCION. Durante estos segundos el arco se dibuja a si mismo
      // en vez de aparecer entero. Importa por el canon: estos portales los montan
      // los robots de Bradislav, asi que tienen que verse ENSAMBLADOS y no invocados
      // — es la diferencia entre que el juego trate de tecnologia o de magia.
      born: 0, buildTime: 0.55,
    };
    this.portals.push(portal);

    const cx = portal.x + portal.w / 2;
    const cy = portal.y + portal.h / 2;
    const holder = new THREE.Group();
    holder.position.set(cx, cy, LAYER_Z[0] * 0.5 + LAYER_Z[1] * 0.5);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(portal.h / 2, 0.075, 10, 36),
      new THREE.MeshStandardMaterial({
        color: 0x2ed8ee, emissive: 0x2ed8ee, emissiveIntensity: 1.9,
        roughness: 0.35, metalness: 0.4,
      })
    );
    holder.add(ring);

    const membraneTex = this.noise.clone();
    membraneTex.needsUpdate = true;
    membraneTex.wrapS = membraneTex.wrapT = THREE.RepeatWrapping;
    const membrane = new THREE.Mesh(
      new THREE.CircleGeometry(portal.h / 2 - 0.05, 32),
      new THREE.MeshBasicMaterial({
        map: membraneTex, color: 0xf59e0b,
        transparent: true, opacity: 0.32,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      })
    );
    holder.add(membrane);

    // ---- feedback: cuanto le queda, a la vista ----
    //
    // Un portal que caduca sin avisar es una trampa. La cuenta atras se dibuja como
    // un ARCO que se vacia en el suelo, bajo el propio portal: se lee de un vistazo
    // y desde lejos, sin numeros y sin mirar el HUD.
    const dial = new THREE.Mesh(
      new THREE.RingGeometry(0.75, 0.95, 48, 1, Math.PI / 2, Math.PI * 2),
      new THREE.MeshBasicMaterial({
        color: 0x2ed8ee, transparent: true, opacity: 0.9,
        side: THREE.DoubleSide, depthWrite: false, fog: false,
      })
    );
    dial.rotation.x = -Math.PI / 2;
    dial.position.set(cx, y + 0.04, LAYER_Z[0]);
    dial.renderOrder = 4;
    this.group.add(dial);

    // Y una luz propia: es lo que lo separa del fondo en la plaza al atardecer.
    const lamp = new THREE.PointLight(0x2ed8ee, 3.0, 7, 2);
    lamp.position.set(cx, cy, LAYER_Z[0] * 0.5 + LAYER_Z[1] * 0.5);
    this.group.add(lamp);

    portal._ring = ring;
    portal._membrane = membrane;
    portal._tex = membraneTex;
    portal._holder = holder;
    portal._dial = dial;
    portal._lamp = lamp;
    this.group.add(holder);
    return portal;
  }

  /** Caduca los portales temporales. Lo llama `update`. */
  _ageTemporary(dt) {
    for (let i = this.portals.length - 1; i >= 0; i -= 1) {
      const p = this.portals[i];
      if (!p.temporary) continue;

      // ---- construccion ----
      // Va ANTES de descontar la vida: mientras se monta, el reloj no corre. Si no,
      // los 12 s incluirian el medio segundo de montaje y el portal duraria menos de
      // lo que se le promete al jugador.
      if (p.born < p.buildTime) {
        p.born += dt;
        const k = Math.min(1, p.born / p.buildTime);
        const suave = 1 - Math.pow(1 - k, 3);

        // El anillo se DIBUJA: su arco crece de 0 a la vuelta entera. Se rehace la
        // geometria porque el angulo barrido no es una escala, es otra forma.
        p._ring.geometry.dispose();
        p._ring.geometry = new THREE.TorusGeometry(
          p.h / 2, 0.075, 10, Math.max(3, Math.round(36 * suave)),
          Math.PI * 2 * suave
        );
        // Y gira mientras se traza, como una maquina que lo va soldando.
        p._ring.rotation.z = (1 - suave) * 4.0;

        // La membrana solo llega cuando el marco ya esta: primero la estructura.
        const membrana = Math.max(0, (k - 0.55) / 0.45);
        p._membrane.scale.setScalar(membrana);
        p._membrane.material.opacity = 0.32 * membrana;

        p._dial.scale.setScalar(suave);
        p._lamp.intensity = 3.0 * suave;
        continue;      // mientras se construye no cuenta el tiempo de vida
      }

      p.life -= dt;

      // El arco se vacia con el tiempo restante. Se reconstruye la geometria en vez
      // de escalarla porque lo que tiene que comunicar es CUANTO QUEDA, y eso es un
      // angulo, no un tamaño.
      const frac = Math.max(0, p.life / p.maxLife);
      p._dial.geometry.dispose();
      p._dial.geometry = new THREE.RingGeometry(
        0.75, 0.95, 48, 1, Math.PI / 2, Math.PI * 2 * frac
      );

      // ---- cierre estilizado ----
      //
      // Los ultimos 3 s el color vira a rosa de alerta y parpadea. Y el ultimo
      // segundo NO se apaga: se DESHACE — el anillo se encoge y se abre, la
      // membrana se contrae hacia el centro y el arco se inclina, como una
      // estructura que pierde tension. Apagarlo de golpe se lee como que lo han
      // desconectado; deshacerlo se lee como que se ha agotado, que es lo que pasa.
      const warn = p.life < 3;
      const blink = warn ? (Math.sin(p.life * 18) > 0 ? 1 : 0.25) : 1;

      if (p.life < 1.0) {
        const k = 1 - p.life;                    // 0 -> 1 en el ultimo segundo
        const suave = k * k;
        p._ring.scale.setScalar(1 - suave * 0.55);
        p._ring.rotation.z = suave * 0.7;        // se inclina al perder tension
        p._membrane.scale.setScalar(Math.max(0.02, 1 - suave * 1.1));
        p._holder.position.y = (p.y + p.h / 2) + suave * 0.25;
        p._dial.scale.setScalar(1 + suave * 0.6);
        p._dial.material.opacity *= 1 - suave;
        p._lamp.distance = 7 * (1 - suave * 0.8);
      }
      const tint = warn ? 0xe62a9e : 0x2ed8ee;
      p._ring.material.emissiveIntensity = 1.9 * blink;
      p._ring.material.color.setHex(tint);
      p._ring.material.emissive.setHex(tint);
      p._membrane.material.opacity = 0.32 * blink;
      p._dial.material.color.setHex(tint);
      p._dial.material.opacity = 0.9 * blink;
      p._lamp.color.setHex(tint);
      p._lamp.intensity = 3.0 * blink;

      if (p.life <= 0) {
        // No se retira mientras se esta cruzando: cerrarlo a media disolucion
        // dejaria al jugador a medio camino entre las dos capas.
        if (this.phase !== 'idle') { p.life = 0.2; continue; }
        this._cerrarTemporal(i);
      }
    }
  }

  /**
   * Retira un portal temporal y suelta su memoria.
   *
   * Estaba en linea dentro de `_ageTemporary` y ahora es un metodo porque hay DOS
   * formas de que un portal temporal se cierre: que se le acabe la vida, y que el
   * jugador abra otro. Ver `openTemporary`.
   *
   * @param {number} i indice en `this.portals`
   */
  _cerrarTemporal(i) {
    const p = this.portals[i];
    // Aviso de cierre, para que quien lo escuche pueda soltar una onda suave.
    this.onTemporaryClosed?.(p.x + p.w / 2, p.y + p.h / 2, LAYER_Z[0]);
    this.group.remove(p._holder);
    this.group.remove(p._dial);
    this.group.remove(p._lamp);
    p._dial.geometry.dispose();
    p._dial.material.dispose();
    p._ring.geometry.dispose();
    p._ring.material.dispose();
    p._membrane.geometry.dispose();
    p._membrane.material.dispose();
    p._tex.dispose();
    this.portals.splice(i, 1);
  }

  _buildGhost() {
    // Silueta de salida. Como ambas capas comparten X e Y, la salida esta en la misma
    // posicion y solo cambia la Z: una silueta simple basta y cuesta un draw call.
    const geo = new THREE.CapsuleGeometry(this.player.width * 0.42, this.player.height * 0.52, 4, 12);
    this.ghost = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: 0x2ed8ee, transparent: true, opacity: 0.30,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.ghost.visible = false;
    this.scene.add(this.ghost);
  }

  /** Portal que solapa al jugador ahora mismo, o null. */
  _portalAt(body) {
    for (const p of this.portals) {
      if (body.x < p.x + p.w && body.x + body.w > p.x &&
          body.y < p.y + p.h && body.y + body.h > p.y) return p;
    }
    return null;
  }

  get busy() { return this.phase !== 'idle'; }

  /**
   * Deja al jugador en un sitio valido al llegar a la otra capa.
   *
   * Las dos capas tienen geometria distinta, asi que el punto donde reapareces puede
   * estar ocupado por algo que en tu capa no existia. Sin resolverlo, el jugador
   * aparece DENTRO de una caja y la fisica lo expulsa por donde puede — normalmente
   * hacia arriba, que es lo que se veia.
   *
   * La regla es la del plan §10.4: un portal nunca deja al jugador en mal sitio. Se
   * busca la salida mas cercana en este orden, porque es el que menos altera lo que
   * el jugador esperaba:
   *
   *   1. Encima de lo que estorba, si cabe. Es lo mas parecido a "seguir andando".
   *   2. A los lados, empezando por el sentido en que iba.
   *   3. Si nada cabe, se deshace el cruce: mejor no cruzar que cruzar a un sitio roto.
   */
  _resolveArrival(player) {
    const world = player.world;
    if (!world) return;

    const body = player.body;
    const solids = world.solidsForLayer(player.layer);
    const choca = (b) => solids.some((s) =>
      b.x < s.x + s.w && b.x + b.w > s.x && b.y < s.y + s.h && b.y + b.h > s.y);

    if (!choca(body)) return;

    const dir = Math.sign(player.velocity.x) || 1;
    const original = { x: body.x, y: body.y };

    // 1. Por encima de lo que estorba.
    const encima = solids
      .filter((s) => body.x < s.x + s.w && body.x + body.w > s.x)
      .reduce((alto, s) => Math.max(alto, s.y + s.h), -Infinity);
    if (Number.isFinite(encima)) {
      body.y = encima + 0.02;
      if (!choca(body)) return;
      body.y = original.y;
    }

    // 2. A los lados, en pasos de medio metro. Primero hacia donde iba.
    for (let paso = 0.5; paso <= 4.0; paso += 0.5) {
      for (const sentido of [dir, -dir]) {
        body.x = original.x + sentido * paso;
        if (!choca(body)) return;
      }
    }

    // 3. Nada cabe: se deshace el cruce.
    body.x = original.x;
    body.y = original.y;
    player.layer = player.layer === 0 ? 1 : 0;
    this.blocked = true;
  }

  /** @param {number} beatPulse 1 en el pulso, cayendo a 0 entre pulsos */
  update(dt, elapsed, beatPulse = 0) {
    this._ageTemporary(dt);
    const player = this.player;

    // Membranas latiendo AL PULSO de la musica, no a un reloj propio (plan §25.3).
    for (const p of this.portals) {
      p._tex.offset.x = (elapsed * 0.12) % 1;
      p._tex.offset.y = (elapsed * 0.07) % 1;
      const near = Math.abs(player.position.x - (p.x + p.w / 2)) < 4;
      p._ring.material.emissiveIntensity = (near ? 2.4 : 1.2) * (1 + beatPulse * 0.9);
      p._membrane.material.opacity = 0.32 + beatPulse * 0.20;
      const s = 1 + beatPulse * 0.035;
      p._ring.scale.setScalar(s);
    }

    if (this.cooldown > 0) this.cooldown -= dt;

    // ---------------------------------------------------------- transicion
    if (this.phase === 'out') {
      this.timer += dt;
      this.dissolve = Math.min(1, this.timer / DISSOLVE_OUT);
      if (this.timer >= DISSOLVE_OUT) {
        // Punto medio: el personaje es invisible, aqui se cambia de capa.
        player.layer = this.pending;
        this.pending = null;
        this.phase = 'in';
        this.timer = 0;
        this.crossings += 1;
        this._resolveArrival(player);
      }
    } else if (this.phase === 'in') {
      this.timer += dt;
      this.dissolve = Math.max(0, 1 - this.timer / DISSOLVE_IN);
      if (this.timer >= DISSOLVE_IN) {
        this.phase = 'idle';
        this.dissolve = 0;
        this.cooldown = PORTAL_COOLDOWN;
      }
    }

    for (const u of this.uniforms) u.uDissolve.value = this.dissolve;

    // ------------------------------------------------------------ disparo
    const inside = this._portalAt(player.body);

    // En cuanto se abandona el arco usado, queda libre otra vez.
    if (this.lockedPortal && inside !== this.lockedPortal) this.lockedPortal = null;

    if (inside && !this.busy && this.cooldown <= 0 && inside !== this.lockedPortal) {
      this.pending = player.layer === 0 ? 1 : 0;
      this.phase = 'out';
      this.timer = 0;
      this.lockedPortal = inside;
      // La velocidad NO se toca: el impulso se conserva a proposito.
    }

    // -------------------------------------------------- silueta de salida
    const preview = inside && !this.busy;
    this.ghost.visible = Boolean(preview);
    if (preview) {
      const other = player.layer === 0 ? 1 : 0;
      this.ghost.position.set(
        player.position.x,
        player.position.y + player.height * 0.5,
        LAYER_Z[other]
      );
    }
  }

  /** Un render de un frame fuera de pantalla para que el shader no compile en juego. */
  precompile(renderer, camera) {
    const saved = this.dissolve;
    for (const u of this.uniforms) u.uDissolve.value = 0.5;
    renderer.compile(this.scene, camera);
    for (const u of this.uniforms) u.uDissolve.value = saved;
  }
}
