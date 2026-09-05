/**
 * Props de personaje: piezas que se cuelgan de los huesos del rig.
 *
 * Es la mitad de runtime del generador modular (plan §4.2). El generador de Blender
 * ensambla el personaje base y hornea su GLB; esto engancha lo que se pone y se
 * quita EN JUEGO — unas botas que se recogen, un guante, un cuerno.
 *
 * Se apoya en el contrato de esqueleto: los 25 huesos `mixamorig:*` son los mismos
 * en todas las especies, asi que un prop colocado sobre `RightFoot` encaja en
 * Borislov, en Bradislav y en la ardilla sin tocar nada. Esa es toda la razon de ser
 * del contrato, y aqui es donde se cobra.
 *
 * Los props son RIGIDOS: se emparentan al hueso y heredan su transformada. Nada de
 * pesos ni de segundo esqueleto (plan §4.2, "props rigidos").
 */

import * as THREE from 'three';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';

// Vectores de trabajo: medir en el bucle de equipamiento no debe asignar.
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

/**
 * Catalogo de props.
 *
 * `bone` es el nombre canonico del contrato, sin el prefijo `mixamorig:`, tal como
 * lo normaliza `canon()` en la plataforma. `size` es la altura deseada en METROS:
 * los modelos vienen de fuentes distintas y cada uno en su escala, asi que se
 * normalizan al colocarlos en vez de confiar en como venga cada GLB.
 *
 * Referencia para no volver a pasarse: Borislov mide 1,48 m, asi que una bota son
 * ~17 cm de alto contando la caña, y un guante ~12. Puesto a 30 se ve como un
 * zueco.
 */
/**
 * Colores por PODER. Es lo que hace legible el equipo de un vistazo: la pieza no
 * dice solo "llevo algo", dice QUE puedo hacer.
 */
export const POWER_COLORS = {
  portal: 0x7c3aed,   // violeta: es el color de los Portales de Idea
  throw: 0x2ed8ee,    // cian: el de las Chispas
  motor: 0xe62a9e,    // rosa: el unico que mejora al personaje, no que le añade un verbo
  none: 0xf59e0b,
};

/**
 * Bota low-poly, construida aquí.
 *
 * Existe porque orientar calzado ajeno resultó una lotería: cada modelo viene en su
 * eje, la mitad traen el par, y ninguno declara dónde tiene la puntera. Deducirlo de
 * la geometría funciona a veces y falla justo en los casos raros.
 *
 * Autorándola se acaba el problema de raíz: **la puntera está en +Z porque yo la
 * pongo ahí**, la suela en Y=0 y el ancho en X. Son 3 cajas y 36 triángulos, pesa
 * nada, y encima el emisivo permite teñirla según el poder que concede.
 */
function buildBoot(color) {
  const g = new THREE.Group();

  const cuerpo = new THREE.MeshStandardMaterial({
    color: 0x2a2f3d, roughness: 0.55, metalness: 0.35,
  });
  const brillo = new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: 1.4, roughness: 0.3,
  });

  // Pie: más largo (Z) que ancho (X). La puntera cae en +Z.
  const pie = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.62), cuerpo);
  pie.position.set(0, 0.11, 0.06);
  g.add(pie);

  // Puntera achatada: da la silueta de bota sin añadir un modelo.
  const punta = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.14, 0.16), cuerpo);
  punta.position.set(0, 0.07, 0.42);
  g.add(punta);

  // Caña, hacia atrás y arriba: es lo que la distingue de un zapato.
  const cana = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.34, 0.30), cuerpo);
  cana.position.set(0, 0.34, -0.10);
  g.add(cana);

  // Banda emisiva: el canal que dice QUE poder lleva.
  const banda = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.06, 0.32), brillo);
  banda.position.set(0, 0.24, -0.09);
  g.add(banda);

  const suela = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.05, 0.66), brillo);
  suela.position.set(0, 0.02, 0.06);
  g.add(suela);

  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  return g;
}

