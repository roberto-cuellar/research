# Deuda técnica — pixel-borislov

Regla que `tests/arquitectura.test.mjs` hace cumplir: **ningún `// TODO` en `src/`
sin su entrada `TDB-NNN` aquí**. Un pendiente sin registrar es un pendiente que
nadie va a hacer: no sale en ninguna lista y se descubre por casualidad.

El proyecto arranca **sin TODOs propios**: el código heredado vino limpio y las
suites lo confirman.

---

## Deuda heredada por la COPIA del motor

No son TODOs en el código; son consecuencias de haber forkeado. Se registran aquí
porque nadie más las va a recordar.

### TDB-001 — El fork diverge de `MrHector/game`
Los 29 módulos se copiaron el 2026-09-05. A partir de ahí, cualquier arreglo en el
original **no llega solo**. Fue una decisión consciente para mantener `MrHector`
en solo lectura (§14.11), y este es su coste.

**Mitigación:** `knowledge_base/legacy_index.md` registra qué se copió y desde qué
commit, para poder comparar cuando haga falta.

### TDB-002 — La colisión es discreta, no barrida
`p_physics.js` resuelve por ejes con comprobación de posición final, sin *sweep
test*. A velocidad alta o `dt` grande hay riesgo de atravesar paredes finas.

**Por qué importa aquí:** Pixel Adventure tiene plataformas finas y trampas
rápidas —sierras sobre raíl, bolas pendulares—, así que este límite se va a tocar
antes que en el juego original. Ya está en la memoria como lección.

### TDB-003 — La versión del navegador de los golden visuales no está anclada
Playwright usa el Chrome del sistema porque la descarga del Chromium empaquetado
se corta en esta máquina. Una actualización de Chrome puede mover el antialiasing
y romper baselines **sin que cambie una línea de código**.

**Mitigación:** en CI sí se usa el Chromium empaquetado.

### ~~TDB-004 — Sin render determinista~~ · CERRADA 2026-09-05
`tools/build_scenario.py` genera escenas con cámara ortográfica fija, semilla
fija, sin denoiser y en CPU. **Verificado: dos renders independientes dan
MSE = 0** sobre una imagen no trivial (media 183.9, 2929 colores).

El matiz que importa: la primera comprobación dio MSE = 0 sobre un fotograma
**negro**, y no demostraba nada. Un render en blanco también es determinista.
Por eso la verificación incluye ahora que la imagen no sea trivial.

### TDB-005 — `blender.exe` sigue fuera del PATH
Los scripts se invocan por ruta absoluta a `C:\Program Files\Blender Foundation\Blender 5.2\`.
Funciona, pero ata los comandos a esa ruta y a esa versión.
