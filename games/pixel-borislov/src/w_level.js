/**
 * CAPRILOPOLIS · nivel 1 — el Proyector de Ideas.
 *
 * Ocho tramos cronometrados a una pieza de 105,95 s (49 compases, 111 BPM en 4/4).
 * Todo el nivel se declara AQUI y el motor lo interpreta: geometria, etapas, guion,
 * cinematicas, ambiente por momento, encuadre por momento y logros. Montar el mundo 2
 * no debe exigir tocar `src/` (GDD §12, constitucion › DATOS FRENTE A CODIGO).
 *
 * Tiene la MISMA forma que producira el exportador de Blender (plan §6), asi que
 * cuando exista el escenario horneado solo cambia el origen de los datos.
 *
 * Unidades en metros. `layer` 0 = capa DELANTERA, 1 = capa TRASERA.
 * Los solidos sin `layer` valen para las dos.
 *
 * Los tramos y su momento musical:
 *
 *   0 Apertura        presentacion          1-8   cinematica, sin musica
 *   1 Primeros pasos  precombate1           9-12  ambiental · la primera victoria
 *   2 La habitacion   combate1             13-20  coreografiada · retiene por loop
 *   3 El hallazgo     postcombate1         21-24  ambiental · el gesto de cobro
 *   4 Bisagra         contraste_pre_climax    25  1 compas, plano lejano
 *   5 Los tejados     climax_salvaje       26-33  coreografiada · RUNNER
 *   6 La caida        contraste_oscuro        34  1 compas, set piece
 *   7 La plaza        combate2             35-42  coreografiada · retiene por loop
 *   8 Cierre          postcombate2         43-49  ambiental
 */

import { SURFACE } from './w_contracts.js';

const s = (x, y, w, h, surface = SURFACE.TIERRA, layer = 0) => ({ x, y, w, h, surface, layer });