/** Guante low-poly. Mismo criterio: los dedos van a +Z. */
function buildGlove(color) {
  const g = new THREE.Group();
  const cuerpo = new THREE.MeshStandardMaterial({
    color: 0x2a2f3d, roughness: 0.5, metalness: 0.4,
  });
  const brillo = new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: 1.6, roughness: 0.25,
  });

  const palma = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.10, 0.24), cuerpo);
  palma.position.set(0, 0, 0.06);
  g.add(palma);

  const puno = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.13, 0.10), cuerpo);
  puno.position.set(0, 0, -0.09);
  g.add(puno);

  // Anillo emisivo en la muñeca: es de donde sale la Chispa.
  const anillo = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.12), brillo);
  anillo.position.set(0, 0.02, -0.09);
  g.add(anillo);

  const dorso = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.16), brillo);
  dorso.position.set(0, 0.06, 0.06);
  g.add(dorso);

  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  return g;
}

/** Constructores por prop. Si hay uno, se usa en vez del GLB. */
/** Mochila del Motor de Idea: dos bloques y un nucleo que late. */
function buildEngine(color) {
  const g = new THREE.Group();
  const cuerpo = new THREE.MeshStandardMaterial({
    color: 0x2a2f3d, roughness: 0.4, metalness: 0.6,
  });
  const brillo = new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: 1.8, roughness: 0.2,
  });

  const caja = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.30, 0.14), cuerpo);
  g.add(caja);

  const nucleo = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.06), brillo);
  nucleo.position.set(0, 0.02, -0.08);
  g.add(nucleo);

  for (const lado of [-1, 1]) {
    const tubo = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.24, 0.05), brillo);
    tubo.position.set(lado * 0.15, 0, -0.02);
    g.add(tubo);
  }

  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  return g;
}

const BUILDERS = { botas: buildBoot, tenis: buildBoot, guante: buildGlove, motor: buildEngine };

export const PROPS = {
  botas: {
    label: 'Botas del Cañón',
    url: './public/models/props/botas.glb',
    bones: ['leftfoot', 'rightfoot'],
    size: 0.17,
    offset: [0, 0, 0.01],
    sole: true,   // su suela se apoya en el suelo, no en el hueso
    // Construida aqui: sin GLB, sin par que partir y sin orientacion que adivinar.
    built: true,
    // Lo que desbloquea al equiparse. Es el gancho con el gameplay.
    grants: 'portal',
  },
  tenis: {
    label: 'Tenis',
    url: './public/models/props/tenis.glb',
    bones: ['leftfoot', 'rightfoot'],
    size: 0.14,
    offset: [0, 0, 0.01],
    sole: true,
    built: true,
  },
  guante: {
    label: 'Guantes del Proyector',
    url: './public/models/props/guante.glb',
    bones: ['lefthand', 'righthand'],
    size: 0.12,
    offset: [0, 0.01, 0],
    built: true,
    // Son TECNOLOGIA, no un arma: son los guantes con los que se maneja el
    // Proyector, y por eso habilitan lanzar Chispas.
    grants: 'throw',
  },
  /**
   * MOTOR DE IDEA — la recompensa de la isla trasera.
   *
   * Esta donde SOLO se llega abriendo un portal propio, asi que el desvio tiene que
   * pagar de verdad o nadie vuelve a hacerlo. Da tres cosas a la vez, que es lo que
   * lo convierte en una mejora y no en un coleccionable mas:
   *
   *   +25 % de carrera        se nota en cada segundo de juego
   *   recarga a la mitad      el lanzamiento deja de racionarse
   *   +2 Chispas por rompible los rompibles pasan a merecer el rodeo
   *
   * Va en la espalda porque es una mochila: se ve desde atras mientras corres, que
   * es como se juega el 90 % del nivel.
   */
  motor: {
    label: 'Motor de Idea',
    bones: ['spine2'],
    size: 0.30,
    offset: [0, 0.02, -0.10],
    built: true,
    grants: 'motor',
  },
  cuerno: {
    label: 'Cuerno',
    url: './public/models/props/cuerno.glb',
    bones: ['head'],
    size: 0.34,
    offset: [0.1, 0.18, 0],
    rotation: [0, 0, 0.4],
    tint: 0xb9a48a,
  },
};

