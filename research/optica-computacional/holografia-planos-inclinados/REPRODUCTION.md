# REPRODUCTION — hologramas en planos inclinados (Rayleigh-Sommerfeld)

**Paper:** Cuellar-Lozano & Rueda, *BISTUA* 19(2), 2021, pp. 15–20
**Fecha de la réplica:** 2026-09-05 · **Semilla:** 0 · **M = D = 128** (confirmado por el autor)

> **Estado: REPRODUCCIÓN PARCIAL.** No se abre la fase de mejora. §10.3 es explícita:
> saltarse la reproducción y "ir directo a mejorar" construye mejoras sobre un baseline
> mal medido, y entonces la comparación no significa nada.

---

## Tabla afirmado vs. obtenido

| Claim | Afirmado | Obtenido | Delta | ¿Replica? |
|---|---|---|---|---|
| **C2** `M mod D == 0` | 0 | 0 | — | ✅ **sí** |
| **C3** `dz` | **13.7 µm** | **10.316 µm** | **−3.384 µm (−24.7%)** | 🔴 **NO** |
| **C3b** `dz >> λ` | se cumple | 16.3× | — | ✅ **sí** |
| **C1** método de 4 pasos | genera el holograma | ejecuta, holograma no trivial y finito | — | ⚠️ **parcial** |
| **C6** coste `η·O(u·MN·(logM+logN))` | η = nº de FFT | **256 FFT contadas** = 128 propagaciones × 2 | 0 | ✅ **sí** |
| **C4** corrección de contraste | — | no intentado (depende de C1) | — | ⏸️ |
| **C5** tolerancia angular < 5° | — | **no verificable**: requiere el montaje óptico de la fig. 9 | — | ⛔ |

**3 replican, 1 no replica, 1 parcial, 1 pendiente, 1 no verificable.**

---

## 🔴 C3 — la discrepancia, y por qué no se maquilla

Aplicando la Ec. (9) del propio paper con los parámetros que el propio paper declara:

```
Sd = δx · M/D      = 19 µm × (128/128)      = 19.000 µm
dz = Sd · tan(Ω)   = 19 µm × tan(28.5°)     = 10.316 µm
paper reporta                                 13.700 µm
```

Con `M = D`, **`dz` no puede valer 13.7 µm**. Se probó el espacio de parámetros:

| Hipótesis | Resultado |
|---|---|
| Ω = **35.79°** con M = D | daría exactamente 13.7 µm |
| **M = 170** con Ω = 28.5° | daría exactamente 13.7 µm — pero M ≠ D y no es potencia de 2 |
| δx distinto en esa figura | no se puede descartar; el paper declara 19 µm |

**Tres hipótesis, ninguna confirmada.** Lo que NO se ha hecho es ajustar un parámetro
hasta que cuadre y declarar la réplica exitosa: eso es exactamente el autoengaño que
§2 principio 6 prohíbe. Se reporta con el número.

**Para el autor:** ¿es Ω = 28.5° o 35.79°? ¿O la Ec. (9) del PDF difiere de la que
extrajo `pymupdf`? Es la pregunta que cierra este claim.

---

## ⚠️ C1 — por qué es "parcial" y no "replica"

El método corre de principio a fin y produce un holograma **finito y no trivial**
(σ > 0), y la reconstrucción no diverge. Eso demuestra que el algoritmo es
*ejecutable y numéricamente sano*. **No demuestra que sea el del paper.** Faltan dos cosas:

1. **El objeto de las figs. 5b y 11a no está disponible.** Se usó un objeto sintético,
   así que las imágenes reconstruidas **no son comparables una a una** con las del paper.
2. **Las ecuaciones (2), (3), (8) y (9) se transcribieron del texto extraído con
   `pymupdf`**, que deforma símbolos matemáticos. Contrastarlas contra el PDF original
   es requisito antes de subir C1 a "replica".

---

## ✅ C6 — el claim más limpio

El contador de FFT registra **256 llamadas** = 128 propagaciones × 2 (una `fft2` +
una `ifft2` por propagación), que es exactamente η. Se contaron **ejecutando**, no
deduciendo del pseudocódigo.

Matiz honesto: el término `O(u·M·N·(log M + log N))` es una propiedad de la FFT, no
un resultado del método. Lo que el paper aporta —y esto sí se confirma— es que **el
coste escala con el número de secciones D**, porque cada una cuesta una propagación.

---

## Lo que falta para cerrar la reproducción

1. 🔴 **Resolver C3** con el autor. Bloquea la credibilidad de todo lo demás: si un
   parámetro reportado no cuadra, las figuras tampoco van a cuadrar.
2. 🔴 **Contrastar las ecuaciones contra el PDF original**, no contra el texto extraído.
3. ⚠️ **Conseguir los objetos de prueba** de las figs. 5b y 11a.
4. ⚠️ **C4** (corrección del offset de contraste) — es la afirmación más interesante,
   porque es un hallazgo de diagnóstico y no solo un método.
5. ⏸️ **C5** solo como contraparte computacional, documentada como **experimento
   distinto**, nunca como réplica (§10.3).

## Cómo reproducir

```bash
cd research/optica-computacional/holografia-planos-inclinados
PYTHONPATH=src python -c "import geometria,propagacion,json; print(json.dumps({**geometria.verificar(),**propagacion.verificar()},indent=2))"
```

Números en `results/metrics.json`. Determinista: semilla 0 declarada en `propagacion.py`.
