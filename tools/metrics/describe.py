"""Descriptor visual por VLM local (§8.2, nivel 6).

Lo que este módulo hace: pedirle a un modelo de visión que explique EN PALABRAS
en qué difieren dos imágenes. Ese texto va a `attempts.jsonl` y alimenta la
siguiente iteración del bucle.

Lo que este módulo NO hace, y no debe hacer nunca: decidir si algo pasa o falla.
La API está diseñada para que sea difícil equivocarse — `describir()` devuelve
un objeto sin ningún campo booleano, sin score y sin veredicto. Si alguien
quiere un pass/fail, tiene que ir a `visual.py`, que es determinista.

    "El modelo propone y explica; el verificador decide."

VRAM (medido el 2026-09-05, ver benchmarks/vlm/MEDICIONES.md):
    Con el num_ctx por defecto de Ollama (32768) NINGÚN candidato cabe en 8 GB;
    hasta el de 3.3 GB en disco ocupa 8.3 GB y se parte a CPU. El coste lo
    domina la caché KV, no los pesos. Por eso aquí num_ctx SIEMPRE se declara.
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

OLLAMA = "http://localhost:11434"

# Único candidato medido que corre 100% en GPU con 8 GB de VRAM.
# Los dos de 8B se quedan al 89%; gemma4:12b no baja del 31% en CPU.
MODELO_POR_DEFECTO = "qwen3-vl:4b-instruct"

# Nunca el valor por defecto de Ollama: 32768 parte cualquier modelo a CPU.
NUM_CTX = 4096

PROMPT = """Compara estas dos imagenes. La primera es la REFERENCIA, la segunda es la CAPTURA.

Describe UNICAMENTE en que difieren, de forma concreta y breve:
- que elemento cambio
- donde esta (posicion aproximada)
- como cambio (color, tamano, posicion, ausencia)

Si no ves ninguna diferencia, di exactamente: SIN DIFERENCIAS VISIBLES.
No juzgues si esta bien o mal. No des una puntuacion. Solo describe."""


@dataclass(frozen=True)
class Descripcion:
    """Deliberadamente SIN campos `pasa`, `score` ni `veredicto`.

    Si esta clase tuviera un booleano, alguien acabaría usándolo como gate.
    """
    modelo: str
    texto: str
    latencia_s: float
    num_ctx: int

    def __str__(self) -> str:
        return self.texto


def _b64(ruta: Path) -> str:
    return base64.b64encode(ruta.read_bytes()).decode("ascii")


def describir(
    referencia: Path,
    captura: Path,
    modelo: str = MODELO_POR_DEFECTO,
    num_ctx: int = NUM_CTX,
    timeout: int = 180,
) -> Descripcion:
    """Pide al VLM que explique la diferencia. Devuelve texto, nunca un veredicto."""
    cuerpo = json.dumps({
        "model": modelo,
        "prompt": PROMPT,
        "images": [_b64(referencia), _b64(captura)],
        "stream": False,
        "options": {
            "num_ctx": num_ctx,
            # Temperatura 0 no hace determinista a un VLM —por eso no es gate—
            # pero reduce la varianza entre ejecuciones del mismo par.
            "temperature": 0,
        },
    }).encode("utf-8")

    req = urllib.request.Request(
        f"{OLLAMA}/api/generate", data=cuerpo,
        headers={"Content-Type": "application/json"},
    )

    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            datos = json.loads(r.read())
    except urllib.error.URLError as e:
        raise RuntimeError(f"Ollama no responde en {OLLAMA}: {e}") from e
    latencia = time.perf_counter() - t0

    return Descripcion(
        modelo=modelo,
        texto=datos.get("response", "").strip(),
        latencia_s=round(latencia, 2),
        num_ctx=num_ctx,
    )


def main() -> int:
    p = argparse.ArgumentParser(description="Descriptor visual por VLM (NO es un gate)")
    p.add_argument("referencia", type=Path)
    p.add_argument("captura", type=Path)
    p.add_argument("--modelo", default=MODELO_POR_DEFECTO)
    p.add_argument("--num-ctx", type=int, default=NUM_CTX)
    p.add_argument("--json", action="store_true")
    args = p.parse_args()

    d = describir(args.referencia, args.captura, args.modelo, args.num_ctx)

    if args.json:
        print(json.dumps(d.__dict__, indent=2, ensure_ascii=False))
    else:
        print(f"modelo: {d.modelo}  ·  num_ctx: {d.num_ctx}  ·  {d.latencia_s}s\n")
        print(d.texto)
        print("\n--- Esto es una DESCRIPCIÓN, no un veredicto. El pass/fail lo da visual.py. ---")

    # Exit 0 SIEMPRE que el modelo respondiera. El código de salida de este
    # script no puede significar "pasa/falla": eso lo convertiría en un gate.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