export const NIVEL_CAPRILOPOLIS_1 = {
  name: 'Caprilópolis — el Proyector de Ideas',
  spawn: { x: 2, y: 1.2, layer: 0 },
  bounds: { minX: -4, maxX: 288 },
  killY: -8,

  /**
   * RITMO. El jugador corre a 6 m/s y la pieza dura 106 s, asi que un nivel de 78 m
   * se acababa en 13 segundos: las etapas se cumplian antes de que la musica llegara
   * a su seccion. El nivel mide ~200 m repartidos en tres zonas, con obstaculos que
   * obligan a frenar, saltar y desviarse en vez de correr en linea recta.
   *
   *   Zona A  x   0 -  62   la habitacion imaginada  (tramos 1-3)
   *   Zona B  x  62 - 169   los tejados              (tramo 5, runner)
   *   Zona C  x 228 - 283   la plaza                 (tramo 7, el robot)
   *
   * LA ZONA B MEDIA 164 m Y AHORA MIDE 107. No es un recorte estetico: era TDB-001.
   * `climax_salvaje` dura 17,297 s y no tiene loop, asi que la musica no espera; 164 m
   * exigian 9,48 m/s con 6,0 disponibles y la etapa no se fallaba, se ATROPELLABA — la
   * musica seguia y `combate2` reasignaba la etapa 3 con el jugador aun en los tejados.
   *
   * 107 m a la velocidad autoral del runner (6,3 m/s, ver `stages[1].runner`) son
   * 17,0 s: cabe con 0,3 s de margen sobre los 17,297 del momento. El comentario que
   * habia aqui decia "128 m" y los solidos median 164; ahora la cifra y los datos son
   * la misma cosa, que es lo que fallaba.
   *
   * Del hueco entre 169 y 228 no se anda: se CAE. El dron lanza a Borislov al acabar
   * el tramo 5 y el set piece de `contraste_oscuro` lo deja en la plaza (GDD §4.2).
   */
  solids: [
    // ================= ZONA A · la habitacion imaginada =================
    s(-4, -1, 12, 1),                          // suelo inicial, x -4..8

    // ---- el hueco que enseña a saltar ----
    //
    // Aparece a los 8 m, antes que cualquier otra cosa: el jugador arranca, coge
    // velocidad y se lo encuentra. No hay forma de seguir sin saltar, y esa es la
    // gracia — un tutorial escrito se lee o no se lee, un hueco se cruza siempre.
    //
    // Y NO mata. Al fondo hay suelo a -1,2: caerse cuesta un par de segundos y una
    // segunda intentona, que ademas ensena el salto por segunda vez desde abajo
    // (1,2 m de subida contra 2,4 de salto: sale solo). Matar aqui contradiria la
    // regla del nivel — se cuentan intentos, no muertes.
    //
    // 2,7 m de ancho: andando se alcanzan 2,6, corriendo 4,9. Justo por encima de lo
    // que se cruza sin tomar carrerilla, y hay 12 m de pista desde el punto de
    // aparicion para cogerla.
    //
    // Y SE SALE ANDANDO. El fondo sube en dos escalones de 40 y 40 cm contra los 42
    // que el personaje trepa solo: quien se cae camina hacia la derecha y sube sin
    // saltar. Un pozo de paredes rectas seria una trampa — y ademas el salto de
    // pared se dispararia contra el lado equivocado y lo dejaria rebotando dentro.
    s(8, -2.2, 1.8, 1.2),                      // fondo del hueco, top -1.0
    s(9.8, -2.2, 0.45, 1.6),                   // escalon, top -0.6
    s(10.25, -2.2, 0.45, 2.0),                 // escalon, top -0.2
    s(10.7, -1, 11.3, 1),                      // sigue el suelo, x 10,7..22

    s(22, -1, 6, 1.4, SURFACE.MADERA),         // escalon, top 0.4
    // hueco 28..34  ->  se cruza por detras
    s(34, -1, 10, 1.4, SURFACE.MADERA),
    // hueco 44..50  ->  segundo cruce
    s(50, -1, 12, 1.4, SURFACE.MADERA),

    // Ruta trasera: dos puentes que salvan los huecos, y la repisa del secreto.
    s(20, -1, 14, 1.4, SURFACE.METAL, 1),      // 20..34, top 0.4

    // ---- el encaje de la caja ----
    //
    // Un hueco con fondo, no un vacio: la caja cae exactamente 0,75 y su tapa queda
    // a ras del suelo (-0,35 + 0,75 = 0,4). Encajada se convierte en parte del
    // camino, que es lo que hace que la solucion se LEA como solucion.
    //
    // 0,95 de ancho para una caja de 0,75: entra sin puntería. Un encaje justo
    // convertiria un puzle de empujar en uno de alinear, que no es lo que ensena.
    //
    // El escalon de la derecha (top 0,0) es la salida: 0,35 desde el fondo y 0,40
    // hasta el suelo, las dos por debajo de los 0,42 que se trepan solos. Asi caerse
    // dentro cuesta dos segundos y no atrapa a nadie.
    s(34, -1.35, 0.95, 1.0, SURFACE.METAL, 1),    // fondo del encaje, top -0.35
    s(34.95, -1.35, 0.4, 1.35, SURFACE.METAL, 1), // escalon de salida, top 0.0
    s(35.35, -1, 2.65, 1.4, SURFACE.METAL, 1),    // 35,35..38

    s(28, 2.6, 6, 0.4, SURFACE.METAL, 1),      // repisa secreta, top 3.0

    // EL RINCON DEL HALLAZGO (tramo 3, `postcombate1`).
    //
    // La franja trasera llegaba a 54 y ahora llega a 62, hasta la misma altura donde
    // termina la etapa 1. No es relleno: es el suelo del unico tramo del nivel donde
    // no hay nada que cumplir. `postcombate1` son 4 compases —8,65 s— que hasta ahora
    // se atravesaban corriendo, y R5 §1.1 los señala como uno de los seis momentos
    // musicales que el diseño no estaba usando.
    //
    // Esta DETRAS a proposito. El objetivo de la etapa 1 termina en la capa 0, asi que
    // para llegar aqui hay que volver a cruzar — la lección de las capas cobrada una
    // segunda vez, y ahora por decision propia en vez de por obligacion.
    s(42, -1, 20, 1.4, SURFACE.METAL, 1),      // 42..62

    // ================= ZONA B · los tejados =================
    // 107 m, de 62 a 169. La medida sale de la aritmetica del runner y esta razonada
    // en la cabecera del nivel: 107 / 6,3 m/s = 17,0 s contra los 17,297 del momento.
    s(62, -1, 10, 1.4, SURFACE.TEJADO),        // top 0.4
    s(74, 0.4, 8, 1.4, SURFACE.TEJADO),        // top 1.8
    s(85, 1.8, 7, 1.4, SURFACE.TEJADO),        // top 3.2
    s(94, 0.6, 9, 1.4, SURFACE.TEJADO),        // top 2.0
    s(106, -1, 8, 1.4, SURFACE.TEJADO),        // top 0.4
    s(116, 1.0, 6, 1.4, SURFACE.TEJADO),       // top 2.4
    s(124, 1.6, 5, 1.4, SURFACE.METAL),        // top 3.0
    s(131, -1, 9, 1.4, SURFACE.TEJADO),
    s(142, 0.8, 7, 1.4, SURFACE.TEJADO),       // top 2.2
    s(152, 2.2, 6, 1.4, SURFACE.TEJADO),       // top 3.6, el punto mas alto
    // EL TEJADO DEL LANZAMIENTO. Aqui acaba el tramo 5 y empieza la caida: es el
    // ultimo suelo antes de los 59 m de vacio hasta la plaza. El arco de meta va
    // encima, sobre suelo firme — que es lo que TDB-002 no cumplia: la meta estaba en
    // x=226, en el hueco de 4 m entre el ultimo tejado y la plaza, y se cumplia EN EL
    // AIRE durante un salto.
    s(161, 0.4, 8, 1.4, SURFACE.TEJADO),       // 161..169, top 1.8

    // Isla trasera SIN portal fijo cerca.
    //
    // Es la razon de ser del portal temporal. Los portales fijos de la zona estan en
    // x=112 y x=150, y por detras no hay nada entre 118 y 146: cruzar por ellos te
    // deja cayendo. La unica forma de llegar aqui es abrir un portal propio desde la
    // repisa de delante (124..129, a la misma altura). Sin un sitio asi, la mecanica
    // existe pero no hace falta nunca.
    s(126, 2.0, 8, 1.0, SURFACE.METAL, 1),      // top 3.0, enfrente de la repisa

    // Atajos por detras: mas cortos, para quien descubre que puede usarlos huyendo.
    // El tercero llegaba hasta 214 y se fue con los tejados que ya no existen.
    s(96, -1, 22, 1.4, SURFACE.METAL, 1),
    s(144, -1, 28, 1.4, SURFACE.METAL, 1),     // 144..172: cubre el portal G

    // ================= ZONA C · la plaza =================
    s(228, -1, 55, 1.4, SURFACE.HIERBA),
    s(266, 2.6, 4, 0.4, SURFACE.METAL),        // repisa del tercer tornillo
    s(233, -1, 22, 1.4, SURFACE.METAL, 1),     // franja trasera de la plaza
  ],

  /**
   * Portales de Idea. Atravesarlos cambia de capa conservando el impulso.
   * Cada uno tiene suelo debajo EN LAS DOS CAPAS: si no, te dejaria cayendo.
   */
  portals: [
    { id: 'A', x: 24.0, y: 0.4, w: 1.1, h: 2.3, bidirectional: true },
    { id: 'B', x: 36.0, y: 0.4, w: 1.1, h: 2.3, bidirectional: true },
    { id: 'C', x: 43.0, y: 0.4, w: 1.1, h: 2.3, bidirectional: true },
    { id: 'D', x: 52.0, y: 0.4, w: 1.1, h: 2.3, bidirectional: true },
    { id: 'E', x: 100.0, y: 0.4, w: 1.1, h: 2.3, bidirectional: true },
    { id: 'F', x: 112.0, y: 0.4, w: 1.1, h: 2.3, bidirectional: true },
    // G estaba en x=150 y era TDB-014: en la capa 0 el hueco va de 149 a 152, asi que
    // cruzar te dejaba cayendo. En 147 hay tejado delante (142..149, top 2,2) y franja
    // detras (144..172, top 0,4): 1,8 m de desnivel, por debajo del salto.
    { id: 'G', x: 147.0, y: 2.2, w: 1.1, h: 2.3, bidirectional: true },
    { id: 'I', x: 238.0, y: 0.4, w: 1.1, h: 2.3, bidirectional: true },
    { id: 'J', x: 252.0, y: 0.4, w: 1.1, h: 2.3, bidirectional: true },
  ],

  /** Coleccionables. Los de la repisa trasera ensenan que la otra capa importa. */
  sparks: [
    /**
     * Chispas GARANTIZADAS antes de cada habilidad.
     *
     * Las de ruta se derivan de los huecos, y al principio del nivel no hay huecos:
     * medido, habia 0 antes de los guantes y 1 antes de las botas. Una habilidad que
     * se desbloquea sin municion para usarla llega muerta — el tutorial dice "pulsa
     * Q" y no pasa nada, que es la peor primera impresion posible.
     *
     * Estas van a mano y con `route: true` para que cuenten como municion.
     */
    { x: 6, y: 1.2, layer: 0, route: true },
    { x: 9, y: 1.6, layer: 0, route: true },    // 2 antes de los guantes (x=16)
    { x: 19, y: 1.3, layer: 0, route: true },
    { x: 21, y: 1.3, layer: 0, route: true },
    { x: 25, y: 1.6, layer: 0, route: true },
    { x: 27, y: 1.6, layer: 0, route: true },   // 4 mas antes de las botas (x=30)
    // Y dos en la propia repisa trasera, para llegar al portal con las 3 que cuesta.
    { x: 29, y: 3.8, layer: 1, route: true },
    { x: 31, y: 3.8, layer: 1, route: true },

    { x: 12, y: 1.4, layer: 0 },
    { x: 30, y: 4.0, layer: 1, secret: true },
    { x: 32, y: 4.0, layer: 1, secret: true },
    { x: 56, y: 1.6, layer: 0 },
    { x: 78, y: 3.2, layer: 0 },
    { x: 88, y: 4.6, layer: 0 },
    { x: 110, y: 1.8, layer: 0 },
    { x: 127, y: 4.4, layer: 0 },
    // Estaba en y=1,6, o sea DENTRO del tejado 142..149 (ocupa de 0,8 a 2,2): no se
    // podia coger. Era TDB-012, y lo encontro el validador, no jugando — porque una
    // chispa incrustada no se ve mal, simplemente no esta.
    { x: 145, y: 3.0, layer: 0 },
    { x: 130, y: 3.7, layer: 1, secret: true },   // solo con portal propio
    { x: 133, y: 3.7, layer: 1, secret: true },
    { x: 155, y: 5.0, layer: 0 },
    // AQUI FALTABA una chispa secreta en x=176, capa 1, sin ninguna plataforma desde
    // la que saltar a ella (TDB-013). Mientras existio, el 100 % era inalcanzable y
    // `closing.perfect` — `BR-08b`, una linea grabada — no podia sonar NUNCA. Se
    // retira con el tramo de tejados que la rodeaba.
    { x: 246, y: 1.6, layer: 1, secret: true },
    { x: 268, y: 4.0, layer: 0 },
    { x: 278, y: 1.6, layer: 0 },
  ],

  /**
   * Tornillos del robot. NO son coleccionables: son piezas suyas que se le cayeron,
   * y por eso esta descontrolado. Cada uno ensena algo distinto (GDD §10.7c).
   */
  /**
   * Props que se recogen y se EQUIPAN. No son coleccionables: cambian lo que el
   * personaje puede hacer, y por eso van colocados donde su habilidad empieza a
   * hacer falta — no antes, o el jugador la tendria sin entender para que.
   *
   * Las botas van en la repisa trasera de la zona A: para cogerlas hay que usar los
   * portales fijos, asi que cuando desbloquean el portal propio el jugador ya sabe
   * lo que es cruzar de capa.
   */
  /**
   * Cajas empujables. NO se rompen: se mueven.
   *
   * Cada una esta puesta a unos metros de un hueco que sin ella no se cruza, para
   * que traerla SEA el puzle. Son metalicas y no de madera, porque el jugador tiene
   * que saber cual va a ceder antes de saltarle encima.
   */
  pushables: [
    // OJO: van AL LADO del hueco, sobre suelo firme, no dentro. Puestas en el vacio
    // se caen antes de que nadie las toque — que es lo que pasaba.
    // 0,75 m: llega por la cintura de un personaje de 1,48. A 1,0 tapaba medio
    // encuadre y parecia un muro en vez de algo que se empuja.
    // La de las botas. Va en la capa TRASERA, sobre el puente, a 5 m del encaje:
    // lejos como para que empujarla sea un trayecto, cerca como para que se vea el
    // encaje desde donde esta. Si no se ve el destino, empujar es a ciegas.
    { x: 29.0, y: 0.4, size: 0.75, layer: 1 },   // se empuja al encaje 34..35,3
    { x: 41.5, y: 0.4, size: 0.75, layer: 0 },   // se empuja al hueco 44..50
    /**
     * AQUI HABIA UNA CAJA EN x=100, para empujarla al hueco 103..106. Se retira
     * porque el tramo 5 pasó a ser un RUNNER y una caja empujable en la linea de
     * carrera deja de ser un puzle: se convierte en un freno.
     *
     * Medido en el navegador con el acelerador bloqueado a 6,3 m/s: al topar con
     * ella el jugador pasa a la velocidad de empuje (1,4 m/s) y recorre 1,2 m/s
     * reales. En un tramo que tiene 17,3 s de musica y ni un segundo de sobra, eso
     * no es un obstaculo, es perder el tramo.
     *
     * Y no hace falta: el hueco 103..106 son 3 m con una bajada de 1,6, y a 6,3 m/s
     * se cruza de un salto con margen. Los verbos del runner son saltar, doble
     * saltar, cambiar de capa y lanzar (GDD §4.1); empujar no esta y no debe estar.
     */
    { x: 262.0, y: 0.4, size: 0.85, layer: 0 },  // la plaza: escalon hacia el robot
  ],

  /**
   * Placas de presion: el hueco tiene fondo, y el fondo es un boton.
   *
   * La cadena es caja → encaje → placa → cae el campo. Tres eslabones visibles, y
   * cada uno con su señal propia: la caja se ve caer, la placa cambia de color, y
   * un haz sube de la placa al campo para que no haya duda de que una cosa causa
   * la otra. Un boton que abre algo fuera de pantalla no ensena nada.
   *
   * `unlocks` cruza con el `locked` del prop. Es lo unico que las ata: nadie tiene
   * que saber donde esta el otro.
   */
  plates: [
    { x: 34.475, y: -0.35, w: 0.95, layer: 1, unlocks: 'botas' },
  ],

  /**
   * Rompibles: cajas, barriles y macetas repartidos por el camino.
   *
   * Van donde el tramo es plano y no pasa nada — que es justo donde el nivel se
   * moria. Algunos tapan el paso lo justo para obligar a saltarlos o romperlos;
   * otros son decorativos y solo estan para que el sitio se sienta habitado.
   */
  breakables: [
    // Zona A: los primeros, para enseñar el verbo en terreno seguro.
    // DESPUES del hueco, no encima. Estaban en x=9 y x=10, que era suelo firme hasta
    // que ese tramo paso a ser el hueco que enseña a saltar: se quedaron flotando en
    // el aire sobre el vacio. Aqui apoyan en el suelo de 10,7..22.
    { x: 13, y: 0, kind: 'caja', layer: 0 },
    { x: 14.2, y: 0, kind: 'caja', layer: 0 },
    /**
     * LA CAJA DEL PRIMER DISPARO.
     *
     * Puesta a 8,5 m de los guantes (x=16), que es exactamente el alcance del
     * lanzamiento rapido. El tutorial dice "pulsa Q", el jugador pulsa mirando al
     * frente, y la Chispa aterriza en esta caja: aprende de una vez que se lanza,
     * que las cajas revientan y que sueltan recompensa — sin una linea de texto.
     *
     * Si se mueve el pickup de guantes o el alcance del tiro, hay que mover esta.
     */
    { x: 24.5, y: 0, kind: 'caja', layer: 0 },
    { x: 17, y: 0, kind: 'maceta', layer: 0 },
    { x: 37, y: 0.4, kind: 'barril', layer: 0 },
    // Apiladas, y AQUI y no al principio: para llegar ya se tienen los guantes, asi
    // que se pueden reventar de arriba abajo. Puestas antes eran un muro de 1,8 m
    // justo detras del hueco que enseña a saltar, y solo se pasaban trepandolas.
    { x: 53, y: 0.4, kind: 'caja', layer: 0 },
    { x: 53, y: 1.3, kind: 'caja', layer: 0 },
    { x: 54.4, y: 0.4, kind: 'maceta', layer: 0 },
    // Zona B: en los tejados, donde el dron aprieta. Romper cuesta tiempo.
    { x: 68, y: 0.4, kind: 'caja', layer: 0 },
    { x: 88, y: 3.2, kind: 'barril', layer: 0 },
    { x: 109, y: 0.4, kind: 'caja', layer: 0 },
    { x: 137, y: 0.4, kind: 'maceta', layer: 0 },
    { x: 165, y: 1.8, kind: 'caja', layer: 0 },
    // Zona C: en la plaza, y el robot los revienta de paso con su pisoton.
    { x: 240, y: 0.4, kind: 'caja', layer: 0 },
    { x: 252, y: 0.4, kind: 'barril', layer: 0 },
    { x: 266, y: 0.4, kind: 'maceta', layer: 0 },
    { x: 280, y: 0.4, kind: 'caja', layer: 0 },
  ],

  props: [
    // Los guantes van PRIMERO y en la ruta principal: lanzar es el verbo que mas se
    // usa, asi que hay que tenerlo pronto. Las botas van despues y escondidas,
    // porque abrir portales es la recompensa de haber entendido las capas.
    { id: 'guante', x: 16, y: 1.2, layer: 0,
      label: 'Guantes del Proyector', hint: 'Ya puedes lanzar Chispas · Q rápido · F cargado' },
    // Las botas NO se cogen corriendo. Estan dentro de un campo de energia que solo
    // cae al encajar la caja en el hueco de abajo. Correr y saltar ya no bastan: hay
    // que entender que las cosas del Proyector se mueven y sirven para algo. Es el
    // sitio exacto para introducir el empuje, porque la recompensa —abrir portales
    // propios— es la habilidad mas grande del nivel y tiene que costar un verbo.
    { id: 'botas', x: 30, y: 3.4, layer: 1, locked: 'botas',
      label: 'Botas del Cañón', hint: 'Ahora puedes abrir tus propios portales · R',
      lockedHint: 'Encaja la caja en el hueco para bajar el campo' },
    // En la isla trasera de x=126..134, a la que SOLO se llega abriendo un portal
    // propio. Es la unica recompensa del nivel que mejora al personaje, y por eso
    // esta detras del unico desvio que exige entender las dos mecanicas.
    { id: 'motor', x: 130, y: 3.6, layer: 1,
      label: 'Motor de Idea', hint: '+25 % de carrera · recarga a la mitad · rompibles dan el doble' },
  ],

  screws: [
    /**
     * EL TORNILLO DE REPUESTO — a 217 m de donde hace falta, y ENTERRADO.
     *
     * Es lo unico del principio del nivel que sirve para el final: no da un numero,
     * quita el reto mas dificil del climax. El tercer tornillo de la plaza es el que
     * hay que arrancarle al robot esquivando en el pulso exacto (GDD §25.6); quien
     * encuentre este llega con dos puestos y puede reparar sin pasar por ese timing.
     *
     * Es exactamente el trato que pide el cuento: la curiosidad no da poder, da
     * margen.
     *
     * ESTABA EN LA REPISA DE x=31 Y SE RECOGIA AL PASAR. Se movio aqui, al rincon
     * trasero del tramo 3, por la regla de R5 §4: *llegar al sitio no es la
     * recompensa, el ultimo esfuerzo lo es*. Antes bastaba con caminar por encima.
     * Ahora hay una grieta, hay que romperla con `stomp`, y solo entonces sale.
     *
     * `buried` significa que no existe hasta que su `diggable` se abre.
     */
    { x: 57, y: 0.9, layer: 1, teaches: 'secreto', spare: true, buried: 'repuesto' },

    { x: 244, y: 0.6, layer: 1, teaches: 'cruzar' },    // solo desde la capa trasera
    { x: 260, y: 0.6, layer: 0, teaches: 'empujar' },   // en el suelo de la plaza
    { x: 268, y: 3.4, layer: 0, teaches: 'timing' },    // en alto: doble salto
  ],

  /**
   * GRIETAS · el gesto de cobro (GDD §7, R5 §4).
   *
   * Tres tiempos, y los tres tienen que existir o el descubrimiento no se siente
   * ganado: **promesa** (el sitio se ve distinto: rim light y ping al entrar en
   * radio), **gesto** (una accion del jugador, aqui `stomp`) y **cobro** (hitstop,
   * particulas, onda, viñeta y sonido).
   *
   * El motor no tenia el eslabon del medio: `stomp` estaba horneado y en el set de
   * gameplay desde el principio, y **no habia ningun estado que lo usara**. Esta es
   * la mecanica que lo enciende.
   *
   * Y es, a proposito, la muestra de la parte NO COREOGRAFIADA del nivel: ocurre en
   * `postcombate1`, en regimen `ambiental`, donde nada esta cuantizado al compas y el
   * jugador manda sobre el reloj.
   */
  diggables: [
    {
      id: 'repuesto',
      x: 57, y: 0.4, layer: 1, radius: 2.0,
      reveals: 'repuesto',
      prompt: 'Romper el suelo',
      logro: 'curiosidad',
    },
  ],

  /** Donde esta el robot descalibrado. Acercarse con los tornillos lo repara. */
  robot: { x: 274, y: 0, radius: 3.2, holdBars: 1 },

  checkpoints: [
    { x: 2, y: 1.2, layer: 0 },
    { x: 24, y: 1.0, layer: 0 },
    { x: 40, y: 1.0, layer: 0 },
    { x: 56, y: 1.0, layer: 0 },
    { x: 66, y: 1.0, layer: 0 },
    { x: 80, y: 2.4, layer: 0 },
    { x: 98, y: 2.6, layer: 0 },
    { x: 110, y: 1.0, layer: 0 },
    { x: 134, y: 1.0, layer: 0 },
    { x: 145, y: 2.2, layer: 0 },
    { x: 164, y: 1.8, layer: 0 },
    // Los de x=176, 196 y 217 se fueron con los tejados que ya no existen. Y ademas
    // sobraban por diseño: el de 217 estaba a 9 m de la meta de la etapa 2, asi que
    // fallar la carrera una vez la convertia en un paseo de 0,52 m/s (TDB-003).
    // Ahora el tramo 5 se reintenta ENTERO — ver `stages[1].retry`.
    { x: 232, y: 1.0, layer: 0 },
    { x: 256, y: 1.0, layer: 0 },
  ],

  markers: [0, 20, 40, 60, 80, 100, 120, 140, 160, 230, 250, 270],

  /**
   * Etapas: atan cada momento con loop a un objetivo de gameplay.
   *
   * ESTO es lo que Unity nunca conecto. Alli el loop se activaba y no lo soltaba
   * nadie; aqui la musica se queda dando vueltas en su seccion hasta que cumples el
   * objetivo, y solo entonces avanza. Es la "sincronizacion por etapas" del titulo.
   *
   * OJO: solo `combate1` y `combate2` tienen loop. `climax_salvaje` no, asi que es
   * lineal por diseno — una carrera de una sola tirada, no un reto de aguantar.
   */
  stages: [
    /**
     * TRAMO 1 · Primeros pasos — `precombate1`, compases 9-12.
     *
     * Regimen AMBIENTAL y sin objetivo: es la primera victoria del jugador, y es la
     * pieza que R5 §2.2 señalaba como la que falta. Hasta ahora el primer objetivo
     * del nivel era `crossAndReturn` —cruzar de capa Y volver, dos pasos— antes de
     * que el jugador hubiera ganado nada. Este tramo compra el credito con el que
     * pedir eso: un hueco, dos chispas marcando el arco, y ya.
     *
     * No declara `objective` a proposito. Una etapa sin objetivo no retiene ni suelta
     * nada; solo fija el regimen, la camara y el ambiente. Su momento no tiene loop,
     * asi que la musica pasa sola al cabo de 8,65 s.
     */
    {
      id: 'tramo1',
      moment: 'precombate1',
      label: 'Primeros pasos',
      regimen: 'ambiental',
      // El diorama: lejos, teleobjetivo, todo plano. Es la vista "de casa".
      vista: { dist: 16, fov: 28, lead: 2.6, corners: 0.30, cornerPulse: 0.25,
               cornerTint: 0x0a0a1e, aberration: 0.35 },
    },
    {
      id: 'etapa1',
      moment: 'combate1',
      label: 'La habitación imaginada',
      regimen: 'coreografiada',
      // Se acerca un poco y el marco se cierra: el reto encuadra.
      vista: { dist: 14.5, fov: 30, lead: 2.6, corners: 0.48, cornerPulse: 0.55,
               cornerTint: 0x120a2e, aberration: 0.7 },
      // GDD §10.7c: el camino de delante esta cortado. Hay que cruzar por detras
      // Y VOLVER al frente. Volver es parte del objetivo, no un extra.
      // La puerta: el bucle no se cierra hasta llegar aqui. El primer hueco esta en
      // x=28, asi que hasta ese punto el jugador solo esta viniendo — retener la
      // musica antes gastaria el bucle en el camino en vez de en el reto.
      gate: { x: 26 },
      // Escenario de la etapa. El cambio ocurre al entrar (transicion T-05).
      scenario: './public/scenario/habitacion/scenario.json',
      // Trance: el mundo se esta imaginando, y eso hay que NOTARLO.
      transition: 'trance',
      objective: {
        type: 'crossAndReturn', x: 60, layer: 0,
        label: 'El paso está cortado: busca el otro lado',
      },
      encourage: { at3: 'BR-04b', at6: 'BR-04c' },
      onClear: { first: 'BR-04a', retry: 'BR-04d', late: 'BR-04d' },
      logro: 'el-otro-lado',
    },

    /**
     * TRAMO 3 · El hallazgo — `postcombate1`, compases 21-24.
     *
     * Regimen AMBIENTAL, sin objetivo, sin enemigo y sin cronometro. Es el aire de la
     * curva de interes (R5 §1) y **la muestra de la parte no coreografiada**: aqui
     * nada cae en el compas, manda la reactividad fisica de las cosas.
     *
     * Lo que hay es una grieta y un tornillo debajo. Nadie lo dice.
     */
    {
      id: 'tramo3',
      moment: 'postcombate1',
      label: 'El hallazgo',
      regimen: 'ambiental',
      // El plano se abre y el marco se suelta: aqui no hay reto que encuadrar, hay
      // sitio que mirar. Es la vista mas abierta del nivel antes de la bisagra.
      vista: { dist: 18, fov: 26, lead: 2.0, corners: 0.14, cornerPulse: 0.12,
               cornerTint: 0x0d1030, aberration: 0.25 },
      transition: 'push',
      onClear: { first: null },
    },

    /**
     * TRAMO 5 · Los tejados — `climax_salvaje`, compases 26-33.
     *
     * RUNNER CON ACELERADOR BLOQUEADO. Es la decision del GDD §4.1 y la que cierra
     * TDB-001, 002 y 003 de una vez, porque los tres eran el mismo problema: la etapa
     * pedia 164 m en 17,3 s —9,48 m/s con 6,0 disponibles— y no se fallaba, se
     * atropellaba.
     *
     * En un runner **el juego fija la velocidad**, asi que la distancia deja de
     * depender de lo bien que corra el jugador y pasa a ser una decision de ritmo.
     * 107 m a 6,3 m/s son 17,0 s contra los 17,297 del momento.
     *
     * Lo que el jugador SIGUE controlando: saltar, doble salto, cambiar de capa y
     * lanzar chispas al dron. Solo se le quita el acelerador. Esa es exactamente la
     * diferencia entre un runner y un video.
     */
    {
      id: 'etapa2',
      moment: 'climax_salvaje',
      label: 'Los tejados',
      regimen: 'coreografiada',
      // LA VISTA CAMBIA DE VERDAD AQUI, y es el cambio de perspectiva mas grande del
      // nivel: `fov` 28 -> 36 y `dist` 16 -> 13. Con teleobjetivo (28) las capas se
      // aplanan y el nivel se lee como un diorama; con gran angular (36) el suelo se
      // abre bajo los pies y los tejados se van hacia el punto de fuga. Es la misma
      // escena y no lo parece — que es lo que se pide de un cambio de etapa.
      vista: { dist: 13, fov: 36, lead: 4.2, corners: 0.62, cornerPulse: 0.9,
               cornerTint: 0x2a1006, aberration: 1.0 },
      /**
       * VIENTO. Partículas extruidas: motas estiradas en el sentido en que se mueven.
       *
       * Va hacia atrás (`dirX: -1`) porque el jugador corre hacia delante, y un poco
       * hacia arriba porque se corre por tejados. El tinte es cálido, no azul: aquí
       * el aire lleva el naranja del contraluz, y una estela azul sobre un cielo
       * naranja se lee como un error de material.
       *
       * Es el único tramo del nivel que lo declara. Un efecto que se usa en todos los
       * momentos deja de significar algo — y este significa "vas rápido".
       */
      viento: { fuerza: 0.85, dirX: -1, dirY: 0.18, tinte: 0xffcfa0 },
      scenario: './public/scenario/caprilopolis/scenario.json',
      // Barrido: los tejados son puro impulso, no desconcierto.
      transition: 'whip',
      /**
       * EL ACELERADOR BLOQUEADO.
       *
       *   `speed`      velocidad autoral, en m/s
       *   `from`       donde arranca el tramo
       *   `startBars`  cuanto espera antes de tirar del personaje
       *
       * `startBars` NO es decoracion y **se descuenta del presupuesto**. El tramo
       * entra con una transicion `whip` de 1,5 compases, y una transicion es un truco
       * de camara que no quita el control: sin esta espera el personaje echaba a
       * correr durante el barrido, con la camara todavia girando y sin haber vuelto
       * sobre el. Se veia salir corriendo antes de que existiera el plano.
       *
       * Ese compas y medio es ademas el que el guion pide (tramo 5, compas 26): la
       * camara se cierra y se pone detras, Bradislav dice "¡Corre y no mires atras!"
       * y el dron se suelta. Es el arranque, no tiempo perdido.
       *
       * De ahi sale la aritmetica, y es la que comprueba `tests/level.test.mjs`:
       *
       *   ventana util = 17,297 − 1,5 × 2,1622 = 14,054 s
       *   distancia    = 165 − 62              = 103 m
       *   exige        = 103 / 14,054          = 7,33 m/s
       *   se declara                             7,60 m/s  (3,8 m de margen)
       *
       * 7,6 y no 6,3 —que era el numero de antes de descontar el arranque— convierte
       * el tramo en una carrera de verdad: es un 27 % por encima de la carrera maxima
       * del jugador, que es lo que hace que se sienta prestado y no suyo.
       */
      runner: { speed: 7.6, from: 62, startBars: 1.5 },
      objective: { type: 'reachX', x: 165, goal: true, label: 'Corre. No mires atrás' },
      chaser: true,
      rewindTo: 'climax_salvaje',   // al fallar, la carrera reinicia en su compas
      /**
       * Y EL JUGADOR TAMBIEN VUELVE AL PRINCIPIO. Era TDB-003: la musica rebobinaba
       * al compas 26 y el jugador reaparecia en su ultimo checkpoint —x=217, a 9 m de
       * una meta en 226—, asi que la carrera pasaba de imposible a trivial en un solo
       * fallo. "Reintentar" significaba dos cosas distintas en cada eje.
       *
       * Con velocidad autoral el reintento reinicia el TRAMO ENTERO, que es lo unico
       * coherente: si el juego fija la velocidad, la unica variable es el trayecto.
       */
      retry: { x: 64, y: 1.0, layer: 0 },
      encourage: { at1: 'BR-06b', at3: 'BR-06c' },
      onClear: { first: 'BR-06d', retry: 'BR-06a' },
      logro: 'sin-un-rasguno',
    },
    {
      id: 'etapa3',
      moment: 'combate2',
      label: 'La plaza',
      regimen: 'coreografiada',
      // Teleobjetivo cerrado (24) y la camara lejos: aplana el fondo y hace que el
      // robot ocupe. Es lo contrario exacto de los tejados, y por eso se nota.
      vista: { dist: 21, fov: 24, lead: 1.8, corners: 0.40, cornerPulse: 0.45,
               cornerTint: 0x140a20, aberration: 1.2 },
      // GDD: no son coleccionables, son piezas del robot que hay que devolverle.
      // La plaza empieza en 228 y el robot esta en 274. El bucle se cierra al pisar
      // la plaza, no al cambiar la musica.
      gate: { x: 236 },
      scenario: './public/scenario/plaza/scenario.json',
      // Vertigo: es donde algo va mal, y ese plano solo se usa aqui.
      transition: 'vertigo',
      objective: { type: 'repair', screws: 3, label: 'Devuélvele sus tres tornillos' },
      onClear: { first: 'BO-06' },
      logro: 'manitas',
    },

    /**
     * TRAMO 8 · Cierre — `postcombate2`, compases 43-49.
     *
     * 15,14 s de resolucion que hasta ahora eran solo cartelon. Regimen ambiental: se
     * puede seguir andando mientras la musica se abre y el sol termina de bajar.
     */
    {
      id: 'tramo8',
      moment: 'postcombate2',
      label: 'Cierre',
      regimen: 'ambiental',
      vista: { dist: 17, fov: 27, lead: 2.2, corners: 0.20, cornerPulse: 0.35,
               cornerTint: 0x1a1030, aberration: 0.5 },
    },
  ],

  /**
   * AMBIENTE POR MOMENTO — antes `MOMENT_LOOK` en `game.js:42`.
   *
   * Se mueve aqui para cerrar TDB-005. La cabecera de `d_director.js` declaraba
   * textualmente que "todo se declara en datos, no en codigo, para poder montar los
   * mundos siguientes sin tocar el motor", y estas dos tablas eran la unica cosa del
   * nivel que lo contradecia: montar el mundo 2 obligaba a editar `game.js`.
   *
   * Los valores de `bloom` son los de Unity/URP y NO mapean 1:1 con
   * `UnrealBloomPass`. La conversion vive en un solo sitio y documentada:
   * `PostFX.BLOOM_URP_TO_THREE`.
   */
  ambientes: {
    presentacion:         { key: 0xfff0d8, intensity: 2.2, rim: 0.8, fog: 0x050a2e, shake: 0.00, bloom: 0.0, grain: 0.08, distortion: 0.00 },
    precombate1:          { key: 0xffe0c0, intensity: 2.6, rim: 1.2, fog: 0x0a0f38, shake: 0.02, bloom: 1.5, grain: 0.20, distortion: 0.05 },
    combate1:             { key: 0xffd8b0, intensity: 3.0, rim: 1.6, fog: 0x101545, shake: 0.05, bloom: 0.5, grain: 0.28, distortion: 0.00 },
    postcombate1:         { key: 0xfff4e2, intensity: 2.4, rim: 0.9, fog: 0x070c33, shake: 0.00, bloom: 1.5, grain: 0.16, distortion: 0.00 },
    contraste_pre_climax: { key: 0x9fb4ff, intensity: 0.9, rim: 0.3, fog: 0x03061c, shake: 0.00, bloom: 0.0, grain: 0.10, distortion: 0.00 },
    // Contraluz (TDB-027): luz calida y baja, niebla violeta, rim alto. Es lo que
    // recorta la silueta contra el cielo naranja y deja los `POWER_COLORS` emisivos
    // como lo unico con color del cuadro — la mecanica se vuelve lo mas visible.
    climax_salvaje:       { key: 0xffc890, intensity: 4.2, rim: 2.4, fog: 0x1a1050, shake: 0.14, bloom: 4.0, grain: 0.50, distortion: 0.15 },
    contraste_oscuro:     { key: 0x6070c0, intensity: 0.7, rim: 0.4, fog: 0x02040f, shake: 0.10, bloom: 0.5, grain: 0.22, distortion: 0.00 },
    combate2:             { key: 0xffcf9a, intensity: 3.2, rim: 1.9, fog: 0x14103f, shake: 0.07, bloom: 0.5, grain: 0.32, distortion: 0.05 },
    postcombate2:         { key: 0xffd9a0, intensity: 2.0, rim: 0.7, fog: 0x120a2e, shake: 0.00, bloom: 1.0, grain: 0.18, distortion: 0.00 },
  },

  /**
   * ENCUADRE POR MOMENTO — antes `MOMENT_ZOOM` en `game.js:64`.
   *
   * `dist` es la distancia objetivo; con `dolly` la FOV compensa para conservar
   * `d · tan(fov/2)`, asi que el personaje mantiene su tamaño y lo que se deforma es
   * el fondo. `hold` es cuanto se queda antes de volver.
   *
   * Eran 4 de 9. Faltaban los cinco de los tramos que no existian, y R5 §1.1 lo
   * señalaba como la prueba de que alguien ya habia pensado el encuadre de cada
   * momento y solo faltaba ponerlo.
   */
  encuadres: {
    // La primera victoria: la camara se acerca un poco al recoger la primera chispa.
    precombate1:          { dist: 14.0, dolly: false, seconds: 1.4, hold: 0 },
    // El hallazgo: se abre para que se vea que hay un rincon aparte del camino.
    postcombate1:         { dist: 19.0, dolly: false, seconds: 1.6, hold: 1.2 },
    // Se abre de golpe: aqui es donde se ve Caprilopolis entera (GDD §19.1).
    contraste_pre_climax: { dist: 26.0, dolly: false, seconds: 1.6, hold: 2.2 },
    // La carrera: la camara se acerca y aprieta el encuadre.
    climax_salvaje:       { dist: 15.0, dolly: false, seconds: 1.2, hold: 0 },
    // La caida: dolly zoom puro. El fondo se abalanza.
    contraste_oscuro:     { dist: 11.0, dolly: true,  seconds: 0.9, hold: 1.4 },
    // La plaza: se abre otra vez para que quepa el robot.
    combate2:             { dist: 20.0, dolly: false, seconds: 1.4, hold: 0 },
    // El cierre: se retira despacio, que es como termina un plano.
    postcombate2:         { dist: 18.0, dolly: false, seconds: 2.2, hold: 0 },
  },

  /**
   * Cinematicas. Duran un numero ENTERO de compases y acaban en downbeat, porque
   * la musica no se detiene nunca (plan §19.4).
   */
  cinematics: [
    {
      moment: 'presentacion',
      bars: 5,                    // 10,81 s: acaba en downbeat
      label: 'Bradislav enciende el Proyector',

      // Actores que existen solo durante la cinematica.
      actors: [
        { name: 'bradislav', x: 7.4, y: 0, face: -1, idle: 'entering_code' },
      ],

      /**
       * Pista de la cinematica de apertura (GDD §10.10 #1):
       * Bradislav teclea, el Proyector se enciende, Borislov entra en trance y el
       * mundo se disuelve. Los tiempos estan cuantizados a pulsos de 0,54 s.
       */
      track: [
        { at: 0.0, camera: { x: 6.2, y: 1.5, distance: 9, seconds: 0.1 } },
        { at: 0.0, actor: 'bradislav', anim: 'entering_code', face: -1 },
        { at: 0.0, actor: 'player', anim: 'happy_idle', face: 1 },
        { at: 0.4, say: 'BR-01' },

        { at: 2.7, camera: { x: 4.4, y: 1.4, distance: 11, seconds: 1.6 } },
        { at: 3.2, actor: 'player', anim: 'walking', move: { toX: 5.6, seconds: 2.6 } },

        { at: 6.2, say: 'BO-01' },
        { at: 6.2, actor: 'player', anim: 'happy_idle' },
        { at: 6.5, actor: 'bradislav', anim: 'wide_arm_spell_casting', loop: false },

        // El Proyector arranca: destello, onda y DOLLY ZOOM. La camara se acerca
        // mientras la FOV se abre, asi Borislov mantiene su tamano y lo que se
        // deforma es la ciudad detras. Es el plano de "el mundo acaba de cambiar".
        { at: 7.6, fx: 'projector_on' },
        { at: 7.6, actor: 'player', anim: 'surprised', loop: false },
        { at: 7.6, camera: { x: 5.6, y: 1.3, distance: 6.5, seconds: 1.6, dolly: true } },

        { at: 9.4, camera: null },   // devolver la camara al jugador
      ],
    },

    /**
     * #2 EL PRIMER PORTAL (GDD §10.10). Se dispara POR POSICION, al llegar al arco:
     * una escena que explica el arco no puede sonar antes de tenerlo delante.
     *
     * Bradislav lo activa a distancia — el gesto es `wide_arm_spell_casting`, que en
     * el canon del cuento no es magia sino manejar el Proyector que el construyo.
     */
    {
      id: 'portal',
      atX: 21.0,
      bars: 3,                    // 6,49 s
      label: 'Bradislav activa el Portal de Idea',
      actors: [
        { name: 'bradislav', x: 16.0, y: 0, face: 1, idle: 'entering_code' },
      ],
      track: [
        // Se abre al arco, no al personaje: es el arco lo que hay que mirar.
        { at: 0.0, camera: { x: 22.5, y: 1.9, distance: 11, seconds: 0.8 } },
        { at: 0.0, actor: 'player', anim: 'surprised', face: 1 },
        { at: 0.3, say: 'BR-03' },

        // Bradislav abre los brazos y el arco responde.
        { at: 1.6, actor: 'bradislav', anim: 'wide_arm_spell_casting', loop: false },
        { at: 2.4, fx: 'portal-on' },
        { at: 2.4, camera: { x: 23.5, y: 1.7, distance: 7.5, seconds: 1.2, dolly: true } },

        // Y Borislov reacciona como el critico de juegos que es.
        { at: 4.0, actor: 'player', anim: 'left_strafe', face: 1 },
        { at: 4.2, say: 'BO-02' },

        { at: 5.6, camera: null },
      ],
    },

    /**
     * #3 EL ROBOT SE LEVANTA (GDD §19.1, `contraste_oscuro`).
     *
     * Tambien por posicion: se dispara al pisar la plaza, no al cambiar la musica.
     * Es el unico plano del nivel que da miedo, y dura un compas mas que los otros
     * porque necesita el silencio antes del golpe.
     */
    {
      id: 'robot',
      atX: 248.0,
      bars: 4,                    // 8,65 s
      label: 'El robot descalibrado se levanta',
      track: [
        { at: 0.0, actor: 'player', anim: 'nervously_look_around', face: 1 },
        { at: 0.0, camera: { x: 258, y: 1.6, distance: 15, seconds: 1.0 } },

        // Se levanta: golpe, sacudida y onda desde su sitio.
        { at: 1.6, fx: 'robot-rise' },
        { at: 1.6, camera: { x: 268, y: 3.4, distance: 20, seconds: 1.4 } },
        { at: 2.2, actor: 'player', anim: 'scared', face: 1 },
        // Aqui habia un `say: 'BO-05'` y era una de las cuatro lineas declaradas dos
        // veces (GUION §1.1). Como una linea nunca se repite en la misma partida, la
        // segunda ocurrencia se tragaba EN SILENCIO. Su sitio es el otro: BO-05 es
        // "¡Ay! ¡Bradislav, esa cosa es enorme!" y suena cuando el dron acierta, en
        // `contraste_oscuro`, no cuando se levanta el robot.

        // Dolly zoom sobre el: el fondo se abalanza y el robot no cambia de tamaño.
        { at: 4.2, camera: { x: 268, y: 2.6, distance: 11, seconds: 1.6, dolly: true } },
        { at: 5.0, say: 'BR-07' },

        { at: 7.8, camera: null },
      ],
    },

    /**
     * #4 LA CAIDA (GDD §4.2, GUION tramo 6) — `contraste_oscuro`, 1 compas.
     *
     * El set piece que ata el runner con el climax, y la respuesta a "el tramo 5
     * termina en un suceso, no en una coordenada" (TDB-002). El dron embiste, Borislov
     * sale despedido, y **el aterrizaje cae en el downbeat del compas 35** — que es
     * exactamente donde arranca `combate2` y el robot. El golpe de aterrizar ES el
     * golpe que abre la musica del jefe.
     *
     * Ocupa un momento que estaba vacio, asi que no cuesta tiempo musical: lo
     * recupera. Y cubre los 59 m de vacio entre el ultimo tejado (169) y la plaza
     * (228) sin que el jugador tenga que recorrerlos, que es lo que permitio acortar
     * la zona B de 164 m a 107.
     *
     * ⚠️ ES LA CUARTA TECNICA VISUAL y la constitucion obliga a justificarla. Queda
     * justificada: es la unica forma de cubrir una caida sin cortar la camara, y de
     * paso usa los clips `jumping_up_on_air` y `falling_to_roll`, que llevaban
     * horneados desde el principio sin que nadie los llamara (TDB-021).
     *
     * `setPiece` le dice al motor que ademas de la pista hay una rutina propia: el
     * desplazamiento vertical del parallax, la suspension de la gravedad y el traslado
     * a la plaza. Los datos declaran QUE pasa; el motor sabe COMO.
     */
    {
      id: 'caida',
      moment: 'contraste_oscuro',
      bars: 1,                    // 2,16 s: acaba en el downbeat del 35
      label: 'El dron lanza a Borislov',
      setPiece: 'caida',
      /**
       * La pista va en pulsos del compas 34 (0,5405 s cada uno):
       *
       *   34.0  el dron acierta. Sale despedido y el fondo empieza a subir
       *   34.1  clip de caida en bucle. El desenfoque vertical crece
       *   34.2  EL CORTE — los 65 m hasta la plaza, tapados por el fogonazo
       *   34.3  el fondo frena. El sigue un instante suspendido
       *   35.0  se suelta. `falling_to_roll` e impacto, en el downbeat
       */
      track: [
        // La camara SE QUEDA y el personaje cae dentro del cuadro. Es la regla del
        // plano: mover la camara con el sujeto anula la sensacion de caida.
        { at: 0.0, actor: 'player', anim: 'stumble_backwards', loop: false, face: 1 },
        { at: 0.0, fx: 'caida-inicio' },
        { at: 0.55, actor: 'player', anim: 'jumping_up_on_air', loop: true },
        { at: 1.10, fx: 'caida-salto' },     // el traslado, en el pulso ilegible
        { at: 1.62, fx: 'caida-frenada' },   // el fondo se para y el jugador sigue
        { at: 2.10, fx: 'caida-impacto' },   // downbeat del 35
        { at: 2.10, actor: 'player', anim: 'falling_to_roll', loop: false },
      ],
    },
  ],

  /**
   * LOGROS.
   *
   * R5 §3 tenia el eslabon de "progresion" en amarillo con una nota exacta: *existe
   * (guantes -> botas -> motor) pero NO SE ANUNCIA*. No habia logros, ni persistencia,
   * ni resumen hasta el cartelon final, asi que el jugador hacia cosas dificiles y el
   * juego no se enteraba.
   *
   * Cada logro trae su **compensacion**: algo que el jugador se lleva, no solo un
   * cartel. Es la diferencia entre reconocer y recompensar, y es lo que evita que un
   * logro sea un `console.log` con animacion.
   *
   *   `da`      qué entrega — `chispas` (municion) o `recarga` (adelanta cooldowns)
   *   `cuando`  quien lo dispara, para poder buscarlo en el codigo
   */
  logros: {
    'primera-chispa': {
      titulo: 'Primera idea',
      sub: 'La cogiste al vuelo',
      da: { chispas: 1 },
      cuando: 'la primera chispa recogida en el aire, sobre un hueco',
    },
    'el-otro-lado': {
      titulo: 'El otro lado',
      sub: 'Cruzaste y volviste',
      da: { chispas: 2 },
      cuando: 'objetivo de la etapa 1 cumplido',
    },
    curiosidad: {
      titulo: 'La curiosidad da margen',
      sub: 'Encontraste el tornillo de repuesto',
      // La compensacion de verdad de este no es la municion: es que el climax se
      // vuelve mas facil. La municion es el acuse de recibo.
      da: { chispas: 3 },
      cuando: 'romper la grieta del tramo 3',
    },
    'sin-un-rasguno': {
      titulo: 'Sin un rasguño',
      sub: 'Los tejados a la primera',
      da: { recarga: true },
      cuando: 'etapa 2 superada sin que el dron te atrape',
    },
    manitas: {
      titulo: 'Manitas',
      sub: 'Le devolviste los tres tornillos',
      da: { chispas: 3 },
      cuando: 'objetivo de la etapa 3 cumplido',
    },
    coleccionista: {
      titulo: 'Coleccionista de ideas',
      sub: 'Todas las chispas secretas',
      da: { chispas: 5 },
      cuando: 'todas las chispas `secret` recogidas',
    },
  },

  /**
   * Beats de dialogo: `at` son segundos desde que empieza su momento.
   * La mayoria suenan MIENTRAS juegas; solo los de la cinematica te quitan el control.
   */
  beats: [
    // presentacion no lleva beats: su dialogo va dentro de la pista de la cinematica.
    { moment: 'precombate1', at: 0.3, say: 'BR-02' },

    /**
     * `combate1` SE QUEDA SIN BEATS, y es una correccion, no un recorte.
     *
     * Tenia `BR-03` a los 0,4 s y `BO-02` a los 9,0, y las dos estan ya en la pista de
     * la cinematica `portal` (a 0.3 y 4.2). Como una linea nunca se repite en la misma
     * partida, el segundo `say` **no sonaba**: se tragaba en silencio. Eran dos de las
     * cuatro lineas duplicadas del GUION §1.1.
     *
     * Y el sitio bueno es la cinematica: `BR-03` acompaña el GESTO de Bradislav
     * activando el arco, y `BO-02` llega DESPUES de que el jugador cruce — confirma lo
     * que acaba de sentir en vez de instruirle. Como beat suelto, `BO-02` podia sonar
     * antes de haber cruzado.
     */

    /**
     * `postcombate1` no lleva dialogo de descubrimiento. **El silencio es la
     * recompensa**: el jugador encontro algo que el juego no le habia pedido, y una
     * voz explicandoselo se lo quita (GUION tramo 3).
     *
     * `BR-11` es lo unico que suena, y al final del momento: es el aviso de guardado,
     * no un comentario del hallazgo.
     */
    { moment: 'postcombate1', at: 7.6, say: 'BR-11' },

    // La bisagra: 2,16 s y dos lineas que ya estan grabadas. `BO-04` —"…¿Y eso?"—
    // hace el trabajo de una cinematica entera: presenta al dron sin cinematica.
    { moment: 'contraste_pre_climax', at: 0.2, say: 'BO-03' },
    { moment: 'contraste_pre_climax', at: 1.3, say: 'BO-04' },

    { moment: 'climax_salvaje', at: 0.3, say: 'BR-05' },

    // El dron acierta. Su sitio es este y no la cinematica del robot, donde estaba
    // duplicada: "esa cosa es enorme" se dice del dron que te acaba de tirar.
    { moment: 'contraste_oscuro', at: 0.15, say: 'BO-05' },

    /**
     * `combate2` tampoco lleva beat.
     *
     * Tenia `BR-07` a los 0,6 s y esta en la pista de la cinematica `robot` (at 5.0),
     * que es la cuarta linea duplicada. La cinematica es el sitio correcto: `BR-07`
     * —"¡No lo golpees! Esta descalibrado, tiene miedo"— es el giro moral del nivel y
     * tiene que llegar DESPUES de ver al robot levantarse, no antes.
     */

    { moment: 'postcombate2', at: 1.2, say: 'BO-07' },
  ],

  finalMoment: 'postcombate2',
  closing: { normal: 'BR-08a', perfect: 'BR-08b', rough: 'BR-08d' },
};

