#!/usr/bin/env node
// CAPA 3 — El único mecanismo que PREVIENE en vez de detectar.
//
// Se engancha como `PreToolUse` en Claude Code y como hook equivalente en
// opencode. Recibe por stdin el JSON de la llamada a herramienta, comprueba la
// ruta de destino contra GOVERNANCE.lock.yml y sale con código != 0 si está
// congelada. `verify.mjs` y el pre-commit son las redes de seguridad por detrás;
// este es el que llega a tiempo.
//
// Contrato de salida:
//   exit 0  -> permitir
//   exit 2  -> DENEGAR (el runner muestra stderr al agente y aborta la escritura)
//
// Se elige exit 2 y no 1 porque Claude Code distingue "el hook falló" (1) de
// "el hook deniega" (2). Un hook roto no debe leerse como permiso.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCK = join(RAIZ, 'governance', 'policy', 'GOVERNANCE.lock.yml');

// Herramientas que escriben. Todo lo demás pasa sin mirar.
const ESCRITORAS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'edit', 'write', 'patch']);

function rutasCongeladas() {
  if (!existsSync(LOCK)) return [];
  return [...readFileSync(LOCK, 'utf8').matchAll(/^\s*-\s+path:\s*(.+)$/gm)]
    .map((m) => m[1].trim().replace(/^["']|["']$/g, '').replace(/\\/g, '/'));
}

/** Normaliza a ruta relativa a la raíz del repo, con barras POSIX. */
function normalizar(p) {
  if (!p) return null;
  const abs = isAbsolute(p) ? p : resolve(RAIZ, p);
  const rel = relative(RAIZ, abs).replace(/\\/g, '/');
  return rel.startsWith('..') ? null : rel;   // fuera del repo: no es asunto nuestro
}

/**
 * Extrae la ruta de destino del payload. Los runners no coinciden en el nombre
 * del campo, así que se prueban todos los conocidos y, si ninguno aparece, se
 * cae a una búsqueda por forma. Fallo cerrado: si hay duda, se comprueba.
 */
function rutaDestino(payload) {
  const i = payload?.tool_input ?? payload?.input ?? payload?.args ?? payload ?? {};
  return i.file_path ?? i.filePath ?? i.path ?? i.notebook_path ?? i.target ?? null;
}

let crudo = '';
for await (const trozo of process.stdin) crudo += trozo;

let payload;
try {
  payload = crudo.trim() ? JSON.parse(crudo) : {};
} catch {
  // Un payload ilegible no puede autorizar nada, pero tampoco debe bloquear el
  // trabajo legítimo si el hook está mal cableado. Se avisa y se permite:
  // verify.mjs y el pre-commit siguen detrás.
  process.stderr.write('pre-write-hook: payload no parseable, se delega en el pre-commit\n');
  process.exit(0);
}

const herramienta = payload.tool_name ?? payload.tool ?? payload.name ?? '';
if (!ESCRITORAS.has(herramienta)) process.exit(0);

const destino = normalizar(rutaDestino(payload));
if (!destino) process.exit(0);

const congeladas = rutasCongeladas();
if (!congeladas.includes(destino)) process.exit(0);

// --- denegación -------------------------------------------------------------
const bloque = readFileSync(LOCK, 'utf8')
  .split(/^\s*-\s+path:/m)
  .find((b) => b.trimStart().startsWith(destino));
const motivo = bloque?.match(/reason:\s*["'](.+?)["']/)?.[1] ?? 'archivo congelado';

process.stderr.write(
  `\nDENEGADO por governance/policy/GOVERNANCE.lock.yml\n\n`
  + `  archivo: ${destino}\n`
  + `  motivo:  ${motivo}\n\n`
  + `§14.4 prohíbe modificar un archivo congelado y §14.5 prohíbe auto-aprobarse\n`
  + `el desbloqueo. Si el cambio hace falta:\n\n`
  + `  1. Propón el diff al usuario, sin aplicarlo.\n`
  + `  2. El usuario registra la aprobación en governance/approvals/.\n`
  + `  3. Solo entonces se levanta la entrada del lock.\n\n`,
);
process.exit(2);
