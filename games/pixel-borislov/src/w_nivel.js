// Puente nivel -> motor.
//
// El escenario se define como TILES en `assets/levels/*.json`, que es lo que
// consume Blender. El motor heredado consume SÓLIDOS rectangulares
// `{x, y, w, h, surface, layer}` en `CollisionWorld`. Este módulo traduce.
//
// POR QUÉ SE FUSIONAN LOS TILES
//
// 46 tiles sueltos son 46 rectángulos que el resolutor de colisión recorre en
// cada paso. Fusionados en tiras horizontales quedan 5. Además es la forma que
// ya usa `TEST_LEVEL`, cuyo primer sólido es `{x:-4, y:-1, w:12, h:1}`: tiras
// anchas, no celdas.
//
// La fusión es por FILAS y solo entre tiles contiguos con la MISMA superficie:
// si se fusionara a través de un cambio de fricción, el jugador resbalaría en
// hielo sobre un tramo de tierra.
//
// CONVENIO DE COORDENADAS: en el JSON, `y` crece hacia ARRIBA y un tile ocupa
// la celda [x, x+1) × [y, y+1). Es el mismo convenio del motor, así que no hay
// inversión — pero conviene decirlo, porque en Blender la vertical es Z.

import { SURFACE } from './w_contracts.js';

/** Nombre de superficie del JSON -> valor del contrato. Falla ruidosamente. */
function superficie(nombre) {
  if (nombre == null) return SURFACE.TIERRA;
  const v = SURFACE[String(nombre).toUpperCase()];
  if (!v) {
    // Un nombre desconocido no se convierte en TIERRA en silencio: eso daría un
    // nivel que se juega distinto de lo que dice su fichero.
    throw new Error(
      `superficie desconocida "${nombre}". Válidas: ${Object.keys(SURFACE).join(', ')}`,
    );
  }
  return v;
}

/**
 * Fusiona tiles contiguos de la misma fila y superficie en tiras.
 * Devuelve sólidos ordenados por fila y luego por x, que hace el resultado
 * determinista: dos ejecuciones con el mismo JSON dan el mismo array.
 */
export function fusionarTiles(tiles, { layer = 0 } = {}) {
  const porFila = new Map();
  for (const t of tiles) {
    if (!porFila.has(t.y)) porFila.set(t.y, []);
    porFila.get(t.y).push(t);
  }

  const solidos = [];
  for (const y of [...porFila.keys()].sort((a, b) => a - b)) {
    const fila = porFila.get(y).sort((a, b) => a.x - b.x);
    let actual = null;
    for (const t of fila) {
      const surf = superficie(t.surface);
      const contiguo = actual && t.x === actual.x + actual.w && surf === actual.surface;
      if (contiguo) {
        actual.w += 1;
      } else {
        if (actual) solidos.push(actual);
        actual = { x: t.x, y, w: 1, h: 1, surface: surf, layer };
      }
    }
    if (actual) solidos.push(actual);
  }
  return solidos;
}

const TIPO_MARCADOR = { start: 'spawn', checkpoint: 'checkpoint', end: 'meta' };

/**
 * Convierte la definición de tiles en un nivel que el motor entiende.
 *
 * El resultado tiene la MISMA forma que `TEST_LEVEL` en sus campos
 * obligatorios. Los sistemas que este clon aún no usa (portales, engranajes,
 * cinemáticas) se dejan como arrays vacíos en vez de omitirse: el motor los
 * recorre, y un `undefined` reventaría donde un `[]` no hace nada.
 */
export function nivelDesdeTiles(def) {
  if (!def?.terreno?.length) throw new Error('la definición no tiene terreno');

  const solids = fusionarTiles(def.terreno);
  const marcas = def.marcadores ?? [];
  const buscar = (tipo) => marcas.find((m) => TIPO_MARCADOR[m.tipo] === tipo);

  const inicio = buscar('spawn');
  if (!inicio) throw new Error('la definición no tiene marcador de tipo "start"');

  const xs = def.terreno.map((t) => t.x);
  const ys = def.terreno.map((t) => t.y);
  const minY = Math.min(...ys);

  return {
    name: def.nombre ?? def.id,
    // +0.2 en vertical: el jugador aparece justo encima del suelo, no incrustado.
    spawn: { x: inicio.x + 0.5, y: inicio.y + 0.2, layer: 0 },
    bounds: { minX: Math.min(...xs) - 2, maxX: Math.max(...xs) + 3 },
    // Caer 8 tiles por debajo del punto más bajo mata. Mismo criterio que
    // TEST_LEVEL, que usa killY -8 con su suelo en -1.
    killY: minY - 8,
    solids,
    checkpoints: marcas
      .filter((m) => TIPO_MARCADOR[m.tipo] === 'checkpoint')
      .map((m) => ({ x: m.x + 0.5, y: m.y + 0.2, layer: 0 })),
    markers: marcas.map((m) => ({
      name: m.nombre, tipo: TIPO_MARCADOR[m.tipo] ?? m.tipo,
      x: m.x + 0.5, y: m.y + 0.2, layer: 0,
    })),
    meta: buscar('meta') ? { x: buscar('meta').x + 0.5, y: buscar('meta').y + 0.2 } : null,

    // Sistemas del motor que este clon todavía no usa.
    portals: [], sparks: [], pushables: [], plates: [], breakables: [],
    props: [], screws: [], diggables: [], stages: [], cinematics: [],
  };
}

/** Estadísticas de la conversión. Regla heredada: medir, no deducir. */
export function informeConversion(def, nivel) {
  return {
    tiles: def.terreno.length,
    solidos: nivel.solids.length,
    reduccion: `${(100 * (1 - nivel.solids.length / def.terreno.length)).toFixed(0)}%`,
    superficies: [...new Set(nivel.solids.map((s) => s.surface))].sort(),
    bounds: nivel.bounds,
    killY: nivel.killY,
    checkpoints: nivel.checkpoints.length,
  };
}