/**
 * Parte en dos un modelo que trae el PAR.
 *
 * Casi todos los modelos de calzado que hay por ahi vienen con los dos zapatos, y
 * colgar el par entero de cada pie da cuatro zapatos y una orientacion sin sentido:
 * el eje mas largo del conjunto es el ANCHO DEL PAR, no el largo del zapato, asi que
 * cualquier alineacion automatica apunta mal. Medido: los tenis son 9,7 de ancho por
 * 3,5 de fondo.
 *
 * Se separa por el signo de X del centroide de cada triangulo. Es geometria simple y
 * se hace una vez por modelo, no por personaje.
 *
 * @returns {{izq: THREE.BufferGeometry, der: THREE.BufferGeometry}|null}
 */
function splitPair(source) {
  let mesh = null;
  source.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
  if (!mesh) return null;

  const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
  const pos = geo.attributes.position.array;
  const nor = geo.attributes.normal ? geo.attributes.normal.array : null;
  const uv = geo.attributes.uv ? geo.attributes.uv.array : null;

  const lados = { izq: { p: [], n: [], u: [] }, der: { p: [], n: [], u: [] } };

  for (let t = 0; t < pos.length; t += 9) {
    const cx = (pos[t] + pos[t + 3] + pos[t + 6]) / 3;
    const lado = cx < 0 ? lados.izq : lados.der;
    for (let v = 0; v < 9; v += 1) lado.p.push(pos[t + v]);
    if (nor) for (let v = 0; v < 9; v += 1) lado.n.push(nor[t + v]);
    if (uv) {
      const ut = (t / 9) * 6;
      for (let v = 0; v < 6; v += 1) lado.u.push(uv[ut + v]);
    }
  }

  const build = (lado) => {
    if (!lado.p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(lado.p, 3));
    if (lado.n.length) g.setAttribute('normal', new THREE.Float32BufferAttribute(lado.n, 3));
    if (lado.u.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(lado.u, 2));
    g.computeBoundingBox();
    const c = g.boundingBox.getCenter(new THREE.Vector3());
    g.translate(-c.x, -g.boundingBox.min.y, -c.z);
    canonicalizeShoe(g);
    return g;
  };

  const izq = build(lados.izq);
  const der = build(lados.der);
  // Si uno de los dos sale vacio, el modelo no era un par: se deja como estaba.
  if (!izq || !der) return null;
  return { izq, der, material: mesh.material };
}

/**
 * Deja un zapato en orientacion CANONICA: puntera hacia +Z, suela en Y=0.
 *
 * Es lo que permite dejar de adivinar rotaciones. La forma del propio modelo dice
 * cual es la puntera, porque un zapato tiene una asimetria fiable: **el extremo de
 * la punta es mas bajo que el del talon**, donde esta el tobillo o la caña. Asi que
 * se parte por la mitad a lo largo y gana el lado con menos altura.
 *
 * A partir de aqui todos los zapatos del catalogo miran igual, vengan de donde
 * vengan, y colgarlos de un hueso es una sola rotacion sin casos particulares.
 */
