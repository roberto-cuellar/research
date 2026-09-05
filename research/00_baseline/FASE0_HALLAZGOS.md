# FASE 0 — HALLAZGOS

**Fecha:** 2026-09-04 · **Estado:** completada · **Gate:** pendiente de aprobación del usuario

Todo lo marcado ✅ se comprobó **ejecutándolo**. Lo marcado 🔴 no se pudo verificar.
Este documento corrige varias afirmaciones de `PROMPT_MAESTRO.md`; las correcciones están
marcadas con ⚠️ y ya están aplicadas al prompt.

---

## 1. Acceso a GitHub — RESUELTO (con un bloqueo menor abierto)

| Repo | Push | Evidencia |
|---|---|---|
| `roberto-cuellar/research` | ✅ | `Everything up-to-date` tras autorizar en navegador |
| `borislovdev-glitch/borislov-game` | ✅ | `028e81a..952c664  HEAD -> laberinto/vidas-linterna-y-telon` |

**Cómo está montado (no romper):** GCM instalado, `credential.helper=manager`, y
**`credential.https://github.com.usehttppath=true`** en `~/.gitconfig`. Ese ajuste enruta
credenciales **por ruta de repo**, porque hay dos identidades: `roberto-cuellar` y
`borislovdev-glitch`. Quitarlo rompería el acceso a los repos de `borislovdev-glitch`.

🔴 **Abierto: `gh` no está instalado.** Sin él no se pueden inspeccionar runs de CI ni logs
por API. `winget install --id GitHub.cli -e`. Al hacer `gh auth login`, **rechazar** que se
configure como credential helper de git.

⚠️ **`borislov-game` tiene 3 commits locales sin subir.** No se han tocado.

---

## 2. Blender — ⚠️ CORRECCIÓN IMPORTANTE

El prompt afirmaba que el addon del puerto 9876 era el clásico `ahujasid/blender-mcp` y que
hacía falta el puente `uvx blender-mcp`. **Es falso.**

✅ **Es el addon MCP oficial de Blender.** Manifiesto verificado en
`%APPDATA%\Blender Foundation\Blender\5.2\extensions\user_default\mcp\blender_manifest.toml`:

```toml
id = "mcp"
name = "MCP"
tagline = "MCP server add-on for LLM interaction"
maintainer = "Blender Lab"
website = "https://www.blender.org/lab/mcp-server/"
blender_version_min = "5.1.0"
license = ["SPDX:GPL-3.0-or-later"]
[permissions]
network = "Runs a local TCP socket server for MCP client communication"
```

**Protocolo, del código fuente** (`5.0\scripts\addons\mcp_to_blender_server.py`, cabecera
SPDX "Blender Authors"):

> *"Non-blocking TCP socket server that runs inside Blender. Listens for **null-byte-delimited
> JSON requests**, executes Python directly in the calling thread, and returns JSON responses."*

**Por qué mi sonda anterior falló:** envié JSON sin el terminador de byte nulo, y el servidor
respondió `{"status":"error","message":"Client timed out"}` esperando el resto del mensaje.
El diagnóstico "socket crudo, no HTTP" era correcto; la identificación del addon, no.

**Consecuencias:**
1. **`uvx blender-mcp` es el puente equivocado.** No instalarlo.
2. Hay **dos instalaciones**: Blender 5.0 (addon legacy en `scripts/addons`) y Blender 5.2
   (extensión oficial). El proceso escuchando en 9876 es el que hay que identificar antes de
   cablear nada.
3. La conexión a este addon **ya funciona** desde esta sesión de Claude Code (herramientas
   `mcp__Blender__*`). Para opencode hay que consultar la documentación oficial del addon,
   no la del proyecto de terceros.

🔴 **Pendiente:** `blender.exe` sigue sin estar en el PATH. Necesario para renders headless
deterministas (`blender -b -P script.py`), que es la base de la validación visual de §8.2.

---

## 3. Python 3.14 — ⚠️ CORRECCIÓN: no hay problema

El prompt advertía de riesgo alto de wheels faltantes y recomendaba un entorno 3.12 con `uv`.
**Se probó y no hace falta.** Instalación limpia en un venv de Python 3.14.0:

| Paquete | Versión | |
|---|---|---|
| numpy | 2.5.2 | ✅ |
| scipy | 1.18.1 | ✅ |
| scikit-image | 0.26.0 | ✅ (da SSIM) |
| pillow | 12.3.0 | ✅ |
| imageio, networkx, tifffile | — | ✅ |
| **torch** | **2.14.0+cpu** | ⚠️ instala, pero **`cuda.is_available() == False`** |

⚠️ **Hallazgo relevante para la métrica visual:** torch instaló en su variante **CPU**. LPIPS
—la métrica primaria recomendada en §8.2— correría en CPU, sin usar la 4060 Ti. Para imágenes
pequeñas es asumible, pero hay que **medirlo** antes de meterlo en el bucle. Si el coste es
alto, la alternativa es instalar torch con índice CUDA, o quedarse en SSIM (que ya está
disponible vía scikit-image y no necesita GPU).

