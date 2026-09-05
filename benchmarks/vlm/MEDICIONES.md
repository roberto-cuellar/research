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
