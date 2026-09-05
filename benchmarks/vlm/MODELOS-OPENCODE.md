# Modelos declarados en `opencode.json` — y por qué esos límites

Los `limit.context` de este fichero **no son preferencias: son el resultado de
medir la VRAM**. Ver `benchmarks/vlm/MEDICIONES.md`.

## El hallazgo que los explica

Con el `num_ctx` por defecto de Ollama (**32768**) **ningún** modelo de visión
cabe en los 8 GB de la 4060 Ti. Ni siquiera el de 3.3 GB en disco:

| Modelo | Disco | @32768 | @4096 |
|---|---|---|---|
| `qwen3-vl:4b-instruct` | 3.3 GB | 8.3 GB · 31% CPU | 3.5 GB · **100% GPU** |
| `qwen3-vl:8b-instruct` | 6.1 GB | 10 GB · 49% CPU | 6.2 GB · 11% CPU |
| `minicpm-v4.5:8b` | 6.1 GB | 10 GB · 50% CPU | 5.8 GB · 11% CPU |
| `gemma4:12b` | 7.6 GB | 9.0 GB · 36% CPU | 8.9 GB · **31% CPU** |

**El coste lo domina la caché KV, no los pesos.** Elegir un modelo por su tamaño
en disco es elegirlo mal.

`qwen3-vl:4b-instruct` es el **único que corre entero en GPU**, y aguanta así
hasta 8192 de contexto. Por eso es el descriptor visual por defecto.

`gemma4:12b` se declara pero **no baja del 31% en CPU ni a 4096**: su ocupación
no responde al contexto, así que son los pesos. Está aquí para poder compararlo,
no para usarlo en un bucle.

## Lo que estos números NO dicen

⚠️ **Ninguno de los cuatro detectó un objeto desplazado 20 px.** Los cuatro
respondieron `SIN DIFERENCIAS VISIBLES`. Se corrió un control con una escena
radicalmente distinta y ambos `qwen3-vl` la describieron bien, así que el
transporte multi-imagen funciona: el fallo es de percepción fina.

**Consecuencia:** un VLM sirve para *explicar en palabras* una diferencia que ya
detectó una métrica. **No sirve para detectarla**, y en ningún caso decide
(§14.14).

## Sobre `gemma4:26b` de la config global

`~/.config/opencode/opencode.jsonc` declara `gemma4:26b` con contexto 131072.
Son **18 GB**: no cabe, y a ese contexto ni de lejos. Esa declaración es correcta
a nivel de capacidad y engañosa a nivel de rendimiento en esta máquina.

Este fichero de proyecto **se fusiona sobre el global**, así que los modelos de
aquí son los que valen dentro de `open_code`. La entrada global se deja intacta
porque es tuya y puede que la uses en otros proyectos.