function canonicalizeShoe(g) {
  g.computeBoundingBox();
  let size = g.boundingBox.getSize(new THREE.Vector3());

  // 1. El eje largo HORIZONTAL es el que va del talon a la punta. Se compara solo
  //    X contra Z: la caña de una bota puede ser mas alta que larga.
  if (size.z > size.x) {
    // Ya esta a lo largo de Z.
  } else {
    g.rotateY(Math.PI / 2);        // el eje largo pasa de X a Z
    g.computeBoundingBox();
    size = g.boundingBox.getSize(new THREE.Vector3());
  }

  // 2. Que extremo es la punta. Se compara la altura media de cada mitad en Z.
  const pos = g.attributes.position.array;
  let sumaFrente = 0, nFrente = 0, sumaFondo = 0, nFondo = 0;
  for (let i = 0; i < pos.length; i += 3) {
    if (pos[i + 2] >= 0) { sumaFrente += pos[i + 1]; nFrente += 1; }
    else { sumaFondo += pos[i + 1]; nFondo += 1; }
  }
  const altoFrente = nFrente ? sumaFrente / nFrente : 0;
  const altoFondo = nFondo ? sumaFondo / nFondo : 0;

  // Si la mitad de +Z es la ALTA, la punta esta en -Z: media vuelta.
  if (altoFrente > altoFondo) g.rotateY(Math.PI);

  g.computeBoundingBox();
  g.computeVertexNormals();
  return g;
}

export class PropSystem {
  /**
   * @param {THREE.Object3D} avatar  raiz del personaje, ya cargada
   */
  /**
   * @param {THREE.Object3D} avatar  raiz del personaje, ya cargada
   * @param {(material: THREE.Material) => void} [onMaterial]  se llama con cada
   *   material nuevo. Lo usa el sistema de portales para aplicarle la disolucion:
   *   sin esto, al cruzar de capa el personaje se desvanece y las botas se quedan
   *   flotando enteras, que delata el truco.
   */
  constructor(avatar, onMaterial = null) {
    this.avatar = avatar;
    this.onMaterial = onMaterial;
    this.equipped = new Map();     // id -> [Object3D]
    this.granted = new Set();      // habilidades desbloqueadas
    this.loader = new GLTFLoader();
    this._cache = new Map();
    this._pairs = new Map();

    // Indice de huesos por nombre canonico. Se hace una vez: recorrer el esqueleto
    // en cada equipamiento seria recorrer 25 huesos por prop sin necesidad.
    this.bones = new Map();
    avatar.traverse((o) => {
      if (o.isBone) this.bones.set(o.name.replace(/^mixamorig[:_]?/i, '').toLowerCase(), o);
    });
  }

  has(id) { return this.equipped.has(id); }

  /**
   * Precompila los materiales de todos los props CONSTRUIDOS, al cargar.
   *
   * Por que hace falta. `equip()` llama a `BUILDERS[id](color)`, que crea dos
   * `MeshStandardMaterial` nuevos, y ademas los pasa por `registerMaterial` para
   * injertarles la disolucion del portal con `onBeforeCompile`. La primera vez que
   * uno de esos materiales entra en un render, WebGL **compila y enlaza su programa**,
   * y eso es un bloqueo sincrono de decenas de milisegundos: el tiron que se nota al
   * recoger las botas o los guantes.
   *
   * No es una idea nueva: la constitucion ya lo exige — *"los shaders se precompilan
   * al cargar, con un render de 1 frame fuera de pantalla. Que una transicion sea la
   * primera vez que se compila un shader es la causa clasica de un tiron"* — y
   * `portals.precompile()` ya lo hacia para los suyos. Los props se habian quedado
   * fuera.
   *
   * Los modelos de calentamiento se QUEDAN en la escena, invisibles y lejos. Si se
   * destruyeran, three liberaria sus programas y la compilacion volveria a pagarse en
   * el primer equipamiento — que es justo lo que se esta evitando.
   */
  precompile(renderer, scene, camera) {
    if (this._warmup) return 0;
    const grupo = new THREE.Group();
    grupo.position.set(0, -900, 0);   // fuera de cualquier encuadre posible

    let n = 0;
    for (const [id, spec] of Object.entries(PROPS)) {
      const build = BUILDERS[id];
      if (!spec.built || !build) continue;
      const modelo = build(POWER_COLORS[spec.grants || 'none']);
      modelo.traverse((o) => { if (o.isMesh && this.onMaterial) this.onMaterial(o.material); });
      grupo.add(modelo);
      n += 1;
    }

    scene.add(grupo);
    // Un render fuera de pantalla compila y enlaza todo lo que hay en la escena.
    renderer.compile(scene, camera);
    grupo.visible = false;
    this._warmup = grupo;
    return n;
  }
  can(ability) { return this.granted.has(ability); }

