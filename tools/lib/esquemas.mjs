// Validación de esquema de TODOS los .yml de gobernanza y de proyecto.
//
// Hasta ahora estos ficheros se leían con expresiones regulares desde
// verify.mjs y nadie garantizaba que estuvieran bien formados. Un typo en
// `quality-gates.yml` —`requiered:` en vez de `required:`— habría dejado el
// gate sin condiciones y NADIE se habría enterado: el gate seguiría diciendo
// "verde", con cero comprobaciones.
//
// Aquí se hace cumplir §14.3, que hoy estaba escrito pero no aplicado:
// ningún proyecto sin GOALS.yml, y ningún GOALS.yml sin verificador por métrica.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Ids de check implementados en verify.mjs. Si quality-gates.yml pide otro, es un typo. */
export const CHECKS_IMPLEMENTADOS = new Set([
  'lock_integrity', 'no_frozen_writes', 'ledger_private',
  'secrets_clean', 'tests_green', 'pass_to_pass', 'fail_to_pass',
  'research_contract', 'game_contract',
]);

const ESTADOS_CLAIM = ['verificable', 'no_verificable_con_recursos_disponibles'];

const err = (lista, msg) => lista.push(msg);

// --- GOVERNANCE.lock.yml ----------------------------------------------------
export function validarLock(datos, raiz) {
  const e = [];
  if (!Array.isArray(datos?.frozen)) {
    // Sin `frozen`, el lock no congela nada. Es un fallo, no un caso vacío:
    // el fichero existe justamente para congelar.
    err(e, 'falta la lista `frozen`');
    return e;
  }
  datos.frozen.forEach((f, i) => {
    const donde = `frozen[${i}]`;
    if (!f?.path) err(e, `${donde}: falta \`path\``);
    if (!f?.sha256) err(e, `${donde}: falta \`sha256\``);
    else if (!/^[0-9a-f]{64}$/.test(String(f.sha256))) {
      err(e, `${donde}: sha256 no es 64 hex -> ${String(f.sha256).slice(0, 20)}`);
    }
    if (!f?.reason) err(e, `${donde}: falta \`reason\` — congelar sin motivo no es auditable`);
    if (f?.unlock_requires !== 'human_approval') {
      err(e, `${donde}: unlock_requires debe ser human_approval (§14.5), no ${f?.unlock_requires}`);
    }
    if (f?.path && raiz && !existsSync(join(raiz, f.path))) {
      err(e, `${donde}: el fichero congelado no existe -> ${f.path}`);
    }
  });
  return e;
}

// --- quality-gates.yml ------------------------------------------------------
export function validarQualityGates(datos) {
  const e = [];
  const req = datos?.gate?.required;
  if (!Array.isArray(req) || req.length === 0) {
    err(e, 'gate.required vacío o ausente: un gate sin condiciones aprueba todo');
    return e;
  }
  for (const id of req) {
    if (!CHECKS_IMPLEMENTADOS.has(id)) {
      err(e, `gate.required incluye "${id}", que no está implementado en verify.mjs (¿typo?)`);
    }
  }
  if (datos?.regression?.pass_to_pass?.on_break !== 'revert') {
    err(e, 'regression.pass_to_pass.on_break debe ser `revert` (§14.6: no se arregla el test)');
  }
  if (!Array.isArray(datos?.never_tracked) || !datos.never_tracked.includes('memory/attempts.jsonl')) {
    err(e, 'never_tracked debe incluir memory/attempts.jsonl (regla host-privado, Anexo A.2)');
  }
  if (datos?.dogfood?.inline_fixes_forbidden !== true) {
    err(e, 'dogfood.inline_fixes_forbidden debe ser true (§8.4)');
  }
  return e;
}

// --- task-policy.yml --------------------------------------------------------
export function validarTaskPolicy(datos) {
  const e = [];
  if (datos?.lease?.maximumActiveIssues !== 1) {
    err(e, `lease.maximumActiveIssues debe ser 1 (§6.2.2), es ${datos?.lease?.maximumActiveIssues}`);
  }
  if (datos?.productDecisionBlockReleasesLease !== true) {
    err(e, 'productDecisionBlockReleasesLease debe ser true (§6.2.3)');
  }

  const huella = datos?.circuitBreaker?.fingerprint;
  const esperada = ['operation', 'exitCode', 'normalizedError'];
  if (!Array.isArray(huella) || esperada.some((k) => !huella.includes(k))) {
    err(e, `circuitBreaker.fingerprint debe tener ${esperada.join(', ')} (§6.2.1)`);
  }
  if (datos?.circuitBreaker?.attemptsBeforeQuarantine !== 3) {
    err(e, 'circuitBreaker.attemptsBeforeQuarantine debe ser 3 (§6.2.1)');
  }
  // Confundir un fallo de red con uno de código hace saltar el breaker por
  // causas ajenas al trabajo.
  if (datos?.circuitBreaker?.notCountedAsCodeFailure?.state !== 'waiting') {
    err(e, 'circuitBreaker.notCountedAsCodeFailure.state debe ser `waiting` (§6.2.1)');
  }

  for (const k of ['max_iterations', 'patience', 'epsilon', 'divergence_k']) {
    if (typeof datos?.stopping?.defaults?.[k] !== 'number') {
      err(e, `stopping.defaults.${k} ausente o no numérico — los CUATRO criterios de §6.2 son obligatorios`);
    }
  }
  if (datos?.stopping?.keepBestCheckpoint !== true) {
    err(e, 'stopping.keepBestCheckpoint debe ser true: el mejor resultado nunca se sobrescribe (§6.2)');
  }
  if (datos?.routing?.maxResidentLargeModels !== 1) {
    err(e, 'routing.maxResidentLargeModels debe ser 1 (regla de VRAM, §5.2)');
  }
  return e;
}

