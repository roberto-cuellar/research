# Benchmark VLM — mediciones de ocupación de VRAM

**Fecha:** 2026-09-05 · **Máquina:** RTX 4060 Ti, 8 GB VRAM (8188 MiB) · **Ollama:** puerto 11434

> ⚠️ **Esto NO es `RESULTS.md`.** Aquí solo hay ocupación de VRAM y reparto CPU/GPU.
> La precisión de detección de diferencias y la calidad de la descripción —que es lo
> que decide el rol de descriptor visual (§9.2)— **no están medidas todavía**: hace
> falta primero el dataset de 20–30 pares del dominio real.

---

## 1. El hallazgo que corrige un supuesto del prompt maestro

§5.2 planteaba la disyuntiva como *"¿gana la capacidad del 8B cuantizado a q4, o la
limpieza del 4B a q8?"*, dando por hecho que ambos caben en 8 GB porque su tamaño en
disco lo sugiere.

🔴 **Falso con el contexto por defecto.** Medido ejecutándolos:

| Modelo | Disco | Ocupación real @ `num_ctx` 32768 | Reparto |
|---|---|---|---|
| `qwen3-vl:4b-instruct` | 3.3 GB | **8.3 GB** | 31% CPU / 69% GPU |
| `qwen3-vl:8b-instruct` | 6.1 GB | **10 GB** | 49% CPU / 51% GPU |
| `minicpm-v4.5:8b` | 6.1 GB | **10 GB** | 50% CPU / 50% GPU |
| `gemma4:12b` | 7.6 GB | **9.0 GB** | 36% CPU / 64% GPU |

**Ninguno de los cuatro cabe.** Incluso el de 3.3 GB en disco ocupa 8.3 GB y se parte
a CPU. **El culpable es la caché KV del contexto de 32768, no los pesos.** Elegir modelo
por su tamaño en disco es elegir mal.

## 2. Con el contexto acotado

| Modelo | @ `num_ctx` 4096 | | @ `num_ctx` 8192 | |
|---|---|---|---|---|
| | ocupación | reparto | ocupación | reparto |
| **`qwen3-vl:4b-instruct`** | 3.5 GB | **100% GPU** ✅ | 4.2 GB | **100% GPU** ✅ |
| `qwen3-vl:8b-instruct` | 6.2 GB | 11% CPU / 89% GPU | 6.9 GB | 20% CPU / 80% GPU |
| `minicpm-v4.5:8b` | 5.8 GB | 11% CPU / 89% GPU | 6.4 GB | 18% CPU / 82% GPU |
| `gemma4:12b` | 8.9 GB | 31% CPU / 69% GPU | 8.9 GB | 33% CPU / 67% GPU |

### Lo que esto decide y lo que no

**Decide:**
- **`qwen3-vl:4b-instruct` es el único candidato que corre entero en GPU**, y le sobra
  margen hasta 8192 de contexto. Es el único que no paga peaje de CPU en cada llamada.
- **`gemma4:12b` queda descartado con el dato**: no baja del 31% en CPU ni acotando el
  contexto a 4096. Su ocupación no responde al contexto, así que son los pesos.
- Los dos de 8B se quedan al 89% de GPU en el mejor caso. Utilizables, pero cada
  invocación arrastra un 11% de cómputo en CPU.

**No decide:** cuál acierta más. Un modelo que corre entero en GPU y falla la detección
de diferencias no sirve para nada. **La precisión sigue sin medirse** y es lo que manda.

## 3. Consecuencia para la regla de VRAM (§5.2)

La regla *"nunca más de un modelo grande residente"* se queda corta. Lo correcto es:

> **Nunca más de un modelo residente, y con `num_ctx` declarado explícitamente.**
> El valor por defecto de Ollama (32768) hace que hasta un modelo de 3.3 GB se parta
> a CPU. Toda invocación del descriptor visual debe fijar `options.num_ctx`.

Esto refuerza el patrón de **evaluación visual por lotes**: si cada swap cuesta segundos
y además hay que acertar el contexto, agrupar N capturas en una pasada no es una
optimización, es la única forma sensata de usarlo.

## 4. Lo que falta para poder escribir `RESULTS.md`

1. Dataset de **20–30 pares (captura, referencia)** del dominio real: renders de Blender
   y UI del juego. Con etiquetas humanas `igual`/`difiere` + descripción.
2. Casos difíciles a propósito: una sombra, un objeto desplazado 20 px, un color
   ligeramente distinto, texto ilegible.
3. Por candidato: **precisión de detección**, **calidad de la descripción** y **latencia
   en régimen** (no la de la primera llamada, que incluye la carga del modelo).
4. Una recomendación **con su número**.

## 5. `NO VERIFICADO`

- 🔴 **Latencia real.** Los tiempos de primera respuesta (6–16 s) incluyen la carga del
  modelo desde disco. No sirven como medida de latencia y no se reportan como tal.