  /**
   * Cuelga un prop de sus huesos.
   *
   * @returns {Promise<string|null>} la habilidad que concede, o null
   */
  async equip(id) {
    const spec = PROPS[id];
    if (!spec || this.equipped.has(id)) return null;

    // Los construidos no cargan nada: se autoran aqui y ya vienen orientados.
    const gltf = spec.built ? null : await this._load(spec.url);
    if (!spec.built && !gltf) return null;

    const attached = [];
    // Correccion compartida entre piezas simetricas, calculada en la primera.
    let ajuste = null;
    for (const boneName of spec.bones) {
      let factorEscala = 1;
      let bajada = 0;
      const bone = this.bones.get(boneName);
      if (!bone) continue;

      // Pieza construida: la puntera ya esta en +Z por definicion, asi que no hay
      // nada que deducir. El color sale del PODER que concede.
      let model;
      if (spec.built) {
        const build = BUILDERS[id];
        const color = POWER_COLORS[spec.grants || 'none'];
        if (build) model = build(color);
      }

      // Si el modelo trae el par, se usa SOLO el zapato de este lado.
      if (!model && spec.pair) {
        const partes = this._pairs.get(spec.url) ?? splitPair(gltf.scene);
        this._pairs.set(spec.url, partes);
        if (partes) {
          const geo = boneName.startsWith('left') ? partes.izq : partes.der;
          model = new THREE.Object3D();
          model.add(new THREE.Mesh(geo, partes.material.clone()));
        }
      }
      if (!model) model = gltf.scene.clone(true);

      // Escala normalizada a `size`, en METROS de mundo.
      //
      // Se divide por la escala del HUESO, no por la del avatar. Un prop cuelga del
      // hueso y hereda la cadena entera —avatar, raiz, cadera, pierna, pie—, y esa
      // acumulacion no tiene por que coincidir con la del avatar: medido, la bota
      // salia a 30 cm cuando se le pedian 17.
      const box = new THREE.Box3().setFromObject(model);
      const height = Math.max(box.getSize(new THREE.Vector3()).y, 0.001);
      model.scale.setScalar(spec.size / height);

      model.position.set(...(spec.offset || [0, 0, 0]));
      model.rotation.set(...(spec.rotation || [0, 0, 0]));

      // ---- alineacion con el hueso ----
      //
      // Nada de rotaciones a ojo. Cada modelo viene autorado en su propio eje y
      // acertar por prueba y error es una loteria que ademas se rompe con el
      // siguiente prop. Se calcula:
      //
      //   1. La direccion REAL del hueso, que es hacia su hijo — en un pie, hacia
      //      la puntera. Es dato del rig, no una suposicion.
      //   2. El eje largo del modelo, sacado de su caja: un zapato es mas largo que
      //      ancho o alto, asi que ese eje ES el que va del talon a la punta.
      //
      // Y se gira lo uno sobre lo otro. Funciona con cualquier modelo y cualquier
      // hueso, que es lo que hace falta si el catalogo va a crecer.
      if (spec.align !== false) {
        const child = bone.children.find((c) => c.isBone);
        if (child) {
          // ---- la base se construye en MUNDO, no en el espacio del hueso ----
          //
          // Los ejes locales de un hueso de Mixamo no siguen la convencion que uno
          // supondria: en el pie, la Y local va a lo largo del hueso, asi que el
          // "arriba" que se deduzca ahi puede apuntar a cualquier lado. Construir la
          // base con esos ejes acertaba la direccion de la puntera y dejaba el
          // zapato girado sobre ella — el giro sobrante.
          //
          // En mundo no hay ambiguedad: el personaje esta de pie, asi que arriba es
          // arriba. Se arma la base ahi y se convierte al espacio del hueso al final.
          this.avatar.updateMatrixWorld(true);
          const pieW = bone.getWorldPosition(new THREE.Vector3());
          const dedoW = child.getWorldPosition(new THREE.Vector3());

          const adelante = dedoW.clone().sub(pieW).normalize();
          const arribaRef = new THREE.Vector3(0, 1, 0);
          // Si el hueso apunta casi recto arriba o abajo, se usa otra referencia.
          if (Math.abs(adelante.dot(arribaRef)) > 0.95) arribaRef.set(0, 0, 1);

          const derecha = new THREE.Vector3().crossVectors(arribaRef, adelante).normalize();
          const arriba = new THREE.Vector3().crossVectors(adelante, derecha).normalize();

          const baseMundo = new THREE.Matrix4().makeBasis(derecha, arriba, adelante);
          // Del mundo al hueso: se quita la rotacion del propio hueso.
          const delHueso = new THREE.Matrix4().extractRotation(bone.matrixWorld).invert();
          model.quaternion.setFromRotationMatrix(delHueso.multiply(baseMundo));

          // Correccion fina del catalogo, en grados. Es la valvula de escape para
          // los modelos cuya geometria no delata su orientacion.
          if (spec.extra) {
            const r = Math.PI / 180;
            model.quaternion.multiply(new THREE.Quaternion().setFromEuler(
              new THREE.Euler(spec.extra[0] * r, spec.extra[1] * r, spec.extra[2] * r)
            ));
          }
        }
      }

      // Espejo SOLO si el modelo no venia en par. Cuando se ha partido, cada mitad
      // YA es el zapato de su lado, y espejarla encima invierte la orientacion que
      // se acaba de calcular — el zapato apuntaba al reves justo despues de haberlo
      // alineado bien.
      if (!spec.pair && boneName.startsWith('left')) model.scale.x *= -1;

      model.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.frustumCulled = false;
        if (spec.tint !== undefined && !spec.built) {
          o.material = o.material.clone();
          o.material.color.setHex(spec.tint);
        }
      });