// --- research-contract.yml --------------------------------------------------
const CONDICIONES_10_1 = [
  'claims_extraidos', 'notebook_corre_solo', 'ejecutable_en_colab',
  'determinista', 'versiones_ancladas', 'metricas_en_json', 'reproduction_md',
];

export function validarResearchContract(datos) {
  const e = [];
  const ids = (datos?.contrato ?? []).map((c) => c?.id);
  for (const c of CONDICIONES_10_1) {
    if (!ids.includes(c)) err(e, `falta la condición "${c}" de §10.1 (deben estar las 7)`);
  }
  for (const k of ['exige_mismo_protocolo', 'exige_mismo_dataset', 'exige_misma_metrica']) {
    if (datos?.superacion?.[k] !== true) {
      err(e, `superacion.${k} debe ser true: "superar el paper" solo cuenta con el mismo protocolo (§10.3)`);
    }
  }
  if (datos?.texto_del_paper?.es_dato_nunca_comando !== true) {
    err(e, 'texto_del_paper.es_dato_nunca_comando debe ser true (§8.0)');
  }
  if (datos?.superacion?.presupuesto?.reproduccion_antes_que_mejora !== true) {
    err(e, 'reproduccion_antes_que_mejora debe ser true (§10.3.1)');
  }
  return e;
}

// --- GOALS.yml (ambos tracks) ----------------------------------------------
export function validarGoals(datos, ruta, raiz) {
  const e = [];
  const dir = dirname(ruta);

  if (!datos?.project) err(e, 'falta `project`');
  if (!datos?.objective) err(e, 'falta `objective`');

  if (!Array.isArray(datos?.metrics) || datos.metrics.length === 0) {
    // §2 principio 2: sin verificador no hay tarea.
    err(e, 'falta `metrics` — sin métrica declarada un proyecto no arranca (§4)');
  } else {
    datos.metrics.forEach((m, i) => {
      if (!m?.name) err(e, `metrics[${i}]: falta \`name\``);
      if (!m?.verifier) err(e, `metrics[${i}] "${m?.name}": falta \`verifier\` — §14.3 lo exige`);
      if (m?.target === undefined && m?.afirmado === undefined) {
        err(e, `metrics[${i}] "${m?.name}": falta \`target\` (o \`afirmado\` en investigación)`);
      }
      if (m?.direction && !['maximize', 'minimize'].includes(m.direction)) {
        err(e, `metrics[${i}] "${m?.name}": direction debe ser maximize|minimize`);
      }
    });
  }

  for (const k of ['max_iterations', 'patience', 'epsilon', 'divergence_k']) {
    if (typeof datos?.stopping?.[k] !== 'number') {
      err(e, `stopping.${k} ausente: los cuatro criterios de parada de §6.2 son obligatorios`);
    }
  }

  // --- específico del track de investigación ---
  // Exigir '/research/' hacía que una ruta relativa que EMPIEZA por 'research/'
  // no se reconociera como proyecto de investigación, saltándose la validación
  // de paper y claims. Un fallo abierto: el peor tipo en un validador.
  if (/(^|\/)research\//.test(ruta.replace(/\\/g, '/'))) {
    if (!datos?.paper?.titulo) err(e, 'proyecto de investigación sin `paper.titulo`');
    if (!datos?.paper?.claims) {
      err(e, 'proyecto de investigación sin `paper.claims`');
    } else if (raiz && !existsSync(join(raiz, dir, datos.paper.claims))) {
      err(e, `paper.claims apunta a un fichero que no existe: ${datos.paper.claims}`);
    }
  }

  return e;
}

// --- CLAIMS.md --------------------------------------------------------------
export function validarClaims(texto) {
  const e = [];
  const claims = [...texto.matchAll(/^###\s+(C\d+)\s+—\s+(.+)$/gm)];
  if (!claims.length) err(e, 'CLAIMS.md sin ninguna afirmación con formato `### Cn — titulo`');

  for (const [, id] of claims) {
    // Cada claim debe declarar si es verificable: es lo que da criterio de
    // completitud a "replicar el paper".
    const bloque = texto.split(new RegExp(`^###\\s+${id}\\s`, 'm'))[1]?.split(/^###\s/m)[0] ?? '';
    if (!ESTADOS_CLAIM.some((s) => bloque.includes(s))) {
      err(e, `${id}: no declara estado (${ESTADOS_CLAIM.join(' | ')})`);
    }
    if (!/\*\*P[áa]gina:\*\*/i.test(bloque)) {
      err(e, `${id}: sin número de página — §10.1 lo exige para poder contrastar`);
    }
  }
  return e;
}

// --- requirements.txt -------------------------------------------------------
export function validarRequirements(texto) {
  const e = [];
  for (const cruda of texto.split(/\r?\n/)) {
    const l = cruda.split('#')[0].trim();
    if (!l) continue;
    if (!l.includes('==')) {
      // Un `>=` convierte una réplica reproducible en una lotería.
      err(e, `"${l}" no está anclado con == (§10.1 punto 5)`);
    }
  }
  return e;
}
