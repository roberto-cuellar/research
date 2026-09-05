"""Cascada de validación visual (§8.2).

REGLA INNEGOCIABLE: un VLM NO es una métrica. El modelo de visión nunca decide
si algo pasa o falla — no es determinista, no es reproducible entre ejecuciones,
y no se puede calibrar un umbral estable sobre él. Si el VLM es el gate, el
criterio de aceptación cambia de humor entre iteraciones y el bucle de
convergencia deja de significar nada.

    El VLM describe. La métrica programática decide.

Niveles, de barato a caro, cortando en el primer fallo:

    1  MSE == 0    "¿cambió algo?"          atajo, no es gate
    2  SSIM        "¿coincide la estructura?"  GATE
    3  LPIPS       "¿se percibe igual?"        GATE — pendiente de medir en CPU
    4  VLM         "¿en qué difieren?"         NUNCA es gate

Prerrequisito que hace válidos los niveles 1-3: los renders deben ser
DETERMINISTAS (semilla, cámara, luz y viewport fijos). Si no lo son, estos
niveles producen falsos positivos.

Uso:
    python tools/metrics/visual.py ref.png cap.png --umbral 0.95
    python tools/metrics/visual.py ref.png cap.png --json
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
from PIL import Image
from skimage.metrics import structural_similarity


@dataclass
class Resultado:
    nivel: int
    metrica: str
    valor: float | None
    umbral: float | None
    decide: bool          # ¿este nivel es gate?
    pasa: bool | None
    detalle: str


def cargar(ruta: Path) -> np.ndarray:
    """Carga en RGB uint8. Sin conversiones implícitas de tamaño: si difieren, es un fallo."""
    with Image.open(ruta) as im:
        return np.asarray(im.convert("RGB"), dtype=np.uint8)


def mse(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.mean((a.astype(np.float64) - b.astype(np.float64)) ** 2))


def ssim(a: np.ndarray, b: np.ndarray) -> float:
    # channel_axis=-1 compara los tres canales y promedia. En escala de grises
    # daría un número distinto: se deja explícito para que sea reproducible.
    return float(structural_similarity(a, b, channel_axis=-1))


def cascada(ref: Path, cap: Path, umbral_ssim: float = 0.95) -> list[Resultado]:
    a, b = cargar(ref), cargar(cap)

    if a.shape != b.shape:
        # No se reescala. Un cambio de tamaño del viewport invalida la
        # comparación entera; enmascararlo con un resize produciría un número
        # que parece válido y no lo es.
        return [Resultado(0, "shape", None, None, True, False,
                          f"dimensiones distintas: {a.shape} vs {b.shape}. "
                          "El render no es determinista o cambió el viewport.")]

    salida: list[Resultado] = []

    # --- Nivel 1: MSE como detector binario -------------------------------
    # MSE está DESCARTADO como métrica de calidad: penaliza un desplazamiento de
    # 2 px igual que un objeto ausente. Solo sirve para "¿cambió algo?".
    v_mse = mse(a, b)
    if v_mse == 0.0:
        # decide=True SOLO en este caso. MSE está descartado como métrica de
        # CALIDAD, pero "los bytes son idénticos" sí es una decisión
        # determinista y final: no hay nada que los niveles siguientes puedan
        # añadir. Marcarlo como no-decisivo dejaba el AND sin ningún gate con
        # valor, y un AND sobre el conjunto vacío daba FALLA para dos imágenes
        # iguales.
        salida.append(Resultado(1, "mse", 0.0, None, True, True,
                                "idéntico píxel a píxel: se salta el resto de la cascada"))
        return salida
    salida.append(Resultado(1, "mse", v_mse, None, False, None,
                            "hay diferencia; se continúa a los niveles que sí deciden"))

    # --- Nivel 2: SSIM, el gate ------------------------------------------
    v_ssim = ssim(a, b)
    salida.append(Resultado(2, "ssim", v_ssim, umbral_ssim, True, v_ssim >= umbral_ssim,
                            f"estructura {'coincide' if v_ssim >= umbral_ssim else 'DIFIERE'} "
                            f"({v_ssim:.4f} vs umbral {umbral_ssim})"))

    # --- Nivel 3: LPIPS ---------------------------------------------------
    # NO se implementa todavía a propósito. torch instaló en variante +cpu en
    # esta máquina (cuda.is_available() == False), así que LPIPS no usaría la
    # 4060 Ti. §8.2 exige medir su latencia ANTES de meterlo en el bucle.
    salida.append(Resultado(3, "lpips", None, None, True, None,
                            "NO IMPLEMENTADO — requiere medir latencia en CPU primero (§8.2)"))

    return salida


def veredicto(resultados: list[Resultado]) -> bool:
    """AND booleano de los niveles que deciden y tienen valor. Sin puntuaciones."""
    gates = [r for r in resultados if r.decide and r.pasa is not None]
    return bool(gates) and all(r.pasa for r in gates)


def main() -> int:
    p = argparse.ArgumentParser(description="Cascada de validación visual (§8.2)")
    p.add_argument("referencia", type=Path)
    p.add_argument("captura", type=Path)
    p.add_argument("--umbral", type=float, default=0.95, help="umbral de SSIM")
    p.add_argument("--json", action="store_true")
    args = p.parse_args()

    for ruta in (args.referencia, args.captura):
        if not ruta.exists():
            print(f"no existe: {ruta}", file=sys.stderr)
            return 2

    res = cascada(args.referencia, args.captura, args.umbral)
    ok = veredicto(res)

    if args.json:
        print(json.dumps({"pasa": ok, "niveles": [asdict(r) for r in res]}, indent=2))
    else:
        print(f"cascada visual  {args.referencia.name} vs {args.captura.name}\n")
        for r in res:
            if r.pasa is None:
                mark = "·"
            else:
                mark = "OK" if r.pasa else "XX"
            val = "—" if r.valor is None else f"{r.valor:.6g}"
            gate = "GATE" if r.decide else "    "
            print(f"  {mark:2}  L{r.nivel} {gate} {r.metrica:6} {val:>12}   {r.detalle}")
        print()
        print("PASA" if ok else "FALLA")
        print("\nEl VLM, si se invoca, solo DESCRIBE la diferencia. No decide (§14.14).")

    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
