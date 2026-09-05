# Inventario del código heredado — clasificación §3.2

## REUTILIZAR — copiado tal cual a `games/pixel-borislov/`

**Origen:** `MrHector/game`, rama `laberinto/vidas-linterna-y-telon`, commit `952c664`.
**Copiado:** 2026-09-05. **`MrHector` no se tocó**: es solo lectura (§14.11).

### 29 módulos — cierre transitivo real, no la lista del documento

`game.js` importa **27** módulos. El cierre transitivo añade **`w_contracts.js`**,
del que `p_physics.js` reexporta `SURFACE`. Total con `game.js`: **29 ficheros**.

> ⚠️ El documento maestro decía 27. Se verificó leyendo los `import`, no confiando
> en la lista. El grafo generado confirma: **29 módulos · 0 violaciones · 0 ciclos**.

| Necesidad del clon | Módulos |
|---|---|
| Entrada y acciones | `i_input.js` |
| **Colisión y superficies** | `p_physics.js`, `w_contracts.js` (define `SURFACE`) |
| **Jugador y máquina de estados** | `p_player.js` (`TUNING`) |
| Animación | `r_animator.js`, `r_secondary.js` |
| **Definición de nivel** | `w_level.js` |
| Plataformas y placas | `p_pushable.js`+`r_pushable.js`, `p_plate.js`+`r_plate.js` |
| Rompibles | `p_breakables.js`+`r_breakables.js` |
| Proyectiles | `p_projectile.js`+`r_projectile.js` |
| Equipo en sockets | `r_equip.js` |
| Portales entre capas Z | `portal.js` |
| Bus de eventos | `p_events.js` |
| Parallax, partículas, post-FX | `r_parallax.js`, `r_particles.js`, `r_postfx.js` |
| Transiciones y cinemáticas | `r_transitions.js`, `r_cinematic.js` |
| Coreografía, diálogo, sonido | `s_choreo.js`, `s_dialogue.js`, `s_sfx.js` |
| Director e IA | `d_director.js`, `drone.js` |

### 11 suites — línea base PASS_TO_PASS

**155 tests en verde**, medidos en este fork. No 171: ese era el total en MrHector
con 47 módulos, y `sintaxis.test.mjs` escanea los ficheros **presentes** (31 aquí).
El resto de suites da exactamente lo mismo que en el original.

### Datos y herramientas

- `public/audio/choreography.json` — lo exige `level.test.mjs`.
- `tools/dep-graph.mjs` — genera `docs/technical/grafo-de-dependencias.md`, que
  `arquitectura.test.mjs` exige al día.

## DESCARTAR — los módulos del laberinto (§14.11c)

`g_maze.js`, `r_maze.js`, `w_maze.js`, `w_maze_retos.js`, `hu_maze.js`,
`hu_vallas.js`, `p_maze_*.js`, `r_fondo.js`, `r_niebla.js`, `r_aura.js`,
`r_cine.js`, `p_cadena.js`, `r_procanim.js`.

**Razón:** el repo `game` contiene **dos juegos**. La base del clon es el
plataformer; el laberinto es un subsistema que aquél carga bajo demanda. Verificado
leyendo los imports: ninguno entra en el cierre transitivo de `game.js`.

## ADAPTAR

- **`docs/TECH_DEBT.md`** — no se copió el de MrHector (64 KB de deuda ajena). Se
  escribió uno propio con la deuda que **esta copia** introduce (TDB-001 a TDB-004).
- **`docs/technical/grafo-de-dependencias.md`** — regenerado para estos 29 módulos.
  Copiar el de 47 habría dejado un mapa que miente, y el test lo habría cazado.
