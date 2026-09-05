// Hashing de contenido estable entre plataformas.
//
// POR QUÉ EXISTE ESTE FICHERO (bug real, 2026-09-05):
//
// GOVERNANCE.lock.yml guardaba el sha256 de los BYTES EN DISCO. En Windows,
// `core.autocrlf` reescribe los saltos de línea al hacer checkout, así que el
// mismo fichero —idéntico para git, con `git diff` vacío— cambiaba de hash con
// solo cambiar de rama. El gate acusaba de manipulación a un fichero intacto.
//
// El primer run de CI pasó y ocultó el problema: en Linux el checkout da LF, y
// ahí el hash sí cuadraba. Un gate que solo funciona en un sistema operativo, y
// que además acusa en falso en el otro, es peor que no tener gate: se aprende a
// ignorarlo o a desactivarlo.
//
// La regla: se hashea el contenido tal y como GIT lo almacena (LF), no como el
// sistema de ficheros lo entrega.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const NUL = 0x00;

/** Un fichero con un byte nulo es binario: se hashea crudo, sin tocar nada. */
export function esBinario(buf) {
  return buf.includes(NUL);
}

/**
 * Normaliza CRLF -> LF en texto; deja el binario intacto.
 * Es lo que hace git al almacenar un fichero con `text=auto`.
 */
export function normalizarContenido(buf) {
  if (esBinario(buf)) return buf;
  return Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
}

/** sha256 del contenido normalizado. Mismo valor en Windows, Linux y macOS. */
export function sha256Contenido(buf) {
  return createHash('sha256').update(normalizarContenido(buf)).digest('hex');
}

/** sha256 estable de un fichero del disco. */
export function sha256Fichero(ruta) {
  return sha256Contenido(readFileSync(ruta));
}
