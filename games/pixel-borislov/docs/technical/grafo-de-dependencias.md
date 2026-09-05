---
scope: juego
reads-when: ANTES de renombrar, mover o borrar un archivo de src/
tokens-hint: bajo
generado-por: tools/dep-graph.mjs
updated: 2026-09-05
---

# Grafo de dependencias — `src/`

> ⚠️ **GENERADO POR SCRIPT. NO SE EDITA A MANO.**
> Se regenera con `node tools/dep-graph.mjs`, y **en el mismo commit** que cualquier módulo nuevo o
> movido. Un grafo que va una spec por detrás es peor que no tenerlo, porque se le cree.

31 módulos · 13.058 líneas · 3 sin clasificar

## Cómo se usa

```bash
node tools/dep-graph.mjs --quien src/player.js   # que se rompe si lo muevo
node tools/dep-graph.mjs --verificar             # violaciones de capa y ciclos
```

La columna **`afectados-por`** es la que se consulta antes de tocar un archivo: son los módulos que
dejan de compilar si cambia de nombre o desaparece.

## Módulos

| Módulo | Subsistema | Líneas | Importa | Externos | **afectados-por** |
|---|---|---:|---|---|---|
| `game.js` | sin clasificar | 4805 | `GLTFLoader.js` `d_director.js` `drone.js` `i_input.js` `p_breakables.js` `p_events.js` `p_physics.js` `p_plate.js` `p_player.js` `p_projectile.js` `p_pushable.js` `portal.js` `r_animator.js` `r_breakables.js` `r_cinematic.js` `r_equip.js` `r_parallax.js` `r_particles.js` `r_plate.js` `r_postfx.js` `r_projectile.js` `r_pushable.js` `r_secondary.js` `r_transitions.js` `s_choreo.js` `s_dialogue.js` `s_sfx.js` `w_level.js` | `three` | — |
| `portal.js` | sin clasificar | 611 | — | `three` | `game.js` |
| `drone.js` | sin clasificar | 396 | `GLTFLoader.js` | `three` | `game.js` |
| `d_director.js` | director | 263 | — | — | `game.js` |
| `i_input.js` | plataforma | 156 | `w_contracts.js` | — | `game.js` |
| `p_player.js` | playsim | 352 | `w_contracts.js` | — | `game.js` `r_animator.js` |
| `p_pushable.js` | playsim | 207 | `w_contracts.js` | — | `game.js` |
| `p_physics.js` | playsim | 169 | `w_contracts.js` | — | `game.js` `r_particles.js` |
| `p_projectile.js` | playsim | 143 | `p_events.js` | — | `game.js` |
| `p_breakables.js` | playsim | 131 | `p_events.js` `w_contracts.js` | — | `game.js` |
| `p_events.js` | playsim | 130 | — | — | `game.js` `p_breakables.js` `p_plate.js` `p_projectile.js` |
| `p_trampolin.js` | playsim | 83 | — | — | — |
| `p_plate.js` | playsim | 71 | `p_events.js` | — | `game.js` |
| `r_particles.js` | render | 719 | `p_physics.js` | `three` | `game.js` |
| `r_equip.js` | render | 664 | `GLTFLoader.js` | `three` | `game.js` |
| `r_postfx.js` | render | 568 | `EffectComposer.js` `FilmPass.js` `OutputPass.js` `RenderPass.js` `ShaderPass.js` `UnrealBloomPass.js` | `three` | `game.js` |
| `r_parallax.js` | render | 245 | — | `three` | `game.js` |
| `r_animator.js` | render | 244 | `p_player.js` | `three` | `game.js` `r_cinematic.js` |
| `r_secondary.js` | render | 233 | — | `three` | `game.js` |
| `r_transitions.js` | render | 232 | — | — | `game.js` |
| `r_cinematic.js` | render | 145 | `SkeletonUtils.js` `r_animator.js` | `three` | `game.js` |
| `r_projectile.js` | render | 115 | — | `three` | `game.js` |
| `r_plate.js` | render | 110 | — | `three` | `game.js` |
| `r_pushable.js` | render | 83 | — | `three` | `game.js` |
| `r_breakables.js` | render | 54 | — | `three` | `game.js` |
| `s_choreo.js` | sonido | 416 | — | — | `game.js` |
| `s_dialogue.js` | sonido | 302 | — | — | `game.js` |
| `s_sfx.js` | sonido | 163 | — | — | `game.js` |
| `w_level.js` | datos del mundo | 1060 | `w_contracts.js` | — | `game.js` |
| `w_nivel.js` | datos del mundo | 129 | `w_contracts.js` | — | — |
| `w_contracts.js` | datos del mundo | 59 | — | — | `i_input.js` `p_breakables.js` `p_physics.js` `p_player.js` `p_pushable.js` `w_level.js` `w_nivel.js` |

## Violaciones de capa

✅ Ninguna.

## Ciclos

✅ Ninguno.

## Hojas

Nadie los importa. Son los más baratos de mover, y el sitio por donde empezar una migración:

`game.js` · `p_trampolin.js` · `w_nivel.js`