/**
 * El nivel se llamaba `TEST_LEVEL` y `name: 'Banco de pruebas — movimiento y doble
 * capa'`. Nunca se renombro al pasar de prototipo a nivel, **y se jugaba como lo que
 * decia ser** — es lo primero que lee quien abre el archivo (GDD §12).
 *
 * El alias se conserva porque lo importan las pruebas y `game.js`. Se retira cuando
 * exista el registro `WORLDS` del mundo 2.
 */
export const TEST_LEVEL = NIVEL_CAPRILOPOLIS_1;

/**
 * Chispas de ruta: las que ENSEÑAN por dónde se va.
 *
 * No se colocan a mano. Se derivan de la propia geometría, así que si un hueco se
 * mueve o cambia de altura, sus chispas se mueven con él — a mano se desincronizan
 * a la primera edición y acaban señalando el vacío.
 *
 * Por cada hueco se ponen dos, y cada una dice una cosa distinta:
 *
 *   1. En el suelo, 1,2 m antes del borde  ->  "salta desde aquí"
 *   2. En el aire, sobre el centro del hueco, a la altura de la cresta del salto
 *      ->  "y este es el arco correcto"
 *
 * La segunda es la importante: se recoge a media parábola sin desviarse, así que
 * cogerla ES haber saltado bien. El coleccionable deja de premiar el rodeo y pasa a
 * premiar la línea limpia, que es lo que sostiene la persecución de la etapa 2.
 *
 * Los números salen del TUNING del jugador: altura de salto 2,4 m y carrera 6 m/s.
 */
