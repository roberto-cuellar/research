/**
 * La frontera entre el playsim y el render.
 *
 * El playsim no dibuja: emite HECHOS. Que una caja se rompio, que un pie toco el
 * suelo, que una placa se hundio. El render vacia la cola una vez por frame y decide
 * que significa cada hecho — una onda, polvo, un sonido, un temblor.
 *
 * Es lo que permite que `p_*` no importe `r_*`, y por tanto que el nivel se pueda
 * simular en Node sin dibujarlo (spec 035).
 *
 * ---- por que un buffer y no un bus de eventos ----
 *
 * La tentacion al separar subsistemas es meter un `emit`/`on` con suscriptores. En
 * un bucle de 60 fps eso se paga dos veces: un objeto nuevo por evento —que la
 * recoleccion de basura acaba cobrando en forma de tirones— y un salto indirecto por
 * suscriptor.
 *
 * Aqui no hay objetos ni suscriptores. Dos arrays tipados preasignados, un indice, y
 * un recorrido. Emitir es escribir cuatro numeros; vaciar es un `for`. **Cero
 * asignacion por tick**, que es lo que exige el presupuesto.
 *
 * El precio son 32 bits por numero: una x de 34,475 vuelve como 34,474998. Un
 * micrometro, a cambio de la mitad de memoria y de que no haya conversiones. Para
 * colocar una particula o una onda sobra; nada que necesite precision exacta debe
 * viajar por aqui — para eso estan los hooks, que pasan el objeto entero.
 *
 * ---- si se llena ----
 *
 * Se descarta y se cuenta. Nunca se crece el buffer en runtime: reservar en mitad
 * del bucle es exactamente lo que se esta evitando. `descartados` sale en el panel
 * de depuracion para que llenarse no sea silencioso — un efecto que desaparece sin
 * decir nada es peor que uno que falta y lo avisa.
 */

/** Tipos de hecho. Numeros y no cadenas: van en un `Uint8Array`. */
export const EV = {
  PASO: 1,          // un pie toca el suelo · (x, y, capa, velocidad)
  ATERRIZAJE: 2,    // caida resuelta       · (x, y, capa, dureza 0..1)
  GOLPE_SUELO: 3,   // algo pesado impacta  · (x, y, capa, fuerza)
  ROTURA: 4,        // un rompible cede     · (x, y, capa, tipo)
  RECOGIDA: 5,      // se coge algo         · (x, y, capa, clase)
  CRUCE_PORTAL: 6,  // cambio de capa       · (x, y, capa destino, 0)
  PLACA: 7,         // una placa se hunde   · (x, y, capa, 1 = pulsada)
  IMPACTO: 8,       // proyectil contra algo· (x, y, capa, fuerza)
  RECHAZO: 9,       // un gesto NO se pudo hacer · (x, y, capa, motivo de `MOTIVO`)
};

/**
 * Por que no se pudo hacer un gesto. Viaja en `mag` de un `EV.RECHAZO`.
 *
 * Existe porque el playsim no puede decir nada por su cuenta: no dibuja ni suena. Los
 * metodos `atravesar()` y `romperApuntado()` ya DEVOLVIAN el motivo —y su docblock cita
 * el criterio de aceptacion 6 de la spec 036, "el juego tiene que DECIR por que no se
 * abre"—, pero quien los llamaba tiraba el valor de vuelta. El resultado era que pulsar
 * R sin cargas, o Q sin los guantes, no producia absolutamente nada: ni sonido, ni
 * aviso, ni parpadeo. El poder se ofrecia y parecia roto.
 *
 * Numeros y no cadenas por lo mismo que los tipos: esto va en un `Float32Array`.
 *
 * NO se emite el caso "no estabas apuntando a nada". Pulsar en mitad de un pasillo es
 * lo normal mientras corres, y avisarlo convertiria el feedback en un zumbido que se
 * aprende a ignorar — con lo que dejaria de avisar de lo que si importa.
 */
export const MOTIVO = {
  SIN_CARGAS: 1,      // R contra un muro perforable, pero sin cargas
  NO_PERFORABLE: 2,   // R contra el perimetro: ese no se atraviesa nunca
  SIN_GUANTE: 3,      // Q sin los Guantes del Proyector
  NO_ROMPIBLE: 4,     // Q con guantes, pero ese muro no es de madera
};

/**
 * Capacidad.
 *
 * 256 contra un pico medido de decenas por frame. Sobra a proposito: el coste es
 * 1,3 KB reservados una vez, y quedarse corto significa perder feedback.
 */
const CAP = 256;

const tipos = new Uint8Array(CAP);
const datos = new Float32Array(CAP * 4);
let n = 0;

/** Cuantos se han tenido que tirar por falta de sitio. Deberia ser siempre 0. */
export let descartados = 0;

/**
 * Emite un hecho. Lo llama `p_*`; no devuelve nada y no puede fallar.
 *
 * @param {number} tipo  uno de `EV`
 * @param {number} x
 * @param {number} y
 * @param {number} capa
 * @param {number} [mag]  magnitud: fuerza, dureza, clase… segun el tipo
 */
export function emitir(tipo, x, y, capa, mag = 0) {
  if (n >= CAP) { descartados += 1; return; }
  const i = n * 4;
  tipos[n] = tipo;
  datos[i] = x;
  datos[i + 1] = y;
  datos[i + 2] = capa;
  datos[i + 3] = mag;
  n += 1;
}

/**
 * Recorre lo emitido y vacia la cola. Lo llama `r_*`, una vez por frame.
 *
 * El callback recibe valores sueltos, no un objeto: construir uno por evento es
 * justo la asignacion que este modulo existe para evitar.
 *
 * @param {(tipo:number, x:number, y:number, capa:number, mag:number) => void} fn
 */
export function vaciar(fn) {
  for (let k = 0; k < n; k += 1) {
    const i = k * 4;
    fn(tipos[k], datos[i], datos[i + 1], datos[i + 2], datos[i + 3]);
  }
  n = 0;
}

/** Cuantos hay pendientes. Para el panel de depuracion y para medir el pico. */
export function pendientes() { return n; }

/** Tira lo pendiente sin procesarlo. Al reaparecer o al cambiar de etapa. */
export function limpiar() { n = 0; }

/** Solo para las pruebas: deja el contador de descartes a cero. */
export function _reset() { n = 0; descartados = 0; }