**Decisión propuesta:** empezar la cascada visual con **SSIM** (cero dependencias pesadas,
determinista) y añadir LPIPS solo si SSIM resulta insuficiente, midiendo antes su latencia.

---

## 4. El motor plataformer — LÍNEA BASE MEDIDA

### 4.1 PASS_TO_PASS: 227/227 en verde

```
node --test  →  tests 227 · pass 227 · fail 0 · duration 2472 ms
```

⚠️ **Detalle de invocación que importa para el CI:** `node --test tests/` **falla** en Windows
(`Cannot find module ...\tests`). Hay que pasar los ficheros explícitamente o con glob. El
script de verificación debe usar la forma que funciona, no la intuitiva.

| Suite | Tests | Track |
|---|---|---|
| `sintaxis.test.mjs` | 47 | plataformer |
| `level.test.mjs` | 27 | plataformer |
| `director.test.mjs` | 17 | plataformer |
| `audio.test.mjs` | 15 | plataformer |
| `player.test.mjs` | 12 | plataformer |
| `physics.test.mjs` | 11 | plataformer |
| `breakables.test.mjs` | 11 | plataformer |
| `pushable.test.mjs` | 11 | plataformer |
| `plate.test.mjs` | 8 | plataformer |
| `arquitectura.test.mjs` | 6 | plataformer |
| `events.test.mjs` | 6 | plataformer |
| **Subtotal plataformer** | **171** | |
| `maze_retos.test.mjs` | 30 | laberinto |
| `maze.test.mjs` | 16 | laberinto |
| `cadena.test.mjs` | 10 | laberinto |
| **Subtotal laberinto** | **56** | |
| **TOTAL** | **227** | |

**Los 171 del plataformer son la línea base de trabajo.** Los 56 del laberinto son la línea
base de no-regresión: deben seguir en verde intactos, sin tocarlos.

### 4.2 Entorno

Node v22.22.0. `package.json` solo declara `puppeteer-core ^25.9.0` y **no tiene `scripts`** —
los tests se invocan a mano. Hay hueco para añadir `scripts.test` sin romper nada.

---

## 5. Inventario real de mecánicas — ⚠️ MUCHO MAYOR de lo que decía la web

