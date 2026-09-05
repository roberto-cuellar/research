# Plan de implementación — SEM · revisión 2

**Rev 1:** 2026-09-05, aprobada. **Rev 2:** 2026-09-05, tras ejecutar las fases 0.5–3.
Sustituye a la rev 1. El historial de lo hecho está en el log de git y en `memory/lessons.jsonl`.

---

## Por qué esta revisión

Dos motivos, ambos del usuario:

1. **La gobernanza no está probada.** `verify.mjs`, el parser del lock, el hook de
   pre-escritura y **todos los `.yml`** son código y datos que deciden si el resto pasa —
   y no tienen un solo test propio. Los 26 tests actuales cubren memoria y hashes.
   Un gate sin tests es exactamente el fallo que el gate existe para prevenir.
2. **El paper es toda la información disponible.** No se resuelve C3 preguntando al autor:
   la discrepancia se documenta como hallazgo de la reproducción, que es un resultado
   legítimo y honesto.

**Consecuencia de orden:** se abre una fase nueva —**2c**— que bloquea el track de
investigación. No se escribe una línea más de reproducción hasta que la gobernanza de
**ambos** tracks esté probada.

---

## Estado real (con evidencia)

| Fase | Estado | Evidencia |
|---|---|---|
| 0.5 Desbloqueos | ✅ | Repo trasladado, venv 3.14 con versiones ancladas, `gh` 2.100.0, 4 VLM descargados |
| 1 Cimientos | ✅ | 26/26 tests. Recuperación por `error_signature` sin leer ficheros enteros, demostrada instrumentando `readFile` |
| 2 Gobernanza (3 capas) | ⚠️ **funciona, sin tests** | Hook deniega con exit 2; `verify.mjs` caza hash alterado; pre-commit bloquea. **Demostrado a mano, no automatizado** |
| 2b CI verificado | ✅ | Run verde `d8114fd` y run **rojo** `cec8b69` con el gate fallando en el paso exacto |
| 3 Conectividad | ✅ | Puente MCP a Blender 5.2.1 LTS por protocolo MCP real; Playwright con baseline en verde |
| 4 Benchmark VLM | ⚠️ parcial | VRAM medida; detección medida sobre 1 caso. Falta el dataset de 20–30 pares |
| 5 Juego | 🔲 solo `GOALS.yml` | Motor sin copiar |
| 6 Paper | ⚠️ parcial | 3 replican, 1 no replica, 1 parcial |
| 7 Optimización | 🔲 | — |

**Lo que se aprendió y cambió supuestos del brief** está en `benchmarks/vlm/MEDICIONES.md`
y en las 6 lecciones de `memory/lessons.jsonl`.

---

## FASE 2c — Gobernanza probada · **BLOQUEANTE**

**Gate:** ningún trabajo de investigación ni de juego avanza hasta que esto pase.

### 2c.1 Tests de `verify.mjs`

Cada check tiene que fallar cuando debe. Un check que solo se ha visto pasar no está probado.

| Test | Qué demuestra |
|---|---|
| `lock_integrity` con hash alterado | detecta manipulación |
| `lock_integrity` con fichero borrado | no revienta; reporta `NO EXISTE` |
| **lock con YAML malformado** | **falla cerrado**: un lock que no se entiende no autoriza nada |
| lock vacío / ausente | pasa, sin ficheros congelados |
| `no_frozen_writes` con fichero nuevo cuyo hash casa | **permite** — es su nacimiento, no una modificación |
| `no_frozen_writes` con contenido alterado | deniega |
| `ledger_private` con `attempts.jsonl` trackeado | deniega |
| `secrets_clean` con un token plantado | detecta |
| `secrets_clean` sobre binario | no revienta ni da falso positivo |
| `pass_to_pass` con la suite por debajo de la línea base | deniega |
| gate compuesto | es un **AND**: una sola condición roja tumba el conjunto |

### 2c.2 Tests del hook de pre-escritura

Ruta congelada → exit 2 · ruta libre → exit 0 · herramienta no escritora → exit 0 ·
payload ilegible → exit 0 con aviso (delega en pre-commit) · ruta fuera del repo → exit 0 ·
ruta absoluta equivalente a una congelada → **exit 2** (no se esquiva con `..` ni con
barras invertidas).

### 2c.3 Validación de TODOS los `.yml` — los dos tracks

