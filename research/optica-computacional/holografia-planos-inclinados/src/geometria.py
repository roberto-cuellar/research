"""C2 y C3 — restricciones geométricas del método (§2.2 del paper, Ecs. 5 y 9).

Es la parte más barata de verificar del paper y no depende de que la propagación
esté bien: son dos identidades aritméticas sobre los parámetros declarados.

Parámetros reportados en las figs. 10 y 11:
    δx = 19 µm · D = 128 · λ = 633 nm · Z = 0.5 m · Ω = 28.5° · dz = 13.7 µm
M = D confirmado por el autor (2026-09-05).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

# --- Parámetros del paper, tal y como se reportan --------------------------
DELTA_X = 19e-6      # m
D = 128
M = 128              # = D, confirmado por el autor
N = 128
LAMBDA = 633e-9      # m
Z = 0.5              # m
OMEGA_DEG = 28.5

DZ_AFIRMADO = 13.7e-6  # m — lo que el paper reporta


@dataclass(frozen=True)
class Geometria:
    delta_x: float = DELTA_X
    M: int = M
    N: int = N
    D: int = D
    lam: float = LAMBDA
    omega_deg: float = OMEGA_DEG

    @property
    def Lx(self) -> float:
        """Ec. (4): LX = M·δx."""
        return self.M * self.delta_x

    @property
    def Sd(self) -> float:
        """Ancho de una sección: |Sd| = δx·M/D (Ec. 7)."""
        return self.delta_x * self.M / self.D

    @property
    def dz(self) -> float:
        """Ec. (9): dz = |Sd|·tan(Ω)."""
        return self.Sd * math.tan(math.radians(self.omega_deg))

    # --- C2: restricción 1 ------------------------------------------------
    @property
    def cumple_restriccion_1(self) -> bool:
        """Ec. (5): M mod D == 0. La división debe dar un entero."""
        return self.M % self.D == 0

    # --- C3: restricción 2 ------------------------------------------------
    @property
    def razon_dz_lambda(self) -> float:
        return self.dz / self.lam

    def cumple_restriccion_2(self, factor_minimo: float = 10.0) -> bool:
        """`dz >> λ`.

        El paper no cuantifica ">>". Se fija 10x como criterio explícito: es una
        DECISIÓN NUESTRA, no del paper, y por eso está parametrizada y declarada.
        """
        return self.razon_dz_lambda >= factor_minimo

    def omega_que_daria(self, dz_objetivo: float) -> float:
        """Ω en grados que produciría un dz dado, con la M y D actuales."""
        return math.degrees(math.atan(dz_objetivo / self.Sd))


def verificar() -> dict:
    """Devuelve el contraste afirmado vs. obtenido, en formato máquina."""
    g = Geometria()
    delta = g.dz - DZ_AFIRMADO
    return {
        "C2_M_mod_D": {
            "afirmado": "M mod D == 0",
            "obtenido": g.M % g.D,
            "replica": g.cumple_restriccion_1,
        },
        "C3_dz": {
            "afirmado_m": DZ_AFIRMADO,
            "obtenido_m": g.dz,
            "delta_m": delta,
            "delta_relativo": delta / DZ_AFIRMADO,
            # ---------------------------------------------------------------
            # NO replica. Con los parámetros que el propio paper declara y M=D,
            # la Ec. (9) da 10.316 µm, no los 13.7 µm reportados: un -24.7%.
            # Esto NO se maquilla ni se ajusta un parámetro hasta que cuadre:
            # se reporta con el número (§2 principio 6).
            # ---------------------------------------------------------------
            "replica": abs(delta / DZ_AFIRMADO) < 0.01,
            "omega_que_lo_explicaria_deg": g.omega_que_daria(DZ_AFIRMADO),
        },
        "C3_restriccion_dz_mucho_mayor_que_lambda": {
            "afirmado": "dz >> lambda",
            "razon_obtenida": g.razon_dz_lambda,
            "criterio_propio": ">= 10x",
            "replica": g.cumple_restriccion_2(),
        },
        "parametros": {
            "delta_x_m": g.delta_x, "M": g.M, "N": g.N, "D": g.D,
            "lambda_m": g.lam, "Z_m": Z, "omega_deg": g.omega_deg,
            "Lx_m": g.Lx, "Sd_m": g.Sd,
        },
    }


if __name__ == "__main__":
    import json
    print(json.dumps(verificar(), indent=2))