La página de itch.io solo enumeraba 4 trampas. **El pack real tiene 13.** Extraído de
`Documents\Games\PixelAdventureHardcore\...\Assets\Pixel Adventure 1\Assets\`, que es el pack
CC0 **sin modificar**.

> ⚠️ **El proyecto Unity que lo contiene NO es referencia** — el usuario confirma que nunca se
> terminó. Solo se toma el inventario de assets; su código se ignora.

### 5.1 Trampas — 13 tipos, con sus estados de animación

Los estados **definen el comportamiento**, así que valen como especificación:

| Trampa | Estados | Mecánica que implica |
|---|---|---|
| **Rock Head** | Blink · Idle · Top/Bottom/Left/Right Hit | Bloque que embiste en 4 direcciones; **parpadea antes de moverse** (telegrafía) |
| **Spike Head** | Blink · Idle · Top/Bottom/Left/Right Hit | Igual, pero dañino al contacto |
| **Saw** | On · Off · **Chain** | Sierra que recorre una cadena/raíl |
| **Spiked Ball** | Spiked Ball · **Chain** | Péndulo colgado de cadena |
| **Fire** | On · Off · Hit | Peligro cíclico encendido/apagado |
| **Spikes** | Idle | Peligro estático |
| **Arrow** | Idle · Hit | Proyectil / disparador |
| **Trampoline** | Idle · Jump | Impulso vertical |
| **Falling Platforms** | On · Off | Se activa al pisar y cae |
| **Platforms** | Brown On/Off · Grey On/Off · **Chain** | Plataformas móviles sobre cadena, dos variantes |
| **Fan** | On · Off | Corriente ascendente |
| **Blocks** | Idle · HitTop · HitSide · Part 1 · Part 2 | **Bloque rompible en dos pedazos** |
| **Sand Mud Ice** | Sand/Mud/Ice Particle · Sliced | **Tres tipos de fricción de superficie** |

🔑 **`Sand Mud Ice` es el hallazgo más útil**: implica que Pixel Adventure tiene **tipos de
superficie con fricción distinta**, y el motor plataformer ya exporta **`SURFACE` desde
`p_physics.js`**. Encaja directamente; no hay que inventar el sistema.

Y **`Blocks` (HitTop/HitSide/Part 1/Part 2)** mapea sobre `p_breakables.js` + `r_breakables.js`,
que ya existen con 11 tests en verde.

### 5.2 Personajes, ítems y escenarios

- **4 personajes:** Mask Dude · Ninja Frog · Pink Man · Virtual Guy → se sustituyen por los
  8 de las recetas de Borislov.
- **Ítems:** Fruits (manzana, cereza, plátano, piña…) · Boxes (Box1, Box2, Box3) ·
  **Checkpoints (Start · Checkpoint · End)** → el sistema de progresión ya está definido por
  los assets.
- **Otros:** Confetti (16×16) · Dust Particle · Shadow · Transition → mapean sobre
  `r_particles.js` y `r_transitions.js`, ya existentes.
- **Terreno:** tileset de 16×16. **Fondos:** 7 colores (Blue, Brown, Gray, Green, Pink,
  Purple, Yellow) → mapean sobre `r_parallax.js`.

### 5.3 La demo jugada en el navegador

✅ Se jugó la demo embebida (`html-classic.itch.zone/html/1680278/index.html`, 512×288).
Confirmado: se mueve con flechas, hay botones de escena arriba a la derecha, y la escena 1
tiene frutas como coleccionables sobre terreno con hierba y plataformas de madera.

🔴 **No se pudo recorrer todas las escenas**: los botones de navegación no respondieron al
clic en este entorno, y el render va a baja tasa de refresco. **El inventario de sprites de
§5.1 es mejor evidencia** que la demo, porque es exhaustivo y no depende de conseguir llegar
a cada escena.

---

## 6. Gobernanza local — diseño de la capa 3

**El problema:** el patrón de tres capas del Anexo A.2 apoya su capa ejecutable en GitHub
Actions + CODEOWNERS + PRs. Aquí el trabajo es local y el agente escribe directo en disco:
un workflow **solo corre después de que el daño ya está commiteado**.

**Diseño propuesto — un solo script, dos puntos de invocación:**

```
governance/
├── AUTONOMY.md                 # capa 1: contrato en prosa
├── policy/
│   ├── GOVERNANCE.lock.yml     # capa 2: rutas congeladas + sha256
│   └── quality-gates.yml       # capa 2: el AND booleano
├── enforce/
│   ├── verify.mjs              # ← EL script. Corre en local Y en CI
│   └── pre-write-hook.mjs      # capa 3a: intercepta escrituras, exit≠0
└── approvals/                  # registro firmado de desbloqueos
```

**Tres puntos de aplicación, de más temprano a más tarde:**

1. **`PreToolUse` hook** — intercepta la escritura **antes de que ocurra**. Es el único que
   previene en vez de detectar. Compara la ruta contra `GOVERNANCE.lock.yml` y devuelve
   exit≠0 si está congelada.
2. **`pre-commit` de git** — invoca `verify.mjs`. Red de seguridad si el hook se saltó.
3. **Workflow de CI** — invoca **el mismo `verify.mjs`**. Autoridad final cuando haya `gh`.

**Por qué un solo script:** si el gate de CI y el local divergen, el agente aprende a pasar el
local y el de CI se convierte en ruido. Un único `verify.mjs` hace que "pasa en mi máquina"
signifique exactamente lo mismo que "pasa en CI".

**Qué comprueba `verify.mjs`** (AND booleano, sin puntuaciones, §8.3.2):
`integridad de hashes del lock` ∧ `las 227 suites en verde` ∧ `PASS_TO_PASS intacto` ∧
`sin secretos en el diff` ∧ `sin escrituras a rutas congeladas`.

**Primeros candidatos a congelar:** `assets3d/rig/rig_contract.json` (mover un socket rompe
el motor), `assets3d/species/goat/goat_master.blend` (archivo de autoría), y las 3 suites de
test del laberinto.

---

## 7. Lista de NO VERIFICADO

1. 🔴 `gh` no instalado → no se puede confirmar que un workflow ejecute. Cualquier workflow
   escrito hasta entonces es un YAML, no un gate.
2. 🔴 `blender.exe` no está en el PATH → renders headless deterministas sin comprobar.
3. 🔴 Cuál de las dos instalaciones de Blender (5.0 addon legacy / 5.2 extensión) es la que
   escucha en 9876.
4. 🔴 Cómo se declara este addon MCP concreto en `opencode.jsonc`. La sintaxis `mcp` +
   `type: local|remote` está verificada; el **comando o URL correcto para este addon, no**.
5. 🔴 Coste real de LPIPS en CPU. Sin medir.
6. 🔴 Recorrido completo de escenas de la demo. Suplido por el inventario de assets.
7. ⚠️ El benchmark de VLMs (§9.2) **no se ha ejecutado**. Sigue pendiente y es requisito
   antes de asignar el rol de descriptor visual.
8. ⚠️ No se ha leído aún `game/.github/copilot-instructions.md` (16 KB) ni `game/docs/INDEX.md`
   en profundidad. Son la gobernanza vigente del repo del juego y **condicionan cómo se
   integra el clon**.

---

## 8. Recomendación de siguiente paso

Con la línea base en verde y el inventario cerrado, el orden que menos riesgo acumula:

1. **Instalar `gh` y poner `blender.exe` en el PATH** — desbloquea 2 de los 3 puntos abiertos.
2. **Escribir `verify.mjs`** y cablearlo al hook local. Es la capa 3, y sin ella la gobernanza
   del prompt es decoración.
3. **Solo entonces** el workflow de CI, que lo invoca.
4. Crear `research/games/pixel-borislov/` con su `GOALS.yml` y la primera métrica.

**Decisión abierta que sigue necesitando al humano** (§11.3.2): si los escenarios y trampas se
construyen como geometría 3D en Blender o como planos texturizados con los tilesets CC0.
