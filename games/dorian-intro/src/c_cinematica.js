/**
 * Reproductor de cinemáticas de vitral.
 *
 * DECISIÓN CENTRAL: `estadoEn(t)` es una FUNCIÓN PURA del tiempo.
 *
 * No hay estado mutable avanzando por ahí: dado un segundo `t`, devuelve
 * exactamente qué dibujar. Dos consecuencias que valen la pena:
 *
 *  1. Se prueba sin navegador. La lógica de tiempos, texto y parallax se
 *     verifica en Node, y el navegador solo pinta.
 *  2. Los golden visuales son estables. Playwright puede saltar a t=3.2 s y
 *     obtener SIEMPRE el mismo fotograma. Un reproductor con estado dependería
 *     de cuántos frames hayan pasado, y la captura sería flaky.
 *
 * TODOS los tiempos salen de `tweaks.json`. Este fichero no tiene ni un número
 * de duración.
 */

// --- easings ---------------------------------------------------------------
const EASE = {
  lineal: (x) => x,
  seno: (x) => Math.sin(x * Math.PI * 2),
  suave: (x) => x * x * (3 - 2 * x),
  entrada: (x) => x * x,
  salida: (x) => 1 - (1 - x) * (1 - x),
};

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Duración de un cuadro: la suma de sus tramos. Ningún número suelto. */
export function duracionCuadro(tweaks) {
  const c = tweaks.cuadro;
  return c.fundido_entrada + c.espera_antes_del_texto + c.lectura
       + c.espera_despues_del_texto + c.fundido_salida;
}

export function duracionTotal(guion, tweaks) {
  return guion.cuadros.length * duracionCuadro(tweaks);
}

/**
 * Cuántos caracteres se han escrito en `t` segundos de máquina de escribir.
 *
 * Las pausas en punto y coma no se simulan carácter a carácter —eso obligaría a
 * recorrer el texto entero en cada frame— sino descontando por adelantado el
 * tiempo que costarán. Es equivalente en el resultado y O(1) por frame.
 */
export function caracteresEscritos(texto, t, tweaks) {
  const tx = tweaks.texto;
  if (tx.modo !== 'maquina') return t > 0 ? texto.length : 0;
  if (t <= 0) return 0;

  const puntos = (texto.match(/[.…!?]/g) ?? []).length;
  const comas = (texto.match(/[,;:]/g) ?? []).length;
  const pausas = puntos * tx.pausa_en_punto + comas * tx.pausa_en_coma;

  const escritura = texto.length / tx.caracteres_por_segundo;
  const total = escritura + pausas;
  if (t >= total) return texto.length;

  // Reparto proporcional: el tiempo de pausa se distribuye sobre el avance.
  return Math.floor((t / total) * texto.length);
}

/**
 * Estado completo en el segundo `t`.
 *
 * @returns null si `t` cae fuera de la cinemática (ya terminó).
 */
export function estadoEn(t, guion, tweaks) {
  const dur = duracionCuadro(tweaks);
  const indice = Math.floor(t / dur);
  if (indice < 0 || indice >= guion.cuadros.length) return null;

  const cuadro = guion.cuadros[indice];
  const local = t - indice * dur;
  const c = tweaks.cuadro;

  // --- tramos, en orden ------------------------------------------------
  const finEntrada = c.fundido_entrada;
  const inicioTexto = finEntrada + c.espera_antes_del_texto;
  const finTexto = inicioTexto + c.lectura;
  const inicioSalida = finTexto + c.espera_despues_del_texto;

  let opacidad = 1;
  let fase = 'lectura';
  if (local < finEntrada) {
    opacidad = EASE.salida(clamp01(local / c.fundido_entrada));
    fase = 'entrada';
  } else if (local >= inicioSalida) {
    opacidad = 1 - EASE.entrada(clamp01((local - inicioSalida) / c.fundido_salida));
    fase = 'salida';
  }

  // --- texto -------------------------------------------------------------
  const tTexto = local - inicioTexto;
  const visibles = tTexto < 0 ? 0 : caracteresEscritos(cuadro.texto, tTexto, tweaks);
  let opacidadTexto = 0;
  if (tTexto >= 0 && local < inicioSalida) {
    opacidadTexto = EASE.salida(clamp01(tTexto / tweaks.texto.fundido_entrada));
  } else if (local >= inicioSalida) {
    opacidadTexto = 1 - EASE.entrada(clamp01((local - inicioSalida) / tweaks.texto.fundido_salida));
  }

  // --- parallax: deriva lenta mientras se lee ---------------------------
  const p = tweaks.parallax;
  const faseDeriva = (local / p.duracion_deriva) % 1;
  const onda = (EASE[p.easing] ?? EASE.seno)(faseDeriva);
  const zoom = 1 + (p.zoom_figura - 1) * clamp01(local / p.duracion_zoom);

  const capas = ['fondo', 'medio', 'figura'].map((nombre) => {
    const factor = cuadro.parallax?.[nombre] ?? 1;
    return {
      nombre,
      // La amplitud va en FRACCIÓN del ancho, no en píxeles: así el mismo
      // tweak vale para 1280 y para 1920.
      dx: onda * p.amplitud * factor * p.direccion[0],
      dy: onda * p.amplitud * factor * p.direccion[1],
      escala: nombre === 'figura' ? zoom : 1,
      png: `assets/vitrales/${cuadro.id}/${cuadro.id}_${nombre}.png`,
    };
  });

  return {
    indice,
    cuadro: cuadro.id,
    fase,
    local: +local.toFixed(4),
    opacidad: +opacidad.toFixed(4),
    capas,
    texto: {
      completo: cuadro.texto,
      visible: cuadro.texto.slice(0, visibles),
      caracteres: visibles,
      terminado: visibles >= cuadro.texto.length,
      opacidad: +opacidadTexto.toFixed(4),
    },
    acento: cuadro.acento ?? '#ffffff',
    brillo: {
      // Luz que recorre el vidrio. Periodo propio, independiente del parallax:
      // si compartieran periodo se percibirían como un solo movimiento.
      fase: (local / tweaks.vitral.brillo_periodo) % 1,
      intensidad: tweaks.vitral.brillo_intensidad,
      angulo: tweaks.vitral.brillo_angulo_grados,
    },
  };
}

/** Segundo en el que empieza un cuadro. Útil para saltar entre ellos. */
export function inicioDe(indice, tweaks) {
  return indice * duracionCuadro(tweaks);
}

export { EASE };