- 🔴 **Precisión de detección de diferencias.** Sin dataset, sin medida.
- 🔴 **Degradación por cuantización en grounding de coordenadas.** Los benchmarks
  públicos de `qwen3-vl` (ScreenSpot 94.4%) son de los **pesos oficiales**, no de los
  GGUF de Ollama. Sigue sin medirse.
- ⚠️ La ocupación se leyó de `ollama ps` tras una inferencia trivial de texto. **Una
  petición con imagen puede ocupar más**: el encoder visual y los tokens de imagen no
  entraron en esta medición.

## Cómo reproducir

```bash
curl -s http://localhost:11434/api/generate \
  -d '{"model":"qwen3-vl:4b-instruct","prompt":"di ok","stream":false,"options":{"num_ctx":4096}}'
ollama ps
ollama stop qwen3-vl:4b-instruct
```

---

# 6. Precisión de detección — primera medición (2026-09-05)

Caso de prueba: escena sintética determinista de 400×300 (suelo, caja, sol) con
**una caja desplazada 20 px a la derecha**. Es literalmente uno de los casos
difíciles que §9.2 prescribe. Fixtures en `tools/metrics/fixtures/`.

## 6.1 Los cuatro VLM fallan el caso de 20 px

| Modelo | Latencia | Respuesta |
|---|---|---|
| `qwen3-vl:4b-instruct` | 2.5 s | `SIN DIFERENCIAS VISIBLES` ❌ |
| `qwen3-vl:8b-instruct` | 11.5 s | `SIN DIFERENCIAS VISIBLES` ❌ |
| `minicpm-v4.5:8b` | 7.2 s | `SIN DIFERENCIAS VISIBLES` ❌ |
| `gemma4:12b` | 71.9 s | `SIN DIFERENCIAS VISIBLES` ❌ |

**Control ejecutado antes de concluir.** Cabía la duda de que Ollama no pasara
las dos imágenes al modelo. Se repitió con una captura radicalmente distinta
(fondo rojo, círculo blanco con texto) y **ambos `qwen3-vl` describieron las dos
imágenes con precisión**, enumerando los elementos de cada una. El transporte
multi-imagen funciona: **el fallo con 20 px es del modelo, no del cableado.**

> Sin este control, la conclusión habría sido una acusación infundada al modelo.
> Es exactamente el principio 1 de §2 aplicado a la propia medición.

## 6.2 SSIM tampoco lo caza con el umbral por defecto

Barrido sobre la misma escena, variando solo el desplazamiento:

| Desplazamiento | SSIM | MSE | ¿pasa @0.95? | @0.98 | @0.99 |
|---|---|---|---|---|---|
| 1 px | 0.9953 | 21 | sí | sí | sí |
| 2 px | 0.9919 | 42 | sí | sí | sí |
| 5 px | 0.9855 | 106 | sí | sí | **NO** |
| 10 px | 0.9805 | 212 | sí | sí | **NO** |
| 20 px | 0.9719 | 424 | sí | **NO** | **NO** |
| 40 px | 0.9547 | 848 | sí | **NO** | **NO** |
| 80 px | 0.9364 | 1294 | **NO** | **NO** | **NO** |

🔑 **Con el umbral 0.95 de la plantilla de §6.3, un objeto tiene que moverse
80 px —el 20% del ancho de la imagen— antes de que SSIM lo rechace.** Ese valor
por defecto es demasiado permisivo para validación de escenas.

**Recomendación con su número:** para escenas de este tipo, `target: 0.98` caza
desplazamientos ≥20 px y `0.99` los caza desde 5 px. El valor concreto depende
del contenido, así que **cada `GOALS.yml` debe calibrar el suyo con un barrido
como este**, no heredar 0.95.

## 6.3 La conclusión incómoda

Para el caso de 20 px **fallaron a la vez la métrica barata y el describidor
caro**. Eso no invalida el patrón "el VLM describe, la métrica decide" — lo
refuerza: si el VLM hubiera sido el gate, habría dado un falso VERDE con toda
naturalidad, y no habría forma de calibrarlo.

Lo que sí invalida es la idea de que SSIM sola baste. Es el argumento de §8.2
—*"ninguna métrica aislada captura la percepción humana"*— pero ahora con un
número propio en esta máquina. **Refuerza la prioridad de medir LPIPS**, que es
la métrica primaria recomendada para renders y la que mejor correlaciona con la
percepción.

## 6.4 `NO VERIFICADO` que añade esta medición

- 🔴 **LPIPS sobre este mismo barrido.** Es la comprobación que decidiría si
  LPIPS aporta lo que SSIM no da. Sin medir.
- ⚠️ **La escena de prueba es sintética.** Un render de Blender y una captura de
  UI del juego tienen estadísticas distintas. El dataset real de 20–30 pares
  sigue siendo necesario; esto es un caso, no un benchmark.
- ⚠️ **Un solo prompt probado.** No se descarta que otro prompt (por ejemplo,
  pidiendo coordenadas explícitas en vez de descripción libre) mejore la
  detección de `qwen3-vl`, que es SOTA en *UI grounding*.
