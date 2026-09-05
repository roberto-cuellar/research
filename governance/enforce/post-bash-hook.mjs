#!/usr/bin/env node
// CAPA 3b — detección inmediata tras un comando de shell.
//
// POR QUÉ EXISTE
//
// `pre-write-hook.mjs` intercepta por RUTA, y eso solo funciona con las
// herramientas de edición, que declaran la ruta en su payload. Un comando de
// shell puede escribir de mil formas —redirección, `tee`, `sed -i`, un script
// de Python, un `node -e`— y la ruta puede calcularse en tiempo de ejecución.
// Intentar adivinarla parseando la línea de comandos es una carrera perdida.
//
// Aquí se invierte el problema: en vez de predecir si el comando ESCRIBIRÁ en
// un fichero congelado, se comprueba DESPUÉS si alguno cambió. La detección es
// completa —no depende de cómo se escribió— a cambio de ser posterior al hecho.
//
// No es un sustituto de la prevención: es la red que la hace fiable. El daño se
// detecta en el acto, con el fichero exacto, en vez de aparecer en el commit.
//
// Contrato: exit 0 = todo intacto · exit 2 = un fichero congelado cambió.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sha256Fichero } from '../../tools/lib/hash.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCK = join(RAIZ, 'governance', 'policy', 'GOVERNANCE.lock.yml');

function entradasCongeladas() {
  if (!existsSync(LOCK)) return [];
  const texto = readFileSync(LOCK, 'utf8');
  const out = [];
  let actual = null;
  for (const cruda of texto.split(/\r?\n/)) {
    const p = cruda.match(/^\s*-\s+path:\s*(.+)$/);
    if (p) { actual = { path: limpiar(p[1]) }; out.push(actual); continue; }
    const s = cruda.match(/^\s+sha256:\s*(.+)$/);
    if (s && actual) actual.sha256 = limpiar(s[1]);
  }
  return out.filter((e) => e.path && e.sha256);
}

const limpiar = (s) => s.trim().replace(/^["']|["']$/g, '');

// LÍMITE CONOCIDO: si alguien edita el propio lock para descongelar algo, los
// hashes de los demás siguen cuadrando y esta comprobación no lo ve. Ese caso lo
// cubre el pre-commit, que compara el lock contra HEAD, y el CI. Ninguna capa
// sola basta; por eso son tres.

let crudo = '';
for await (const trozo of process.stdin) crudo += trozo;

// El payload no se usa para decidir —la decisión es por hash— pero se lee para
// no romper el protocolo del runner y para poder nombrar el comando culpable.
let comando = '';
try {
  const payload = crudo.trim() ? JSON.parse(crudo) : {};
  comando = payload?.tool_input?.command ?? '';
} catch { /* un payload ilegible no cambia la comprobación */ }

const rotos = [];
for (const e of entradasCongeladas()) {
  const abs = join(RAIZ, e.path);
  if (!existsSync(abs)) { rotos.push(`${e.path}: BORRADO`); continue; }
  const real = sha256Fichero(abs);
  if (real !== e.sha256) {
    rotos.push(`${e.path}: ${real.slice(0, 12)}… ≠ lock ${e.sha256.slice(0, 12)}…`);
  }
}

if (!rotos.length) process.exit(0);

process.stderr.write(
  `\nARCHIVO CONGELADO ALTERADO — detectado tras un comando de shell\n\n`
  + `${rotos.map((r) => `  ${r}`).join('\n')}\n\n`
  + (comando ? `  comando: ${comando.slice(0, 200)}\n\n` : '')
  + `El hook de pre-escritura solo intercepta las herramientas de edición; un\n`
  + `comando de shell lo esquiva. Esta comprobación es por hash, así que detecta\n`
  + `la escritura sin importar cómo se hizo.\n\n`
  + `Revierte el cambio, o regístralo en governance/approvals/ y actualiza el\n`
  + `lock. El agente NUNCA se auto-aprueba (§14.5).\n\n`,
);
process.exit(2);
