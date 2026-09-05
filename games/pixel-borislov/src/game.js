/**
 * Arranque del prototipo jugable.
 *
 * Modulo agnostico del framework, igual que space.js en la plataforma: expone
 * createGame(container) y devuelve una API con dispose(). Asi la ruta de Next.js
 * sera un montaje fino y no habra que reescribir nada.
 */

import * as THREE from 'three';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';
import { Input, ACTIONS } from './i_input.js';
import { CollisionWorld, SURFACE } from './p_physics.js';
import { Player, STATE, TUNING } from './p_player.js';
import { Animator } from './r_animator.js';
import { PortalSystem, LAYER_Z } from './portal.js';
import { Choreography } from './s_choreo.js';
import { PostFX } from './r_postfx.js';
import { Parallax } from './r_parallax.js';
import { Sfx } from './s_sfx.js';
import { Dialogue } from './s_dialogue.js';
import { Director, CONTROL } from './d_director.js';
import { Actor, CinematicPlayer } from './r_cinematic.js';
import { Particles, Viento } from './r_particles.js';
import { Drone } from './drone.js';
import { Projectiles } from './p_projectile.js';
import { ProjectileViews } from './r_projectile.js';
import { PropSystem } from './r_equip.js';
import { SecondarySystem } from './r_secondary.js';
import { Breakables, KINDS as BREAK_KINDS } from './p_breakables.js';
import { BreakableViews } from './r_breakables.js';
import { Pushables, PUSH_SPEED } from './p_pushable.js';
import { PushableViews } from './r_pushable.js';
import { EV, vaciar as vaciarEventos, pendientes as eventosPendientes } from './p_events.js';
import { Plates } from './p_plate.js';
import { PlateViews } from './r_plate.js';
import { TransitionPlayer } from './r_transitions.js';
import { TEST_LEVEL } from './w_level.js';

/**
 * AMBIENTE Y ENCUADRE POR MOMENTO — ya no viven aqui.
 *
 * `MOMENT_LOOK` (9 presets de luz, niebla, bloom, grano, distorsion y shake
 * sostenido) y `MOMENT_ZOOM` eran constantes de este archivo y eran TDB-005: la
 * cabecera de `d_director.js` prometia que "todo se declara en datos, no en codigo,
 * para poder montar los mundos siguientes sin tocar el motor", y estas dos tablas
 * eran lo unico que lo desmentia — montar el mundo 2 obligaba a editar `game.js`.
 *
 * Ahora son `level.ambientes` y `level.encuadres`. Estos dos valores son solo el
 * respaldo para un nivel que no los declare: el motor no debe quedarse sin ambiente
 * por un dato que falte, pero tampoco debe traer el del nivel 1 escondido.
 */
const AMBIENTE_NEUTRO = {
  key: 0xfff0d8, intensity: 2.2, rim: 0.8, fog: 0x050a2e,
  shake: 0, bloom: 0, grain: 0.08, distortion: 0,
};

/**
 * VISTA POR DEFECTO. La perspectiva base del juego, cuando ninguna etapa manda.
 *
 * `fov` bajo (plan §10.7): los personajes 3D tienen volumen pero las capas planas no
 * se deforman en los bordes. Cada etapa la sustituye por la suya — ver
 * `level.stages[].vista`, que es lo que hace que un cambio de etapa se VEA.
 */
const VISTA_BASE = {
  dist: 16, fov: 28, lead: 2.6,
  corners: 0.22, cornerPulse: 0.2, cornerTint: 0x080a1c, aberration: 0.4,
};

/**
 * El manotazo del robot: donde cae y cuanto barre.
 *
 * Los numeros no son libres, tienen que resolver una desigualdad. El golpe vuelve
 * cada 3 pulsos (1,62 s) y la reparacion exige mantener un compas entero (2,16 s).
 * Si la zona de peligro cubriera todo el radio de reparacion, seria imposible
 * completarla NUNCA: siempre te interrumpiria un pisoton.
 *
 * Asi que el brazo cae a la izquierda y barre 1,8 m, dejando libre la mitad derecha
 * del circulo de reparacion (radio 3,2 m). Ahi es donde hay que ponerse — y por eso
 * el aviso del pulso 1 marca en rojo el sitio que hay que evitar.
 */
const SLAM_OFFSET = -2.2;   // metros a la izquierda del robot
const SLAM_RADIUS = 1.8;    // alcance del barrido
/**
 * Fuera de este radio el robot deja de manotear y dispara su chorro de agua.
 * Es un poco mayor que el radio de reparacion (3,2 m) a proposito: dentro del
 * circulo se pelea cuerpo a cuerpo, fuera te alcanza el chorro, y en ningun sitio
 * se puede esperar sin hacer nada.
 */
const MELEE_RANGE = 4.5;

const FIXED_DT = 1 / 60;
const MAX_STEPS = 5;   // si la pestana se congela, no se recuperan mas de 5 ticks

const SURFACE_COLOR = {
  [SURFACE.TIERRA]: 0x6b5a45,
  [SURFACE.MADERA]: 0x8a5a32,
  [SURFACE.METAL]: 0x5d6c8a,
  [SURFACE.TEJADO]: 0x9c4a3a,
  [SURFACE.HIERBA]: 0x3f7a45,
  [SURFACE.AGUA]: 0x2f6f9e,
};

/**
 * Textura de onda expansiva: anillos concentricos que se apagan hacia fuera.
 *
 * Se genera en vez de tomarse del pattern pack porque asi el borde es exactamente
 * circular y el degradado se controla — un patron de rejilla escalado no lee como
 * una onda, lee como una baldosa.
 */
function makeShockwaveTexture(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  const c = size / 2;
  const img = g.createImageData(size, size);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const r = Math.hypot(x - c, y - c) / c;      // 0 en el centro, 1 en el borde
      let a = 0;
      if (r <= 1.0) {
        // Tres anillos: el frente marcado y dos ecos por detras.
        const wave = Math.max(0, Math.sin((1 - r) * Math.PI * 3.0));
        // El frente de onda vive en el borde exterior; el centro queda vacio.
        a = wave * Math.pow(r, 1.6) * (1 - Math.pow(r, 8));
      }
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(Math.min(1, a) * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Textura de superficie, generada al vuelo.
 *
 * El suelo era color plano: sin grano no se lee de que esta hecho, y todas las
 * plataformas parecen la misma pieza pintada de otro color. Se dibujan en canvas en
 * vez de cargar PNG porque son patrones geometricos simples — un tileset para esto
 * serian seis ficheros y seis peticiones para lo que aqui son 40 lineas.
 *
 * Devuelve `{ map, bump }`: el mapa de color y uno de relieve. El relieve es lo que
 * hace que las luces direccionales del nivel talladen la superficie; sin el, la
 * textura se ve pegada como una calcomania.
 */
function makeSurfaceTexture(surface, base) {
  const S = 128;
  const color = document.createElement('canvas');
  const bump = document.createElement('canvas');
  color.width = color.height = bump.width = bump.height = S;
  const c = color.getContext('2d');
  const b = bump.getContext('2d');

  const hex = '#' + new THREE.Color(base).getHexString();
  c.fillStyle = hex;
  c.fillRect(0, 0, S, S);
  b.fillStyle = '#808080';       // gris medio = altura neutra
  b.fillRect(0, 0, S, S);

  // PRNG sembrado: la textura debe ser identica en cada arranque.
  let seed = surface.length * 7919;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  const line = (ctx, x1, y1, x2, y2, style, w = 1) => {
    ctx.strokeStyle = style; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  };

  switch (surface) {
    case SURFACE.MADERA: {
      // Tablones horizontales con veta.
      for (let y = 0; y < S; y += 32) {
        line(c, 0, y, S, y, 'rgba(0,0,0,.34)', 2);
        line(b, 0, y, S, y, '#3a3a3a', 3);
        for (let i = 0; i < 7; i += 1) {
          const yy = y + 6 + rnd() * 22;
          line(c, 0, yy, S, yy, 'rgba(0,0,0,.10)', 1);
        }
      }
      break;
    }
    case SURFACE.METAL: {
      // Chapa remachada: paneles y tornillos en las esquinas.
      for (let i = 0; i <= S; i += 64) {
        line(c, i, 0, i, S, 'rgba(0,0,0,.30)', 2);
        line(c, 0, i, S, i, 'rgba(0,0,0,.30)', 2);
        line(b, i, 0, i, S, '#404040', 3);
        line(b, 0, i, S, i, '#404040', 3);
      }
      for (let x = 12; x < S; x += 64) {
        for (let y = 12; y < S; y += 64) {
          c.fillStyle = 'rgba(255,255,255,.22)';
          c.beginPath(); c.arc(x, y, 3, 0, 6.284); c.fill();
          b.fillStyle = '#c8c8c8';
          b.beginPath(); b.arc(x, y, 3, 0, 6.284); b.fill();
        }
      }
      break;
    }
    case SURFACE.TEJADO: {
      // Tejas solapadas, en filas alternas.
      for (let y = 0, row = 0; y < S; y += 22, row += 1) {
        const off = row % 2 ? 16 : 0;
        for (let x = -32; x < S; x += 32) {
          c.strokeStyle = 'rgba(0,0,0,.34)'; c.lineWidth = 2;
          c.beginPath(); c.arc(x + off + 16, y, 16, 0, Math.PI); c.stroke();
          b.strokeStyle = '#4a4a4a'; b.lineWidth = 4;
          b.beginPath(); b.arc(x + off + 16, y, 16, 0, Math.PI); b.stroke();
        }
      }
      break;
    }
    case SURFACE.HIERBA: {
      // Briznas cortas en dos tonos.
      for (let i = 0; i < 460; i += 1) {
        const x = rnd() * S, y = rnd() * S, h = 3 + rnd() * 6;
        line(c, x, y, x + (rnd() - 0.5) * 3, y - h,
             rnd() > 0.5 ? 'rgba(255,255,255,.16)' : 'rgba(0,0,0,.22)', 1);
        line(b, x, y, x, y - h, '#a0a0a0', 1);
      }
      break;
    }
    case SURFACE.AGUA: {
      for (let y = 0; y < S; y += 9) {
        c.strokeStyle = 'rgba(255,255,255,.14)'; c.lineWidth = 2;
        c.beginPath();
        for (let x = 0; x <= S; x += 8) c.lineTo(x, y + Math.sin(x * 0.12 + y) * 2.5);
        c.stroke();
      }
      break;
    }
    default: {
      // Tierra: grano y piedrecillas.
      for (let i = 0; i < 900; i += 1) {
        const x = rnd() * S, y = rnd() * S, r = rnd() * 2.2;
        c.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.16)';
        c.beginPath(); c.arc(x, y, r, 0, 6.284); c.fill();
        b.fillStyle = rnd() > 0.5 ? '#989898' : '#686868';
        b.beginPath(); b.arc(x, y, r, 0, 6.284); b.fill();
      }
    }
  }

  const map = new THREE.CanvasTexture(color);
  const bumpTex = new THREE.CanvasTexture(bump);
  for (const t of [map, bumpTex]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
  }
  map.colorSpace = THREE.SRGBColorSpace;
  return { map, bump: bumpTex };
}

/**
 * Colorea a Borislov, POR NOMBRE DE MALLA.
 *
 * Sus materiales originales son procedurales (Noise -> ColorRamp -> Base Color) y eso
 * no tiene equivalente en glTF: al exportar se perdian y las piezas llegaban en gris.
 * Esta tabla era la unica forma de que Borislov tuviera color.
 *
 * YA NO ES LA FUENTE DE VERDAD, ES EL RESPALDO. Desde que `build_character.py` hornea la
 * paleta de la receta en el Base Color, el GLB llega con su color y manda el GLB — que
 * es lo que hace que cambiar un color en `recipes/borislov.json` se vea en el juego. La
 * tabla se queda para los modelos que NO traen color, que hoy son el `borislov_mixamo`
 * de la epoca de Mixamo y cualquier GLB exportado a mano. Ver `traeColorPropio`.
 *
 * Aviso para quien venga a cambiar un color aqui y no vea nada: si el modelo cargado es
 * el de la receta, el sitio es el JSON, no esta tabla. La consola lo dice al cargar.
 *
 * ANTES SE INDEXABA POR NUMERO DE TRIANGULOS. La tabla decia `[100528, 'cuerpo']`,
 * `[14064, 'gorra']`… y funcionaba, pero **cualquier reexportacion del modelo cambia
 * esos numeros y rompe todo el color en silencio**: no lanza error, simplemente deja
 * de encontrar mallas y el personaje sale gris. Era TDB-036, y bloqueaba la spec 023
 * entera: no se podia arreglar el modelo sin romper el color.
 *
 * Los nodos del GLB SI tienen nombre —`Body`, `Cap`, `Cord`, `Eye`, `EyeBow`,
 * `EyeLid`, `HairBase`, `Horn`— aunque las mallas se llamen `Mesh.001`. Es el nombre
 * del NODO lo que se mira, y sobrevive a reexportar.
 *
 * Y falla RUIDOSAMENTE: si aparece una malla que no esta en la tabla, lo dice. El
 * fallo silencioso es justo lo que se esta corrigiendo.
 */
const BORISLOV_LOOK = {
  Body:     { color: 0xf3ece2, roughness: 0.85, metalness: 0.0 },
  // Las dos prendas de la spec 023. YA vienen en el GLB: no salian porque el master las
  // guarda ocultas para poder modelar el cuerpo y el exportador va con `use_visible`.
  // Lo enciende `_mostrar` en `build_character.py`. Su color real sale de la receta;
  // estos valores solo se usan con un GLB que no traiga ninguno.
  Hodie:    { color: 0x2ed8ee, roughness: 0.70, metalness: 0.0 },
  Pants:    { color: 0x1e3a5f, roughness: 0.80, metalness: 0.0 },
  Cap:      { color: 0x7c3aed, roughness: 0.70, metalness: 0.0 },
  Cord:     { color: 0x2ed8ee, roughness: 0.55, metalness: 0.0 },
  HairBase: { color: 0xd8c4a0, roughness: 0.90, metalness: 0.0 },
  Horn:     { color: 0xb9a48a, roughness: 0.60, metalness: 0.0 },
  EyeLid:   { color: 0xf3ece2, roughness: 0.85, metalness: 0.0 },
  EyeBow:   { color: 0x6b5a45, roughness: 0.90, metalness: 0.0 },
  // Los ojos brillan un poco: es lo que les da vida a esta distancia.
  Eye:      { color: 0x1a1626, roughness: 0.25, metalness: 0.1,
              emissive: 0x2a2440, emissiveIntensity: 0.5 },
};

/**
 * Un GLB trae su propia paleta si lo construyo `build_character.py` desde una receta.
 *
 * Lo dice una FIRMA, no el color. El build escribe `borislov_receta` en la escena de
 * Blender, el exportador la saca como `extras` y el `GLTFLoader` la deja en
 * `gltf.scene.userData`. Si esta, los colores del archivo son los de la receta y no se
 * repintan; si no esta, el modelo no sabe de que color es y manda `BORISLOV_LOOK`.
 *
 * Deducirlo del color NO funciona, y esta medido. `baseColorFactor` es opcional en glTF
 * —cuando falta, la especificacion dice blanco puro—, pero el GLB de la epoca de Mixamo
 * no lo omite: lleva **`#E6E6E6` en sus ocho materiales**, que es el Base Color del
 * Principled del .blend fuente y **no pinta nada** (el color de verdad vivia en la rampa
 * de ruido, que glTF no sabe exportar). Con la regla «si no es blanco puro, trae color»,
 * aquel modelo pasaba el filtro y salia entero en gris claro. Se vio en pantalla.
 */
function traeSuPaleta(raiz) {
  return !!raiz && !!raiz.userData && typeof raiz.userData.borislov_receta === 'string';
}

function paintBorislov(root) {
  const desconocidas = [];
  let pintadas = 0;

  // ---- el color de la receta manda sobre la tabla ----
  //
  // Y ademas la tabla NO PUEDE pintar bien un modelo de receta: una malla llega partida
  // en varios materiales —`Body` son cuatro: piel, pezunas, interior de oreja y
  // detalles— y la tabla solo sabe de un color por pieza. Repintar aplastaria las cuatro
  // zonas en una sola.
  const suya = traeSuPaleta(root);

  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    // El nombre puede estar en el nodo o en su padre segun como venga el GLB.
    const nombre = BORISLOV_LOOK[o.name] ? o.name
                 : (o.parent && BORISLOV_LOOK[o.parent.name] ? o.parent.name : null);
    if (!nombre) { desconocidas.push(o.name); return; }

    o.userData.part = nombre;
    pintadas += 1;
    if (suya) return;

    const look = BORISLOV_LOOK[nombre];
    o.material = new THREE.MeshStandardMaterial({
      color: look.color,
      roughness: look.roughness,
      metalness: look.metalness,
      emissive: look.emissive ?? 0x000000,
      emissiveIntensity: look.emissiveIntensity ?? 0,
    });
  });

  // Si no se pinto nada es que no es Borislov (el X Bot son 2 mallas sin estos
  // nombres): se deja como esta y no se avisa, porque es el caso normal del banco.
  if (pintadas === 0) return;
  console.info(suya
    ? `[borislov] paleta desde el GLB (receta "${root.userData.borislov_receta}") en ${pintadas} mallas`
    : `[borislov] paleta desde BORISLOV_LOOK en ${pintadas} mallas — el GLB no trae receta`);
  if (desconocidas.length) {
    console.warn('[borislov] mallas sin color declarado:', desconocidas.join(', '),
                 '— añadelas a BORISLOV_LOOK o saldran en gris');
  }
}

/** Paleta del confeti de cierre: los cuatro acentos del proyecto. */
const CODA_COLORS = [0xf59e0b, 0x2ed8ee, 0xe62a9e, 0x7c3aed];

/** Modelo que se muestra en el pedestal de cada prop, antes de equiparlo. */
const PROP_URLS = {
  botas: './public/models/props/botas.glb',
  tenis: './public/models/props/tenis.glb',
  guante: './public/models/props/guante.glb',
  cuerno: './public/models/props/cuerno.glb',
};

/**
 * Chispas que cuesta abrir un Portal de Idea temporal.
 *
 * Tres, y no una: tiene que doler. Es el unico uso que cambia la ruta en vez de
 * resolver un obstaculo puntual, asi que si fuera barato nadie volveria a buscar
 * los caminos del nivel — abriria un portal y ya.
 */
const CAST_COST = 3;



/**
 * CICLO DEL PORTAL DE IDEA, en pulsos. Desde que se pulsa hasta que vuelve a poder
 * pulsarse, gesto incluido.
 *
 * **Nueve pulsos = 4,865 s.** Va en pulsos y no en segundos porque todo lo que dura
 * algo en este juego se declara en la rejilla, y porque a 111 BPM una recarga que cae
 * en el pulso se siente parte de la pieza en vez de un cronometro aparte.
 *
 * ## De donde viene, porque el numero de antes estaba mal por dos sitios
 *
 * Antes era `gesture + 8.0`, o sea **10,85 s**, y el razonamiento escrito era: "mas
 * que el propio portal en pantalla (12 s) menos su gesto, para que no se puedan
 * encadenar dos". Dos problemas:
 *
 *  1. **La cuenta no daba.** 10,85 s de recarga contra un portal que vive 12 s mas
 *     0,55 de construccion: la recarga terminaba **1,7 s antes** de que el arco
 *     caducara. La tecla se pintaba lista y pulsarla no hacia nada, porque
 *     `openTemporary` se negaba a abrir un segundo.
 *  2. **Esperar no es decidir.** El coste de mover el portal son 3 Chispas, que es un
 *     recurso escaso de verdad; los trece segundos no anadian una decision, la
 *     aplazaban. Ahora el portal nuevo SUSTITUYE al viejo y el gate es la munición.
 */
const PORTAL_CICLO_PULSOS = 9;

/**
 * Material del disco de portal en el suelo.
 *
 * El patron gira y late como antes, pero encima corre una ONDA RADIAL que sale del
 * centro hacia el borde. Es la misma idea que el arco: algo que empuja hacia fuera,
 * no una calcomania que parpadea. Se hace en el shader porque es una funcion del
 * radio — hacerlo con geometria pediria un anillo animado por frame.
 *
 * Se parte del material basico de three.js y se le injerta el efecto en el
 * `onBeforeCompile`, para no perder el resto del pipeline (niebla, tono, blending).
 */