      // Los materiales del prop pasan por el mismo tratamiento que los del
      // personaje: si el personaje se disuelve, el prop tambien.
      if (this.onMaterial) {
        model.traverse((o) => {
          if (!o.isMesh) return;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => this.onMaterial(m));
        });
      }

      bone.add(model);

      // ---- correccion de escala y posicion ----
      //
      // Se calcula UNA vez, con el primer hueso, y se reutiliza para los demas.
      //
      // Es necesario porque la medida en mundo depende de la POSE: si al equipar el
      // pie izquierdo esta levantado a media zancada, su caja envolvente sale
      // escorzada y la correccion sale distinta de la del derecho. Medido asi, la
      // bota derecha quedaba a 2 mm y la izquierda a 3,5 cm y un 55 % mas grande.
      //
      // Los dos pies son simetricos en el rig, asi que la correccion LOCAL del
      // primero vale para el segundo tal cual.
      if (ajuste) {
        model.scale.multiplyScalar(ajuste.escala);
        model.position.y += ajuste.bajada;
        attached.push(model);
        continue;      // ya esta colgado del hueso justo arriba
      }

      // ---- correccion de escala, medida ----
      //
      // La cadena de transformadas de un hueso (avatar, raiz, cadera, pierna, pie)
      // no es predecible: deducir el factor a partir de la escala del avatar o de la
      // del hueso daba 0,30 m cuando se pedian 0,17. En vez de razonarlo, se coloca,
      // se MIDE en el mundo y se corrige por la razon. Da igual como sea la cadena.
      this.avatar.updateMatrixWorld(true);
      const real = new THREE.Box3().setFromObject(model);
      const altoReal = real.getSize(new THREE.Vector3()).y;
      if (altoReal > 0.0001) {
        factorEscala = spec.size / altoReal;
        model.scale.multiplyScalar(factorEscala);
      }

      // ---- correccion de posicion, medida ----
      //
      // DESPUES de la de escala, y el orden importa: reescalar mueve la suela, asi
      // que ajustarla antes lo deshace el reescalado. Medido con el orden invertido,
      // la bota acababa 9,4 cm ENTERRADA.
      //
      // Leido del esqueleto real: el hueso del pie esta a 8,6 cm del suelo y la
      // puntera a 1,3. Un zapato cuya suela nace en el origen del hueso queda, por
      // tanto, flotando ocho centimetros por encima del pie — que es exactamente lo
      // que se veia.
      //
      // La correccion no se calcula: se mide. Se compara la parte mas baja de la
      // pieza con la del hueso mas bajo de la cadena (la puntera) y se baja la
      // diferencia. Funciona con cualquier calzado y con cualquier rig.
      if (spec.sole) {
        this.avatar.updateMatrixWorld(true);
        let masBajo = bone;
        bone.traverse((o) => {
          if (!o.isBone) return;
          if (o.getWorldPosition(_v).y < masBajo.getWorldPosition(_v2).y) masBajo = o;
        });
        const sueloHueso = masBajo.getWorldPosition(_v).y;
        const cajaPieza = new THREE.Box3().setFromObject(model);
        const baja = cajaPieza.min.y - sueloHueso;
        if (Number.isFinite(baja)) {
          // De mundo a local: se divide por la escala acumulada del hueso.
          const esc = bone.getWorldScale(_v2).y || 1;
          bajada = -baja / esc;
          model.position.y += bajada;
        }
      }
      ajuste = { escala: factorEscala, bajada };

      attached.push(model);
    }

    if (!attached.length) return null;
    this.equipped.set(id, attached);
    if (spec.grants) this.granted.add(spec.grants);
    return spec.grants || null;
  }

  /**
   * Ajusta en vivo la rotacion de un prop ya equipado, en grados.
   *
   * Existe porque acertar la orientacion de un modelo ajeno por deduccion tiene un
   * limite: cuando la geometria no dice lo que uno cree, cada intento es un ciclo
   * completo de editar, recargar y mirar. Con esto se prueba en el sitio y el valor
   * que funcione se fija luego en el catalogo como `extra`.
   *
   *   __game.props.tune('botas', 0, 90, 0)
   *
   * @returns {string} el valor listo para pegar en PROPS
   */
  tune(id, gx = 0, gy = 0, gz = 0) {
    const models = this.equipped.get(id);
    if (!models) return 'no equipado: ' + id;
    const r = Math.PI / 180;
    for (const model of models) {
      if (!model.userData.baseQuat) {
        model.userData.baseQuat = model.quaternion.clone();
      }
      const extra = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(gx * r, gy * r, gz * r, 'XYZ')
      );
      model.quaternion.copy(model.userData.baseQuat).multiply(extra);
    }
    return `extra: [${gx}, ${gy}, ${gz}]   // grados`;
  }

  /** Retira un prop y libera su geometria. */
  unequip(id) {
    const models = this.equipped.get(id);
    if (!models) return false;
    for (const model of models) {
      model.parent?.remove(model);
      model.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry.dispose();
        o.material.dispose();
      });
    }
    this.equipped.delete(id);
    const spec = PROPS[id];
    if (spec?.grants) this.granted.delete(spec.grants);
    return true;
  }

  async _load(url) {
    if (this._cache.has(url)) return this._cache.get(url);
    const promise = new Promise((resolve) => {
      this.loader.load(url, resolve, undefined, () => resolve(null));
    });
    this._cache.set(url, promise);
    return promise;
  }
}
