// Capa de persistencia de la memoria.
//
// Implementa las SEIS reglas de §7.5, auditadas del `workspace-memory.ts` de
// oh-my-cli. No son teoría: vienen de código en producción.
//
//   1. Redactar secretos y rutas de usuario ANTES de persistir.
//   2. Escritura atómica (temp + rename). Un store corrupto nunca crashea.
//   3. Límites duros con fallo cerrado.
//   4. Procedencia obligatoria: timestamp ISO + git HEAD.
//   5. Tombstones, no borrado.
//   6. Kill switch por variable de entorno.

import { appendFile, mkdir, open, readFile, rename } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

// --- Regla 3: límites duros. Los mismos que usa el bot auditado. -------------
export const LIMITES = {
  MAX_ENTRADAS: 200,        // lecciones activas
  MAX_CHARS_ENTRADA: 2000,  // por campo de texto libre
};

// --- Regla 6: kill switch ---------------------------------------------------
/** Permite aislar si un fallo viene de la memoria o del agente. */
export function memoriaDesactivada() {
  const v = process.env.SEM_MEMORY_DISABLED;
  return v === '1' || v === 'true';
}

// --- Regla 1: redacción ANTES de persistir ----------------------------------
// Un secreto escrito en disco ya es un incidente aunque nunca se muestre.
const SECRETOS = [
  [/\b(gh[pousr]_[A-Za-z0-9]{16,})\b/g, '<REDACTED:github-token>'],
  [/\b(sk-[A-Za-z0-9_-]{16,})\b/g, '<REDACTED:api-key>'],
  [/\b(xox[abps]-[A-Za-z0-9-]{10,})\b/g, '<REDACTED:slack-token>'],
  [/\b(AKIA[0-9A-Z]{16})\b/g, '<REDACTED:aws-key>'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '<REDACTED:private-key>'],
  [/\b(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g, '<REDACTED:jwt>'],
  [/((?:password|passwd|secret|token|api[_-]?key|authorization)\s*[=:]\s*)(["']?)[^\s"',}]{6,}\2/gi, '$1<REDACTED>'],
  [/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/g, '$1<REDACTED:credentials>@'],
];

const BARRA_INV = String.fromCharCode(92);

/** Sustituye el home del usuario por `~`, en ambos separadores. */
function redactHome(s) {
  const home = process.env.USERPROFILE || process.env.HOME;
  if (!home) return s;
  const variantes = new Set([
    home,
    home.split(BARRA_INV).join('/'),
    home.split('/').join(BARRA_INV),
  ]);
  for (const h of variantes) {
    if (!h) continue;
    s = s.split(h).join('~');
  }
  return s;
}

/** Redacta recursivamente un valor de cualquier forma. Idempotente. */
export function redact(value) {
  if (typeof value === 'string') {
    let s = redactHome(value);
    for (const [re, sub] of SECRETOS) s = s.replace(re, sub);
    return s;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redact(v);
    return out;
  }
  return value;
}

// --- Regla 3 (cont.): truncado con marca visible ----------------------------
export function truncar(s, max = LIMITES.MAX_CHARS_ENTRADA) {
  if (typeof s !== 'string' || s.length <= max) return s;
  // La marca se calcula ANTES de cortar: su longitud depende de s.length, así
  // que restar una constante deja el resultado por encima del tope.
  const marca = `…<TRUNCADO:${s.length}>`;
  return `${s.slice(0, Math.max(0, max - marca.length))}${marca}`;
}

// --- Regla 4: procedencia ---------------------------------------------------
let _headCache;

/** git HEAD del momento. Sin esto no se sabe si una lección sigue aplicando. */
export function gitHead(cwd = process.cwd()) {
  if (_headCache !== undefined) return _headCache;
  try {
    _headCache = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    _headCache = 'no-git';  // fallo cerrado: se registra la ausencia, no se omite el campo
  }
  return _headCache;
}

export function procedencia(cwd) {
  return { ts: new Date().toISOString(), git_head: gitHead(cwd) };
}

// --- Regla 5: estados de tombstone ------------------------------------------
export const ESTADO = Object.freeze({
  ACTIVE: 'active',
  SUPERSEDED: 'superseded',
  FORGOTTEN: 'forgotten',
});

// --- Regla 2: escritura atómica ---------------------------------------------
/** Escribe por fichero temporal + rename. El rename es atómico en NTFS y ext4. */
export async function writeAtomic(path, contenido) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  const fh = await open(tmp, 'w', 0o600);
  try {
    await fh.writeFile(contenido, 'utf8');
    await fh.sync();          // el rename no vale de nada si los datos siguen en caché
  } finally {
    await fh.close();
  }
  await rename(tmp, path);
}

/**
 * Append a un JSONL. Devuelve el offset en bytes donde empieza la línea, que es
 * lo que guarda el índice para poder leer una entrada sin cargar el fichero.
 */
export async function appendJsonl(path, obj) {
  await mkdir(dirname(path), { recursive: true });
  const linea = `${JSON.stringify(obj)}\n`;
  const offset = existsSync(path) ? statSync(path).size : 0;
  await appendFile(path, linea, { encoding: 'utf8', mode: 0o600 });
  return { offset, bytes: Buffer.byteLength(linea, 'utf8') };
}

/**
 * Lee UNA entrada por offset. Es lo que hace que el nivel 1 de §7.6 no cargue
 * el JSONL entero: se salta al byte y se lee solo esa línea.
 */
export async function readJsonlAt(path, offset, bytes) {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    await fh.read(buf, 0, bytes, offset);
    return JSON.parse(buf.toString('utf8'));
  } finally {
    await fh.close();
  }
}

/**
 * Lee un JSONL entero, saltando líneas corruptas.
 * Regla 2: un store corrupto NUNCA debe crashear el agente ni sobrescribirse.
 */
export async function readJsonl(path) {
  if (!existsSync(path)) return { entradas: [], corruptas: 0 };
  const texto = await readFile(path, 'utf8');
  const entradas = [];
  let corruptas = 0;
  for (const linea of texto.split('\n')) {
    if (!linea.trim()) continue;
    try { entradas.push(JSON.parse(linea)); } catch { corruptas++; }
  }
  return { entradas, corruptas };
}

export function rutasMemoria(raiz) {
  const base = join(raiz, 'memory');
  return {
    base,
    attempts: join(base, 'attempts.jsonl'),
    lessons: join(base, 'lessons.jsonl'),
    index: join(base, 'index.json'),
  };
}