function makePortalDiscMaterial(map) {
  const mat = new THREE.MeshBasicMaterial({
    map, color: 0x7c3aed,
    transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false, fog: false,
    side: THREE.DoubleSide,
  });

  mat.userData.uniforms = {
    uTime: { value: 0 },
    uPulse: { value: 0 },     // 1 justo tras un cruce, decae
  };

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = mat.userData.uniforms.uTime;
    shader.uniforms.uPulse = mat.userData.uniforms.uPulse;

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        uniform float uPulse;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          // Radio normalizado desde el centro del disco.
          float r = length(vMapUv - 0.5) * 2.0;

          // Onda que viaja hacia fuera. Tres crestas para que se lea como
          // ondulacion y no como un unico anillo subiendo.
          float onda = sin(r * 9.0 - uTime * 3.2) * 0.5 + 0.5;
          // Se apaga en el centro y en el borde: nace y muere dentro del disco.
          onda *= smoothstep(0.0, 0.25, r) * smoothstep(1.0, 0.65, r);

          // El pulso del cruce lanza una cresta mas marcada y mas rapida.
          float cruce = sin(r * 14.0 - uPulse * 22.0) * 0.5 + 0.5;
          cruce *= uPulse * smoothstep(1.0, 0.4, r);

          diffuseColor.rgb *= 0.55 + onda * 0.9 + cruce * 1.6;
          diffuseColor.a *= 0.45 + onda * 0.55 + cruce * 0.8;
          // Se recorta a circulo: el plano es cuadrado y sus esquinas se ven.
          if (r > 1.0) discard;
        }`);
  };

  return mat;
}

/** Color hacia el que se apaga el personaje cuando esta en la capa trasera. */
const BACK_LAYER_TINT = new THREE.Color(0x4a5580);

/** Entrada muerta: se usa mientras dura la transicion de portal. */
const NULL_INPUT = {
  axisX: 0,
  isDown: () => false,
  justPressed: () => false,
  justReleased: () => false,
  endFrame: () => {},
};

export function createGame(container, options = {}) {
  const modelUrl = options.modelUrl || './public/models/xbot_test.glb';
  const noiseUrl = options.noiseUrl || './public/textures/noise.png';
  const level = options.level || TEST_LEVEL;
  // Aviso de accion contextual. El texto va en un span; la caja que se muestra y
  // se oculta es su contenedor.
  const promptEl = options.promptEl || null;
  const promptBox = promptEl ? promptEl.parentElement : null;
  const promptBarEl = options.promptBarEl || null;
  const ammoEl = options.ammoEl || null;
  const ammoNumEl = ammoEl ? ammoEl.querySelector('#ammo-n') : null;
  const radioEl = options.radioEl || null;
  const radioBars = radioEl ? [...radioEl.querySelectorAll('.barras u')] : [];
  const logroEl = options.logroEl || null;
  const logroSubEl = logroEl ? logroEl.querySelector('#logro-sub') : null;
  const tutoEl = options.tutoEl || null;
  const tutoKeyEl = tutoEl ? tutoEl.querySelector('b') : null;
  const tutoTextEl = tutoEl ? tutoEl.querySelector('span') : null;
  const skillsEl = options.skillsEl || null;
  const skillThrow = skillsEl ? skillsEl.querySelector('#sk-throw') : null;
  const skillPortal = skillsEl ? skillsEl.querySelector('#sk-portal') : null;

  /**
   * Pinta una tecla de la barra de habilidades.
   *
   * Tres estados y se distinguen sin leer: bloqueada (apagada, con candado), lista
   * (encendida) y recargando (la barra sube tapando la tecla, con los segundos que
   * faltan). Sin esto, pulsar `R` y que no pase nada tiene tres causas posibles y
   * ninguna se ve.
   */
  function pintarHabilidad(el, desbloqueada, cooldown, total) {
    if (!el) return;
    const recargando = desbloqueada && cooldown > 0.02;
    el.classList.toggle('bloqueada', !desbloqueada);
    el.classList.toggle('lista', desbloqueada && !recargando);
    el.classList.toggle('recargando', recargando);
    el.querySelector('u').style.height = recargando
      ? `${Math.min(100, (cooldown / total) * 100)}%` : '0%';
    if (recargando) el.dataset.left = cooldown.toFixed(1);
    else delete el.dataset.left;
  }

  /**
   * Tutorial persistente: aparece al desbloquear algo y NO se va hasta que se usa.
   *
   * Un aviso con temporizador se lo pierde quien este mirando otra cosa — que es
   * exactamente lo que pasa justo despues de recoger algo, cuando la atencion esta
   * en el objeto y no en el HUD. Esperar a que se use lo garantiza.
   */
  let tuto = null;

  function mostrarTutorial(key, texto, cumplido) {
    if (!tutoEl) return;
    tuto = { cumplido };
    tutoKeyEl.textContent = key;
    tutoTextEl.textContent = texto;
    tutoEl.classList.add('on');
  }

  function revisarTutorial() {
    if (!tuto) return;
    if (!tuto.cumplido()) return;
    tuto = null;
    tutoEl.classList.remove('on');
    sfx?.play('achievement', { volume: 0.35, pitch: 1.4 });
  }

  /** Habilidades ya ejercidas: es lo que apaga cada tutorial. */
  const usado = { throw: false, portal: false };

  // -------------------------------------------------------------------- logros
  //
  // R5 §3 dejaba el eslabon de "progresion" en amarillo con una nota exacta: existe
  // (guantes -> botas -> motor) pero **no se anuncia**. El jugador hacia cosas
  // dificiles y el juego no se daba por enterado hasta el cartelon final.
  //
  // Dos decisiones que hacen que esto no sea un cartel con animacion:
  //
  //  1. **Cada logro entrega algo.** Es la "compensacion": municion, o adelantar las
  //     recargas. Un logro que solo felicita es reconocimiento, no recompensa, y el
  //     jugador aprende en dos repeticiones a ignorarlo. Lo comprueba una prueba:
  //     `todo logro entrega algo, no solo un cartel`.
  //  2. **Se encolan.** Dos logros a la vez —terminar la etapa 3 completa el objetivo
  //     Y el 100 % de las chispas— se pisaban y solo se veia el segundo.
  const LOGROS = level.logros || {};
  const logrosGanados = new Set();
  const logroCola = [];
  let logroActivo = null;

  /**
   * Concede un logro. Idempotente: pedirlo dos veces no lo repite ni paga dos veces.
   * @returns {boolean} si se concedio ahora
   */
  function conceder(id) {
    const logro = LOGROS[id];
    if (!logro || logrosGanados.has(id)) return false;
    logrosGanados.add(id);

    // ---- la compensacion, ANTES del cartel ----
    //
    // Primero se paga y luego se anuncia: si se anuncia primero, el jugador mira el
    // HUD, ve subir el contador y no sabe si es del logro o de otra cosa. Pagando
    // antes, el cartel llega cuando el contador ya subio y la relacion se lee.
    if (logro.da?.chispas) {
      routeTaken += logro.da.chispas;
      // Y VIAJAN. Se reutiliza el vuelo de las chispas recogidas para que la
      // recompensa entre por el mismo sitio por el que entra todo lo que se gana en
      // este juego, en vez de aparecer en el contador de la nada.
      for (let i = 0; i < logro.da.chispas; i += 1) {
        setTimeout(() => flyToCounter(player.position.x, player.position.y + 1.2,
                                      LAYER_Z[player.layer], true), i * 110);
      }
    }
    if (logro.da?.recarga) {
      throwCooldown = 0;
      castCooldown = 0;
    }

    logroCola.push({ id, logro });
    return true;
  }

  /**
   * Saca el siguiente logro de la cola y lo enseña. El cartel dura 2 compases: es
   * narrativo, asi que va en compases y no en "tres segundos".
   */
  function actualizarLogros(dt) {
    if (logroActivo) {
      logroActivo.t -= dt;
      if (logroActivo.t > 0) return;
      logroActivo = null;
      if (logroEl) logroEl.classList.remove('on');
      return;
    }
    const siguiente = logroCola.shift();
    if (!siguiente) return;

    logroActivo = { ...siguiente, t: (choreo?.barSeconds || 2.16) * 2 };
    if (logroEl) {
      logroEl.querySelector('b').textContent = siguiente.logro.titulo;
      if (logroSubEl) logroSubEl.textContent = siguiente.logro.sub || '';
      logroEl.classList.add('on');
    }
    // El sonido en dos golpes, el segundo una quinta arriba: es el acorde que el
    // oido lee como "premio" sin necesidad de un jingle propio.
    sfx?.play('achievement', { volume: 0.7 });
    setTimeout(() => sfx?.play('achievement', { volume: 0.45, pitch: 1.5 }), 150);
    postfx.aberrationImpulse(0.5);
    particles.burst(player.position.x, player.position.y + 1.0,
                    LAYER_Z[player.layer], 0xf59e0b, 22, 2.6);
  }

  // ------------------------------------------------- chispas en vuelo al contador
  //
  // Recoger algo y que solo suba un numero no se siente como recogerlo. La chispa
  // tiene que VIAJAR: sale de donde estaba, describe un arco y aterriza en su
  // contador, que acusa el golpe. Es lo que conecta el mundo con el HUD.
  //
  // Van en DOM y no en la escena porque el destino es un elemento de pantalla;
  // proyectar el HUD al mundo para animarlas en 3D seria dar la vuelta al problema.
  const flyEl = options.flyEl || null;
  const FLY_POOL = 14;
  const flights = [];
  if (flyEl) {
    for (let i = 0; i < FLY_POOL; i += 1) {
      const el = document.createElement('i');
      flyEl.appendChild(el);
      flights.push({ el, t: -1 });
    }
  }
  let flyCursor = 0;
  const _proj = new THREE.Vector3();

  // Cache de las medidas del HUD. Se invalida al redimensionar, que es lo unico que
  // puede cambiarlas.
  let _hudCache = null;
  function medidasHud() {
    if (_hudCache) return _hudCache;
    const rect = renderer.domElement.getBoundingClientRect();
    const host = flyEl.getBoundingClientRect();
    const punto = (sel) => {
      const el = ammoEl.querySelector(sel) || ammoEl;
      const b = el.getBoundingClientRect();
      return { x: b.left + b.width / 2 - host.left, y: b.top + b.height / 2 - host.top };
    };
    _hudCache = {
      rect, host,
      targets: { ruta: punto('.c-ruta'), secreta: punto('.c-secreta') },
    };
    return _hudCache;
  }

  /**
   * Lanza una chispa desde un punto del MUNDO hacia su contador.
   * @param {boolean} isRoute cian (munición) o dorada (colección)
   */
  function flyToCounter(x, y, z, isRoute) {
    if (!flyEl || !ammoEl) return;
    const slot = flights[flyCursor];
    flyCursor = (flyCursor + 1) % FLY_POOL;

    // Origen: la posicion del mundo proyectada a pantalla.
    _proj.set(x, y, z).project(camera);
    // Las medidas del DOM van CACHEADAS. `getBoundingClientRect` fuerza al navegador
    // a recalcular el layout, y llamarlo tres veces por recogida —mas el reflow del
    // pulso del contador— es lo que producia el tiron al coger un tornillo. Nada de
    // esto cambia salvo al redimensionar, asi que se mide una vez.
    const { rect, host, targets } = medidasHud();
    // Si la chispa se recogio fuera de cuadro, el origen se pega al borde: sin esto
    // el vuelo entra como un rayo desde fuera y no se lee de donde viene.
    const sx = Math.max(-40, Math.min(host.width + 40,
      (_proj.x * 0.5 + 0.5) * rect.width + rect.left - host.left));
    const sy = Math.max(-40, Math.min(host.height + 40,
      (-_proj.y * 0.5 + 0.5) * rect.height + rect.top - host.top));

    // Destino: el contador que le toca, cian o dorado.
    const tb = isRoute ? targets.ruta : targets.secreta;
    const tx = tb.x;
    const ty = tb.y;

    slot.t = 0;
    slot.dur = 0.55 + Math.random() * 0.12;   // se escalonan si llegan varias juntas
    slot.x0 = sx; slot.y0 = sy;
    slot.x1 = tx; slot.y1 = ty;
    // Punto de control del arco: por encima del camino, con un desvio lateral
    // aleatorio. Una recta se ve mecanica; el arco se ve lanzado.
    slot.cx = (sx + tx) / 2 + (Math.random() - 0.5) * 120;
    slot.cy = Math.min(sy, ty) - 60 - Math.random() * 70;
    slot.isRoute = isRoute;
    slot.el.className = isRoute ? 'ruta' : 'secreta';
  }

  /**
   * El contador acusa la llegada de una chispa.
   *
   * Aqui vivia un TIRON, y de los que la constitucion nombra por su nombre: *"nada de
   * layout thrashing. Leer `getBoundingClientRect()` en el bucle ya provoco un
   * tartamudeo al recoger objetos"*. El codigo era
   *
   *     ammoEl.classList.remove('recibe');
   *     void ammoEl.offsetWidth;          // <- reflow SINCRONO forzado
   *     ammoEl.classList.add('recibe');
   *
   * Ese `offsetWidth` es el truco clasico para reiniciar una animacion CSS, y lo que
   * hace es obligar al navegador a **recalcular el layout de la pagina entera** en
   * mitad del frame. Con el HUD abierto —dos paneles, la lista de comprobaciones, la
   * barra de habilidades— eso se paga en milisegundos, y se paga UNA VEZ POR CHISPA:
   * al recoger varias seguidas, varias veces en el mismo frame.
   *
   * La API de animaciones web hace lo mismo sin tocar el layout: cada llamada crea su
   * propia animacion y no hay nada que reiniciar. Si el navegador no la trae, se cae
   * a la clase de siempre — el tiron es preferible a no ver el acuse.
   */
  let _pulsoContador = null;
  function acusarRecibo() {
    if (!ammoEl) return;
    if (typeof ammoEl.animate !== 'function') {
      ammoEl.classList.remove('recibe');
      ammoEl.classList.add('recibe');
      return;
    }
    // Se cancela la anterior en vez de dejar que se acumulen: dos pulsos solapados se
    // multiplican y el contador pega un bote.
    _pulsoContador?.cancel();
    _pulsoContador = ammoEl.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }],
      { duration: 220, easing: 'cubic-bezier(.2,.9,.3,1)' }
    );
  }

  /**
   * El contador dice "no tienes bastantes". Mismo motivo que `acusarRecibo`, y ademas
   * este se dispara MANTENIENDO la tecla: con el reflow forzado, insistir en lanzar
   * sin munición recalculaba el layout entero varias veces por segundo.
   */
  let _pulsoNope = null;
  function avisarSinChispas() {
    if (!ammoEl) return;
    if (typeof ammoEl.animate !== 'function') {
      ammoEl.classList.remove('nope');
      ammoEl.classList.add('nope');
      return;
    }
    _pulsoNope?.cancel();
    _pulsoNope = ammoEl.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' },
       { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }],
      { duration: 180, easing: 'ease-out' }
    );
  }

  /** Avanza las chispas en vuelo. Se llama una vez por frame. */
  function updateFlights(dt) {
    for (const f of flights) {
      if (f.t < 0) continue;
      f.t += dt / f.dur;

      if (f.t >= 1) {
        f.t = -1;
        f.el.style.opacity = '0';
        acusarRecibo();
        continue;
      }

      // Bezier cuadratica: origen -> control -> contador.
      const k = f.t;
      const inv = 1 - k;
      const px = inv * inv * f.x0 + 2 * inv * k * f.cx + k * k * f.x1;
      const py = inv * inv * f.y0 + 2 * inv * k * f.cy + k * k * f.y1;

      // Crece a mitad de camino y se encoge al llegar: da la sensacion de que se
      // acerca a camara y luego entra en el contador.
      const scale = 0.6 + Math.sin(k * Math.PI) * 1.1;
      f.el.style.transform = `translate(${px}px, ${py}px) scale(${scale})`;
      f.el.style.opacity = String(Math.min(1, (1 - k) * 3));
    }
  }
  const secretNumEl = ammoEl ? ammoEl.querySelector('#secret-n') : null;

  // Preferencias del jugador. Se aplican en cuanto existen los buses de audio; si
  // se cambian antes de arrancar la musica, quedan guardadas y se aplican al crearlos.
  let volumes = { master: 1, music: 1, sfx: 1, voice: 1 };
  const opts = { subtitles: true, reduceMotion: false, reduceFlash: false };

  function applyVolumes() {
    const m = volumes.master;
    // Un parametro, un dueño: se pide el cambio, no se escribe el nodo. Escribirlo
    // aqui es lo que peleaba con la rampa de la pausa (TDB-004).
    choreo?.setBaseGain?.(0.85 * volumes.music * m);
    sfx?.setVolume?.(0.55 * volumes.sfx * m);
    if (dialogue?.bus) dialogue.bus.gain.value = 0.62 * volumes.voice * m;
    if (dialogue?.radioBus) dialogue.radioBus.gain.value = 0.40 * volumes.voice * m;
  }

  // ------------------------------------------------------------------ render
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  /**
   * DESTELLO A PANTALLA COMPLETA.
   *
   * `TRANSITIONS` declara un `flash` para cinco de sus seis entradas —`trance` 0,55,
   * `flash` 1,0, `whip` 0,15— y `TransitionPlayer` lo calculaba cada frame como un
   * pico alrededor del punto de ocultación… **y nadie lo dibujaba**. El valor existía
   * y no llegaba a ninguna parte, así que el recurso más barato del diccionario para
   * tapar un cambio no estaba haciendo nada.
   *
   * Va en DOM y no en un pase de post-proceso a propósito: es un rectángulo blanco a
   * pantalla completa, o sea justo lo que el compositor del navegador hace gratis, y
   * un pase más costaría un render target contra el presupuesto del GDD §10.12.
   *
   * Respeta la preferencia de accesibilidad: con `reduceFlash` no pasa de 0,22.
   */
  const flashEl = document.createElement('div');
  flashEl.style.cssText = 'position:absolute;inset:0;background:#fff;opacity:0;'
                        + 'pointer-events:none;mix-blend-mode:screen;z-index:5';
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  container.appendChild(flashEl);
  let destelloExtra = 0;
  /** Destello puntual, además del de la transición. Decae solo. */
  function destello(cantidad) { destelloExtra = Math.max(destelloExtra, cantidad); }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050a2e);
  scene.fog = new THREE.Fog(0x050a2e, 26, 80);

  // Tablas de reactividad, ahora en datos (TDB-005).
  const AMBIENTES = level.ambientes || {};
  const ENCUADRES = level.encuadres || {};

  const camera = new THREE.PerspectiveCamera(VISTA_BASE.fov, 1, 0.1, 200);
  camera.position.set(0, 3, 18);

  scene.add(new THREE.HemisphereLight(0x9fb4ff, 0x1a1030, 1.2));
  const key = new THREE.DirectionalLight(0xfff0d8, 2.2);
  key.position.set(6, 12, 8);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const d = 18;
  Object.assign(key.shadow.camera, { top: d, bottom: -d, left: -d, right: d, near: 1, far: 60 });
  scene.add(key);
  scene.add(key.target);

  const rim = new THREE.DirectionalLight(0x2ed8ee, 0.8);
  rim.position.set(-8, 5, -6);
  scene.add(rim);

  const postfx = new PostFX(renderer, scene, camera);
  const particles = new Particles(scene);
  /**
   * Viento por particulas extruidas. Un draw call, apagado por completo en los seis
   * tramos que no lo declaran. Se sopla desde `stages[].viento` y desde la caida.
   */
  const viento = new Viento(scene);
  // El area se recalcula cada frame con fitTo(); esta es solo la semilla inicial.
  particles.enableAmbient(170, { w: 34, h: 12 });

  // Capas horneadas desde Blender. Si no estan, el juego funciona igual.
  const parallax = new Parallax(
    scene,
    options.scenarioUrl || './public/scenario/caprilopolis/scenario.json',
    16
  );
  parallax.load()
    .then((m) => log(`parallax: ${m.layers.length} capas`))
    .catch(() => console.warn('[parallax] sin escenario horneado, se usa el fondo liso'));

  function log(msg) { console.log('[game] ' + msg); }

  // ------------------------------------------------------------------- nivel
  const world = new CollisionWorld(level.solids.slice());
  // Se crea DESPUES del mundo: necesita sondear el terreno para no atravesarlo.
  const drone = new Drone(scene, { ...(level.drone || {}), world });
  // Chorros del robot: solo se usan en la etapa 3, pero el pool se crea una vez.
  //
  // Partidos en dos por la spec 035: `Projectiles` lleva la parabola y la colision,
  // `ProjectileViews` la esfera, el halo y la estela.
  const shots = new Projectiles({ radius: 0.9, gravity: 11.0 });
  const shotViews = new ProjectileViews(scene, shots.shots,
    { color: 0x2ed8ee, layerZ: LAYER_Z, particles });
  // Chispas lanzadas por el jugador. Pool aparte del robot: colores, radios y
  // reglas de impacto distintas, y asi ninguno puede quedarse sin hueco por culpa
  // del otro en mitad del climax.
  // Gravedad alta y vuelo largo: la Chispa describe un arco AMPLIO, que es lo
  // que permite leerla en el aire y apuntar con ella.
  const throwsPool = new Projectiles({ radius: 0.85, gravity: 16.0 });
  const throwViews = new ProjectileViews(scene, throwsPool.shots,
    { color: 0xf59e0b, layerZ: LAYER_Z, particles, trailStep: 0.22 });

  // La chispa que el personaje LLEVA en la mano durante el gesto. Sin ella el
  // proyectil aparece de la nada a media animacion y el lanzamiento no se cree.
  const heldSpark = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.14, 0),
    new THREE.MeshBasicMaterial({ color: 0xf59e0b, fog: false })
  );
  heldSpark.visible = false;
  scene.add(heldSpark);
  const heldLight = new THREE.PointLight(0xf59e0b, 1.6, 3.5, 2);
  heldSpark.add(heldLight);
  const levelGroup = new THREE.Group();
  scene.add(levelGroup);

  const DEPTH = 2.6;
  const surfaceMats = new Map();

  // Rompibles. Sus cajas se AÑADEN al mundo de colision, asi que la fisica los trata
  // como cualquier plataforma; al romperse se retiran y el hueco queda libre.
  //
  // Partidos en dos por la spec 035: `Breakables` lleva cuanto aguanta cada uno y
  // cuando cede; `BreakableViews` los dibuja. La rotura llega por la cola de eventos
  // (`EV.ROTURA`), no por un hook — es un HECHO, y el render decide que humo sacar.
  const breakables = new Breakables(level.breakables || [], {
    onDrop: (x, y, capa) => {
      // Lo que SUELTA si va por hook y no por evento: crea una chispa recogible, que
      // es estado de partida, no un efecto.
      const z = LAYER_Z[capa];
      // Suelta una Chispa de ruta: romper da munición, asi que abrir cosas paga.
      // Con el Motor de Idea sueltan dos, que es lo que hace que romper cosas
      // merezca el rodeo en vez de ser un adorno.
      const cuantas = props?.can('motor') ? 2 : 1;
      for (let i = 0; i < cuantas; i += 1) {
        const dx = (i - (cuantas - 1) / 2) * 0.35;
        loose.push({ x: x + dx, y, z, vy: 4.0 + i * 0.6, life: 8, taken: false,
                     mesh: makeLooseSpark(x + dx, y, z) });
      }
    },
  });
  const breakableViews = new BreakableViews(scene, breakables.items, LAYER_Z);

  /**
   * Lo que se ve al romperse algo.
   *
   * Lo llama el vaciado de la cola de eventos, no el rompible: `p_breakables` emite
   * que algo cedio y aqui se decide que significa.
   */
  function efectoRotura(x, y, capa, kindId) {
    const kind = kindId === 2 ? BREAK_KINDS.barril : kindId === 3 ? BREAK_KINDS.maceta
               : BREAK_KINDS.caja;
    const z = LAYER_Z[capa];

    // ---- humo ----
    // Los cascotes solos se ven pobres: salen y se acaban. El humo es lo que deja
    // el hueco "sucio" un segundo y hace que parezca que ahi habia algo. Va en
    // tres tandas escalonadas para que la nube crezca en vez de aparecer entera.
    for (let i = 0; i < 3; i += 1) {
      setTimeout(() => {
        for (let k = 0; k < 5; k += 1) {
          particles.airBurst(
            x + (Math.random() - 0.5) * 1.3,
            y + (Math.random() - 0.5) * 0.9,
            z + (Math.random() - 0.5) * 0.8,
            0xb8b0a4,            // humo gris pardo, no del color de la caja
            4, 1.1 + i * 0.4
          );
        }
      }, i * 55);
    }
    // Y los cascotes, del color de lo que se rompio.
    particles.burst(x, y, z, kind.color, kind.shards, 3.2);
    particles.land(x, y - kind.size[1] / 2, z, SURFACE.MADERA, true);
    particles.shockwaveAmbient(x, y, 0.55);
    groundShockwave(x, y - 0.3, z,
                    { radius: 2.4, power: 0.7, speed: 3.0, color: kind.color });
    sfx?.play('land_hard', { volume: 0.5, pitch: 1.4 });
    sfx?.play('spark', { volume: 0.35, pitch: 0.7 });
    shakeImpulse = Math.max(shakeImpulse, 0.22);
    rebuildSolids();
  }

  /** Chispas sueltas que caen de los rompibles. */
  const loose = [];
  function makeLooseSpark(x, y, z) {
    const m = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.16, 0),
      new THREE.MeshStandardMaterial({
        color: 0x2ed8ee, emissive: 0x2ed8ee, emissiveIntensity: 1.8, roughness: 0.3,
      })
    );
    m.position.set(x, y, z);
    scene.add(m);
    return m;
  }

  // Partidas en dos por la spec 035: `Pushables` lleva el empuje, la caida y el
  // contacto; `PushableViews`, el metal, el marco cian y las flechas.
  const pushables = new Pushables(level.pushables || [], world);
  const pushableViews = new PushableViews(scene, pushables.items, LAYER_Z);

  /**
   * Reconstruye la lista de solidos.
   *
   * Los rompibles enteros cuentan y los rotos no; las empujables cuentan siempre,
   * porque su caja se MUEVE con ellas y la fisica la lee cada frame por referencia.
   */
  function rebuildSolids() {
    world.solids = level.solids.concat(breakables.solids, pushables.solids);
  }
  rebuildSolids();

  /** Escala las UV de una caja para que la textura mida ~1 m por repeticion. */
  function scaleUv(uv, w, h) {
    const out = new Float32Array(uv.length);
    // BoxGeometry ordena las caras: +X, -X, +Y, -Y, +Z, -Z, 4 vertices cada una.
    // Las laterales usan la altura; la de arriba y abajo, el ancho.
    const perFace = 8;
    const scales = [
      [DEPTH, h], [DEPTH, h],      // laterales
      [w, DEPTH], [w, DEPTH],      // arriba y abajo
      [w, h], [w, h],              // frente y fondo
    ];
    for (let f = 0; f < 6; f += 1) {
      const [su, sv] = scales[f];
      for (let i = 0; i < perFace; i += 2) {
        const k = f * perFace + i;
        out[k] = uv[k] * su;
        out[k + 1] = uv[k + 1] * sv;
      }
    }
    return out;
  }
  for (const solid of level.solids) {
    const layer = solid.layer ?? 0;
    const base = new THREE.Color(SURFACE_COLOR[solid.surface] ?? 0x6b5a45);

    // La capa trasera se dibuja desaturada y mas oscura (plan §25.3). Son dos
    // operaciones sobre el color, no un pase de render: cuesta cero.
    if (layer === 1) {
      const hsl = {};
      base.getHSL(hsl);
      base.setHSL(hsl.h, hsl.s * 0.28, hsl.l * 0.52);
    }

    // Un material por superficie y capa, compartido entre todas las plataformas que
    // lo usan: 12 materiales en total en vez de uno por solido.
    const matKey = `${solid.surface || 'tierra'}:${layer}`;
    let material = surfaceMats.get(matKey);
    if (!material) {
      const tex = makeSurfaceTexture(solid.surface || SURFACE.TIERRA, base);
      material = new THREE.MeshStandardMaterial({
        map: tex.map,
        bumpMap: tex.bump,
        bumpScale: layer === 1 ? 0.12 : 0.3,   // la capa trasera, mas plana
        roughness: solid.surface === SURFACE.AGUA ? 0.25 : 0.85,
        metalness: solid.surface === SURFACE.METAL ? 0.45 : 0.0,
      });
      surfaceMats.set(matKey, material);
    }

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(solid.w, solid.h, DEPTH), material);

    // La textura se repite por METRO, no por cara: si no, una plataforma de 55 m y
    // otra de 5 m mostrarian el mismo grano estirado a escalas distintas.
    mesh.geometry.attributes.uv.array.set(
      scaleUv(mesh.geometry.attributes.uv.array, solid.w, solid.h)
    );
    mesh.geometry.attributes.uv.needsUpdate = true;

    // Centrada en el plano de su capa: el personaje camina por la MITAD de la
    // plataforma en profundidad, no por el borde delantero.
    //
    // Estuvo un rato echada hacia atras media profundidad, para que la cara frontal
    // no tapara los pies. Era un parche sobre un sintoma: lo que ocultaba las
    // piernas no era el cubo, era el anclaje al suelo hundiendo al personaje casi
    // un metro. Arreglado aquello, el parche solo servia para descentrarlo.
    mesh.position.set(solid.x + solid.w / 2, solid.y + solid.h / 2, LAYER_Z[layer]);
    mesh.receiveShadow = true;
    mesh.castShadow = layer === 0;
    levelGroup.add(mesh);
  }

  /**
   * Velo de profundidad: un plano semitransparente ENTRE las dos capas jugables.
   *
   * Es el truco clasico y cuesta un solo draw call. Todo lo que quede detras
   * (la capa trasera y el parallax lejano) se ve a traves de el, y eso separa los
   * dos planos de un vistazo sin recurrir a un desenfoque, que exigiria un pase
   * de render extra y no cabe en el presupuesto.
   */
  const scrim = new THREE.Mesh(
    new THREE.PlaneGeometry(140, 60),
    new THREE.MeshBasicMaterial({
      color: 0x0a1040, transparent: true, opacity: 0.42,
      depthWrite: false, fog: false,
    })
  );
  scrim.position.set(0, 10, LAYER_Z[1] * 0.42);
  scrim.renderOrder = -5;
  scene.add(scrim);

  /**
   * Portales de suelo: el disco de patron bajo cada arco.
   *
   * Es la mitad que faltaba del Portal de Idea. El arco dice "hay un paso"; el disco
   * del suelo dice DONDE se pisa para cruzarlo, y al latir marca el pulso sin que
   * haya que mirar el HUD. La textura sale del pattern pack de Kenney.
   */
  const groundPortals = [];
  {
    const patternTex = new THREE.TextureLoader().load('./public/textures/pattern_portal.png');
    patternTex.colorSpace = THREE.SRGBColorSpace;
    patternTex.wrapS = patternTex.wrapT = THREE.RepeatWrapping;
    // Disco CIRCULAR, no cuadrado: un portal es un agujero redondo, y un plano
    // cuadrado con textura se le notan las esquinas por mucho que se difumine.
    const discGeo = new THREE.CircleGeometry(1.3, 48);

    for (const p of level.portals || []) {
      // Uno por capa: el portal comunica las dos, y desde cualquiera se ve el suyo.
      for (const layer of [0, 1]) {
        const disc = new THREE.Mesh(discGeo, makePortalDiscMaterial(patternTex));
        // Tumbado en el suelo, un pelo por encima para no pelear con el z-buffer.
        disc.rotation.x = -Math.PI / 2;
        disc.position.set(p.x + p.w / 2, p.y + 0.02, LAYER_Z[layer]);
        disc.renderOrder = 2;
        scene.add(disc);
        groundPortals.push(disc);
      }
    }
  }

  /**
   * Discos de aterrizaje: el mismo patron, pero de un solo uso.
   *
   * Se expanden y se apagan donde cae el jugador. Es el feedback que pedia una caida
   * larga — el polvo dice "he caido", el disco dice "he caido AQUI".
   */
  const landRings = [];
  {
    const ringGeo = new THREE.PlaneGeometry(1, 1);
    const waveTex = makeShockwaveTexture();
    for (let i = 0; i < 8; i += 1) {
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        map: waveTex, color: 0x2ed8ee,
        transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false, fog: false,
      }));
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      scene.add(ring);
      landRings.push({ mesh: ring, life: 0, radius: 3, power: 1, speed: 2.4 });
    }
  }
  let landRingCursor = 0;

  /**
   * Onda expansiva en el suelo.
   *
   * Radio y potencia son independientes a proposito: el radio dice HASTA DONDE llega
   * la onda y la potencia dice CUANTO se ve. Un aterrizaje suave es un anillo pequeño
   * y tenue; el mazazo del robot es uno grande y brillante; y una explosion puede ser
   * grande pero apagada.
   *
   * @param {object} [opt]
   * @param {number} [opt.radius] radio final en metros
   * @param {number} [opt.power]  0..1, intensidad y grosor
   * @param {number} [opt.speed]  velocidad de expansion (1 = ~1 s)
   * @param {number} [opt.color]  color del anillo
   */
  function groundShockwave(x, y, z, opt = {}) {
    const slot = landRings[landRingCursor];
    landRingCursor = (landRingCursor + 1) % landRings.length;
    slot.life = 1;
    slot.radius = opt.radius ?? 3.0;
    slot.power = opt.power ?? 1.0;
    slot.speed = opt.speed ?? 2.4;
    slot.mesh.material.color.setHex(opt.color ?? 0x2ed8ee);
    slot.mesh.position.set(x, y + 0.03, z);
    slot.mesh.visible = true;
  }

  /**
   * Arcos de meta: donde termina una etapa que se supera llegando a un punto.
   *
   * Es la respuesta a "la etapa 2 no se entiende cuando llega a su fin": si el
   * objetivo es correr hasta una x y esa x no existe visualmente, el jugador corre
   * sin referencia y el final le llega de sorpresa. El arco se ve de lejos, late al
   * pulso y se apaga al cruzarlo.
   */
  const goals = [];
  for (const stage of level.stages || []) {
    const obj = stage.objective;
    if (!obj?.goal || obj.x === undefined) continue;

    const group = new THREE.Group();
    group.position.set(obj.x, 0, LAYER_Z[obj.layer ?? 0]);

    const mat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b, transparent: true, opacity: 0.9, fog: false,
    });
    for (const side of [-1.7, 1.7]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 5.2, 0.16), mat);
      post.position.set(side, 2.6, 0);
      group.add(post);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.16, 0.16), mat);
    lintel.position.y = 5.2;
    group.add(lintel);

    // Cortina translucida entre los postes: se cruza, no se choca.
    const veil = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 5.2),
      new THREE.MeshBasicMaterial({
        color: 0xf59e0b, transparent: true, opacity: 0.14,
        side: THREE.DoubleSide, depthWrite: false, fog: false,
      })
    );
    veil.position.y = 2.6;
    group.add(veil);

    scene.add(group);
    goals.push({ stageId: stage.id, group, mat, veil });
  }

  // Postes kilometricos. Se apoyan en el terreno de cada punto, no en y=0: con
  // alturas cambiantes acababan flotando o enterrados segun el tramo.
  for (const x of level.markers || []) {
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 1.2, 0.06),
      new THREE.MeshBasicMaterial({ color: 0xf59e0b })
    );
    const ground = world.groundHeightAt(x, 0, 0);
    post.position.set(x, ground + 0.6, -1.5);
    levelGroup.add(post);
  }

  // ------------------------------------------------------------- chispas
  const sparkGeo = new THREE.IcosahedronGeometry(0.16, 0);
  // Dos clases de chispa, y se distinguen a simple vista:
  //   ruta    pequeñas y cian, marcan por donde se va y como saltar
  //   secreta grandes y doradas, premian salirse de la ruta
  // Sin esa diferencia el jugador no sabe cuando esta siguiendo el camino y cuando
  // ha encontrado algo, y las dos cosas dejan de significar nada.
  const sparks = (level.sparks || []).map((data) => {
    const isRoute = !!data.route;
    const mesh = new THREE.Mesh(sparkGeo, new THREE.MeshStandardMaterial({
      color: isRoute ? 0x2ed8ee : 0xf59e0b,
      emissive: isRoute ? 0x2ed8ee : 0xf59e0b,
      emissiveIntensity: isRoute ? 1.5 : 2.4,
      roughness: 0.3,
    }));
    mesh.scale.setScalar(isRoute ? 0.62 : 1.0);
    mesh.position.set(data.x, data.y, LAYER_Z[data.layer ?? 0]);
    scene.add(mesh);
    return { ...data, mesh, taken: false };
  });
  let sparksTaken = 0;
  // Dos cuentas distintas, porque son dos cosas distintas:
  //   ruta     cian, abundantes -> son la MUNICION, se gastan al lanzar
  //   secretas doradas, escasas -> son la COLECCION, no se gastan nunca
  let routeTaken = 0;
  let secretTaken = 0;
  const secretTotal = (level.sparks || []).filter((sp) => !sp.route).length;

  // ------------------------------------------------------------------- props
  // Piezas que se EQUIPAN, no que se cuentan. Se marcan como los tornillos —halo,
  // luz y flecha— porque cambiar lo que puedes hacer merece verse desde lejos.
  let props = null;   // se crea el PropSystem cuando el avatar existe
  // Inercia de orejas, barba y cola. Se crea junto al avatar y queda en null si el GLB
  // no trae los huesos secundarios, que es lo que pasa con cualquier modelo que haya
  // pasado por Mixamo: descarta los huesos que no reconoce (spec 022).
  let secondary = null;
  const propPickups = (level.props || []).map((data) => {
    const group = new THREE.Group();
    const z = LAYER_Z[data.layer ?? 0];
    // El suelo bajo el prop: el objeto FLOTA sobre el, no se apoya.
    const ground = world.groundHeightAt(data.x, data.layer ?? 0, data.y - 1.2);
    group.position.set(data.x, ground, z);
    scene.add(group);

    // Disco de portal en el suelo: es de donde "sale" el objeto. Reutiliza el mismo
    // patron que los Portales de Idea, porque narrativamente es lo mismo — algo que
    // el Proyector ha traido a este lado.
    const disc = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 2.2),
      new THREE.MeshBasicMaterial({
        map: new THREE.TextureLoader().load('./public/textures/pattern_portal.png'),
        color: 0xf59e0b, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.03;
    group.add(disc);

    // Columna de luz: sube del disco al objeto y ata las dos cosas. Sin ella el prop
    // parece flotar por su cuenta en vez de estar sostenido por el portal.
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.62, 2.0, 16, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xf59e0b, transparent: true, opacity: 0.14,
        side: THREE.DoubleSide, depthWrite: false, fog: false,
        blending: THREE.AdditiveBlending,
      })
    );
    beam.position.y = 1.0;
    group.add(beam);

    // El objeto en si, en su propio nodo para poder flotarlo sin mover el pedestal.
    const holder = new THREE.Group();
    holder.position.y = 1.25;
    group.add(holder);

    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(1.7, 1.7),
      new THREE.MeshBasicMaterial({
        map: makeShockwaveTexture(128), color: 0xf59e0b,
        transparent: true, opacity: 0.6,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      })
    );
    holder.add(halo);

    const light = new THREE.PointLight(0xf59e0b, 2.2, 7, 2);
    light.position.y = 1.25;
    group.add(light);

    const stub = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.22, 0.5),
      new THREE.MeshStandardMaterial({
        color: 0x8a5a32, emissive: 0xf59e0b, emissiveIntensity: 0.4, roughness: 0.6,
      })
    );
    holder.add(stub);

    new GLTFLoader().load(PROP_URLS[data.id] || '', (gltf) => {
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      model.scale.setScalar(0.5 / Math.max(box.getSize(new THREE.Vector3()).y, 0.001));
      model.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      holder.remove(stub);
      holder.add(model);
    }, undefined, () => { /* se queda la silueta */ });

    // ---- campo de energia ----
    //
    // Solo para los props que estan cerrados con llave. Es una jaula de tres aros
    // que giran en ejes distintos: parece un mecanismo sujetando algo, no un cristal
    // decorativo. Y late al pulso, como todo lo del Proyector.
    //
    // Va en su propio nodo para poder deshacerlo entero cuando cae, sin tocar el
    // prop que hay dentro.
    let field = null;
    if (data.locked) {
      field = new THREE.Group();
      field.position.y = 1.25;
      group.add(field);

      const jaulaMat = new THREE.MeshBasicMaterial({
        color: 0x7c3aed, transparent: true, opacity: 0.75,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      });
      for (let i = 0; i < 3; i += 1) {
        const aro = new THREE.Mesh(
          new THREE.TorusGeometry(0.62, 0.022, 8, 40), jaulaMat.clone()
        );
        aro.rotation.x = (i * Math.PI) / 3;
        aro.rotation.y = (i * Math.PI) / 4;
        field.add(aro);
      }
      // Membrana: da volumen y, sobre todo, TIÑE el prop de dentro. Sin ella los
      // aros se leen como un adorno alrededor de un objeto que ya podrias coger.
      const membrana = new THREE.Mesh(
        new THREE.SphereGeometry(0.6, 20, 14),
        new THREE.MeshBasicMaterial({
          color: 0x7c3aed, transparent: true, opacity: 0.16,
          side: THREE.DoubleSide, depthWrite: false, fog: false,
          blending: THREE.AdditiveBlending,
        })
      );
      field.add(membrana);
    }

    return { ...data, ground, group, holder, halo, light, disc, beam, field,
             locked: data.locked || null, taken: false };
  });

  // ------------------------------------------------------------------- placas
  //
  // Partidas en dos por la spec 035: `Plates` decide cuando se hunde una, y
  // `PlateViews` la dibuja leyendo ese estado. La logica no sabe que existe Three.
  const plates = new Plates(level.plates || []);
  const plateViews = new PlateViews(scene, plates.items, LAYER_Z);

  /**
   * La placa baja el campo del prop que le toque.
   *
   * Los dos golpes de onda no son adorno: uno sale de la placa y otro del campo, y
   * el orden —abajo primero, arriba despues— es lo que se lee como "esto ha causado
   * aquello". Y la camara va al campo, no a la placa, porque lo que importa es lo
   * que se acaba de abrir, no el boton.
   */
  /**
   * Lo que se OYE Y SE VE al hundirse una placa. Llega por la cola de eventos.
   *
   * Dos capas de sonido: el golpe de la caja al asentar y el campo cediendo justo
   * despues.
   */
  function efectoPlaca(x, y, capa) {
    const z = LAYER_Z[capa];
    sfx?.play('land_hard', { volume: 0.6, pitch: 0.7 });
    sfx?.play('portal_exit', { volume: 0.7, pitch: 0.8 });
    groundShockwave(x, y + 0.1, z, { radius: 3.0, power: 0.9, speed: 2.6, color: 0x2ed8ee });
    particles.burst(x, y + 0.4, z, 0x2ed8ee, 20, 2.4);
    shakeImpulse = Math.max(shakeImpulse, 0.35);
  }

  /**
   * Lo que la placa DESBLOQUEA. Va por hook y no por evento a proposito: que se abra
   * un prop concreto es estado de partida, no un efecto, y el render no tiene por
   * que saber que existen las botas.
   */
  plates.onPress = (placa) => {
    const pick = propPickups.find((p) => p.locked === placa.unlocks && !p.taken);
    if (!pick) return;

    pick.unlocking = 1;
    pick.locked = null;
    const fx = pick.group.position.x;
    const fy = pick.ground + 1.25;
    const fz = pick.group.position.z;
    groundShockwave(fx, fy, fz,
                    { radius: 3.6, power: 1.0, speed: 2.2, color: 0x7c3aed });
    particles.burst(fx, fy, fz, 0x7c3aed, 26, 3.0);
    focusOn(fx, fy, { dist: 7.0, hold: 1.5, once: 'campo:' + placa.unlocks,
                      label: 'El campo ha caído · ya puedes cogerlas' });
  };

  // ---------------------------------------------------------------- tornillos
  // Cada tornillo es un grupo: la pieza, un halo que lo destaca de lejos, una luz
  // propia y una flecha que baja apuntandolo. Sin todo eso una pieza de 26 cm en
  // una plaza de 55 m es invisible, y el objetivo se vuelve una busqueda a ciegas.
  const screwGeo = new THREE.CylinderGeometry(0.07, 0.09, 0.26, 6);
  const arrowGeo = new THREE.ConeGeometry(0.16, 0.38, 4);
  const haloGeo = new THREE.PlaneGeometry(1.5, 1.5);
  const haloTex = makeShockwaveTexture(128);

  const screws = (level.screws || []).map((data) => {
    const group = new THREE.Group();
    group.position.set(data.x, data.y, LAYER_Z[data.layer ?? 0]);
    scene.add(group);

    const mesh = new THREE.Mesh(screwGeo, new THREE.MeshStandardMaterial({
      color: 0xd8dce8, emissive: 0x2ed8ee, emissiveIntensity: 0.9,
      metalness: 0.8, roughness: 0.3,
    }));
    mesh.castShadow = true;
    group.add(mesh);

    // Halo: se ve a contraluz desde el otro extremo de la plaza.
    const halo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({
      map: haloTex, color: 0x2ed8ee, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    group.add(halo);

    // Flecha: el "recoge esto" explicito. Rebota para llamar la atencion.
    const arrow = new THREE.Mesh(arrowGeo, new THREE.MeshBasicMaterial({
      color: 0xf59e0b, fog: false,
    }));
    arrow.rotation.z = Math.PI;      // apunta hacia abajo, al tornillo
    arrow.position.y = 0.95;
    group.add(arrow);

    const light = new THREE.PointLight(0x2ed8ee, 1.6, 5, 2);
    group.add(light);

    return { ...data, group, mesh, halo, arrow, light, taken: false };
  });

  /**
   * Los tornillos ENTERRADOS no existen hasta que se rompe su grieta.
   *
   * Se apagan aqui y no en la construccion para que compartan todo lo demas —halo,
   * flecha, luz, recogida— con los otros tres. Un tipo aparte solo para este seria
   * duplicar el sistema entero por un booleano.
   */
  for (const screw of screws) {
    if (screw.buried) screw.group.visible = false;
  }

  // ------------------------------------------------------------------ grietas
  //
  // EL GESTO DE COBRO (GDD §7, R5 §4). *Llegar al sitio no es la recompensa; el
  // ultimo esfuerzo lo es.* Tres tiempos y los tres tienen que existir:
  //
  //   1 PROMESA  el sitio se ve distinto — la grieta late y coge luz al acercarse
  //   2 GESTO    una accion del jugador — `stomp`, no pasar por encima
  //   3 COBRO    hitstop, particulas, onda, sonido, y el premio
  //
  // Antes de esto, el unico "descubrimiento" del nivel se recogia caminando por
  // encima. La diferencia entre las dos cosas es la diferencia entre logistica y
  // participacion.
  const grietaGeo = new THREE.PlaneGeometry(1.6, 1.6);
  const grietaTex = makeShockwaveTexture(128);
  const grietas = (level.diggables || []).map((data) => {
    const mesh = new THREE.Mesh(grietaGeo, new THREE.MeshBasicMaterial({
      map: grietaTex, color: 0xf59e0b, transparent: true, opacity: 0.0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    // Tumbada sobre el suelo: es una grieta EN el suelo, no un cartel en el aire.
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(data.x, data.y + 0.03, LAYER_Z[data.layer ?? 0]);
    scene.add(mesh);
    return { ...data, mesh, abierta: false, cerca: 0 };
  });

  /**
   * HITSTOP — congelar el mundo unas centesimas en el impacto.
   *
   * Es la pieza que mas vende un golpe segun *The Art of Screenshake*, y la que R5
   * §4.1 marcaba como la que faltaba para que el cobro se sintiera. Lo que congela es
   * el PLAYSIM (fisica, animacion, particulas); la camara y el post-proceso siguen
   * corriendo, porque congelarlo todo se lee como un tiron de rendimiento en vez de
   * como un golpe.
   *
   * Y NO toca el reloj de la musica: `Choreography.position` va sobre
   * `AudioContext.currentTime` y no sabe nada de esto. Un hitstop que parara el
   * transporte desincronizaria el nivel entero.
   */
  let hitstop = 0;
  function congelar(segundos) { hitstop = Math.max(hitstop, segundos); }

  // La pieza real del Car Kit sustituye al cilindro en cuanto llega.
  new GLTFLoader().load('./public/models/screw.glb', (gltf) => {
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3());
    const scale = 0.34 / Math.max(size.y, size.x, 0.001);
    for (const screw of screws) {
      const model = gltf.scene.clone(true);
      model.scale.setScalar(scale);
      model.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.material = new THREE.MeshStandardMaterial({
          color: 0xd8dce8, metalness: 0.85, roughness: 0.25,
          emissive: 0x2ed8ee, emissiveIntensity: 0.6,
        });
      });
      screw.mesh.visible = false;
      screw.group.add(model);
      screw.model = model;
    }
  }, undefined, () => { /* sin modelo: se queda el cilindro */ });
  let screwsTaken = 0;
  let repaired = false;
  let repairHold = 0;
  let hits = 0;              // golpes recibidos: decide BR-07a vs BR-07b y el logro Manitas
  let throwCooldown = 0;     // recarga entre lanzamientos
  let pendingThrow = null;   // la chispa sale a mitad del gesto, no al pulsar
  let noAmmoHint = 0;        // cuenta atras del aviso de "sin Chispas"
  const throwTargets = [];   // blancos de las Chispas, recalculados cada frame
  let droneCueGiven = false; // ¿ya grito Bradislav el "¡Corre!"?
  let robotIntro = 0;        // 0 sin presentar · 1 enfocado el robot · 2 enfocado el tornillo
  let codaSpray = 0;         // acumulador del chorro de confeti
  let pushDust = 0;          // acumulador del polvo al empujar
  let pushHint = 0;          // cuenta atras del aviso de empujar
  let cambioListo = null;    // escenario descargado, a la espera del pico
  let vineta = 0;            // apertura de la pupila, suavizada

  /**
   * Mira de destino del Portal de Idea.
   *
   * Solo aparece con las botas puestas — sin ellas seria una promesa que el juego no
   * cumple. Y dice DOS cosas: donde caeria el portal, y si ahi se puede o no. El
   * color hace de respuesta antes de gastar nada.
   */
  const miraPortal = new THREE.Group();
  miraPortal.visible = false;
  scene.add(miraPortal);

  // Anillo en el suelo, del tamaño real del portal. Es la pieza que dice DONDE,
  // igual que el circulo de peligro del robot dice donde cae el brazo.
  const miraAnillo = new THREE.Mesh(
    new THREE.RingGeometry(0.62, 0.78, 40),
    new THREE.MeshBasicMaterial({
      color: 0x2ed8ee, transparent: true, opacity: 0.9,
      side: THREE.DoubleSide, depthWrite: false, fog: false,
    })
  );
  miraAnillo.rotation.x = -Math.PI / 2;
  miraAnillo.position.y = 0.04;
  miraPortal.add(miraAnillo);

  // Relleno tenue: llena el circulo para que se vea de lejos sin tapar el suelo.
  const miraRelleno = new THREE.Mesh(
    new THREE.CircleGeometry(0.62, 32),
    new THREE.MeshBasicMaterial({
      color: 0x2ed8ee, transparent: true, opacity: 0.14,
      side: THREE.DoubleSide, depthWrite: false, fog: false,
      blending: THREE.AdditiveBlending,
    })
  );
  miraRelleno.rotation.x = -Math.PI / 2;
  miraRelleno.position.y = 0.03;
  miraPortal.add(miraRelleno);

  // Y la SILUETA del arco que va a aparecer, a su tamaño. Es lo que convierte la
  // marca en una promesa concreta: no dice "aqui cabe algo", dice "aqui va esto".
  const miraArco = new THREE.Mesh(
    new THREE.TorusGeometry(1.15, 0.045, 8, 28),
    new THREE.MeshBasicMaterial({
      color: 0x2ed8ee, transparent: true, opacity: 0.35,
      depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
    })
  );
  miraArco.position.y = 1.15;
  miraPortal.add(miraArco);

  // ---- marca de DESTINO, en la otra capa ----
  //
  // Va suelta del grupo porque vive en otra Z. Es lo que convierte la mira en
  // informacion util en tiempo real: no dice solo "se puede o no", enseña DONDE
  // caerias — y si ahi no hay suelo, se ve que no lo hay.
  const miraDestino = new THREE.Group();
  miraDestino.visible = false;
  scene.add(miraDestino);

  const destinoAnillo = new THREE.Mesh(
    new THREE.RingGeometry(0.5, 0.66, 32),
    new THREE.MeshBasicMaterial({
      color: 0x2ed8ee, transparent: true, opacity: 0.7,
      side: THREE.DoubleSide, depthWrite: false, fog: false,
    })
  );
  destinoAnillo.rotation.x = -Math.PI / 2;
  miraDestino.add(destinoAnillo);

  // Silueta del personaje en el destino: la misma idea que el fantasma del portal.
  const destinoSilueta = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 1.4, 0.2),
    new THREE.MeshBasicMaterial({
      color: 0x2ed8ee, transparent: true, opacity: 0.16,
      depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
    })
  );
  destinoSilueta.position.y = 0.7;
  miraDestino.add(destinoSilueta);

  // Hilo que une origen y destino: sin el, las dos marcas se leen como dos cosas
  // distintas en vez de como los dos extremos de un mismo salto.
  const miraHilo = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 1, 6),
    new THREE.MeshBasicMaterial({
      color: 0x2ed8ee, transparent: true, opacity: 0.35,
      depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
    })
  );
  scene.add(miraHilo);
  miraHilo.visible = false;
  let castCooldown = 0;      // recarga entre portales temporales
  let castCooldownTotal = 1; // de cuanto era esa recarga, para la barra
  let throwCooldownTotal = 1;
  let pendingCast = 0;       // el portal nace a mitad del gesto
  let sparksSpent = 0;       // chispas gastadas en lanzar
  let screwsDelivered = 0;   // tornillos entregados a distancia

  // ---------------------------------------------------------- transiciones
  //
  // Todas viven en `transitions.js`, con sus parametros a la vista. Aqui solo se
  // conectan sus efectos a la camara, al post-proceso y al audio; ajustar una
  // transicion es editar numeros en el diccionario, no tocar este archivo.
  const transicion = new TransitionPlayer({
    // El cambio de assets ocurre en el punto de ocultacion de cada transicion,
    // cuando la imagen es ilegible. Ese es su trabajo, ademas del estetico.
    onHide: () => {
      // El cambio ya esta descargado y esperando: aplicarlo es sincrono y cae
      // EXACTAMENTE en este frame, que es el del pico de la transicion. Cargarlo
      // aqui lo dejaba uno o dos frames tarde, cuando la imagen ya se lee otra vez.
      if (cambioListo) { cambioListo(); cambioListo = null; log('escenario cambiado'); }
      postfx.shockwave(0.5, 0.5, 1.0);
      particles.shockwaveAmbient(player.position.x, player.position.y + 1.0, 1.3);
      sfx?.play('portal_exit', { volume: 0.7, pitch: 0.8 });
    },
    onShake: (fuerza) => { shakeImpulse = Math.max(shakeImpulse, fuerza); },
    onDuck: (db, seconds) => choreo.rampShelf(db, seconds),
  });

  /** Segundos de permanencia que exige la reparacion. Un solo sitio que lo decide. */
  function needForRepair() {
    return Math.max(0.5, (level.robot?.holdBars || 1) * (choreo.barSeconds || 0));
  }

  // El robot descalibrado. Es el X Bot de Mixamo: mismo esqueleto de 25 huesos
  // que Borislov, asi que reproduce los mismos clips sin trabajo extra.
  // Sus emisivos van de rojo (descalibrado) a ambar (reparado).
  let robotMesh = null;      // el grupo que se mueve
  let robotMats = [];        // materiales a teñir
  let robotMixer = null;
  const robotActions = {};
  let robotPulse = -1;       // pulso actual del ciclo de 3
  let robotSlamAt = 0;       // instante del ultimo golpe, para no repetirlo
  let shakeImpulse = 0;      // temblor puntual, decae solo
  // Pico de eventos por frame. Sale en el panel de depuracion: si se acerca a la
  // capacidad de la cola (256), es que algo esta emitiendo de mas.
  let picoEventos = 0;
  let robotExit = null;      // salida del robot tras la reparacion
  let coda = null;           // secuencia de cierre: saludo y baile
  let footBones = [];        // huesos de los pies, para el anclaje al suelo
  let handBone = null;       // mano que lanza
  let hipsBone = null;       // referencia para medir la extension del brazo
  const _handPos = new THREE.Vector3();
  const _hipsPos = new THREE.Vector3();
  let groundOffset = 0;      // correccion vertical suavizada
  const _tmpVec = new THREE.Vector3();
  let robotZone = null;      // circulo que marca el rango de reparacion
  let robotZoneFill = null;  // relleno: progreso del compas que hay que mantener
  let robotDanger = null;    // marca en rojo donde va a caer el brazo
  let portalFlash = 0;       // destello de los discos al teletransportar

  let robotCore = null;      // el nucleo luminoso del pecho
  let robotLight = null;

  /**
   * El brillo sale del NUCLEO, no del cuerpo. Si se hace emisivo el cuerpo entero,
   * con el bloom a 4.0 del climax el robot se convierte en una mancha que tapa
   * media pantalla. El cuerpo solo recibe un tinte muy tenue.
   */
  function playRobotClip(name, speed = 1) {
    if (!robotMixer || !robotActions[name]) return;
    const action = robotMixer.clipAction(robotActions[name]);
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.timeScale = speed;
    action.setEffectiveWeight(1);
    action.fadeIn(0.06).play();
  }

  function setRobotGlow(color, intensity = 1.0) {
    if (robotCore) robotCore.material.color.copy(color);
    if (robotLight) {
      robotLight.color.copy(color);
      robotLight.intensity = 2.2 * intensity;
    }
    for (const m of robotMats) {
      m.emissive.copy(color);
      m.emissiveIntensity = 0.18 * intensity;
    }
  }

  if (level.robot) {
    robotMesh = new THREE.Group();
    robotMesh.position.set(level.robot.x, level.robot.y, LAYER_Z[0]);
    scene.add(robotMesh);

    // El nucleo: pequeño, sin iluminacion, es lo unico que brilla de verdad.
    robotCore = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xe62a9e })
    );
    robotCore.position.set(0, 2.1, 0.45);
    robotMesh.add(robotCore);

    robotLight = new THREE.PointLight(0xe62a9e, 2.2, 9, 2);
    robotLight.position.set(0, 2.1, 1.2);
    robotMesh.add(robotLight);

    // Silueta provisional mientras carga; se retira al llegar el modelo.
    const stub = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 2.4, 1.2),
      new THREE.MeshStandardMaterial({
        color: 0x3a3f4d, metalness: 0.85, roughness: 0.4,
        emissive: 0xe62a9e, emissiveIntensity: 0.18,
      })
    );
    stub.position.y = 1.2;
    robotMesh.add(stub);
    robotMats = [stub.material];

    // Zona de reparacion: un circulo en el suelo que marca DONDE hay que ponerse.
    // Sin el, el radio de 3,2 m es invisible y la mecanica se vuelve adivinanza —
    // el jugador aprieta E en el sitio equivocado y concluye que no funciona.
    robotZone = new THREE.Mesh(
      new THREE.RingGeometry(0.86, 1.0, 48),
      new THREE.MeshBasicMaterial({
        color: 0xf59e0b, transparent: true, opacity: 0.0,
        side: THREE.DoubleSide, depthWrite: false, fog: false,
      })
    );
    robotZone.rotation.x = -Math.PI / 2;
    robotZone.scale.setScalar(level.robot.radius);
    robotZone.position.set(level.robot.x, level.robot.y + 0.04, LAYER_Z[0]);
    robotZone.renderOrder = 3;
    scene.add(robotZone);

    // Y el relleno, que se llena como una barra de progreso al mantener E.
    robotZoneFill = new THREE.Mesh(
      new THREE.CircleGeometry(1.0, 48),
      new THREE.MeshBasicMaterial({
        color: 0x2ed8ee, transparent: true, opacity: 0.0,
        depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
      })
    );
    robotZoneFill.rotation.x = -Math.PI / 2;
    robotZoneFill.position.copy(robotZone.position).setY(level.robot.y + 0.03);
    robotZoneFill.renderOrder = 2;
    scene.add(robotZoneFill);

    // Zona de peligro: donde va a caer el brazo. Se enciende en el pulso 1 (el
    // aviso) y se apaga tras el golpe. Es lo que convierte el ciclo en algo que se
    // aprende mirando, en vez de un castigo que llega sin avisar.
    robotDanger = new THREE.Mesh(
      new THREE.CircleGeometry(SLAM_RADIUS, 40),
      new THREE.MeshBasicMaterial({
        color: 0xff3060, transparent: true, opacity: 0,
        depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
      })
    );
    robotDanger.rotation.x = -Math.PI / 2;
    robotDanger.position.set(level.robot.x + SLAM_OFFSET, level.robot.y + 0.05, LAYER_Z[0]);
    robotDanger.renderOrder = 4;
    scene.add(robotDanger);

    new GLTFLoader().load('./public/models/xbot_test.glb', (gltf) => {
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      // El robot del climax es grande: 3,2 m contra el 1,48 m de Borislov.
      model.scale.setScalar(3.2 / Math.max(size.y, 0.001));
      model.rotation.y = -Math.PI / 2;   // mira hacia el jugador, que viene por la izquierda

      robotMats = [];
      model.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.frustumCulled = false;
        o.material = new THREE.MeshStandardMaterial({
          color: 0x3a3f4d, metalness: 0.9, roughness: 0.35,
          emissive: new THREE.Color(0xe62a9e), emissiveIntensity: 0.18,
        });
        robotMats.push(o.material);
      });

      robotMesh.remove(stub);
      robotMesh.add(model);
      // El nucleo se sube a la altura real del pecho del modelo escalado.
      robotCore.position.y = 3.2 * 0.62;
      robotLight.position.y = 3.2 * 0.62;

      robotMixer = new THREE.AnimationMixer(model);
      for (const clip of gltf.animations) robotActions[clip.name] = clip;
      const idle = robotActions['standing_block_idle'] || robotActions['happy_idle'] || gltf.animations[0];
      if (idle) robotMixer.clipAction(idle).play();
    }, undefined, () => { /* sin modelo: se queda la silueta */ });
  }

  // ---------------------------------------------------------------- jugador
  const player = new Player(world, {
    x: level.spawn.x,
    y: level.spawn.y,
    layer: level.spawn.layer ?? 0,
  });

  const input = new Input(window);

  // ------------------------------------------------------------- portales
  const noise = new THREE.TextureLoader().load(noiseUrl, (tex) => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  });
  noise.wrapS = noise.wrapT = THREE.RepeatWrapping;
  const portals = new PortalSystem(scene, level, player, noise);

  // --------------------------------------------------- checkpoints y reintentos
  const checkpoints = level.checkpoints || [level.spawn];
  let checkpoint = checkpoints[0];
  let attempts = 0;

  // Postes provisionales; se sustituyen por el modelo real de bandera al cargar.
  const flags = checkpoints.map((cp) => {
    const flag = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 1.6, 0.07),
      new THREE.MeshStandardMaterial({ color: 0x2a2f86, emissive: 0x2a2f86, emissiveIntensity: 0.4 })
    );
    flag.position.set(cp.x, cp.y + 0.4, LAYER_Z[cp.layer ?? 0] - 1.0);
    levelGroup.add(flag);
    return flag;
  });

  new GLTFLoader().load('./public/models/flag.glb', (gltf) => {
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3());
    const scale = 1.7 / Math.max(size.y, 0.001);
    const probe = new THREE.Box3();

    flags.forEach((placeholder, i) => {
      const cp = checkpoints[i];
      const model = gltf.scene.clone(true);
      model.scale.setScalar(scale);
      // La Y del checkpoint es donde REAPARECE el jugador, no donde esta el suelo:
      // por eso las banderas quedaban despegadas.
      const ground = world.groundHeightAt(cp.x, cp.layer ?? 0, cp.y ?? 0);
      model.position.copy(placeholder.position).setY(ground);

      // Y AQUI se corrige de verdad. Calcular el desfase a partir del pivote del
      // GLB no basta: los kits traen transformadas anidadas y el pivote puede estar
      // en cualquier sitio, asi que la cuenta sale mal justo en los modelos raros.
      // En lugar de deducirlo, se coloca, se MIDE la caja ya en el mundo y se baja
      // lo que sobre. Es autocorrectivo: da igual como venga el modelo.
      model.updateWorldMatrix(true, true);
      probe.setFromObject(model);
      if (Number.isFinite(probe.min.y)) model.position.y += ground - probe.min.y;
      model.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        // Material propio por bandera: asi cada una se enciende por separado
        // al pasar por ella, sin afectar a las demas.
        o.material = o.material.clone();
      });
      levelGroup.add(model);
      placeholder.visible = false;
      placeholder.userData.model = model;
      model.traverse((o) => { if (o.isMesh) o.material.color.setHex(0x55607f); });
    });
  }, undefined, () => { /* sin modelo: se quedan los postes */ });

  /**
   * ¿Debe haber perseguidor ahora mismo?
   *
   * Es UNA sola fuente de verdad, consultada en los tres sitios que reviven al dron
   * (reaparicion, captura y cambio de etapa). Antes cada uno decidia por su cuenta y
   * el dron volvia a aparecer en la etapa 3, cuando su etapa ya estaba superada.
   */
  function chaserWanted() {
    return !!(director && director.stage && director.stage.chaser);
  }

  // ------------------------------------------------ el runner (auto-scroll)
  //
  // El acelerador bloqueado del tramo 5. Es la decision del GDD §4.1 y lo que cierra
  // TDB-001/002/003: con la velocidad fijada por el juego, la distancia del tramo deja
  // de depender de lo bien que corra el jugador y pasa a ser una decision de ritmo.
  //
  // COMO SE HACE, y por que asi. Se inyecta un mando sintetico que mantiene la
  // derecha pulsada y se pone la rampa de carrera al maximo cada paso, en vez de
  // escribir `velocity.x` a mano despues del `update`. La diferencia importa: por el
  // mando, el jugador sigue pasando por la misma fisica de siempre — coyote, buffer,
  // apice, asistencia de escalon, salto de pared, colision con las cajas — y lo unico
  // que pierde es la decision de cuanto acelera. Escribiendo la velocidad al final se
  // pisa el resultado de la colision y el personaje atraviesa paredes.
  //
  // Lo que SIGUE controlando: saltar, doble salto, cambiar de capa, lanzar chispas.
  // Esa es la diferencia entre un runner y un video.
  const RUNNER_INPUT = {
    _real: null,
    get axisX() { return 1; },                       // siempre hacia delante
    justPressed(a) { return this._real.justPressed(a); },
    justReleased(a) { return this._real.justReleased(a); },
    isDown(a) { return this._real.isDown(a); },
    get held() { return this._real.held; },
  };

  /**
   * Compases que le quedan al runner para arrancar. Cuenta ATRÁS, y eso importa:
   * `choreo.position` retrocede cuando el loop rebobina o cuando `seekMoment` salta,
   * así que comparar contra un instante futuro absoluto puede no cumplirse nunca.
   * Es la trampa número uno del contrato de sincronía.
   */
  let runnerEspera = 0;

  /**
   * ¿Está el auto-scroll tirando del personaje AHORA?
   *
   * Tres condiciones, y las dos últimas se añadieron después de verlo jugar:
   *
   *  1. La etapa declara `runner`.
   *  2. **Nadie más tiene el control** — ni una cinemática ni el paso de un portal.
   *  3. **La transición ha terminado.** Ésta es la que faltaba: una transición es un
   *     truco de cámara que NO quita el control (es su definición), así que el
   *     personaje arrancaba a correr durante el barrido, mientras la cámara todavía
   *     estaba girando y aún no había vuelto sobre él. Se veía salir corriendo antes
   *     de que el plano existiera.
   *
   * Y un compás y medio de espera además, que es lo que dura el barrido: la cámara
   * llega, Bradislav dice "¡Corre y no mires atrás!" y el dron se suelta. **Ese compás
   * está descontado del presupuesto del tramo** — ver `runner.startBars` en el nivel.
   */
  function runnerActivo() {
    const stage = director?.stage;
    if (!stage?.runner) return null;
    if (director.control !== CONTROL.PLAYING) return null;
    if (transicion.running) return null;
    if (runnerEspera > 0) return null;
    return stage.runner;
  }

  /**
   * Ancla los pies al suelo cuando el personaje esta apoyado.
   *
   * Los clips de Mixamo estan grabados sobre un actor de 1,82 m y su raiz no
   * siempre coincide con la planta del pie: en el breakdance, en el aterrizaje duro
   * y en cualquier movimiento de suelo, el pie mas bajo acaba por ENCIMA de y=0 y
   * el personaje se ve levitando. Es el mismo defecto en todos, asi que se corrige
   * de una vez en lugar de parchear clip por clip.
   *
   * Mide el hueso mas bajo, calcula cuanto sobra y baja el avatar esa cantidad.
   * Solo actua sobre estados APOYADOS: en el aire despegar es lo correcto.
   *
   * El offset se suaviza, porque aplicarlo en crudo hace que el personaje vibre
   * cuando el pie mas bajo cambia de una pierna a la otra.
   */
  const AIRBORNE_STATES = new Set([
    STATE.JUMP, STATE.DOUBLE_JUMP, STATE.FALL, STATE.WALL_SLIDE,
  ]);

  const MAX_GROUND_DROP = 0.9;   // tope: nunca hunde el avatar mas de esto

  function groundLock(dt) {
    if (!avatar || !footBones.length) return;

    let target = 0;
    if (!AIRBORNE_STATES.has(player.state) && !portals.busy) {
      avatar.updateMatrixWorld(true);
      let lowest = Infinity;
      for (const bone of footBones) {
        const y = bone.getWorldPosition(_tmpVec).y;
        if (y < lowest) lowest = y;
      }

      // El offset se descuenta leyendolo del AVATAR, no de `groundOffset`.
      //
      // Son cosas distintas y confundirlas cuesta caro: el bloque de la camara ya
      // dejo `avatar.position.y = player.position.y` antes de llegar aqui, asi que
      // la medida viene sin correccion aunque `groundOffset` valga otra cosa.
      // Sumando `groundOffset` se contaba dos veces, el offset crecia cada frame y
      // acababa clavado en el tope de 0,9 m — el personaje enterrado hasta la rodilla.
      //
      // Leyendo el offset real, la formula vale con cualquier orden de ejecucion.
      const applied = avatar.position.y - player.position.y;
      const restY = lowest - applied;              // pie sin ninguna correccion
      target = THREE.MathUtils.clamp(player.position.y - restY, -MAX_GROUND_DROP, 0);
    }

    groundOffset += (target - groundOffset) * Math.min(1, dt * 12);
    avatar.position.y = player.position.y + groundOffset;
  }

  /**
   * Altura VISUAL de los pies. Es donde deben nacer las particulas de suelo: el
   * colisionador y el dibujo no coinciden cuando el anclaje esta corrigiendo.
   */
  function feetY() { return player.position.y + groundOffset; }

  function respawn() {
    attempts += 1;
    director?.registerAttempt();
    dialogue?.stop();

    /**
     * DONDE SE REAPARECE. Normalmente el ultimo checkpoint; en un tramo con velocidad
     * autoral, el principio del tramo.
     *
     * Era TDB-003. La etapa 2 rebobinaba la MUSICA al compas 26 al fallar, pero el
     * jugador reaparecia en su ultimo checkpoint —x=217, a 9 m de una meta en 226—,
     * asi que la misma carrera pasaba de exigir 9,48 m/s a exigir 0,52 en un solo
     * fallo. "Reintentar" significaba dos cosas distintas en cada eje.
     *
     * Con el acelerador bloqueado la unica variable del tramo es el trayecto, asi que
     * reintentar tiene que devolver el trayecto entero o no reintenta nada.
     */
    const desde = director?.stage?.retry || checkpoint;
    player.body.x = desde.x - player.width / 2;
    player.body.y = desde.y;
    player.velocity.x = 0;
    player.velocity.y = 0;
    player._peakY = desde.y;
    player.layer = desde.layer ?? 0;
    player.setState(STATE.FALL);

    // El perseguidor se recoloca detras del checkpoint. Sin esto se quedaba donde
    // estaba —normalmente ya muy por delante— y la persecucion no volvia a empezar:
    // el jugador reaparecia y no le perseguia nadie.
    // Al reintentar un tramo con auto-scroll, el arranque se vuelve a pagar: la rampa
    // de carrera se pone a cero y se espera medio compas. Sin esto el jugador
    // reaparece ya a 7,6 m/s, que es desorientador justo cuando acaba de perder.
    if (director?.stage?.runner) {
      player._runRamp = 0;
      runnerEspera = choreo.barSeconds * 0.5;
    }

    shots.clear();
    if (chaserWanted()) {
      drone.start(desde.x, LAYER_Z[desde.layer ?? 0], desde.layer ?? 0);
    } else {
      drone.stop();
    }
  }

  function updateCheckpoints() {
    for (let i = checkpoints.length - 1; i >= 0; i -= 1) {
      const cp = checkpoints[i];
      if (cp === checkpoint) break;
      if (player.position.x >= cp.x) {
        checkpoint = cp;
        flags.forEach((f, j) => f.material.color.set(j <= i ? 0x2ed8ee : 0x2a2f86));
        break;
      }
    }
  }

  // ------------------------------------------------------------------ avatar
  let animator = null;
  let avatar = null;

  // ---------------------------------------------------------- coreografia
  const choreo = new Choreography({
    onMoment: (moment) => {
      look.target = AMBIENTES[moment.name] || look.target;

      // ---- zooms de momento ----
      // El dolly zoom estaba escrito pero solo lo usaba la cinematica de apertura.
      // Los momentos de contraste son exactamente donde debe ir: son compases en los
      // que el juego se para y hay que mirar algo. Como el zoom no bloquea el
      // control, se puede seguir jugando mientras la camara respira.
      // Una sola vez por momento. `climax_salvaje` se re-entra en cada reintento de
      // la carrera y `combate1`/`combate2` cada vuelta del loop: repetir el zoom
      // ahi seria pararle la camara al jugador una y otra vez.
      const zoomKey = `zoom:${moment.name}`;
      if (ENCUADRES[moment.name] && !opts.reduceMotion && !alreadyShown.has(zoomKey)) {
        alreadyShown.add(zoomKey);
        momentZoom = { ...ENCUADRES[moment.name], t: 0, from: cam.dist };
      }

      // El contraste oscuro es un golpe seco: se acompana con una onda.
      if (moment.name === 'contraste_oscuro') {
        postfx.shockwave(0.5, 0.45, 1.0);
        particles.shockwaveAmbient(player.position.x, player.position.y + 1.2, 1.4);
      }
      director?.enterMoment(moment);
      if (api.onMomentChanged) api.onMomentChanged(moment);
    },
    onBeat: () => { beatPulse = 1; },
  });

  let dialogue = null;
  let director = null;
  let beatPulse = 0;

  // --------------------------------------------------------- cinematicas
  let gltfSource = null;          // GLB base, para clonar actores secundarios
  const actors = new Map();
  let cameraShot = null;          // toma activa; null = la camara sigue al jugador
  let momentZoom = null;          // zoom disparado por el momento musical
  let focusShot = null;           // encuadre de foco sobre un objetivo concreto
  /**
   * Lo que ya se ha enseñado una vez.
   *
   * Un foco o un zoom sirven para DECIR algo la primera vez. Repetidos en cada
   * reintento dejan de informar y pasan a estorbar: el jugador ya sabe que hay un
   * dron detras, y lo que quiere es correr, no que le paren la camara otra vez.
   */
  const alreadyShown = new Set();
  let focusBlend = 0;             // 0 = camara normal, 1 = totalmente en el foco
  let focusDist = 9.5;
  const focusPos = new THREE.Vector2();

  /**
   * Enfoca algo del mundo para decirle al jugador "esto es lo que toca".
   *
   * Es distinto de `momentZoom`, que respira con la musica: esto es un plano corto
   * y puntual sobre un punto concreto (un tornillo, el dron que aparece). Aparta la
   * camara del jugador durante un momento, asi que dura poco y **no quita el
   * control** — si el jugador se mueve mientras tanto, no pasa nada malo.
   *
   * @param {number} x  punto a enfocar
   * @param {number} [opt.hold] segundos sostenido
   * @param {number} [opt.dist] distancia de camara (menor = mas cerca)
   * @param {string} [opt.label] rotulo en el HUD mientras dura
   */
  function focusOn(x, y, opt = {}) {
    // Un foco nunca pisa a otro: el segundo confundiria en vez de guiar.
    if (focusShot) return false;
    // Ni se repite: en la segunda vuelta ya no enseña nada.
    if (opt.once) {
      if (alreadyShown.has(opt.once)) return false;
      alreadyShown.add(opt.once);
    }
    focusShot = {
      x, y,
      dist: opt.dist ?? 9.5,
      seconds: opt.seconds ?? 0.55,
      hold: opt.hold ?? 1.1,
      t: 0,
      fromX: cam.x, fromY: cam.y, fromDist: cam.dist,
    };
    if (opt.label && promptBox) {
      promptBox.style.opacity = '1';
      promptEl.textContent = opt.label;
      focusShot.label = true;
    }
    sfx?.play('portal_enter', { volume: 0.3, pitch: 1.4 });
    return true;
  }

  // ------------------------------------------------------- lip sync (prototipo)
  //
  // PROTOTIPO, y conviene decir de que y hasta donde.
  //
  // El lip sync definitivo son visemas horneados con Rhubarb sobre el texto de cada
  // linea, y eso es la spec 028. Esto demuestra que la cadena entera existe y
  // funciona: el audio ya pasa por un analizador, el rig llega hasta la cabeza, y la
  // boca se mueve con lo que se OYE — se para en las pausas y se abre en las silabas
  // fuertes — sin que nadie autore un solo fotograma.
  //
  // POR QUE UNA BOCA PROCEDURAL Y NO EL HUESO `jaw`. El contrato de rig
  // (`assets3d/rig/rig_contract.json`) declara `jaw` entre los huesos secundarios,
  // pero **el GLB de hoy no lo tiene**: son 25 huesos `mixamorig:` limpios, porque
  // Mixamo descarta los huesos que no reconoce al re-riggear. El hueso llega cuando
  // el pipeline de la spec 023 lo añada DESPUES de Mixamo. Mientras tanto, una boca
  // pegada al hueso de la cabeza da exactamente el mismo movimiento y no exige
  // esperar a un asset.
  let boca = null;

  function montarBoca(root, headBone) {
    if (!headBone) { log('lip sync: sin hueso de cabeza'); return; }

    /**
     * DONDE VA LA BOCA — medido, no estimado.
     *
     * La cabeza no mira siempre al mismo sitio en coordenadas locales del hueso, y
     * deducirlo del eje del hueso falla en cuanto el rig cambia. Asi que se usa la
     * malla `Eye`, que SI existe en el GLB: se mide su centro en el espacio LOCAL del
     * hueso de la cabeza, y de ahi salen las tres cosas que hacen falta — hacia donde
     * mira la cara, a que altura estan los ojos, y cuanto mide la cabeza.
     *
     * Es la regla de MEDIR EN VEZ DE DEDUCIR aplicada a un caso nuevo, y por el mismo
     * motivo de siempre: a ojo la boca acababa dentro del craneo o flotando delante.
     */
    root.updateMatrixWorld(true);
    let ojos = null;
    let coronilla = null;
    root.traverse((o) => {
      if (o.isMesh && (o.name === 'Eye' || o.parent?.name === 'Eye')) ojos = o;
      if (o.isBone && /HeadTop_End$/i.test(o.name)) coronilla = o;
    });
    if (!ojos) {
      // Sin la malla de ojos no se inventa una posicion: se avisa y no se monta. Es
      // preferible no tener boca a tenerla dentro del craneo.
      log('lip sync: no hay malla Eye para medir la cara — boca no montada');
      return;
    }

    /**
     * Se mide en el MUNDO y se convierte al final.
     *
     * En el espacio local del hueso de la cabeza, "abajo" no es -Y: los huesos de
     * Mixamo llevan su eje Y a lo largo del hueso y los otros dos donde caigan. Medido
     * en este GLB, los ojos caen en (-0,10 · -0,02 · +0,14) locales, con los dos ojos
     * separados a lo largo de Z — o sea que el eje "hacia delante" del hueso NO es
     * ninguno de los tres de forma evidente. Deducirlo de los ejes del hueso es
     * exactamente el error que la constitucion prohibe.
     *
     * En el mundo, en cambio, "arriba" es +Y siempre, y "hacia delante" es la
     * componente horizontal del vector que va del hueso a los ojos — los ojos
     * sobresalen de la cara, asi que ese vector apunta a donde mira.
     */
    const cabezaMundo = headBone.getWorldPosition(new THREE.Vector3());
    const cajaOjos = new THREE.Box3().setFromObject(ojos);
    const ojosMundo = cajaOjos.getCenter(new THREE.Vector3());

    const alto = coronilla
      ? coronilla.getWorldPosition(new THREE.Vector3()).y - cabezaMundo.y
      : (cajaOjos.getSize(new THREE.Vector3()).y * 3.5);

    const adelante = ojosMundo.clone().sub(cabezaMundo).setY(0);
    if (adelante.lengthSq() < 1e-8) adelante.set(1, 0, 0);
    adelante.normalize();

    // La boca cae a un tercio de la distancia ojos-barbilla, que en una cabeza de
    // esta proporcion es ~0,34 de su altura por debajo de los ojos, y sobresale un
    // poco mas que ellos porque el morro va por delante.
    const bocaMundo = ojosMundo.clone()
      .addScaledVector(new THREE.Vector3(0, 1, 0), -alto * 0.34)
      .addScaledVector(adelante, alto * 0.10);

    const grupo = new THREE.Group();
    headBone.add(grupo);
    grupo.position.copy(headBone.worldToLocal(bocaMundo.clone()));
    // Y mira hacia fuera. `lookAt` trabaja en coordenadas de mundo aunque el objeto
    // cuelgue del hueso, asi que basta apuntarle a un punto delante de la cara.
    grupo.lookAt(bocaMundo.clone().addScaledVector(adelante, 1));

    // La boca son dos planos: el hueco (oscuro) y el labio inferior. Con uno solo,
    // abrirla se ve como una mancha creciendo; con el labio, se ve una mandibula.
    const hueco = new THREE.Mesh(
      new THREE.CircleGeometry(1, 16),
      new THREE.MeshBasicMaterial({ color: 0x2b1418, fog: false, transparent: true, opacity: 0.95 })
    );
    const labio = new THREE.Mesh(
      new THREE.CircleGeometry(1, 16),
      new THREE.MeshBasicMaterial({ color: 0xe08d92, fog: false, transparent: true, opacity: 0.9 })
    );
    labio.position.z = 0.01;
    grupo.add(hueco);
    grupo.add(labio);

    /**
     * La escala sale de la cabeza MEDIDA, no de un literal.
     *
     * `alto` esta en unidades de mundo y el grupo cuelga del hueso, que arrastra la
     * escala del avatar (1,2665 medido). Dividir por esa escala es lo que hace que
     * una boca de "0,16 cabezas" siga midiendo 0,16 cabezas aunque mañana el GLB
     * venga con otra estatura y `avatar.scale` cambie.
     */
    const escalaHueso = headBone.getWorldScale(new THREE.Vector3()).x || 1;
    const escala = (alto * 0.16) / escalaHueso;
    boca = { grupo, hueco, labio, escala, abierta: 0, ancha: 0 };
    grupo.scale.setScalar(escala * 0.001);   // arranca cerrada
    log(`lip sync: cabeza ${alto.toFixed(3)} m · boca radio ${(alto * 0.16).toFixed(3)} m`);
  }

  /** Mueve la boca con la envolvente REAL de la voz. Se llama cada frame. */
  function actualizarBoca(dt) {
    if (!boca) return;
    const forma = dialogue?.mouthShape?.() || { abierta: 0, ancha: 0 };

    // Se suaviza asimetricamente: abrir rapido (una consonante explosiva es
    // instantanea) y cerrar mas lento (la boca no se cierra de golpe entre silabas).
    // Con el mismo tiempo en las dos direcciones el resultado tiembla y parece un pez.
    const kAbrir = Math.min(1, dt * 26);
    const kCerrar = Math.min(1, dt * 12);
    boca.abierta += (forma.abierta - boca.abierta)
                  * (forma.abierta > boca.abierta ? kAbrir : kCerrar);
    boca.ancha += (forma.ancha - boca.ancha) * Math.min(1, dt * 14);

    // "a" -> alta y estrecha · "i" -> baja y ancha. El ancho compensa al alto para
    // que la boca conserve area: una boca que crece en los dos ejes a la vez se lee
    // como un bostezo permanente.
    const alto = (0.05 + boca.abierta * 0.95) * (1 - boca.ancha * 0.35);
    const ancho = 0.55 + boca.ancha * 0.65 + boca.abierta * 0.15;

    boca.grupo.scale.set(boca.escala * ancho, boca.escala * alto, 1);
    boca.labio.scale.set(1, Math.max(0.12, 0.34 - boca.abierta * 0.2), 1);
    boca.labio.position.y = -1 + Math.max(0.12, 0.34 - boca.abierta * 0.2);
    boca.grupo.visible = boca.abierta > 0.012;
  }

  const cinematic = new CinematicPlayer({
    getActor: (name) => (name === 'player' ? playerActor : actors.get(name)),
    setCamera: (shot) => {
      if (!shot) { cameraShot = null; return; }
      cameraShot = { ...shot, t: 0, fromX: cam.x, fromY: cam.y, fromZ: cam.dist };
      // Constante del dolly zoom: distancia x tangente de media FOV al arrancar.
      cameraShot._k = cam.dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    },
    fx: (name) => {
      if (name === 'projector_on') {
        postfx.shockwave(0.5, 0.5, 1.3);
        particles.shockwaveAmbient(player.position.x, player.position.y + 1.0, 1.6);
        sfx?.play('portal_enter', { volume: 0.8 });
        choreo.rampShelf(-14, 0.25);
        setTimeout(() => choreo.rampShelf(0, 1.0), 400);

      } else if (name === 'portal-on') {
        // El primer arco se enciende. La onda sale DEL ARCO, no del centro de
        // pantalla: es lo que ata el efecto al objeto que lo produce.
        const arch = level.portals[0];
        const ax = arch.x + arch.w / 2;
        const ay = arch.y + arch.h / 2;
        const ndc = new THREE.Vector3(ax, ay, LAYER_Z[0]).project(camera);
        postfx.shockwave((ndc.x + 1) * 0.5, (ndc.y + 1) * 0.5, 0.9);
        particles.burst(ax, ay, LAYER_Z[0], 0x7c3aed, 28, 3.0);
        particles.shockwaveAmbient(ax, ay, 1.1);
        groundShockwave(ax, arch.y, LAYER_Z[0],
                        { radius: 5.0, power: 1.0, speed: 1.8, color: 0x7c3aed });
        portalFlash = 1;
        sfx?.play('portal_exit', { volume: 0.75, pitch: 1.05 });
        shakeImpulse = Math.max(shakeImpulse, 0.35);

      } else if (name === 'robot-rise') {
        // Se levanta detras de la fuente. Golpe grave, penumbra y onda a sus pies.
        if (robotMesh) setRobotGlow(new THREE.Color(0xff3060), 2.6);
        const rx = level.robot ? level.robot.x : player.position.x;
        const ry = level.robot ? level.robot.y : 0;
        const ndc = new THREE.Vector3(rx, ry + 1.5, LAYER_Z[0]).project(camera);
        postfx.shockwave((ndc.x + 1) * 0.5, (ndc.y + 1) * 0.5, 1.2);
        particles.shockwaveAmbient(rx, ry + 1.0, 1.5);
        particles.land(rx, ry, LAYER_Z[0], SURFACE.METAL, true);
        groundShockwave(rx, ry, LAYER_Z[0],
                        { radius: 11.0, power: 1.0, speed: 1.0, color: 0xff3060 });
        shakeImpulse = 1.3;
        playRobotClip('stomp', 0.75);
        sfx?.play('land_hard', { volume: 0.9, pitch: 0.35 });
        sfx?.play('step_metal', { volume: 0.7, pitch: 0.4, spread: 1.8 });
        // La musica se hunde un instante: es el compas seco del GDD.
        choreo.rampShelf(-20, 0.2);
        setTimeout(() => choreo.rampShelf(0, 1.4), 700);
        // Y la presentacion en dos tiempos ya no hace falta: la ha hecho la escena.
        robotIntro = 2;

      } else if (name === 'caida-inicio') {
        /**
         * EL SET PIECE DE CAIDA (GDD §4.2). La camara se queda y el FONDO sube.
         *
         * Es lo que permite cubrir los 59 m entre el ultimo tejado (169) y la plaza
         * (228) sin que el jugador los recorra, y por tanto lo que permitio acortar
         * la zona B de 164 m a 107 y cerrar TDB-001.
         *
         * La tecnica es el desplazamiento vertical de UV del parallax: la misma
         * banda infinita que ya produce el scroll horizontal, girada 90 grados. No
         * hay geometria nueva, ni un render target extra, ni motion blur real — que
         * habria costado un buffer de velocidad y un pase, contra el presupuesto del
         * GDD §10.12. Con todo el fotograma moviendose en la MISMA direccion, el
         * desenfoque direccional es indistinguible del real (R2 §3.5).
         */
        caida = {
          t: 0,
          desdeX: player.position.x,
          hastaX: (level.stages.find((s) => s.id === 'etapa3')?.retry?.x) ?? 232,
          y: player.body.y,
          scroll: 0,
          frenando: false,
        };
        drone.stop();
        sfx?.play('portal_enter', { volume: 0.5, pitch: 0.5 });
        choreo.rampShelf(-18, choreo.beatSeconds);

      } else if (name === 'caida-salto') {
        /**
         * EL CORTE. Los 65 m hasta la plaza, en un frame.
         *
         * Cae en el pulso en que la imagen no se puede leer: el fondo va a máxima
         * velocidad, el desenfoque direccional está al 0,9 y encima entra un fogonazo.
         * Todo lo que salta —la cámara, las bandas de parallax, sus offsets de
         * textura— salta debajo de eso.
         *
         * Se hace aquí y no repartido a lo largo del compás porque la cámara sigue la
         * X del personaje: cualquier traslado *visible* arrastra el mundo de lado y
         * mata la caída. Un corte tapado es invisible; un deslizamiento de 30 m/s no.
         */
        if (caida) {
          player.body.x = caida.hastaX - player.width / 2;
          caida.saltado = true;
        }
        destello(1.0);
        postfx.aberrationImpulse(1.2);
        postfx.shockwave(0.5, 0.55, 0.8);
        shakeImpulse = Math.max(shakeImpulse, 0.5);
        sfx?.play('portal_enter', { volume: 0.55, pitch: 1.3 });

      } else if (name === 'caida-frenada') {
        // El fondo se para y Borislov sigue un instante suspendido. El frenado se
        // vende soltandolo DESPUES de que el fondo pare, no a la vez: si las dos
        // cosas ocurren juntas, se lee como que la animacion se ha cortado.
        if (caida) caida.frenando = true;

      } else if (name === 'caida-impacto') {
        // El aterrizaje cae en el downbeat del compas 35, que es donde arranca
        // `combate2`. El golpe de aterrizar ES el golpe que abre la musica del jefe.
        if (caida) {
          player.body.x = caida.hastaX - player.width / 2;
          player.body.y = world.groundHeightAt(caida.hastaX, 0, 0.4);
          player.velocity.x = 0;
          player.velocity.y = 0;
          player._peakY = player.body.y;
          player.layer = 0;
          player.setState(STATE.ROLL);
          caida = null;
        }
        parallax.setVerticalScroll(0);
        postfx.forceMotion(null);
        viento.set(0);
        congelar(0.16);
        shakeImpulse = 1.1;
        postfx.aberrationImpulse(1.1);
        postfx.shockwave(0.5, 0.42, 1.1);
        particles.land(player.position.x, player.position.y, LAYER_Z[0], SURFACE.HIERBA, true);
        groundShockwave(player.position.x, player.position.y, LAYER_Z[0],
                        { radius: 6.0, power: 1.0, speed: 1.6, color: 0x2ed8ee });
        sfx?.play('land_hard', { volume: 0.95, pitch: 0.7 });
        choreo.rampShelf(0, choreo.barSeconds * 0.5);
      }
    },
    say: (id) => dialogue?.say(id),
  });

  /** Envoltorio del jugador para que la cinematica pueda dirigirlo como a un actor. */
  const playerActor = {
    play: (clip, loop = true) => { cinematicClip = { clip, loop }; },
    face: (d) => { player.facing = d; },
    moveTo: (toX, seconds) => { scriptedMove = { fromX: player.position.x, toX, seconds, t: 0 }; },
  };
  let cinematicClip = null;
  let scriptedMove = null;
  /** Estado del set piece de caida. `null` cuando no se esta cayendo. */
  let caida = null;

  /**
   * Avanza la caida. Se llama cada frame ANTES de la fisica.
   *
   * Mientras dura, el jugador no cae de verdad: se le sostiene la Y y se le desplaza
   * la X hacia la plaza. Cae el FONDO. Sostener la Y no es cosmetico — con la
   * gravedad puesta cruzaria `killY` a mitad del compas y el juego le haria
   * reaparecer en medio del plano.
   */
  function actualizarCaida(dt) {
    if (!caida) return;
    caida.t += dt;

    /**
     * EL PERSONAJE NO SE MUEVE EN HORIZONTAL. Cae el fondo.
     *
     * Al principio los 65 m hasta la plaza se recorrían interpolados a lo largo del
     * compás, con una curva suave para que el parallax no diera un salto. Y se veía
     * fatal, por una razón que sólo aparece jugando: **la cámara sigue la X del
     * personaje**, así que trasladarlo hace que el mundo entero se deslice de lado a
     * 30 m/s. No se lee como una caída, se lee como que a la cabra se la llevan
     * arrastrando.
     *
     * El GDD §4.2 lo decía literalmente y yo lo había implementado al revés: *"la
     * cámara se queda quieta y él cae dentro del cuadro"*. Así que la X se queda
     * donde está, y el salto a la plaza se hace **en un solo frame**, en el pulso en
     * que la imagen es ilegible — desenfoque al máximo, fondo a toda velocidad y
     * fogonazo encima. Es exactamente para lo que existen las transiciones en este
     * juego: tapar un cambio en el punto en que no se puede leer.
     */
    player.body.y = caida.y;
    player.velocity.x = 0;
    player.velocity.y = 0;

    // El fondo sube acelerando, y frena de golpe cuando se pide. La velocidad de
    // scroll es lo que comunica la caida entera.
    const objetivo = caida.frenando ? 0 : 46;
    caida.velScroll = (caida.velScroll ?? 0)
      + (objetivo - (caida.velScroll ?? 0)) * Math.min(1, dt * (caida.frenando ? 9 : 3.2));
    caida.scroll += caida.velScroll * dt;
    parallax.setVerticalScroll(caida.scroll);

    // Desenfoque direccional VERTICAL, proporcional a lo rapido que sube el fondo.
    const k = Math.min(1, caida.velScroll / 46);
    postfx.forceMotion(k * 0.9, 0, 1);
    // Y el viento sube con el, que es lo unico que dice "estas cayendo" aparte del
    // fondo: el personaje esta quieto en pantalla y sin las estelas parece flotando.
    viento.set(k * 1.0, 0, 1, 0xdfe8ff);
  }

  const look = {
    target: AMBIENTES.presentacion || AMBIENTE_NEUTRO,
    key: new THREE.Color(0xfff0d8),
    fog: new THREE.Color(0x050a2e),
    intensity: 2.2,
    rim: 0.8,
    shake: 0,   // sostenido por momento; los golpes van en shakeImpulse
  };

  const api = {
    player, level, portals, choreo, postfx, drone, particles, scene, screws, shots,
    /** Inercia de orejas y barba. `__game.secondary.impulse('ear', 0, 0, 9)`. */
    get secondary() { return secondary; },
    input,   // expuesto para poder dirigir al personaje desde las pruebas
    breakables, pushables, plates,
    transicion,
    /** Prueba una transicion del diccionario sin esperar a cambiar de etapa. */
    probarTransicion: (nombre, url = null) =>
      transicion.start(nombre, choreo.barSeconds, url),
    get props() { return props; },
    propPickups,
    throwsPool,
    get sparksTaken() { return sparksTaken; },
    get screwsTaken() { return screwsTaken; },

    /**
     * Volumenes independientes por bus (plan §27.5).
     *
     * `master` multiplica a los otros tres en vez de existir como nodo propio: son
     * tres cadenas separadas (musica, sfx, voces) que nunca se mezclaron en un bus
     * comun, y meterlo ahora obligaria a reconectar el grafo entero por una barra.
     */
    setVolumes({ master = 1, music = 1, sfx: sfxVol = 1, voice = 1 } = {}) {
      volumes = { master, music, sfx: sfxVol, voice };
      applyVolumes();
    },

    /** Accesibilidad y preferencias de presentacion. */
    setOptions({ subtitles, reduceMotion, reduceFlash } = {}) {
      if (subtitles !== undefined) {
        opts.subtitles = subtitles;
        if (options.subtitleEl) options.subtitleEl.style.display = subtitles ? '' : 'none';
      }
      if (reduceMotion !== undefined) opts.reduceMotion = reduceMotion;
      if (reduceFlash !== undefined) opts.reduceFlash = reduceFlash;
    },
    get repaired() { return repaired; },
    /**
     * Expuestos para VERIFICAR JUGANDO desde la consola. La camara y la vista son lo
     * unico con lo que se puede comprobar que un cambio de etapa cambio de verdad la
     * perspectiva: mirar una captura no distingue 28 grados de 30.
     */
    // `renderer` e `input` se exponen para el traspaso al laberinto (spec 038): el
    // contexto WebGL es lo caro y lo que el navegador limita, asi que el modo
    // siguiente reutiliza el que ya esta caliente en vez de abrir un segundo canvas.
    camera, viento, renderer, input,
    get vista() { return { ...vistaActual, objetivo: { ...vistaObjetivo } }; },
    get logros() { return { ganados: [...logrosGanados], catalogo: LOGROS }; },
    get boca() { return boca ? { abierta: boca.abierta, ancha: boca.ancha } : null; },
    get caida() { return caida; },
    get hitstop() { return hitstop; },
    onFrame: null, onMomentChanged: null, dispose,
    /**
     * Se dispara cuando el nivel 1 se ha terminado del todo: robot reparado, baile
     * y cartelon incluidos. Es el enganche con el laberinto (spec 038): quien monte
     * el juego decide que hacer despues, y el motor no tiene que saber que existe un
     * nivel 2.
     */
    onComplete: null,
    startMusic: () => choreo.play(),
    get director() { return director; },
    get dialogue() { return dialogue; },
  };

  new GLTFLoader().load(modelUrl, (gltf) => {
    gltfSource = gltf;
    avatar = gltf.scene;
    avatar.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    paintBorislov(avatar);
    // El sistema de props necesita el esqueleto, asi que nace con el avatar.
    // Se le pasa el registrador de la disolucion: los props cruzan de capa con el
    // personaje en vez de quedarse enteros mientras el se desvanece.
    props = new PropSystem(avatar, (m) => portals.registerMaterial(m));
    // Y se calientan sus shaders AQUI, al cargar, no la primera vez que el jugador
    // recoge algo. Ver `PropSystem.precompile`.
    log(`props precompilados: ${props.precompile(renderer, scene, camera)}`);

    // Se escala a la altura del colisionador, para que fisica y dibujo coincidan
    // aunque el GLB sea un placeholder de otra estatura.
    const byName = new Map();
    avatar.traverse((o) => {
      if (o.isBone) byName.set(o.name.replace(/^mixamorig[:_]?/i, '').toLowerCase(), o);
    });
    avatar.updateMatrixWorld(true);
    const top = byName.get('headtop_end');
    const toe = byName.get('lefttoe_end');
    let modelHeight = 1.82;
    if (top && toe) {
      modelHeight = top.getWorldPosition(new THREE.Vector3()).y
                  - toe.getWorldPosition(new THREE.Vector3()).y;
    }
    avatar.scale.setScalar(player.height / modelHeight);

    // La reactividad secundaria se monta DESPUES de la escala: el muelle mide
    // aceleraciones en metros de mundo, y montarlo antes lo dejaria calibrado para un
    // personaje de otro tamano.
    secondary = new SecondarySystem(avatar);
    log(secondary.count
      ? `reactividad secundaria: ${secondary.count} huesos`
      : 'reactividad secundaria: el GLB no trae huesos secundarios (ear_*, beard_*, tail_*)');

    // Huesos mas bajos de cada pierna. Sirven para anclar al suelo cualquier clip
    // que despegue los pies (ver `groundLock`).
    footBones = ['lefttoe_end', 'righttoe_end', 'leftfoot', 'rightfoot']
      .map((n) => byName.get(n))
      .filter(Boolean);
    // La mano que lanza y la cadera de referencia: con las dos se mide cuanto se ha
    // estirado el brazo, que es lo que decide el instante de la suelta.
    handBone = byName.get('righthand') || byName.get('lefthand') || null;
    hipsBone = byName.get('hips') || null;

    montarBoca(avatar, byName.get('head'));

    scene.add(avatar);
    animator = new Animator(avatar, gltf.animations);

    portals.registerAvatar(avatar);
  // Onda SUAVE al cerrarse un portal temporal: lenta, ancha y tenue. Un golpe seco
  // se leeria como una explosion, y lo que pasa es lo contrario — algo que se agota.
  portals.onTemporaryClosed = (x, y, z) => {
    groundShockwave(x, y - 1.15, z,
                    { radius: 3.8, power: 0.45, speed: 0.9, color: 0xe62a9e });
    particles.airBurst(x, y, z, 0xe62a9e, 10, 1.2);
    particles.shockwaveAmbient(x, y, 0.35);
    sfx?.play('portal_exit', { volume: 0.28, pitch: 0.55 });
  };
    portals.precompile(renderer, camera);

    api.clipNames = gltf.animations.map((c) => c.name);
    if (options.onReady) options.onReady(api);
  });

  function spawnActors(spec) {
    if (!gltfSource) return;
    for (const def of spec.actors || []) {
      if (actors.has(def.name)) continue;
      const actor = new Actor(gltfSource, {
        ...def,
        scale: avatar ? avatar.scale.x : 1,
        z: LAYER_Z[def.layer ?? 0],
      });
      scene.add(actor.root);
      if (def.idle) actor.play(def.idle);
      actors.set(def.name, actor);
    }
  }

  function despawnActors() {
    for (const actor of actors.values()) actor.dispose();
    actors.clear();
    cinematicClip = null;
    scriptedMove = null;
  }

  // ----------------------------------------------------------------- camara
  const cam = { x: player.position.x, y: 2.2, lead: 0, z: 0, dist: VISTA_BASE.dist };
  const DEAD_ZONE = 1.6;

  /**
   * LA VISTA DE LA ETAPA — el cambio de perspectiva al cambiar de tramo.
   *
   * Cada etapa declara su `vista` en `w_level.js` y aqui se mezcla hacia ella. Lo que
   * cambia de verdad es la **FOV**, no solo la distancia: con 24 grados el nivel se
   * aplana y se lee como un diorama, y con 36 el suelo se abre bajo los pies y los
   * tejados se van al punto de fuga. Mover solo la distancia no cambia la
   * perspectiva — cambia el tamaño, que es otra cosa y se nota mucho menos.
   *
   * Se interpola en ~2 s. Un corte de FOV es de las pocas cosas que de verdad marean.
   */
  let vistaObjetivo = { ...VISTA_BASE };
  const vistaActual = { ...VISTA_BASE };
  /** FOV de juego, sin el aporte de la transicion. Ver `updateCamera`. */
  let fovJuego = VISTA_BASE.fov;

  function aplicarVista(v) {
    vistaObjetivo = { ...VISTA_BASE, ...(v || {}) };
    if (vistaObjetivo.cornerTint !== undefined) {
      postfx.setCorners(vistaActual.corners, vistaActual.cornerPulse, 0.55,
                        vistaObjetivo.cornerTint);
    }
  }

  function mezclarVista(dt) {
    const k = Math.min(1, dt * 0.9);
    for (const campo of ['dist', 'fov', 'lead', 'corners', 'cornerPulse']) {
      vistaActual[campo] += (vistaObjetivo[campo] - vistaActual[campo]) * k;
    }
    // El marco de esquinas late con el pulso de la musica encima de su valor de
    // etapa: es la interfaz del Proyector, y respira al compas como todo lo demas.
    postfx.setCorners(
      vistaActual.corners * (1 + beatPulse * 0.10),
      vistaActual.cornerPulse,
      0.55,
      vistaObjetivo.cornerTint
    );
  }

  function updateCamera(dt) {
    // Toma de cinematica: la camara deja de seguir al jugador y va a una posicion
    // guiada, siempre interpolando. Nunca hay corte seco.
    if (cameraShot) {
      cameraShot.t = Math.min(cameraShot.seconds, cameraShot.t + dt);
      const k = cameraShot.seconds > 0 ? cameraShot.t / cameraShot.seconds : 1;
      const eased = k * k * (3 - 2 * k);
      cam.x = cameraShot.fromX + (cameraShot.x - cameraShot.fromX) * eased;
      cam.y = cameraShot.fromY + (cameraShot.y - cameraShot.fromY) * eased;
      cam.dist = cameraShot.fromZ + (cameraShot.distance - cameraShot.fromZ) * eased;

      // Dolly zoom: la camara se acerca o se aleja mientras la FOV compensa, de modo
      // que el sujeto conserva su tamano y lo que se deforma es el FONDO. Es el plano
      // de "algo va mal" — para cuando aparece el robot, o al entrar al Proyector.
      if (cameraShot.dolly) {
        // Se conserva  d * tan(fov/2)  constante.
        const fov = 2 * THREE.MathUtils.radToDeg(Math.atan(cameraShot._k / Math.max(cam.dist, 0.1)));
        camera.fov = THREE.MathUtils.clamp(fov, 8, 90);
        camera.updateProjectionMatrix();
      }
      // La toma manda mientras dura, pero la base de juego la sigue: si no, al
      // devolver la camara al jugador la FOV pega un salto desde donde la dejo la
      // cinematica hasta donde estaba antes de empezar.
      fovJuego = camera.fov;

      camera.position.set(cam.x, cam.y + 1.0, cam.dist);
      camera.lookAt(cam.x, cam.y, 0);
      key.position.set(cam.x + 6, cam.y + 12, 8);
      key.target.position.set(cam.x, cam.y, 0);
      parallax.update(cam.x, dt);
      scrim.position.x = cam.x;
      return;
    }
    // ---- foco sobre un objetivo: desvia la camara un instante y vuelve ----
    if (focusShot) {
      focusShot.t += dt;
      const inT = focusShot.seconds;
      const total = inT + focusShot.hold;
      let k;
      if (focusShot.t <= inT) k = focusShot.t / inT;                       // va
      else if (focusShot.t <= total) k = 1;                               // se queda
      else k = Math.max(0, 1 - (focusShot.t - total) / inT);              // vuelve

      const eased = k * k * (3 - 2 * k);
      focusBlend = eased;
      focusPos.set(focusShot.x, focusShot.y);
      focusDist = focusShot.dist;

      if (focusShot.t > total + inT) {
        if (focusShot.label && promptBox) promptBox.style.opacity = '0';
        focusShot = null;
        focusBlend = 0;
      }
    }

    // ---- zoom del momento musical, sobre la camara de juego ----
    // La distancia de reposo es la DE LA ETAPA, no un 16 fijo.
    let wantDist = vistaActual.dist;
    let dollyNow = false;
    if (momentZoom) {
      momentZoom.t += dt;
      const total = momentZoom.seconds + momentZoom.hold;
      if (momentZoom.t >= total + momentZoom.seconds) {
        momentZoom = null;                       // vuelta completa: se suelta
      } else if (momentZoom.t <= momentZoom.seconds) {
        const k = momentZoom.t / momentZoom.seconds;
        const eased = k * k * (3 - 2 * k);       // smoothstep: entra y sale suave
        wantDist = momentZoom.from + (momentZoom.dist - momentZoom.from) * eased;
        dollyNow = momentZoom.dolly;
        if (!momentZoom._k) {
          momentZoom._k = momentZoom.from * Math.tan(THREE.MathUtils.degToRad(vistaActual.fov) / 2);
        }
      } else if (momentZoom.t <= total) {
        wantDist = momentZoom.dist;              // se queda ahi
        dollyNow = momentZoom.dolly;
      } else {
        const k = (momentZoom.t - total) / momentZoom.seconds;
        const eased = k * k * (3 - 2 * k);
        wantDist = momentZoom.dist + (vistaActual.dist - momentZoom.dist) * eased;
        dollyNow = momentZoom.dolly;
      }
    }
    cam.dist += (wantDist - cam.dist) * Math.min(1, dt * 2.5);

    /**
     * LA FOV DE JUEGO, separada de la que se escribe en la camara.
     *
     * Aqui habia un defecto de acumulacion. El aporte de la transicion se sumaba al
     * final sobre `camera.fov` — el valor YA ESCRITO — cada frame, mientras este
     * bloque solo tiraba de vuelta un `dt*3` de la diferencia. Con la transicion
     * `whip` (fov: 5) sumando 5 grados por frame contra un tiron de 0,05, la FOV
     * escalaba hasta el tope de 90 grados en menos de un segundo, y el nivel se veia
     * con un ojo de pez durante toda la transicion.
     *
     * Medido antes del arreglo, 2,2 s despues de entrar en cada momento:
     * `combate1` 49,0 grados y `climax_salvaje` 90,0 — con 30 y 36 declarados.
     *
     * Se arregla teniendo una base propia: la transicion se SUMA a la base, no al
     * resultado, asi que su aporte no se puede realimentar.
     */
    if (dollyNow && momentZoom) {
      // Dolly zoom: se conserva  d * tan(fov/2). El sujeto no cambia de tamaño;
      // lo que se abalanza es el fondo.
      fovJuego = THREE.MathUtils.clamp(2 * THREE.MathUtils.radToDeg(
        Math.atan(momentZoom._k / Math.max(cam.dist, 0.1))
      ), 12, 70);
    } else if (Math.abs(fovJuego - vistaActual.fov) > 0.01) {
      // Al salir de una toma, la FOV vuelve a la DE LA ETAPA sin corte. Antes volvia
      // siempre a la misma constante, asi que la perspectiva de tramo se perdia en
      // cuanto pasaba una cinematica o un zoom de momento.
      fovJuego += (vistaActual.fov - fovJuego) * Math.min(1, dt * 3);
    }

    const px = player.position.x;
    if (px > cam.x + DEAD_ZONE) cam.x = px - DEAD_ZONE;
    else if (px < cam.x - DEAD_ZONE) cam.x = px + DEAD_ZONE;

    const wanted = player.facing * vistaActual.lead * Math.min(1, Math.abs(player.velocity.x) / 4);
    cam.lead += (wanted - cam.lead) * Math.min(1, dt * 2.5);

    const targetY = player.position.y + 1.6;
    cam.y += (targetY - cam.y) * Math.min(1, dt * 4);

    // La camara acompana un poco al cambiar de capa, sin cortar nunca.
    const targetZ = LAYER_Z[player.layer] * 0.35;
    cam.z += (targetZ - cam.z) * Math.min(1, dt * 3);

    let cx = Math.max(level.bounds.minX + 6, Math.min(level.bounds.maxX - 6, cam.x + cam.lead));
    let cy = cam.y;
    let cdist = cam.dist + cam.z;

    // Mezcla del foco: se interpola HACIA el objetivo y se vuelve. La camara nunca
    // corta, solo se desplaza — cortar en un juego cronometrado desorienta.
    if (focusBlend > 0.001) {
      cx += (focusPos.x - cx) * focusBlend;
      cy += (focusPos.y - cy) * focusBlend;
      cdist += (focusDist - cdist) * focusBlend;
    }

    // Temblor: el sostenido del momento musical + los golpes puntuales.
    // Se suma a la POSICION, no al lookAt, para que el encuadre no se tuerza.
    shakeImpulse = Math.max(0, shakeImpulse - dt * 3.0);
    // Tres fuentes de temblor: el sostenido del momento musical, los golpes
    // puntuales y el de la transicion en curso.
    const amp = look.shake * 0.22 + shakeImpulse * 0.5 + transicion.tremor * 0.28;
    const sx = amp ? Math.sin(elapsed * 47.3) * amp * 0.6 : 0;
    const sy = amp ? Math.sin(elapsed * 61.7) * amp : 0;

    camera.position.set(cx + sx, cy + 1.2 + sy, cdist + transicion.dolly);
    camera.lookAt(cx, cy, LAYER_Z[player.layer] * 0.5);
    // El giro va DESPUES del lookAt: si no, el lookAt lo deshace. Es el que
    // convierte un desenfoque en desorientacion y no en un tiron de rendimiento.
    if (transicion.roll) camera.rotateZ(transicion.roll);
    // Y el aporte de FOV de la transicion, sobre la BASE de juego — no sobre lo ya
    // escrito, que es lo que se realimentaba hasta saturar en 90 grados.
    const fovFinal = THREE.MathUtils.clamp(fovJuego + transicion.fov, 8, 90);
    if (Math.abs(camera.fov - fovFinal) > 0.001) {
      camera.fov = fovFinal;
      camera.updateProjectionMatrix();
    }
    parallax.update(cx, dt);
    scrim.position.x = cx;

    key.position.set(cx + 6, cam.y + 12, 8);
    key.target.position.set(cx, cam.y, 0);
  }

  // ------------------------------------------------------------------ bucle
  let accumulator = 0;
  let last = performance.now();
  let elapsed = 0;
  let paused = false;
  let lastState = player.state;
  let avatarTint = 0;
  let sfx = null;
  let lastPortalPhase = 'idle';
  let lastX = player.position.x;
  let lastSparks = 0;
  let wallDust = 0;

  function tick(now) {
    const frameTime = Math.min(0.25, (now - last) / 1000);
    last = now;
    elapsed += frameTime;

    if (input.justPressed(ACTIONS.PAUSE)) {
      paused = !paused;
      choreo.setPaused(paused);
    }

    // ------------------------------------------------------- coreografia
    choreo.update();
    beatPulse = Math.max(0, beatPulse - frameTime * 4.5);

    // Cinematica: dispara sus eventos sobre la linea de tiempo de la musica.
    if (choreo.playing) cinematic.update(choreo.position);
    for (const actor of actors.values()) actor.update(frameTime);

    // Guardia: el desplazamiento guiado SOLO vale dentro de una cinematica. Si no,
    // un corte a mitad deja al jugador clavado, moviendose sin cambiar de estado y
    // sin responder al mando — muy dificil de diagnosticar desde fuera.
    if (scriptedMove && director && director.control !== CONTROL.CINEMATIC) {
      scriptedMove = null;
      cinematicClip = null;
    }

    // Desplazamiento guiado del jugador durante una cinematica.
    if (scriptedMove) {
      scriptedMove.t = Math.min(scriptedMove.seconds, scriptedMove.t + frameTime);
      const k = scriptedMove.t / scriptedMove.seconds;
      const eased = k * k * (3 - 2 * k);
      const x = scriptedMove.fromX + (scriptedMove.toX - scriptedMove.fromX) * eased;
      player.body.x = x - player.width / 2;
      player.facing = scriptedMove.toX >= scriptedMove.fromX ? 1 : -1;
      if (scriptedMove.t >= scriptedMove.seconds) scriptedMove = null;
    }

    // El director decide etapas, objetivos, dialogo y quien tiene el control.
    director?.update(frameTime, {
      sparks: sparksTaken,
      sparksTotal: sparks.length,
      crossings: portals.crossings,
      screws: screwsTaken,
      repaired,
      attempts,
    });

    // Ambiente del momento, interpolado a lo largo de ~1 s.
    const blend = Math.min(1, frameTime * 1.1);
    look.key.lerp(new THREE.Color(look.target.key), blend);
    look.fog.lerp(new THREE.Color(look.target.fog), blend);
    look.intensity += (look.target.intensity - look.intensity) * blend;
    look.rim += (look.target.rim - look.rim) * blend;
    look.shake += (look.target.shake - look.shake) * blend;

    key.color.copy(look.key);
    key.intensity = look.intensity * (1 + beatPulse * 0.18);
    rim.intensity = look.rim * (1 + beatPulse * 0.35);
    scene.fog.color.copy(look.fog);
    scene.background.copy(look.fog);

    postfx.setLook(look.target);
    // La curvatura de la transicion se suma SIN interpolar: la del momento es el
    // tono del tramo y mezcla despacio; esta es el paso por el portal y tiene que
    // caer en el frame.
    postfx.setWarp(transicion.warp);
    // El desenfoque direccional sigue a la velocidad del jugador: solo aparece
    // corriendo, que es cuando comunica algo.
    // ---- recuadro de radio de Bradislav ----
    // Las barras siguen la envolvente REAL de la voz: se paran en las pausas y
    // suben en las silabas fuertes. Con una animacion falsa el recuadro se nota
    // desconectado de lo que se oye, y entonces no sostiene la ficcion.
    if (radioEl && dialogue) {
      const onAir = dialogue.speaking === 'bradislav';
      radioEl.classList.toggle('on', onAir);
      if (onAir) {
        const level = dialogue.radioLevel();
        for (let i = 0; i < radioBars.length; i += 1) {
          // Cada barra responde a un tramo distinto del nivel, de fuera hacia
          // dentro: asi el medidor se llena en vez de subir y bajar en bloque.
          const need = (i + 0.5) / radioBars.length;
          const h = 12 + Math.max(0, Math.min(1, (level - need * 0.55) * 2.2)) * 88;
          radioBars[i].style.height = `${h}%`;
        }
      }
    }

    transicion.update(frameTime);
    // El desenfoque de la transicion manda sobre el de la velocidad.
    postfx.forceMotion(transicion.running ? transicion.blur : null, player.facing);
    // Y el aire se arremolina con ella.
    if (transicion.running) particles.setFieldSpeed(transicion.roll * 60);
    updateFlights(frameTime);
    revisarTutorial();
    actualizarLogros(frameTime);
    actualizarBoca(frameTime);

    // Barra de habilidades. El total de recarga se recuerda para poder dibujar la
    // proporcion: sin el, la barra no sabe de cuanto esta bajando.
    pintarHabilidad(skillThrow, !!props?.can('throw'), throwCooldown, throwCooldownTotal);
    pintarHabilidad(skillPortal, !!props?.can('portal'), castCooldown, castCooldownTotal);
    // ---- viñeta: la pupila ----
    //
    // Se CIERRA cuando la camara se aleja y se ABRE cuando se acerca. La razon no es
    // decorativa: al alejarse es cuando entran en cuadro los bordes del mundo — el
    // final de una banda de parallax, el canto de una plataforma, el vacio detras —
    // y cerrar el encuadre los tapa sin quitar nada de lo que importa, que siempre
    // esta en el centro. Al acercarse ya no hay costura que esconder, asi que se abre.
    //
    // Y durante una transicion se cierra del todo: es la mascara que remata el corte.
    const lejania = THREE.MathUtils.clamp((cam.dist - 14) / 12, 0, 1);
    const objetivoVineta = Math.max(lejania * 0.55, transicion.running ? 0.85 : 0);
    vineta += (objetivoVineta - vineta) * Math.min(1, frameTime * 2.5);
    // La pupila cede ante el marco de esquinas. Son dos efectos distintos que
    // comparten palabra —una mascara circular centrada y un marco— y sumados cierran
    // la imagen el doble (R2 §3.2). Con el marco puesto, la pupila se retira.
    postfx.setVignette(vineta * (1 - Math.min(0.7, vistaActual.corners * 0.9)), 0.5);
    mezclarVista(frameTime);

    // El destello: el de la transicion mas el puntual, que decae a 4/s.
    destelloExtra = Math.max(0, destelloExtra - frameTime * 4);
    const luz = Math.min(1, transicion.flash + destelloExtra) * (opts.reduceFlash ? 0.22 : 0.75);
    if (Math.abs(parseFloat(flashEl.style.opacity) - luz) > 0.004) {
      flashEl.style.opacity = luz.toFixed(3);
    }

    postfx.setMotion(player.velocity.x);
    shotViews.faceCamera(camera);
    throwViews.faceCamera(camera);
    postfx.update(frameTime);
    particles.update(frameTime);
    // El polvo se centra en lo que la camara ESTA mirando (cx, con el adelanto ya
    // aplicado), no en cam.x: si no, la nube queda desplazada respecto al encuadre.
    particles.fitTo(camera, Math.abs(camera.position.z - LAYER_Z[player.layer]));
    if (!transicion.running) particles.setFieldSpeed(player.velocity.x);
    // El polvo se vuelve confeti mientras Borislov baila: mismo sistema, mismas
    // particulas, mismo draw call — solo cambia el color, y con eso basta.
    particles.setFiesta(coda && coda.step === 2, frameTime);
    // El viento viaja CON la camara, igual que las bandas de atmosfera: asi su caja
    // nunca se queda atras por rapido que corra el jugador.
    viento.update(frameTime, camera.position.x, camera.position.y, LAYER_Z[player.layer]);
    particles.updateAmbient(frameTime, camera.position.x, camera.position.y - 1.2,
                            player.position.x, player.position.y,
                            LAYER_Z[player.layer]);

    if (!paused) {
      // El control se ignora durante la transicion de portal y en cinematica.
      const locked = portals.busy || (director && !director.playerHasControl);
      const runner = locked ? null : runnerActivo();
      let active = locked ? NULL_INPUT : input;
      if (runner) {
        RUNNER_INPUT._real = input;
        active = RUNNER_INPUT;
      }

      // El hitstop congela el playsim, no el frame. La camara, el post-proceso y la
      // musica siguen: congelarlo todo se lee como un tiron, y congelar solo la
      // simulacion se lee como un golpe.
      if (hitstop > 0) hitstop = Math.max(0, hitstop - frameTime);
      if (runnerEspera > 0) runnerEspera = Math.max(0, runnerEspera - frameTime);
      // La caida manda sobre la fisica: mientras dura, el jugador no cae, cae el
      // fondo. Va ANTES del paso fijo para que la fisica parta de su posicion.
      actualizarCaida(frameTime);
      // Durante la caida la fisica no corre: si corriera, la gravedad ganaria a la
      // Y sostenida dentro del mismo frame y el personaje se hundiria en el plano.
      accumulator += (hitstop > 0 || caida) ? 0 : frameTime;
      let steps = 0;
      while (accumulator >= FIXED_DT && steps < MAX_STEPS) {
        /**
         * NO se fuerza `_runRamp = 1`.
         *
         * Al principio sí, para que el tramo cuadrara con su ventana musical al
         * milímetro. Pero eso arranca al personaje **de golpe** a la velocidad
         * autoral, y un runner que empieza a tope no se lee como que echa a correr:
         * se lee como que le han dado al play. Dejando la rampa natural
         * (`runRampTime` = 0,40 s) el arranque tiene peso, y la rampa **no vuelve a
         * cobrarse**: `_runRamp` sólo decae cuando el eje está a cero, y con el mando
         * sintético nunca lo está. Se paga una vez, al arrancar, y ya.
         *
         * Los 0,40 s de arranque están contados en `runner.startBars`.
         */
        player.update(active, FIXED_DT);
        accumulator -= FIXED_DT;
        steps += 1;
      }
      if (steps === MAX_STEPS) accumulator = 0;

      if (!caida && player.body.y < (level.killY ?? -20)) respawn();
      updateCheckpoints();

      // --- dron perseguidor de la etapa 2 ---
      // El dron persigue en la capa del jugador: si cruzas un portal, cruza detras.
      // El dron arranca cuando se cumplen LAS DOS condiciones: el jugador tiene el
      // control y Bradislav ya ha avisado. Antes bastaba con que empezara la etapa,
      // asi que te alcanzaba durante la cinematica, sin poder moverte.
      if (drone.waiting && director?.control === CONTROL.PLAYING && droneCueGiven) {
        drone.release(choreo.barSeconds);   // un compas de arranque
        focusOn(drone.x, drone.y + 0.4, {
          dist: 11.0, hold: 0.9, once: 'dron', label: '¡Corre! No mires atrás',
        });
        // Chirrido de arranque: sube de tono durante el compas que tarda en lanzarse.
        sfx?.play('portal_enter', { volume: 0.45, pitch: 0.7 });
        setTimeout(() => sfx?.play('portal_enter', { volume: 0.5, pitch: 1.6 }),
                   choreo.barSeconds * 1000 * 0.8);
      }
      drone.setLayer(player.layer, LAYER_Z[player.layer]);
      if (drone.update(frameTime, player.position.x, player.position.y,
                       LAYER_Z[player.layer], elapsed, particles)) {
        sfx?.play('portal_exit', { volume: 0.6, pitch: 0.8 });
        particles.burst(player.position.x, player.position.y + 0.8,
                        LAYER_Z[player.layer], 0xe62a9e, 18, 2.6);
        respawn();
        // La musica rebobina al inicio del tramo: la carrera se reintenta desde el
        // mismo punto musical, no desde donde estuviera sonando.
        const stage = director?.stage;
        if (stage && stage.rewindTo !== undefined) choreo.seekMoment(stage.rewindTo);
        if (chaserWanted()) drone.start(player.position.x, LAYER_Z[player.layer], player.layer);
        else drone.stop();
        // Al tercer fallo, Bradislav le baja la velocidad. Y se la baja de verdad.
        if (drone.captures >= 3 && drone.applyHelp()) dialogue?.say('BR-06c');
      }
      // Los portales laten al pulso de la musica, no a un reloj propio.
      portals.update(frameTime, elapsed, beatPulse);

      // ---- sonido del portal + barrido de EQ ----
      if (portals.phase !== lastPortalPhase) {
        if (portals.phase === 'out') {
          sfx?.play('portal_enter', { volume: 0.7, spread: 1.0 });
          // Onda circular en el sitio del que sales: acompaña la disolucion y deja
          // claro que el salto ocurre AHI, no en un punto abstracto de la pantalla.
          groundShockwave(player.position.x, feetY(), LAYER_Z[player.layer],
                          { radius: 3.2, power: 0.9, speed: 2.6, color: 0x7c3aed });
          portalFlash = 1;
          // El shelf se hunde mientras te disuelves: la musica pierde el aire,
          // como si te la llevaras contigo al otro lado.
          choreo.rampShelf(-24, 0.35);
        } else if (portals.phase === 'in') {
          // Y otra al aparecer, en la capa nueva: la onda "empuja" al personaje
          // hacia el mundo, en vez de que se materialice sin mas.
          groundShockwave(player.position.x, feetY(), LAYER_Z[player.layer],
                          { radius: 4.0, power: 1.0, speed: 2.0, color: 0x2ed8ee });
          particles.shockwaveAmbient(player.position.x, player.position.y + 0.8, 0.7);
          sfx?.play('portal_exit', { volume: 0.45, spread: 1.2 });
        } else if (portals.phase === 'idle') {
          // Y vuelve en medio compas al salir, no de golpe.
          choreo.rampShelf(0, choreo.barSeconds * 0.5);
        }
        lastPortalPhase = portals.phase;
      }

      if (robotMixer) robotMixer.update(frameTime);

      // ---- el robot reparado se despide y se va ----
      // ---- coda: saludo y baile de cierre ----
      //
      // La secuencia va en compases, no en segundos, porque `postcombate2` dura 7
      // compases exactos y el baile tiene que caber dentro y acabar con la musica.
      //
      //   compas 0     saluda (waving) + BO-07 "¡Hola! ¡Vengan, tienen que ver esto!"
      //   compas 2     se arranca a bailar
      //   compas 5     vuelve al reposo, con la coda todavia sonando
      if (coda) {
        coda.t += frameTime;
        const bar = coda.t / choreo.barSeconds;

        if (coda.step === 0) {
          coda.step = 1;
          player.setState(STATE.WAVE);
          // Se retiene hasta el compas 2, no lo que dure el clip: el saludo es mas
          // corto que dos compases y quedaba un hueco de `idle` antes del baile.
          player.holdState(choreo.barSeconds * 2);
          player.velocity.x = 0;
          dialogue?.say('BO-07');
          particles.burst(player.position.x, feetY() + 1.2,
                          LAYER_Z[player.layer], 0xf59e0b, 22, 2.6);
        } else if (coda.step === 1 && bar >= 2) {
          coda.step = 2;
          player.setState(STATE.CELEBRATE);
          player.holdState(choreo.barSeconds * 3);
          player.velocity.x = 0;
          sfx?.play('achievement', { volume: 0.65 });
          groundShockwave(player.position.x, feetY(), LAYER_Z[player.layer],
                          { radius: 5.5, power: 0.9, speed: 1.4, color: 0xf59e0b });
        } else if (coda.step === 2 && bar >= 5) {
          coda.step = 3;

          // ---- remate: el cartelon ----
          // Va DESPUES del baile, no al reparar. Primero se celebra y luego se
          // corona; juntos se pisan y ninguno de los dos se disfruta.
          if (logroEl) {
            logroEl.classList.add('on');
            if (logroSubEl) {
              const total = level.sparks.length;
              const partes = [`${sparksTaken} de ${total} Chispas`];
              if (screwsTaken >= 3) partes.push('los tres tornillos');
              partes.push(hits === 0 ? 'sin un rasguño' : `${hits} golpe${hits > 1 ? 's' : ''}`);
              if (attempts > 0) partes.push(`${attempts} intento${attempts > 1 ? 's' : ''}`);
              logroSubEl.textContent = partes.join(' · ');
            }
          }
          sfx?.play('achievement', { volume: 0.8 });
          setTimeout(() => sfx?.play('achievement', { volume: 0.5, pitch: 1.5 }), 180);
          groundShockwave(player.position.x, feetY(), LAYER_Z[player.layer],
                          { radius: 8.0, power: 1.0, speed: 1.2, color: 0xf59e0b });
          particles.shockwaveAmbient(player.position.x, feetY() + 1.0, 1.2);
          shakeImpulse = Math.max(shakeImpulse, 0.6);
          // Un ultimo estallido de confeti, el mas grande de todos.
          for (let i = 0; i < 8; i += 1) {
            particles.airBurst(
              player.position.x + (Math.random() - 0.5) * 5.0,
              feetY() + 1.0 + Math.random() * 3.0,
              LAYER_Z[player.layer],
              CODA_COLORS[i % CODA_COLORS.length], 8, 4.0
            );
          }

          coda = null;
          // El nivel esta terminado. Se avisa DESPUES del cartelon, no al reparar:
          // primero se celebra, luego se corona, y solo entonces se pasa pagina.
          if (api.onComplete) api.onComplete({
            sparks: sparksTaken, screws: screwsTaken, hits, attempts,
          });
        }

        // ---- fiesta visual mientras baila ----
        //
        // Todo NACE DEL PERSONAJE, no de un punto fijo: se emite alrededor de su
        // posicion en este frame y a la altura visual de sus pies. Antes se colaba
        // la del frame anterior y el confeti aparecia desplazado del bailarin, que
        // es lo que se veia "en otro lado".
        if (coda && coda.step === 2) {
          const px = player.position.x;
          const pz = LAYER_Z[player.layer];
          const py = feetY();

          // Chorro continuo por los lados, como dos cañones de confeti.
          codaSpray += frameTime;
          while (codaSpray >= 0.05) {
            codaSpray -= 0.05;
            const side = Math.random() < 0.5 ? -1 : 1;
            particles.airBurst(
              px + side * (1.1 + Math.random() * 0.6),
              py + 0.4 + Math.random() * 0.5,
              pz + (Math.random() - 0.5) * 1.4,
              CODA_COLORS[Math.floor(Math.random() * CODA_COLORS.length)],
              2, 3.4
            );
          }

          // Y en cada pulso, un estallido en alto sobre su cabeza.
          if (beatPulse > 0.9) {
            for (let i = 0; i < 3; i += 1) {
              particles.airBurst(
                px + (Math.random() - 0.5) * 3.0,
                py + 1.8 + Math.random() * 1.2,
                pz + (Math.random() - 0.5) * 2.0,
                CODA_COLORS[Math.floor(Math.random() * CODA_COLORS.length)],
                6, 3.0
              );
            }
            // Un anillo en el suelo a su ritmo: el baile marca el compas.
            groundShockwave(px, py, pz, {
              radius: 3.2, power: 0.55, speed: 3.2,
              color: CODA_COLORS[Math.floor(Math.random() * CODA_COLORS.length)],
            });
            // Y empuja el polvo suspendido, para que el aire tambien celebre.
            particles.shockwaveAmbient(px, py + 1.0, 0.5);
          }
        }
      }

      if (robotExit && robotMesh) {
        robotExit.t += frameTime;
        // Saluda dos compases y luego echa a andar hacia la derecha, saliendo de
        // cuadro. El bamboleo lo hace pesado sin necesidad de root motion.
        const walkAfter = choreo.barSeconds * 2;

        // Tres orientaciones encadenadas. El modelo viene rotado -90 grados (mira a
        // la izquierda, de donde llega el jugador), asi que todo se expresa como
        // giro del GRUPO sobre esa base:
        //
        //   +90 grados  el saludo va A CAMARA — es al jugador a quien da las
        //               gracias, no al eje X. De perfil no se lee como saludo.
        //   +180        se da media vuelta para marcharse; sin esto caminaba
        //               de espaldas hacia la derecha.
        const wantTurn = robotExit.t > walkAfter - 0.45 ? Math.PI : Math.PI / 2;
        robotMesh.rotation.y += (wantTurn - robotMesh.rotation.y) * Math.min(1, frameTime * 5);

        if (robotExit.t > walkAfter) {
          if (!robotExit.walking) {
            robotExit.walking = true;
            playRobotClip('orc_walk', 0.85);
            if (robotMixer && robotActions['orc_walk']) {
              robotMixer.clipAction(robotActions['orc_walk']).setLoop(THREE.LoopRepeat, Infinity);
            }
          }
          const k = robotExit.t - walkAfter;
          robotMesh.position.x = robotExit.fromX + k * 2.2;
          robotMesh.position.y = level.robot.y + Math.abs(Math.sin(k * 3.4)) * 0.09;
          // Cada pisada suya levanta polvo: sigue pesando dos toneladas.
          if (Math.floor(k * 1.7) !== robotExit._step) {
            robotExit._step = Math.floor(k * 1.7);
            particles.land(robotMesh.position.x, level.robot.y, LAYER_Z[0], SURFACE.HIERBA, false);
            sfx?.play('step_metal', { volume: 0.28, pitch: 0.5 });
          }
          if (robotMesh.position.x > level.bounds.maxX) { robotMesh.visible = false; robotExit = null; }
        }
      }

      // ---- lanzar una Chispa de Idea ----
      //
      // El verbo de "disparo" del jugador, y es coherente con el cuento: no hay
      // armas en Caprilopolis. Lanza una de las Chispas que ha recogido, asi que
      // coleccionar deja de ser puntuacion y pasa a ser munición de utilidad.
      //
      // Dos formas, con la misma munición:
      //   Q  rapido    arco corto, recarga breve — para acertarle al dron en marcha
      //   F  cargado   arco alto y largo, mas radio — para llegar lejos o a lo alto
      throwCooldown = Math.max(0, throwCooldown - frameTime);

      // Contador de munición. Se refresca siempre, no solo al lanzar: el jugador
      // tiene que poder mirar cuantas le quedan ANTES de decidir gastar una.
      const ammo = routeTaken - sparksSpent;
      if (ammoNumEl && ammoNumEl.textContent !== String(ammo)) {
        ammoNumEl.textContent = String(ammo);
        ammoEl.classList.toggle('vacio', ammo === 0);
      }
      if (secretNumEl && secretNumEl.textContent !== String(secretTaken)) {
        secretNumEl.textContent = String(secretTaken);
        secretNumEl.nextElementSibling.textContent = `/${secretTotal}`;
      }

      // ---- abrir un Portal de Idea temporal (R) ----
      //
      // El uso caro de las Chispas, y el unico que CAMBIA LA RUTA en vez de quitar
      // un obstaculo. Por eso cuesta tres y por eso caduca: un portal permanente
      // donde quieras convertiria las dos capas en una sola y se acabaria el juego.
      //
      // El gesto es `wide_arm_spell_casting`, que en el canon del cuento no es un
      // hechizo sino manejar el Proyector — la maquina de Bradislav (GDD §10.6).
      // Sin las botas no hay portal propio. Es lo que convierte un prop en algo mas
      // que decoracion: cambiar lo que llevas cambia lo que puedes hacer.
      if (active.justPressed(ACTIONS.CAST) && !props?.can('portal')) {
        sfx?.play('portal_enter', { volume: 0.2, pitch: 0.5 });
        if (promptBox) {
          promptBox.style.opacity = '1';
          promptEl.textContent = 'Necesitas las Botas del Cañón para abrir portales';
          noAmmoHint = 1.8;
        }
      }

      // La mira sigue al jugador y se pinta segun se pueda o no. Se calcula igual
      // que la comprobacion del lanzamiento, asi que lo que ves es lo que va a pasar.
      const puedePortal = !!props?.can('portal');
      let destinoValido = false;
      if (puedePortal) {
        const sueloAqui = world.groundHeightAt(player.position.x, player.layer, -999);
        const otraCapa = player.layer === 0 ? 1 : 0;
        const sueloAlla = world.groundHeightAt(player.position.x, otraCapa, -999);
        destinoValido = sueloAlla >= sueloAqui - 4.0;

        miraPortal.visible = true;
        miraPortal.position.set(player.position.x, sueloAqui, LAYER_Z[player.layer]);
        miraAnillo.rotation.z += frameTime * 0.7;

        const listo = destinoValido && castCooldown <= 0
                   && routeTaken - sparksSpent >= CAST_COST;
        // El color responde ANTES de gastar nada: cian se puede, rosa no.
        const tono = listo ? 0x2ed8ee : 0xe62a9e;
        miraAnillo.material.color.setHex(tono);
        miraRelleno.material.color.setHex(tono);
        miraArco.material.color.setHex(tono);

        miraAnillo.material.opacity = (listo ? 0.85 : 0.45) + beatPulse * 0.15;
        miraRelleno.material.opacity = (listo ? 0.16 : 0.08) + beatPulse * 0.10;
        // El arco solo se insinua cuando de verdad se puede: si se dibujara siempre,
        // prometeria un portal en sitios donde no va a salir.
        miraArco.material.opacity = listo ? 0.30 + beatPulse * 0.22 : 0.06;
        miraPortal.scale.setScalar(listo ? 1 + beatPulse * 0.06 : 0.88);

        // ---- destino en la otra capa ----
        const hayDestino = sueloAlla > -900;
        miraDestino.visible = hayDestino;
        miraHilo.visible = hayDestino;

        if (hayDestino) {
          const zAlla = LAYER_Z[otraCapa];
          miraDestino.position.set(player.position.x, sueloAlla + 0.04, zAlla);
          destinoAnillo.rotation.z -= frameTime * 0.7;
          destinoAnillo.material.color.setHex(tono);
          destinoSilueta.material.color.setHex(tono);
          destinoAnillo.material.opacity = (listo ? 0.7 : 0.35) + beatPulse * 0.15;
          destinoSilueta.material.opacity = listo ? 0.16 + beatPulse * 0.10 : 0.06;

          // El hilo se estira entre los dos puntos y se orienta solo.
          const a = new THREE.Vector3(player.position.x, sueloAqui + 0.1, LAYER_Z[player.layer]);
          const b = new THREE.Vector3(player.position.x, sueloAlla + 0.1, zAlla);
          const medio = a.clone().add(b).multiplyScalar(0.5);
          const largo = a.distanceTo(b);
          miraHilo.position.copy(medio);
          miraHilo.scale.set(1, Math.max(0.01, largo), 1);
          miraHilo.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()
          );
          miraHilo.material.color.setHex(tono);
          miraHilo.material.opacity = listo ? 0.35 : 0.14;
        }
      } else {
        miraPortal.visible = false;
        miraDestino.visible = false;
        miraHilo.visible = false;
      }

      if (active.justPressed(ACTIONS.CAST) && puedePortal
          && player.grounded && castCooldown <= 0) {
        // El suelo se comprueba AQUI, antes del gesto. Hacerlo al soltar obligaba a
        // esperarse 1,7 s de animacion para que te dijeran que no se podia.
        if (!destinoValido) {
          sfx?.play('portal_enter', { volume: 0.3, pitch: 0.5 });
          if (promptBox) {
            promptBox.style.opacity = '1';
            promptEl.textContent = 'Al otro lado no hay suelo aquí';
            noAmmoHint = 1.6;
          }
        } else if (routeTaken - sparksSpent >= CAST_COST) {
          const gesture = animator?.clipSecondsFor(STATE.CAST) || 1.6;
          sparksSpent += CAST_COST;
          // El ciclo entero, gesto incluido, y cuantizado al pulso. Nunca menor que
          // el propio gesto: la tecla no puede estar lista antes de que el personaje
          // termine de mover los brazos.
          castCooldown = Math.max(gesture, PORTAL_CICLO_PULSOS * choreo.beatSeconds);
          castCooldownTotal = castCooldown;
          player.setState(STATE.CAST);
          // Se retiene 0,7 del gesto y no 0,9: el ultimo tercio del clip es el brazo
          // volviendo, y quedarse clavado mirandolo no aporta nada. Con el gesto ya
          // acortado, son 1,25 s de bloqueo frente a los 2,57 de antes.
          player.holdState(gesture * 0.7);
          player.velocity.x = 0;
          usado.portal = true;
          // Y el arco nace ANTES, a 0,38 del gesto en vez de a 0,55: 0,68 s desde la
          // pulsacion frente a 1,57. Lo que se sentia lento no era la recarga, era
          // pulsar la tecla y que no apareciera nada durante segundo y medio.
          pendingCast = gesture * 0.38;
          sfx?.play('portal_enter', { volume: 0.5, pitch: 0.9 });
        } else if (ammoEl) {
          // Distinto del aviso de "sin Chispas": aqui SI tienes, pero no bastantes.
          avisarSinChispas();
          if (promptBox) {
            promptBox.style.opacity = '1';
            promptEl.textContent = `Abrir un portal cuesta ${CAST_COST} Chispas de ruta`;
            noAmmoHint = 1.6;
          }
        }
      }
      castCooldown = Math.max(0, castCooldown - frameTime);

      if (pendingCast > 0) {
        pendingCast -= frameTime;
        if (pendingCast <= 0) {
          const ground = world.groundHeightAt(player.position.x, player.layer);
          const made = portals.openTemporary(player.position.x, ground + 0.1, 12, world);

          // Chispas de soldadura mientras el arco se traza: van escalonadas para
          // acompañar al anillo dibujandose, no de golpe al principio.
          if (made && made !== 'sin-suelo') {
            for (let paso = 0; paso < 5; paso += 1) {
              setTimeout(() => {
                const a = (paso / 5) * Math.PI * 2 - Math.PI / 2;
                particles.airBurst(
                  player.position.x + Math.cos(a) * 1.15,
                  ground + 1.15 + Math.sin(a) * 1.15,
                  LAYER_Z[player.layer], 0x2ed8ee, 4, 1.6
                );
                sfx?.play('spark', { volume: 0.22, pitch: 1.2 + paso * 0.18 });
              }, paso * 95);
            }
          }

          if (made === 'sin-suelo') {
            // Se devuelven las Chispas: no se cobra por algo que no ha pasado.
            sparksSpent -= CAST_COST;
            sfx?.play('portal_enter', { volume: 0.3, pitch: 0.5 });
            if (promptBox) {
              promptBox.style.opacity = '1';
              promptEl.textContent = 'Al otro lado no hay suelo aquí';
              noAmmoHint = 1.6;
            }
          } else if (made) {
            particles.burst(player.position.x, ground + 1.2, LAYER_Z[player.layer],
                            0x2ed8ee, 26, 3.2);
            groundShockwave(player.position.x, ground, LAYER_Z[player.layer],
                            { radius: 4.0, power: 0.9, speed: 2.0, color: 0x2ed8ee });
            particles.shockwaveAmbient(player.position.x, ground + 1.0, 0.7);
            sfx?.play('portal_exit', { volume: 0.6, pitch: 1.1 });
            shakeImpulse = Math.max(shakeImpulse, 0.35);
          }
        }
      }

      const wantsLight = active.justPressed(ACTIONS.THROW);
      const wantsHeavy = active.justPressed(ACTIONS.THROW_HEAVY);

      // Sin guantes no hay lanzamiento. El aviso distingue "no puedo" de "no tengo":
      // son dos problemas distintos y el jugador los resuelve de forma distinta.
      if ((wantsLight || wantsHeavy) && !props?.can('throw')) {
        sfx?.play('portal_enter', { volume: 0.2, pitch: 0.5 });
        if (promptBox) {
          promptBox.style.opacity = '1';
          promptEl.textContent = 'Necesitas los Guantes del Proyector para lanzar';
          noAmmoHint = 1.8;
        }
      }

      // Sin Chispas: se avisa en vez de no pasar nada. Un boton que no responde se
      // lee como "esta roto", no como "no tengo".
      if ((wantsLight || wantsHeavy) && props?.can('throw') && ammo <= 0) {
        sfx?.play('portal_enter', { volume: 0.2, pitch: 0.6 });
        if (ammoEl) {
          avisarSinChispas();
        }
        if (promptBox) {
          promptBox.style.opacity = '1';
          promptEl.textContent = 'Sin Chispas — recoge alguna para poder lanzar';
          noAmmoHint = 1.6;
        }
      }
      if (noAmmoHint > 0) {
        noAmmoHint -= frameTime;
        if (noAmmoHint <= 0 && promptBox) promptBox.style.opacity = '0';
      }

      if ((wantsLight || wantsHeavy) && props?.can('throw')
          && throwCooldown <= 0 && player.grounded && ammo > 0) {
        const heavy = wantsHeavy;
        const state = heavy ? STATE.THROW_HEAVY : STATE.THROW;

        // La duracion REAL del clip ya reescalada por su `speed`. De ahi sale todo
        // lo demas, en vez de constantes a ojo que se desincronizan en cuanto se
        // toca la velocidad de la animacion — que es justo lo que pasaba.
        const gesture = animator?.clipSecondsFor(state) || (heavy ? 1.9 : 1.0);

        throwCooldown = (gesture + 0.15) * (props?.can('motor') ? 0.5 : 1);
        throwCooldownTotal = throwCooldown;
        sparksSpent += 1;
        player.setState(state);
        player.holdState(gesture * 0.85);
        player.velocity.x *= heavy ? 0.15 : 0.4;   // el cargado clava los pies
        // Sonido del gesto: el zumbido de armar la Chispa. El disparo en si suena
        // al SOLTARLA, no aqui — si no, el golpe cae medio segundo antes que la mano.
        sfx?.play('spark', { volume: heavy ? 0.35 : 0.3, pitch: heavy ? 0.6 : 0.9 });

        // La suelta cae donde la mano llega arriba: ~45 % del gesto en el rapido,
        // ~52 % en el cargado, que arma mas atras antes de soltar.
        const dir = player.facing >= 0 ? 1 : -1;
        usado.throw = true;
        pendingThrow = {
          // `at` es el instante previsto de la suelta, medido sobre la duracion
          // real del clip. La deteccion de maxima extension solo puede ADELANTARLA
          // si el brazo llega antes; nunca retrasarla. Cuando `at` era el tope de
          // seguridad y el pico no disparaba, la chispa salia al final del gesto —
          // que es la desincronizacion que se veia.
          at: gesture * (heavy ? 0.52 : 0.45),
          // Y `min` es el suelo: no se suelta antes de haber armado el brazo.
          min: gesture * (heavy ? 0.34 : 0.26),
          peak: -Infinity,
          dir, heavy, layer: player.layer,
        };
        heldSpark.material.color.setHex(heavy ? 0xffd166 : 0xf59e0b);
        heldSpark.scale.setScalar(heavy ? 1.35 : 1.0);
      }

      // ---- la chispa viaja EN LA MANO y se suelta al estirar el brazo ----
      //
      // El instante de la suelta no es una fraccion fija del clip: se DETECTA. Se
      // mide cuanto se ha alejado la mano de la cadera en el sentido de la marcha,
      // y se suelta en cuanto ese alcance deja de crecer — el punto mas estirado
      // del gesto. Asi queda sincronizado con la animacion sea cual sea su
      // velocidad, en vez de descuadrarse cada vez que se toca el `speed`.
      // Si el gesto se interrumpe (un manotazo, una cinematica), la chispa no se
      // queda flotando en el aire: se cancela y se devuelve la munición.
      if (pendingThrow && player.state !== STATE.THROW && player.state !== STATE.THROW_HEAVY) {
        pendingThrow = null;
        heldSpark.visible = false;
        sparksSpent = Math.max(0, sparksSpent - 1);
      }

      if (pendingThrow) {
        pendingThrow.at -= frameTime;

        let reach = null;
        if (handBone && hipsBone) {
          handBone.getWorldPosition(_handPos);
          hipsBone.getWorldPosition(_hipsPos);
          reach = (_handPos.x - _hipsPos.x) * pendingThrow.dir;

          // La chispa sigue a la mano.
          heldSpark.visible = true;
          heldSpark.position.copy(_handPos);
          heldSpark.rotation.y += frameTime * 9;
        }

        // Se suelta cuando el alcance empieza a decrecer, con un minimo de gesto
        // hecho para no dispararse en el primer frame por ruido de la pose.
        const past = pendingThrow.at <= pendingThrow.min;
        const peaked = reach !== null && past && reach < (pendingThrow.peak ?? -Infinity) - 0.005;
        if (reach !== null && reach > (pendingThrow.peak ?? -Infinity)) pendingThrow.peak = reach;

        if (peaked || pendingThrow.at <= 0) {
          const { dir, layer, heavy } = pendingThrow;
          pendingThrow = null;
          heldSpark.visible = false;
          // Sale exactamente de donde esta la mano, no de un punto calculado.
          const fromX = handBone ? _handPos.x : player.position.x + dir * 0.55;
          const fromY = handBone ? _handPos.y : feetY() + (heavy ? 1.45 : 1.25);
          // El cargado llega al doble de lejos y tarda mas: arco alto y visible.
          throwsPool.fire(
            fromX, fromY,
            player.position.x + dir * (heavy ? 16.0 : 8.5), feetY() + 0.5,
            layer, heavy ? 1.35 : 0.95
          );
          // ---- sonido del lanzamiento ----
          // Tres capas, porque un solo disparo suena a "clic" y no a impulso:
          //   cuerpo   el golpe de aire al soltar
          //   silbido  la chispa cortando el aire, agudo y corto
          //   cola     solo en el cargado, el peso del gesto a dos manos
          sfx?.play('portal_exit', {
            volume: heavy ? 0.65 : 0.45,
            pitch: heavy ? 0.8 : 1.35,
            spread: 1.0,
          });
          sfx?.play('spark', {
            volume: heavy ? 0.5 : 0.42,
            pitch: heavy ? 1.5 : 2.0,
          });
          if (heavy) {
            setTimeout(() => sfx?.play('land_soft', { volume: 0.3, pitch: 0.55 }), 70);
          }

          // Fogonazo de salida: la chispa nace de algo, no aparece sin mas.
          particles.airBurst(fromX, fromY, LAYER_Z[layer], 0xf59e0b,
                             heavy ? 16 : 8, heavy ? 3.0 : 2.0);
          groundShockwave(fromX, fromY, LAYER_Z[layer],
                          { radius: heavy ? 2.0 : 1.1, power: heavy ? 0.8 : 0.5,
                            speed: 5.0, color: 0xf59e0b });
          if (heavy) shakeImpulse = Math.max(shakeImpulse, 0.3);
        }
      }

      // Blancos de las Chispas del jugador. Se recalculan cada frame porque el dron
      // se mueve; el coste es un array de dos entradas.
      throwTargets.length = 0;
      if (drone.active && drone.stunned <= 0) {
        throwTargets.push({
          x: drone.x, y: drone.y, radius: 1.5, layer: drone.layer,
          onHit: (hx, hy, hz) => {
            drone.stun(1.4);
            particles.burst(drone.x, drone.y, hz, 0x2ed8ee, 24, 3.2);
            particles.shockwaveAmbient(drone.x, drone.y, 0.8);
            groundShockwave(hx, hy, hz,
                            { radius: 3.4, power: 1.0, speed: 2.4, color: 0x2ed8ee });
            const ndc = new THREE.Vector3(hx, hy, hz).project(camera);
            postfx.shockwave((ndc.x + 1) * 0.5, (ndc.y + 1) * 0.5, 0.55);
            shakeImpulse = Math.max(shakeImpulse, 0.45);
            sfx?.play('portal_exit', { volume: 0.6, pitch: 1.25 });
          },
        });
      }
      if (robotMesh && !repaired) {
        throwTargets.push({
          x: level.robot.x, y: level.robot.y + 1.8, radius: 2.2, layer: 0,
          onHit: () => {
            // Entrega a distancia, solo durante su pulso de recogida.
            if (robotPulse === 2 && screwsTaken > screwsDelivered) {
              screwsDelivered += 1;
              repairHold = Math.max(repairHold, needForRepair() * 0.5);
              setRobotGlow(new THREE.Color(0xf59e0b), 1.0);
              sfx?.play('achievement', { volume: 0.45 });
            }
            shakeImpulse = Math.max(shakeImpulse, 0.35);
          },
        });
      }
      throwsPool.setTargets(throwTargets);

      throwsPool.update(frameTime, -9999, 0, player.layer,
        (x, layer) => world.groundHeightAt(x, layer),
        (x, y, capa) => {
          const z = LAYER_Z[capa];
          // Estallido comun a cualquier impacto: contra el suelo o contra un blanco.
          particles.burst(x, y, z, 0xf59e0b, 16, 2.6);
          groundShockwave(x, y, z, { radius: 2.6, power: 0.7, speed: 2.8, color: 0xf59e0b });
          // El impacto: seco y grave, para que se distinga del lanzamiento.
          sfx?.play('land_soft', { volume: 0.5, pitch: 1.25, spread: 1.2 });
          sfx?.play('spark', { volume: 0.35, pitch: 0.55 });
          // Y rompe lo que haya ahi: es el uso a distancia del verbo.
          breakables.hit(x, y, 1.0, 1, player.layer);
        });

      throwViews.update();

      // ---- chorros del robot ----
      shots.update(frameTime, player.position.x, player.position.y, player.layer,
        (x, layer) => world.groundHeightAt(x, layer),
        (x, y, capa, hitPlayer) => {
          const z = LAYER_Z[capa];
          // La onda sale del PUNTO DE IMPACTO, proyectado a pantalla. Es lo que
          // integra el disparo en el mundo en vez de dejarlo como un efecto suelto.
          const ndc = new THREE.Vector3(x, y + 0.3, z).project(camera);
          postfx.shockwave((ndc.x + 1) * 0.5, (ndc.y + 1) * 0.5, hitPlayer ? 0.7 : 0.45);
          particles.shockwaveAmbient(x, y, hitPlayer ? 0.9 : 0.55);
          // Es agua: salpica hacia ARRIBA en cono, no en anillo.
          //
          // Aqui se llamaba a `land(..., SURFACE.AGUA, ...)`, que pinta el anillo de
          // aterrizaje con el color del agua: sale hacia los lados y se queda
          // flotando. El comentario ya decia "salpica hacia arriba" y la forma decia
          // otra cosa — se veia una nube azul, no un chapoteo.
          particles.salpicadura(x, y, z, hitPlayer ? 1.0 : 0.6);
          groundShockwave(x, y, z, {
            radius: hitPlayer ? 4.2 : 3.0, power: hitPlayer ? 0.9 : 0.6,
            speed: 2.2, color: 0x2ed8ee,
          });
          sfx?.play(hitPlayer ? 'land_hard' : 'step_agua',
                    { volume: hitPlayer ? 0.6 : 0.42, pitch: 1.15, spread: 1.4 });

          if (hitPlayer) {
            // Mojarse cuesta TIEMPO, no vida: empujon y se corta la reparacion.
            const dir = Math.sign(player.position.x - level.robot.x) || 1;
            player.velocity.x = dir * 4.5;
            player.velocity.y = 3.2;
            player.setState(STATE.STUMBLE);
            player.holdState(0.35);
            repairHold = 0;
            hits += 1;
            shakeImpulse = 0.55;
          }
        });
      shotViews.update();

      // ---- portales de suelo: giran despacio y laten al pulso ----
      // El destello del cruce decae solo. Es el feedback que pediste: al
      // teletransportar, TODOS los discos se encienden un instante — el sistema
      // entero responde, no solo el arco por el que pasaste.
      portalFlash = Math.max(0, portalFlash - frameTime * 2.2);
      for (const disc of groundPortals) {
        // El giro y el latido siguen como estaban; lo nuevo es la onda radial, que
        // corre en el shader y solo necesita que le pasemos el tiempo.
        disc.rotation.z += frameTime * (0.35 + portalFlash * 6.0);
        disc.material.opacity = 0.32 + beatPulse * 0.34 + portalFlash * 0.9;
        disc.scale.setScalar(1 + portalFlash * 0.35);
        const u = disc.material.userData.uniforms;
        if (u) { u.uTime.value = elapsed; u.uPulse.value = portalFlash; }
      }

      // ---- ondas expansivas en el suelo ----
      for (const slot of landRings) {
        if (slot.life <= 0) continue;
        slot.life -= frameTime * slot.speed;
        if (slot.life <= 0) { slot.mesh.visible = false; continue; }

        // Se expande rapido y frena (ease-out): asi el golpe se siente seco y la
        // onda parece perder energia, en vez de crecer a velocidad constante.
        const k = 1 - slot.life;
        const size = slot.radius * (1 - Math.pow(1 - k, 2.2));
        slot.mesh.scale.set(Math.max(0.05, size), Math.max(0.05, size), 1);
        slot.mesh.material.opacity = slot.life * slot.life * slot.power;
      }

      // ---- arcos de meta: laten mientras su etapa esta activa ----
      for (const goal of goals) {
        const isActive = director?.stage?.id === goal.stageId;
        const passed = player.position.x > goal.group.position.x;
        goal.group.visible = isActive || !passed;
        if (!goal.group.visible) continue;

        // Activa: dorada y latiendo. Inactiva: apagada, se ve pero no llama.
        const pulse = isActive ? 0.55 + beatPulse * 0.45 : 0.18;
        goal.mat.opacity = pulse;
        goal.veil.material.opacity = pulse * 0.18;
        goal.veil.material.color.setHex(passed ? 0x2ed8ee : 0xf59e0b);
        goal.mat.color.setHex(passed ? 0x2ed8ee : 0xf59e0b);
      }

      // ---- pasos por superficie, emitidos por distancia recorrida ----
      const moved = player.position.x - lastX;
      lastX = player.position.x;
      sfx?.updateFootsteps(moved, player.grounded && !portals.busy,
                           player.surface, player.velocity.x);
      particles.footstep(moved, player.grounded && !portals.busy, player.surface,
                         player.position.x, feetY(), LAYER_Z[player.layer],
                         player.velocity.x);

      // Roce contra la pared: al deslizarse tambien se levanta polvo, y sale del
      // punto de contacto, no de los pies. Sin esto el deslizamiento se ve mudo.
      if (player.state === STATE.WALL_SLIDE && player.wall !== 0) {
        wallDust += Math.abs(player.velocity.y) * frameTime;
        if (wallDust > 0.35) {
          wallDust = 0;
          particles.wallScrape(
            player.position.x + player.wall * (player.width * 0.5),
            player.position.y + player.height * 0.55,
            LAYER_Z[player.layer], player.wall, player.surface || SURFACE.METAL
          );
          sfx?.play('step_metal', { volume: 0.22, pitch: 0.7, spread: 1.2 });
        }
      } else {
        wallDust = 0;
      }

      // --- empujables ---
      // Se actualizan ANTES que los rompibles porque su caja de colision se mueve, y
      // el resto del frame tiene que verla ya en su sitio.
      const empujando = pushables.update(frameTime, player, active);
      pushableViews.update(beatPulse);
      // Las placas van DESPUES: leen donde ha quedado la caja este frame, no donde
      // estaba el anterior. Un frame de retraso aqui se nota como un boton flojo.
      plates.update(frameTime, pushables);
      plateViews.update(frameTime, beatPulse);
      // Dos animaciones: avanzando con la caja, o apoyado en ella cuando no cede.
      const trabada = !empujando && pushables.blocked && player.grounded;
      api.__push = { empujando: !!empujando, trabada: !!trabada,
                     cerca: !!pushables.nearby, suelo: player.grounded,
                     estado: player.state, hold: player._hold };
      // `keepMomentum` en los dos: el bloqueo fija el estado pero NO le quita el eje
      // al jugador. Sin eso la caja se le escapa, se pierde el contacto y el estado
      // rebota entre `push` y `walk` sin que la animacion llegue a verse.
      if (trabada) {
        if (player.state !== STATE.PUSH_STOP) player.setState(STATE.PUSH_STOP);
        player.holdState(0.2, true);
      }
      if (empujando && player.grounded) {
        if (player.state !== STATE.PUSH) player.setState(STATE.PUSH);
        player.holdState(0.2, true);

        // ---- el jugador va A LA VELOCIDAD DE LA CAJA ----
        //
        // Es lo que faltaba. Con el eje libre corre a 3,2 m/s mientras la caja va a
        // 2,4: la adelanta en dos frames, se pierde el contacto, el empuje termina y
        // el estado vuelve a `walk`. Por eso la animacion de `pushing` no llegaba a
        // verse — se cortaba antes de arrancar, una y otra vez.
        //
        // Igualando las velocidades, el contacto se mantiene, el estado dura y el
        // clip se reproduce entero. Y de paso se siente el peso: empujar es mas
        // lento que caminar porque el jugador AVANZA mas lento, no porque se le
        // frene artificialmente.
        const dirEmpuje = Math.sign(active.axisX) || 1;
        player.velocity.x = dirEmpuje * PUSH_SPEED;
        // Polvo bajo la caja: sin el, moverla se ve como deslizar un sticker.
        pushDust += PUSH_SPEED * frameTime;
        if (pushDust > 0.4) {
          pushDust = 0;
          particles.footstep(0.6, true, SURFACE.METAL,
                             empujando.box.x + empujando.size / 2,
                             empujando.box.y, LAYER_Z[empujando.layer ?? 0], 1.2);
          sfx?.play('step_metal', { volume: 0.2, pitch: 0.5, spread: 1.4 });
        }
      } else if (!trabada
                 && (player.state === STATE.PUSH || player.state === STATE.PUSH_STOP)) {
        // No se fuerza IDLE: se suelta el bloqueo y que la maquina de estados
        // decida. Forzarlo disparaba un `idle` que la propia maquina volvia a
        // pedir al frame siguiente, y la animacion se veia reiniciar.
        player.holdState(0);
      }

      // Aviso contextual: empujar no tiene tecla, se hace caminando contra la caja,
      // y eso no se adivina. Solo aparece si se esta al lado y no se esta empujando.
      if (pushables.nearby && !empujando && !tuto) {
        promptBox && (promptBox.style.opacity = '1');
        promptEl && (promptEl.textContent = 'Camina contra la caja para empujarla');
        pushHint = 0.25;
      } else if (pushHint > 0) {
        pushHint -= frameTime;
        if (pushHint <= 0 && promptBox) promptBox.style.opacity = '0';
      }

      // --- rompibles ---
      breakables.update(frameTime);
      breakableViews.update();

      // ---- la frontera: se vacia lo que el playsim ha emitido este frame ----
      //
      // Una pasada, una vez por frame. El playsim dice QUE paso; aqui se decide que
      // significa — humo, onda, sonido, temblor. Es lo que permite que `p_*` no
      // importe Three ni el render (spec 035).
      picoEventos = Math.max(picoEventos, eventosPendientes());
      vaciarEventos((tipo, ex, ey, ecapa, emag) => {
        if (tipo === EV.ROTURA) efectoRotura(ex, ey, ecapa, emag);
        else if (tipo === EV.PLACA) efectoPlaca(ex, ey, ecapa);
      });

      // Se rompen al caerles encima: el verbo que el jugador ya tiene.
      if (player.grounded && player.velocity.y <= 0 && lastState !== player.state
          && (player.state === STATE.LAND || player.state === STATE.HARD_LANDING
              || player.state === STATE.ROLL)) {
        breakables.hit(player.position.x, player.position.y - 0.2, 0.6,
                       player.state === STATE.HARD_LANDING ? 2 : 1, player.layer);
      }

      // Chispas sueltas que han caido de una caja: rebotan y se recogen.
      for (let i = loose.length - 1; i >= 0; i -= 1) {
        const it = loose[i];
        it.vy -= 24 * frameTime;
        it.y += it.vy * frameTime;
        const suelo = world.groundHeightAt(it.x, player.layer, -3);
        if (it.y <= suelo + 0.18) { it.y = suelo + 0.18; it.vy *= -0.42; }
        it.life -= frameTime;
        it.mesh.position.set(it.x, it.y, it.z);
        it.mesh.rotation.y += frameTime * 3;

        const cerca = Math.hypot(it.x - player.position.x,
                                 it.y - (player.position.y + player.height * 0.5));
        if (cerca < 1.0 || it.life <= 0) {
          if (cerca < 1.0) {
            routeTaken += 1;
            sparksTaken += 1;
            sfx?.play('spark', { volume: 0.5, pitch: 1.4 });
            flyToCounter(it.x, it.y, it.z, true);
          }
          scene.remove(it.mesh);
          it.mesh.geometry.dispose();
          it.mesh.material.dispose();
          loose.splice(i, 1);
        }
      }

      // --- props: se recogen y se EQUIPAN ---
      for (const pick of propPickups) {
        if (pick.taken) continue;

        // Flota y gira; el disco gira al reves para que el conjunto no parezca una
        // sola pieza rigida. La flotacion va al pulso de la musica, como todo.
        pick.holder.rotation.y += frameTime * 1.1;
        pick.holder.position.y = 1.25 + Math.sin(elapsed * 1.8) * 0.12;
        pick.disc.rotation.z -= frameTime * 0.5;
        pick.disc.material.opacity = 0.4 + beatPulse * 0.3;
        pick.beam.material.opacity = 0.10 + beatPulse * 0.10;
        pick.halo.lookAt(camera.position);
        pick.halo.material.opacity = 0.4 + beatPulse * 0.4;
        pick.light.intensity = 1.8 + beatPulse * 1.6;

        // ---- campo de energia ----
        //
        // Mientras esta puesto, el prop se ve y NO se coge. Es deliberado: un objeto
        // escondido no plantea nada, uno visible y fuera de alcance plantea "¿como?".
        if (pick.field) {
          if (pick.unlocking > 0) {
            // Se deshace hacia fuera y se apaga. Hacia fuera y no hacia dentro: un
            // campo que se encoge parece que absorbe, y lo que hace es soltar.
            pick.unlocking = Math.max(0, pick.unlocking - frameTime * 1.8);
            const k = 1 - pick.unlocking;             // 0 al empezar, 1 al acabar
            pick.field.scale.setScalar(1 + k * 1.9);
            pick.field.rotation.y += frameTime * (2.0 + k * 9.0);
            for (const aro of pick.field.children) {
              aro.material.opacity *= 0.90;
            }
            if (pick.unlocking === 0) {
              pick.group.remove(pick.field);
              pick.field = null;
            }
          } else {
            // Los aros giran cada uno a su ritmo: asi se lee como un mecanismo que
            // sujeta, no como una esfera de cristal.
            pick.field.rotation.y += frameTime * 0.7;
            pick.field.children[0].rotation.z += frameTime * 1.3;
            pick.field.children[1].rotation.x -= frameTime * 1.0;
            pick.field.children[2].rotation.z -= frameTime * 1.6;
            const p = 0.55 + beatPulse * 0.45;
            for (let i = 0; i < 3; i += 1) pick.field.children[i].material.opacity = p;
          }
        }

        if ((pick.layer ?? 0) !== player.layer || !props) continue;
        // Cerrado: se avisa de que hay una llave, y de donde. Sin esto el jugador
        // se queda dando saltos contra el campo sin saber que hay algo que hacer.
        if (pick.locked) {
          const cerca = Math.abs(pick.group.position.x - player.position.x) < 4.0;
          if (cerca && pick.lockedHint) {
            focusOn(pick.group.position.x, pick.ground + 1.25, {
              dist: 8.5, hold: 1.6, once: 'bloqueado:' + pick.id,
              label: pick.lockedHint,
            });
          }
          continue;
        }
        // Se mide contra el objeto FLOTANTE, no contra el pedestal: es lo que hay
        // que tocar, y esta 1,25 m mas arriba.
        const dx = pick.group.position.x - player.position.x;
        const dy = (pick.ground + pick.holder.position.y)
                 - (player.position.y + player.height * 0.5);
        if (Math.hypot(dx, dy) > 1.3) continue;

        pick.taken = true;
        pick.group.visible = false;
        props.equip(pick.id).then((ability) => {
          if (!ability) return;
          log('habilidad desbloqueada: ' + ability);
          if (ability === 'motor') {
            // Se aplica AQUI y no en el catalogo de props: el prop declara que
            // concede, y el juego decide que significa eso en sus propios numeros.
            player.tuning.runSpeed *= 1.25;
            player.tuning.walkSpeed *= 1.15;
            mostrarTutorial('→', 'Corres un 25 % mas rapido', () => true);
          } else if (ability === 'throw') {
            mostrarTutorial('Q', 'Lanza una Chispa · F para el tiro cargado',
                            () => usado.throw);
          } else if (ability === 'portal') {
            mostrarTutorial('R', 'Abre tu propio Portal de Idea · cuesta 3 Chispas',
                            () => usado.portal);
          }
        });

        // Se anuncia: una habilidad nueva que no se anuncia no existe.
        focusOn(player.position.x, feetY() + 1.0, {
          dist: 7.5, hold: 1.4, once: 'prop:' + pick.id,
          label: pick.hint || pick.label,
        });
        sfx?.play('achievement', { volume: 0.7 });
        const px = pick.group.position.x;
        const pz = pick.group.position.z;
        particles.burst(px, pick.ground + 1.25, pz, 0xf59e0b, 32, 3.4);
        particles.shockwaveAmbient(px, pick.ground + 1.25, 1.0);
        // Dos ondas: una en el objeto y otra en el portal que lo sostenia, que se
        // apaga con el. Asi se ve QUE se ha recogido y DE DONDE salio.
        groundShockwave(px, pick.ground + 1.25, pz,
                        { radius: 3.4, power: 1.0, speed: 2.4, color: 0xf59e0b });
        groundShockwave(px, pick.ground, pz,
                        { radius: 5.5, power: 0.9, speed: 1.5, color: 0x7c3aed });
        const ndc = new THREE.Vector3(px, pick.ground + 1.25, pz).project(camera);
        postfx.shockwave((ndc.x + 1) * 0.5, (ndc.y + 1) * 0.5, 0.7);
        shakeImpulse = Math.max(shakeImpulse, 0.4);
      }

      // --- grietas: el gesto de cobro en sus tres tiempos ---
      for (const grieta of grietas) {
        if (grieta.abierta) {
          // Una vez rota se apaga del todo: un sitio que sigue brillando cuando ya no
          // tiene nada es la misma mentira que un `focusOn` sin `once`.
          grieta.mesh.material.opacity = Math.max(0, grieta.mesh.material.opacity - frameTime);
          continue;
        }
        if ((grieta.layer ?? 0) !== player.layer) { grieta.mesh.material.opacity = 0; continue; }

        const d = Math.abs(grieta.x - player.position.x);
        const dentro = d < (grieta.radius ?? 2.0) && Math.abs(player.position.y - grieta.y) < 2.0;

        // ---- TIEMPO 1 · la promesa ----
        //
        // La grieta no esta encendida siempre. Se enciende al entrar en radio y se
        // apaga al salir, que es la politica del escalon 1: una señal permanente deja
        // de significar algo. Y late al pulso, como todo lo demas del Proyector.
        const quiere = dentro ? 0.35 + beatPulse * 0.45 : 0;
        grieta.mesh.material.opacity += (quiere - grieta.mesh.material.opacity)
                                      * Math.min(1, frameTime * 6);
        grieta.mesh.scale.setScalar(1 + beatPulse * 0.12);

        if (!dentro) { grieta.cerca = 0; continue; }

        // El ping posicional, una sola vez por grieta: es lo que dice "aqui hay algo"
        // sin que nadie hable y sin una flecha en el HUD.
        if (grieta.cerca === 0) {
          sfx?.play('spark', { volume: 0.28, pitch: 0.55 });
          grieta.cerca = 1;
        }

        if (promptBox && player.grounded) {
          promptBox.style.opacity = '1';
          promptEl.textContent = `[E] ${grieta.prompt || 'Romper el suelo'}`;
        }

        // ---- TIEMPO 2 · el gesto ----
        if (!input.justPressed(ACTIONS.ACTION) || !player.grounded) continue;

        grieta.abierta = true;
        if (promptBox) promptBox.style.opacity = '0';
        player.setState(STATE.STOMP);
        player.velocity.x = 0;
        // Se retiene medio compas: lo que dura el gesto, en la rejilla de la musica.
        player.holdState(choreo.barSeconds * 0.5);

        // ---- TIEMPO 3 · el cobro ----
        //
        // Todo junto y en el mismo frame. Por separado se leen como cuatro cosas que
        // pasan seguidas; juntos se leen como una.
        congelar(0.18);
        shakeImpulse = Math.max(shakeImpulse, 0.8);
        postfx.aberrationImpulse(0.9);
        groundShockwave(grieta.x, grieta.y, LAYER_Z[grieta.layer ?? 0],
                        { radius: 4.2, power: 1.0, speed: 2.0, color: 0xf59e0b });
        particles.land(grieta.x, grieta.y, LAYER_Z[grieta.layer ?? 0], SURFACE.TIERRA, true);
        particles.burst(grieta.x, grieta.y + 0.4, LAYER_Z[grieta.layer ?? 0],
                        0x8a5a32, 30, 3.4);
        sfx?.play('land_hard', { volume: 0.85, pitch: 0.6 });
        sfx?.play('step_tierra', { volume: 0.6, pitch: 0.5, spread: 2.0 });

        // Y sale lo que habia debajo. Sale DESPEDIDO y flota: aparecer sin mas seria
        // quitarle el sentido a haber roto el suelo.
        for (const screw of screws) {
          if (screw.buried !== grieta.reveals) continue;
          screw.group.visible = true;
          screw.group.position.y = grieta.y + 0.2;
          screw.brote = { t: 0, desde: grieta.y + 0.2, hasta: screw.y };
        }
        if (grieta.logro) conceder(grieta.logro);
        log('grieta abierta: ' + grieta.id);
      }

      // --- tornillos: se recogen igual que las chispas, pero se DEVUELVEN ---
      for (const screw of screws) {
        if (screw.taken) continue;
        // Un tornillo enterrado no existe: ni se ve, ni se enfoca, ni se recoge al
        // pasar por encima. Solo su grieta lo saca.
        if (screw.buried && !screw.group.visible) continue;

        /**
         * El brote: sale despedido del suelo y se queda flotando.
         *
         * La curva es un rebote, no una interpolacion suave — sube por encima de su
         * altura final y vuelve. Un objeto que asciende y se para se lee como que lo
         * han colocado; uno que se pasa y corrige se lee como que ha SALIDO.
         */
        if (screw.brote) {
          screw.brote.t = Math.min(1, screw.brote.t + frameTime / 0.55);
          const k = screw.brote.t;
          const rebote = Math.sin(k * Math.PI * 0.85) * 0.55;
          screw.group.position.y = screw.brote.desde
            + (screw.brote.hasta - screw.brote.desde) * (k * k * (3 - 2 * k))
            + rebote;
          if (k >= 1) { screw.group.position.y = screw.brote.hasta; screw.brote = null; }
          // Y NO se puede coger mientras brota. Sin esto el imán de 1,2 m se lo traga
          // en el mismo frame en que sale —el jugador está justo encima, acaba de
          // romper el suelo— y el cobro se queda sin su medio segundo: se ve el golpe
          // y ya está el contador subido, sin nada en medio.
          continue;
        }

        // Gira, el halo late y la flecha rebota: tres señales para que se vea.
        screw.mesh.rotation.y += frameTime * 3.0;
        if (screw.model) screw.model.rotation.y += frameTime * 3.0;
        screw.halo.lookAt(camera.position);
        screw.halo.material.opacity = 0.35 + beatPulse * 0.4;
        screw.halo.scale.setScalar(1 + beatPulse * 0.25);
        screw.arrow.position.y = 0.95 + Math.sin(elapsed * 3.2) * 0.14;
        screw.light.intensity = 1.2 + beatPulse * 1.2;

        // Foco la primera vez que aparece un tornillo en cuadro.
        //
        // UNA sola vez para los tres, no una por tornillo: la clave es compartida.
        // Enfocar cada uno paraba la camara tres veces para decir lo mismo, y a la
        // segunda ya no informa — estorba. El primero enseña que existen; los otros
        // dos se buscan, que es justo el objetivo de la etapa.
        if (!screw.shown && Math.abs(screw.group.position.x - player.position.x) < 12) {
          screw.shown = true;
          focusOn(screw.group.position.x, screw.group.position.y + 0.6, {
            dist: 8.0, hold: 0.9, once: 'tornillo',
            label: (screw.layer ?? 0) === player.layer
              ? 'Un tornillo suyo. Recógelo'
              : 'Un tornillo suyo, en la otra capa',
          });
        }

        if ((screw.layer ?? 0) !== player.layer) continue;

        // La distancia se mide sobre el GRUPO: la malla vive en coordenadas locales
        // y comparar su posicion contra la del mundo nunca acertaba.
        const dx = screw.group.position.x - player.position.x;
        const dy = screw.group.position.y - (player.position.y + player.height * 0.5);
        const dist = Math.hypot(dx, dy);

        // Iman de 1,2 m, igual que las chispas (GDD §25.4).
        if (dist < 1.2) {
          screw.group.position.x -= dx * Math.min(1, frameTime * 9);
          screw.group.position.y -= dy * Math.min(1, frameTime * 9);
        }
        if (dist < 0.5) {
          screw.taken = true;
          screwsTaken += 1;
          screw.group.visible = false;
          sfx?.play('spark', { volume: 0.6, pitch: 0.75 });
          particles.burst(screw.group.position.x, screw.group.position.y,
                          screw.group.position.z, 0x2ed8ee, 16, 2.4);
          flyToCounter(screw.group.position.x, screw.group.position.y,
                       screw.group.position.z, false);
        }
      }

      // ---- presentacion del robot: primero EL, luego lo que hay que hacer ----
      //
      // No se dispara con el momento musical sino al ACERCARSE, para que llegue
      // cuando el jugador ya lo tiene delante. Y va en dos tiempos, porque son dos
      // informaciones distintas: "esto es lo que pasa" y "esto es lo que hay que
      // hacer". Juntas en un solo plano no se leen ninguna de las dos.
      if (robotMesh && !repaired && robotIntro === 0
          && director?.control === CONTROL.PLAYING
          && Math.abs(player.position.x - level.robot.x) < 18) {
        robotIntro = 1;
        focusOn(level.robot.x, level.robot.y + 2.2, {
          dist: 16.0, hold: 1.3, once: 'robot',
          label: 'Está descalibrado, no lo golpees',
        });
        setRobotGlow(new THREE.Color(0xff3060), 2.4);
        shakeImpulse = Math.max(shakeImpulse, 0.5);
        sfx?.play('land_hard', { volume: 0.6, pitch: 0.4 });
      }
      // Segundo tiempo: el primer tornillo que quede, en cuanto suelta el anterior.
      if (robotIntro === 1 && !focusShot) {
        robotIntro = 2;
        const pend = screws.find((sc) => !sc.taken);
        if (pend) {
          // Se marcan TODOS como vistos: esta escena ya cumple la funcion de
          // presentarlos, asi que la regla de proximidad no debe repetirla luego.
          for (const sc of screws) sc.shown = true;
          focusOn(pend.group.position.x, pend.group.position.y + 0.6, {
            dist: 9.0, hold: 1.1, once: 'tornillo',
            label: 'Se le cayeron los tornillos. Devuélveselos',
          });
        }
      }

      // --- ciclo de 3 pulsos del robot (GDD §25.6) ---
      // Va cuantizado a la musica, asi que se aprende escuchando:
      //   pulso 1  levanta el brazo   -> aviso
      //   pulso 2  GOLPEA el suelo    -> zona de peligro + onda en el punto de impacto
      //   pulso 3  se recoge jadeando -> ventana de 0,54 s para atornillar
      if (robotMesh && !repaired && director?.control === CONTROL.PLAYING) {
        const beat = choreo.position / choreo.beatSeconds;
        const pulse = Math.floor(beat) % 3;

        if (pulse !== robotPulse) {
          robotPulse = pulse;

          if (pulse === 0) {
            setRobotGlow(new THREE.Color(0xff3060), 2.2);   // aviso
            // Chirrido agudo al levantar el brazo: es el AVISO, tiene que oirse
            // distinto del golpe o no sirve de aviso.
            sfx?.play('portal_enter', { volume: 0.22, pitch: 1.9 });
            playRobotClip('jumping_up', 0.9);
            if (robotDanger) robotDanger.userData.warn = 1;   // se enciende el aviso
          } else if (pulse === 1) {
            // ---- lejos: CHORRO. cerca: PISOTON ----
            //
            // Sin el chorro habia un agujero de diseño: bastaba con quedarse fuera
            // del alcance del brazo y esperar a que pasara el pulso. Ahora estar
            // lejos tambien tiene respuesta, y el climax obliga a moverse.
            const far = Math.abs(player.position.x - level.robot.x) > MELEE_RANGE
                     || player.layer !== 0;
            if (far) {
              robotSlamAt = elapsed;
              playRobotClip('wide_arm_spell_casting', 1.3);
              sfx?.play('portal_exit', { volume: 0.5, pitch: 0.75 });
              // Apunta a donde ESTARA el jugador, no a donde esta: si no, correr
              // hacia delante lo esquiva siempre y el disparo no significa nada.
              const flight = 1.05;
              shots.fire(
                level.robot.x + SLAM_OFFSET * 0.6, level.robot.y + 2.2,
                player.position.x + player.velocity.x * flight * 0.6,
                player.position.y + 0.4,
                0, flight
              );
            } else {
            // El golpe cae DONDE esta el brazo, no en el centro de pantalla:
            // la onda se ancla al mundo, por eso hay que proyectarla.
            const impactX = level.robot.x + SLAM_OFFSET;
            const impactY = level.robot.y;
            robotSlamAt = elapsed;

            const ndc = new THREE.Vector3(impactX, impactY + 0.3, LAYER_Z[0]).project(camera);
            postfx.shockwave((ndc.x + 1) * 0.5, (ndc.y + 1) * 0.5, 0.75);
            particles.shockwaveAmbient(impactX, impactY, 1.0);
            particles.land(impactX, impactY, LAYER_Z[0], SURFACE.METAL, 1.0);
            // El mazazo del robot: la onda mas grande del nivel.
            groundShockwave(impactX, impactY, LAYER_Z[0],
                            { radius: 7.5, power: 1.0, speed: 1.5, color: 0xff3060 });
            shakeImpulse = 1.0;
            playRobotClip('stomp', 1.15);
            // Su pisoton barre los rompibles del alcance. Vale por dos golpes: es
            // una tonelada de metal, no un salto.
            breakables.hit(impactX, impactY + 0.4, SLAM_RADIUS, 2, 0);

            // El pisoton se monta en tres capas, porque un solo disparo suena a
            // "clic" y no a una tonelada de metal cayendo:
            //   grave     el peso, lo que se siente en el pecho
            //   metalico  la chapa del robot, medio pulso despues
            //   cola      el eco por la plaza
            sfx?.play('land_hard', { volume: 0.85, pitch: 0.42 });
            sfx?.play('step_metal', { volume: 0.7, pitch: 0.5, spread: 1.6 });
            setTimeout(() => sfx?.play('land_soft', { volume: 0.3, pitch: 0.35 }), 90);

            // Empujon si estabas dentro del radio de golpe. No quita vida:
            // cuesta tiempo, y el tiempo aqui es otra vuelta del loop.
            if (player.layer === 0 && Math.abs(player.position.x - impactX) < SLAM_RADIUS) {
              const dir = Math.sign(player.position.x - impactX) || -1;
              player.velocity.x = dir * 6.0;
              player.velocity.y = 4.0;
              player.setState(STATE.STUMBLE); // trastabilla, con su animacion
              player.holdState(0.4);          // 0,4 s sin control (GDD §25.6)
              repairHold = 0;                 // interrumpe la reparacion en curso
              hits += 1;
              sfx?.play('land_soft', { volume: 0.6, pitch: 0.7 });
            }
            }
          } else {
            setRobotGlow(new THREE.Color(0xf59e0b), 0.9);   // ventana de accion
          }
        }
        // El aviso late mientras el brazo esta arriba y se apaga al caer.
        if (robotDanger) {
          const warn = robotDanger.userData.warn || 0;
          robotDanger.userData.warn = Math.max(0, warn - frameTime * 1.6);
          robotDanger.material.opacity = robotDanger.userData.warn * 0.34;
          robotDanger.scale.setScalar(0.7 + (1 - robotDanger.userData.warn) * 0.3);
        }

        // Sacudida corta tras el golpe, se apaga sola.
        const since = elapsed - robotSlamAt;
        robotMesh.position.y = level.robot.y +
          (since < 0.35 ? Math.sin(since * 46) * 0.12 * (1 - since / 0.35) : 0);
      }

      // --- reparacion: acercarse y MANTENER la accion un compas completo ---
      if (level.robot && !repaired && screwsTaken >= 2) {
        const near = Math.abs(player.position.x - level.robot.x) < level.robot.radius
                  && player.layer === 0 && player.grounded;
        const holding = near && input.isDown(ACTIONS.ACTION);
        // Suelo de 0,5 s: si la coreografia aun no ha cargado, `barSeconds` puede
        // ser 0 o NaN, y entonces `repairHold >= needed` se cumplia con AMBOS a
        // cero — el robot se reparaba solo con acercarse, sin pulsar nada.
        const needed = needForRepair();

        // ---- feedback del rango y del progreso ----
        if (robotZone) {
          // El circulo solo aparece cuando ya puedes usarlo: antes de tener dos
          // tornillos seria una promesa que el juego no cumple todavia.
          robotZone.material.opacity = near ? 0.85 : 0.34;
          robotZone.material.color.setHex(near ? 0x2ed8ee : 0xf59e0b);
          robotZone.rotation.z += frameTime * (near ? 0.9 : 0.25);

          const k = Math.min(1, repairHold / needed);
          robotZoneFill.material.opacity = k * 0.42;
          robotZoneFill.scale.setScalar(level.robot.radius * k);
        }
        // El aviso de tecla, solo cuando estas dentro del circulo.
        // ---- aviso + barra de permanencia ----
        // La barra es lo que convierte "mantener pulsado" en una mecanica legible:
        // sin ella el jugador suelta a los 0,5 s creyendo que no funciona.
        if (promptBox) {
          promptBox.style.opacity = (near && !repaired) ? '1' : '0';
          const holdingNow = repairHold > 0;
          promptBox.classList.toggle('holding', holdingNow);
          promptEl.textContent = holdingNow
            ? 'No te separes…'
            : 'mantén pulsado para entregarle un tornillo';
          if (promptBarEl) {
            promptBarEl.style.width = `${Math.min(100, (repairHold / needed) * 100)}%`;
          }
        }

        repairHold = holding ? repairHold + frameTime : 0;

        // Mientras se repara, el personaje hace el gesto. Antes se mantenia la
        // tecla y no pasaba nada visible: no habia forma de saber que funcionaba.
        if (holding) {
          if (player.state !== STATE.REPAIR) player.setState(STATE.REPAIR);
          // El bloqueo se re-arma cada frame: `_resolveState` respeta `_hold`, asi
          // que sin esto el estado volveria a `idle` en el tick siguiente y el clip
          // se reiniciaria 60 veces por segundo. Se arma DESPUES de setState, que
          // limpia el bloqueo a proposito.
          player.holdState(0.2);
          player.velocity.x = 0;
        } else if (player.state === STATE.REPAIR) {
          player.setState(STATE.IDLE);
        }

        if (repairHold > 0) {
          const k = Math.min(1, repairHold / needed);
          setRobotGlow(new THREE.Color(0xe62a9e).lerp(new THREE.Color(0xf59e0b), k));
        }
        // `repairHold > 0` no es redundante: es lo que garantiza que se ha mantenido
        // la accion de verdad, pase lo que pase con `needed`.
        if (repairHold > 0 && repairHold >= needed) {
          repaired = true;
          repairHold = 0;
          sfx?.play('achievement', { volume: 0.7 });
          particles.burst(level.robot.x, level.robot.y + 1.4, LAYER_Z[0], 0xf59e0b, 26, 3.2);
          postfx.shockwave(0.5, 0.5, 0.9);
          particles.shockwaveAmbient(level.robot.x, level.robot.y + 1.4, 1.2);
          // Con solo 2 tornillos queda un tic: parpadea. Es el gancho para volver.
          setRobotGlow(new THREE.Color(0xf59e0b), screwsTaken >= 3 ? 1.1 : 0.7);
          groundShockwave(level.robot.x, level.robot.y, LAYER_Z[0],
                          { radius: 9.0, power: 1.0, speed: 1.1, color: 0xf59e0b });

          // El robot agradece y se va andando. Es el unico momento del juego en que
          // se mueve de su sitio, y por eso se lee como "ya esta bien, gracias".
          if (robotZone) { robotZone.visible = false; robotZoneFill.visible = false; }
          if (robotDanger) robotDanger.visible = false;
          shots.clear();   // los chorros en vuelo mueren con la reparacion
          if (promptBox) { promptBox.style.opacity = '0'; promptBox.classList.remove('holding'); }
          playRobotClip('waving', 0.9);
          robotExit = { t: 0, fromX: level.robot.x };
          // El cierre arranca aqui: reparar el robot ES el final del nivel.
          coda = { t: 0, step: 0 };
          dialogue?.say(screwsTaken >= 3
            ? (hits === 0 ? 'BR-07a' : 'BR-07b')
            : 'BR-07c');
        }
      }

      // --- chispas: iman de 1,2 m y recogida ---
      for (const spark of sparks) {
        if (spark.taken) continue;
        spark.mesh.rotation.y += frameTime * 2.2;
        spark.mesh.rotation.x += frameTime * 1.1;
        if ((spark.layer ?? 0) !== player.layer) continue;
        // La distancia se mide contra la posicion ACTUAL de la malla, no contra la
        // original: si no, el iman la arrastra visualmente pero nunca llega a recogerse.
        const dx = spark.mesh.position.x - player.position.x;
        const dy = spark.mesh.position.y - (player.position.y + player.height * 0.5);
        const dist = Math.hypot(dx, dy);
        if (dist < 1.2) {
          spark.mesh.position.x -= dx * Math.min(1, frameTime * 9);
          spark.mesh.position.y -= dy * Math.min(1, frameTime * 9);
        }
        if (dist < 0.45) {
          spark.taken = true;
          sparksTaken += 1;
          if (spark.route) routeTaken += 1; else secretTaken += 1;
          spark.mesh.visible = false;
          // Sube un semitono por chispa: la recogida encadenada suena a escala.
          // Las secretas suenan una octava mas arriba, para que se noten distintas
          // sin mirar el HUD.
          sfx?.play('spark', {
            volume: spark.route ? 0.5 : 0.7,
            pitch: (spark.route ? 1 : 2) + (sparksTaken % 8) * 0.06,
          });
          particles.burst(spark.mesh.position.x, spark.mesh.position.y,
                          spark.mesh.position.z,
                          spark.route ? 0x2ed8ee : 0xf59e0b,
                          spark.route ? 12 : 20, spark.route ? 2.2 : 3.0);
          // Y sale volando hacia su contador.
          flyToCounter(spark.mesh.position.x, spark.mesh.position.y,
                       spark.mesh.position.z, !!spark.route);

          /**
           * LA PRIMERA VICTORIA (R5 §2.2).
           *
           * No vale la primera chispa que se toca: vale la primera que se coge EN EL
           * AIRE. Las de ruta cuelgan sobre el centro del hueco a la altura de la
           * cresta del salto, asi que cogerla ahi ES haber saltado bien — el logro
           * premia la linea limpia, no el paseo. Es lo que compra el credito con el
           * que despues se pide `crossAndReturn`, que es un objetivo de dos partes.
           */
          if (!player.grounded && spark.route) conceder('primera-chispa');

          // Y el 100 % de las MARCADAS COMO SECRETAS — no de las doradas en general,
          // que incluyen las sueltas del camino. `closing.perfect` (`BR-08b`) depende
          // de esto, y era inalcanzable mientras existio la de x=176 (TDB-013): una
          // linea grabada que no podia sonar nunca.
          if (spark.secret && sparks.every((sp) => !sp.secret || sp.taken)) {
            conceder('coleccionista');
          }
        }
      }
    }

    input.endFrame();

    if (avatar) {
      avatar.position.x = player.position.x;
      avatar.position.y = player.position.y;
      // La Z se interpola: el salto de capa ocurre a mitad de la disolucion,
      // cuando el personaje es invisible, asi que nunca se ve teletransportarse.
      const targetZ = LAYER_Z[player.layer];
      avatar.position.z += (targetZ - avatar.position.z) * Math.min(1, frameTime * 12);

      // El propio personaje se apaga al estar detras: refuerza en que capa estas
      // sin tener que mirar el HUD.
      const behind = player.layer === 1 ? 1 : 0;
      avatarTint += (behind - avatarTint) * Math.min(1, frameTime * 5);
      avatar.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (!m.userData._baseColor) m.userData._baseColor = m.color.clone();
          m.color.copy(m.userData._baseColor).lerp(BACK_LAYER_TINT, avatarTint * 0.55);
        }
      });

      // Agarrado a la pared el personaje mira HACIA ella.
      // OJO: el clip de trepar tiene al personaje de ESPALDAS a camara (agarra algo
      // que tiene delante), asi que su frente es el contrario al de los demas clips.
      // Por eso la rotacion va invertida aqui; si no, queda de espaldas a la pared.
      // En la coda mira a CAMARA: el saludo y el baile son para el que juega, no
      // para el eje X. De perfil no se entiende ni el saludo ni la celebracion.
      const facingCamera = player.state === STATE.WAVE || player.state === STATE.CELEBRATE;
      const wanted = facingCamera
        ? 0
        : (player.state === STATE.WALL_SLIDE && player.wall !== 0)
          ? (player.wall > 0 ? -Math.PI / 2 : Math.PI / 2)
          : (player.facing > 0 ? Math.PI / 2 : -Math.PI / 2);
      let diff = wanted - avatar.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      avatar.rotation.y += diff * Math.min(1, frameTime * 14);
    }

    if (animator && !paused) {
      // Durante una cinematica manda la pista, no la maquina de estados.
      if (cinematicClip) {
        const action = animator._action(cinematicClip.clip);
        if (action && animator.currentName !== cinematicClip.clip) {
          action.reset();
          action.setLoop(cinematicClip.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
          action.clampWhenFinished = !cinematicClip.loop;
          action.enabled = true;
          action.setEffectiveWeight(1);
          action.timeScale = 1;
          action.play();
          if (animator.current && animator.current !== action) {
            animator.current.crossFadeTo(action, 0.22, false);
          }
          animator.current = action;
          animator.currentName = cinematicClip.clip;
        }
      } else {
        animator.apply(player.state, player.velocity.x);
      }
      animator.update(hitstop > 0 ? 0 : frameTime);
      groundLock(frameTime);
    }

    updateCamera(frameTime);

    // --- shockwave: solo en eventos gordos (plan §8b.2, una onda activa como maximo) ---
    if (player.state !== lastState) {
      // Retener el estado mientras dure su animacion: una rodada tiene que verse
      // entera, no cortarse a mitad para pasar a caminar.
      // La rodada mantiene el impulso; el aterrizaje duro te clava en el sitio.
      const hold = animator?.holdSecondsFor(player.state) || 0;
      if (hold > 0) player.holdState(hold, player.state === STATE.ROLL);

      if (player.state === STATE.DOUBLE_JUMP) {
        // El golpe de aire ancla el doble salto: sin el se ve flotado.
        particles.airBurst(player.position.x, player.position.y,
                           LAYER_Z[player.layer], player.surface || SURFACE.TIERRA);
        sfx?.play('land_soft', { volume: 0.3, pitch: 1.35, spread: 1.0 });
      } else if (player.state === STATE.HARD_LANDING) {
        const p = new THREE.Vector3(player.position.x, player.position.y, LAYER_Z[player.layer]);
        p.project(camera);
        postfx.shockwave(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5, 0.8);
        particles.shockwaveAmbient(player.position.x, player.position.y + 0.4, 0.8);
        sfx?.play('land_hard', { volume: 0.75, spread: 1.0 });
        particles.land(player.position.x, feetY(), LAYER_Z[player.layer],
                       player.surface, true);
        groundShockwave(player.position.x, feetY(), LAYER_Z[player.layer],
                        { radius: 4.2, power: 0.95, speed: 2.0, color: 0x2ed8ee });
      } else if (player.state === STATE.LAND || player.state === STATE.ROLL) {
        sfx?.play('land_soft', { volume: 0.4, spread: 1.4 });
        particles.land(player.position.x, feetY(), LAYER_Z[player.layer],
                       player.surface, false);
        groundShockwave(player.position.x, feetY(), LAYER_Z[player.layer],
                        { radius: 1.9, power: 0.45, speed: 3.4, color: 0x9fb4ff });
      }
      lastState = player.state;
    }

    // Va aqui, con la pose del frame ya resuelta y justo antes de dibujar. Antes de que
    // el animador coloque el esqueleto, el muelle mediria la pose del frame anterior y
    // la oreja iria retrasada un frame de mas.
    secondary?.update(frameTime);

    postfx.render();

    if (api.onFrame) {
      api.onFrame({
        player, paused, attempts, checkpoint, portals, choreo, director,
        sparks: sparksTaken, sparksTotal: sparks.length,
        stage: director?.stage || null,
        stagesCleared: director?.stagesCleared || 0,
        objective: director?.objective || null,
        control: director?.control || CONTROL.PLAYING,
        fps: 1 / Math.max(frameTime, 1e-6),
      });
    }
    raf = requestAnimationFrame(tick);
  }

  function resize() {
    _hudCache = null;   // las medidas del HUD dejan de valer
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    postfx.setSize(w, h);
    particles.setProjection(h * renderer.getPixelRatio(), camera.fov);
  }
  addEventListener('resize', resize);
  resize();

  let raf = requestAnimationFrame(tick);

  // Los navegadores no dejan sonar nada sin un gesto del usuario: la musica arranca
  // con la primera tecla o el primer clic, no al cargar.
  choreo.load().then(async () => {
    // Los SFX cuelgan del mismo contexto que la musica: un solo reloj.
    sfx = new Sfx(choreo.ctx);
    const loaded = await sfx.load();
    log(`sfx: ${loaded} sonidos`);

    dialogue = new Dialogue(choreo.ctx, options.subtitleEl || null, {
      /**
       * El gesto de ducking. UN SOLO SITIO lo pide y NADIE escribe el nodo aqui.
       *
       * Aqui vivia una recaida completa de TDB-004: este callback escribia
       * `choreo.gain.gain` con dos literales, `0.30` al entrar y **`0.85` al salir**.
       * O sea que cada linea de dialogo borraba la preferencia de musica del jugador
       * y la SUBIA al 85 %, que es exactamente el sintoma de "la musica esta muy alta
       * cuando habla". Y ademas ignoraba la pausa: hablar con el modal abierto
       * devolvia la musica a plena.
       *
       * Ahora `s_choreo` es el dueño y todo son factores de `baseGain`, asi que da
       * igual el orden de los sucesos. Ver `setVoiceDuck()`.
       */
      onDuck: (speaking) => {
        choreo.setVoiceDuck(speaking);
        sfx?.setVoiceDuck?.(speaking);
      },
    });
    applyVolumes();   // las preferencias ya elegidas mandan sobre los valores por defecto
    const voices = await dialogue.load();
    log(`voces: ${voices} grabadas`);

    director = new Director(level, player, choreo, dialogue, {
      onStageChange: (stage, cleared) => {
        if (cleared) {
          sfx?.play('achievement', { volume: 0.4 });
          // El logro de la etapa. `sin-un-rasguno` ademas exige que el dron no te
          // haya tocado: un logro que se da igual pase lo que pase no es un logro.
          if (cleared.logro) {
            const limpio = cleared.id !== 'etapa2' || drone.captures === 0;
            if (limpio) conceder(cleared.logro);
          }
          // El acelerador se devuelve al jugador al salir de un tramo con runner, con
          // el bonus del Motor de Idea si lo lleva. El motor esta EN la zona del
          // runner (x=130), asi que sin esto el jugador lo recogia, no notaba nada
          // durante el tramo —correcto: el acelerador es del juego— y tampoco despues.
          if (cleared.runner) {
            player.tuning.runSpeed = TUNING.runSpeed * (props?.can('motor') ? 1.25 : 1);
          }
        }

        /**
         * EL CAMBIO DE PERSPECTIVA. Es lo que hace que un tramo se distinga del
         * anterior sin leer nada: cambia la FOV, la distancia, el adelanto de camara
         * y el marco de esquinas, todo declarado en `stages[].vista`.
         *
         * Y se acompaña de un pico de aberracion cromatica, que es el efecto que mas
         * "electricidad" da por menos coste (R2 §3.3). Por IMPULSO y decayendo: una
         * aberracion sostenida en un juego infantil no se lee como estilo, se lee
         * como que el render esta roto.
         */
        if (stage) {
          aplicarVista(stage.vista);
          // El viento del tramo. Los que no lo declaran lo apagan, que es lo que hace
          // que signifique algo donde si esta.
          const v = stage.viento;
          viento.set(v?.fuerza ?? 0, v?.dirX ?? -1, v?.dirY ?? 0, v?.tinte ?? 0xbfd8ff);
          if (stage.vista?.aberration) postfx.aberrationImpulse(stage.vista.aberration);
          /**
           * El acelerador bloqueado del runner: su velocidad ES la del personaje, y
           * el bonus del Motor de Idea NO se suma aqui a proposito.
           *
           * El tramo esta dimensionado contra su ventana musical (107 m / 6,3 m/s =
           * 17,0 s de 17,297): un +25 % lo dejaria en 13,6 s y el jugador llegaria al
           * final con casi cuatro segundos de musica por delante y nada que hacer. Lo
           * que el motor da en un runner es lo mismo que da fuera —recarga a la mitad
           * y rompibles al doble—, pero no el acelerador, que aqui no es suyo.
           */
          player.tuning.runSpeed = stage.runner
            ? stage.runner.speed
            : TUNING.runSpeed * (props?.can('motor') ? 1.25 : 1);
          // Y el reloj de arranque del auto-scroll: la camara tiene que llegar antes
          // de que el personaje eche a correr.
          runnerEspera = stage.runner
            ? (stage.runner.startBars ?? 1) * choreo.barSeconds
            : 0;
        }
        // El dron solo existe durante la etapa que lo pide.
        // Cambio de escenario con TRANCE (transicion T-05).
        // Cada etapa elige SU transicion. La habitacion entra en trance porque el
        // mundo se esta imaginando; los tejados con un barrido, que es puro impulso;
        // la plaza con el vertigo, porque ahi es donde algo va mal.
        if (stage && stage.scenario) {
          // Se pide la descarga ANTES de arrancar: la transicion dura mas de un
          // compas, tiempo de sobra para que llegue.
          cambioListo = null;
          parallax.preload(stage.scenario)
            .then((aplicar) => { cambioListo = aplicar; })
            .catch(() => console.warn('[escenario] no se pudo precargar'));
          transicion.start(stage.transition || 'trance', choreo.barSeconds, stage.scenario);
        }

        if (stage && stage.chaser) {
          // Aparece EN ESPERA: se ve llegar, pero no persigue todavia.
          drone.start(player.position.x, LAYER_Z[player.layer], player.layer);
          droneCueGiven = false;
        } else {
          drone.stop();   // cualquier etapa sin perseguidor lo retira
        }
        if (api.onStageChange) api.onStageChange(stage, cleared);
      },
      // El "¡Corre!" de Bradislav es lo que suelta al dron.
      onBeat: (beat) => {
        if (beat.say === 'BR-05') droneCueGiven = true;
      },
      onFinish: () => { if (api.onFinish) api.onFinish(); },
      onCinematic: (spec) => {
        if (!spec) { cinematic.stop(); despawnActors(); cameraShot = null; return; }
        spawnActors(spec);
        cinematic.start(spec, choreo.position);
      },
    });

    if (options.onChoreoReady) options.onChoreoReady(choreo.data);
    const start = () => {
      choreo.play();
      removeEventListener('keydown', start);
      removeEventListener('pointerdown', start);
    };
    addEventListener('keydown', start);
    addEventListener('pointerdown', start);
  }).catch((err) => console.warn('[audio] no se pudo cargar la coreografia:', err));

  /**
   * @param {{conservarAudio?:boolean, conservarRenderer?:boolean}} opciones
   *
   * `conservarAudio` existe por LA MUSICA MANDA: el transporte no se detiene nunca.
   * Al pasar del nivel 1 al laberinto (spec 038) se descarta lo visual pero la
   * `Choreography` sigue sonando y se le entrega al modo siguiente. Sin esto la
   * musica cortaria y volveria a empezar, que es exactamente lo que la regla prohibe.
   *
   * `conservarRenderer` va con lo mismo: el contexto WebGL es lo caro y lo que el
   * navegador limita, asi que el laberinto reutiliza el que ya esta caliente.
   */
  function dispose(opciones = {}) {
    if (!opciones.conservarAudio) choreo.stop();
    cancelAnimationFrame(raf);
    removeEventListener('resize', resize);
    input.dispose();
    if (!opciones.conservarRenderer) {
      renderer.dispose();
      renderer.domElement.remove();
    }
  }

  return api;
}