function routeSparks(solids) {
  const out = [];
  const byLayer = new Map();
  for (const s of solids) {
    const layer = s.layer ?? 0;
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer).push(s);
  }

  for (const [layer, list] of byLayer) {
    list.sort((a, b) => a.x - b.x);
    for (let i = 0; i < list.length - 1; i += 1) {
      const a = list[i];
      const b = list[i + 1];
      const endA = a.x + a.w;
      const gap = b.x - endA;

      // Solo huecos de verdad. Por debajo de 1 m se pasan andando, y por encima de
      // 8 m no se cruzan de un salto: ahí la ruta es otra (un portal, o rodear).
      if (gap < 1.0 || gap > 8.0) continue;

      const topA = a.y + a.h;
      const topB = b.y + b.h;

      // Un escalón que sube más de 2,2 m no se salva de un salto (el máximo son
      // 2,4 m y hay que caer con margen): ahí la ruta no es saltar, así que no se
      // señala como si lo fuera.
      if (topB - topA > 2.2) continue;

      // La cresta se mide sobre la plataforma de DESPEGUE, nunca sobre la de
      // destino. Calculada sobre el destino, en un hueco que sube quedaba por
      // encima del arco y la chispa era literalmente inalcanzable.
      const crest = topA + 1.7;   // bajo los 2,4 m de altura máxima: cómoda de coger

      // El ápice cae 2,7 m después del borde: 0,45 s de subida a 6 m/s de carrera.
      // En un hueco ancho el centro ya pilla al jugador BAJANDO, así que poner ahí
      // la chispa la deja fuera del arco y premia justo lo contrario de lo que se
      // quiere enseñar.
      const APEX_RUN = 2.7;
      out.push({ x: endA - 1.2, y: topA + 0.9, layer, route: true });
      out.push({ x: endA + Math.min(gap / 2, APEX_RUN), y: crest, layer, route: true });
    }
  }
  return out;
}

// Las de ruta van DESPUÉS de las colocadas a mano: las secretas conservan su índice,
// que es lo que consultan los logros de "El otro lado" y "Coleccionista de ideas".
TEST_LEVEL.sparks = TEST_LEVEL.sparks.concat(routeSparks(TEST_LEVEL.solids));
