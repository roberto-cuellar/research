// Normalización de errores y cálculo de firmas.
//
// Es la pieza de la que dependen la deduplicación de lecciones (§7.3) y el
// circuit breaker por huella de fallo (§6.2.1). Si la normalización es floja,
// dos fallos idénticos producen firmas distintas y el breaker nunca salta.

import { createHash } from 'node:crypto';

/** Sustituciones aplicadas en orden. Cada una borra una fuente de ruido. */
const RUIDO = [
  // Rutas Windows y POSIX -> <PATH>. Va primero: las rutas contienen todo lo demás.
  [/[A-Za-z]:\\[^\s:*?"<>|]+/g, '<PATH>'],
  [/(?:\/[\w.\-@+]+){2,}\/?/g, '<PATH>'],
  // Timestamps ISO 8601, con o sin zona.
  [/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, '<TS>'],
  // UUID.
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<UUID>'],
  // Hashes hex largos (git sha, sha256...). Antes que los números sueltos.
  [/\b[0-9a-f]{7,64}\b/gi, '<HASH>'],
  // Direcciones de memoria y punteros.
  [/\b0x[0-9a-f]+\b/gi, '<ADDR>'],
  // Puertos y PIDs anotados explícitamente.
  [/\b(?:pid|PID)[ =:]+\d+/g, 'PID=<N>'],
  [/\b(?:port|puerto)[ =:]+\d+/gi, 'port=<N>'],
  // Referencias fichero:linea:columna que quedan tras sustituir la ruta.
  [/<PATH>:\d+(?::\d+)?/g, '<PATH>:<N>:<N>'],
  // Números sueltos (contadores, duraciones, líneas). Va al final.
  [/\b\d+(?:\.\d+)?\b/g, '<N>'],
];

/**
 * Reduce un texto de error a su forma canónica: sin rutas, timestamps, ids ni
 * números. Dos ejecuciones del mismo fallo deben producir la misma cadena.
 */
export function normalizeError(raw) {
  if (raw == null) return '';
  let s = String(raw);
  for (const [re, sub] of RUIDO) s = s.replace(re, sub);
  return s
    .replace(/\s+/g, ' ')          // colapsa saltos de línea e indentación
    .trim()
    .toLowerCase()
    .slice(0, 2000);               // tope duro: §7.5 regla 3
}

function hash12(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 12);
}

/**
 * Firma del error: `err_<12 hex>`. Es la clave de lookup O(1) del nivel 1 de
 * §7.6 — la recuperación de coste cero que se consulta ANTES de reintentar.
 */
export function errorSignature(raw) {
  const norm = normalizeError(raw);
  if (!norm) return null;
  return `err_${hash12(norm)}`;
}

/**
 * Firma de la tarea: `<dominio>:<slug>`. Legible a propósito, porque §7.4 filtra
 * por "task_signature similar" y un hash no permite comparar por prefijo.
 */
export function taskSignature(domain, subject) {
  const slug = String(subject ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // quita tildes
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${String(domain).toLowerCase()}:${slug}`;
}

/**
 * Huella de fallo del circuit breaker (§6.2.1): {operación, código_salida,
 * error_normalizado}. Distinta de errorSignature: aquí la operación y el exit
 * code forman parte de la identidad, porque el mismo error en dos operaciones
 * distintas son dos fallos distintos.
 */
export function failureFingerprint({ operation, exitCode, error }) {
  const parts = [String(operation ?? ''), String(exitCode ?? ''), normalizeError(error)];
  return `fp_${hash12(parts.join('\u0000'))}`;
}