Un test que recorre el repo y valida **cada** YAML contra su esquema. Hoy nada garantiza
que un `GOALS.yml` tenga verificador, ni que un typo en `quality-gates.yml` se note.

| Fichero | Se valida |
|---|---|
| `GOVERNANCE.lock.yml` | cada entrada con `path` + `sha256` (64 hex) + `reason` + `unlock_requires`; el fichero existe |
| `quality-gates.yml` | `gate.required` no vacío; todo id corresponde a un check implementado |
| `task-policy.yml` | `lease.maximumActiveIssues == 1`; breaker con los 3 campos de huella; los 4 criterios de parada |
| `research-contract.yml` | las **7** condiciones de §10.1 presentes |
| **`games/*/GOALS.yml`** | `project`, `objective`, `metrics[].verifier`, `stopping` con los 4 criterios |
| **`research/**/GOALS.yml`** | lo anterior + `paper`, + `claims` apuntando a un `CLAIMS.md` que existe |

**Regla que el test hace cumplir:** ningún proyecto sin `GOALS.yml`, y ningún `GOALS.yml`
sin `verifier` por métrica. Es §14.3, hoy escrito pero no aplicado.

> **Decisión:** parser YAML mínimo propio en `tools/lib/yaml.mjs`, sin dependencia externa.
> Sirve al subconjunto que estos ficheros usan (mapas, listas, escalares, comentarios) y
> **falla cerrado** ante cualquier construcción que no entienda. Si el subconjunto se queda
> corto, se añade `yaml` como dependencia **con el dato** que lo justifique.

### 2c.4 Gobernanza del track de investigación, ejecutable

`research-contract.yml` hoy **declara** y no **deniega**. Añadir a `verify.mjs` un check
`research_contract` que, cuando el cambio toca `research/**`, exija: `CLAIMS.md` presente
con estados válidos, `GOALS.yml` con `paper` y `claims`, `requirements.txt` anclado con `==`
(nunca `>=`), y `results/metrics.json` parseable si existe.

### 2c.5 Gobernanza del track de juegos

Check `game_contract`: `GOALS.yml` presente, y si existe `src/`, que **no** contenga
ninguno de los módulos prohibidos del laberinto (§14.11c) ni escriba en `MrHector/`.

---

## FASE 6' — Investigación, reanudable solo tras 2c

**El paper es la única fuente.** No se pregunta al autor.

1. **C3 se cierra como NO REPLICA**, con las tres hipótesis documentadas y ninguna
   confirmada. Es un resultado legítimo: la Ec. (9) con los parámetros declarados y M=D
   da 10.316 µm frente a los 13.7 µm reportados.
2. **C1** sube a `replica` solo si se confirman las ecuaciones contra el PDF. Con
   `pymupdf` deformando símbolos, el camino es extraer las fórmulas por bloques de texto
   con posición, no por volcado plano.
3. **C4** (corrección del offset de contraste) — la afirmación más interesante.
4. **C5** solo como contraparte computacional, documentada como **experimento distinto**.
5. Notebook `01_reproduccion.ipynb` con `jupytext` + `papermill` + `nbmake` — **los cuatro
   paquetes siguen sin instalar**, y sin ellos no hay golden test de notebook.

---

## Lo que queda pendiente en el resto

- **Fase 4:** dataset de 20–30 pares del dominio real; LPIPS medido en CPU antes de decidir
  si entra. Sin eso no hay `RESULTS.md`, solo `MEDICIONES.md`.
- **Fase 5:** copiar los 27 módulos + 11 suites; `"type": "module"`; las 13 trampas.
- **Fase 7:** sin empezar.
- **Blender:** `blender.exe` sigue fuera del PATH; la escena abierta no tiene cámara ni
  luces, así que **no hay render determinista posible todavía**.
- **Playwright:** usa el Chrome del sistema porque la descarga del Chromium empaquetado se
  corta. La versión del navegador **no queda anclada** — deriva real para golden visuales.

## Verificación de la Fase 2c

```bash
npm test                                   # todas las suites, incluidas las nuevas
node governance/enforce/verify.mjs         # el gate sobre sí mismo
```

El criterio: **cada check del gate tiene al menos un test que lo ve FALLAR**, y todo `.yml`
del repo valida contra su esquema. Un check que solo se ha visto pasar no está probado.
