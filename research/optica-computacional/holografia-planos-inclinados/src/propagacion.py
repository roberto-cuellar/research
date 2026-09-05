"""C1 y C6 — el método de 4 pasos y su coste computacional.

C1: propagación sucesiva con espectro angular (Ecs. 2 y 3) sobre las D secciones
    del objeto inclinado, hasta obtener el holograma de amplitud en el eje.
C6: coste η·O(u·M·N·(log M + log N)), donde η es el número de operaciones FFT.

⚠️ Las ecuaciones se transcribieron del texto extraído del PDF con pymupdf, que
   deforma símbolos matemáticos. ESTÁN PENDIENTES de contrastar contra el PDF
   original. Hasta entonces esta implementación es una HIPÓTESIS de lo que el
   paper describe, no una réplica confirmada.
"""

from __future__ import annotations

import numpy as np

from geometria import Geometria

# Semilla fija: §10.1 punto 4 exige determinismo declarado.
SEMILLA = 0


class ContadorFFT:
    """C6: cuenta las FFT reales, no las estimadas.

    El paper declara el coste en función de η = número de operaciones FFT. La
    única forma honesta de verificarlo es contarlas al ejecutar, no deducirlas
    del pseudocódigo.
    """

    def __init__(self) -> None:
        self.n = 0

    def fft2(self, a: np.ndarray) -> np.ndarray:
        self.n += 1
        return np.fft.fft2(a)

    def ifft2(self, a: np.ndarray) -> np.ndarray:
        self.n += 1
        return np.fft.ifft2(a)


def transferencia_espacio_libre(
    M: int, N: int, delta_x: float, delta_y: float, lam: float, z: float
) -> np.ndarray:
    """Ec. (3): H(fx,fy;z) = exp( j·2πz/λ · sqrt(1 - (λfx)² - (λfy)²) ).

    Las frecuencias con (λfx)² + (λfy)² > 1 son ondas evanescentes: no propagan.
    Se anulan explícitamente en vez de dejar que numpy produzca un NaN, que se
    propagaría en silencio por todo el cálculo.
    """
    fx = np.fft.fftfreq(M, d=delta_x)
    fy = np.fft.fftfreq(N, d=delta_y)
    FX, FY = np.meshgrid(fx, fy, indexing="ij")

    arg = 1.0 - (lam * FX) ** 2 - (lam * FY) ** 2
    propagante = arg > 0

    H = np.zeros((M, N), dtype=np.complex128)
    H[propagante] = np.exp(1j * 2.0 * np.pi * z / lam * np.sqrt(arg[propagante]))
    return H


def propagar(U: np.ndarray, z: float, g: Geometria, contador: ContadorFFT) -> np.ndarray:
    """Ec. (2): P(U, z) = F⁻¹{ F{U} · H }.  Dos FFT por propagación."""
    H = transferencia_espacio_libre(U.shape[0], U.shape[1], g.delta_x, g.delta_x, g.lam, z)
    return contador.ifft2(contador.fft2(U) * H)


# --- Paso 1 y 2: dividir t en D secciones y sustituirlas en el arreglo T ----
def construir_T(t: np.ndarray, D: int) -> np.ndarray:
    """Ecs. (6) y (8).

    (W)d = t sobre la sección Sd, y 1 en el resto. El relleno con UNOS —no ceros—
    es lo que hace que las secciones no ocluyan la propagación de las demás:
    una transmitancia de 1 deja pasar el campo intacto.
    """
    M, N = t.shape
    if M % D != 0:
        raise ValueError(f"Restricción 1 violada (Ec. 5): M={M} mod D={D} = {M % D}, debe ser 0")

    ancho = M // D
    T = np.ones((M, N, D), dtype=t.dtype)
    for d in range(D):
        ini, fin = d * ancho, (d + 1) * ancho     # Ec. (7): dLX/D <= Sd < (d+1)LX/D
        T[ini:fin, :, d] = t[ini:fin, :]
    return T


# --- Paso 3: propagación iterativa -----------------------------------------
def propagacion_iterativa(t: np.ndarray, g: Geometria) -> tuple[np.ndarray, ContadorFFT]:
    """Propaga sucesivamente a través de las D secciones, separadas dz.

    U_{-1} es una onda plana de referencia de amplitud constante (§2.4), así que
    el campo entra como unos y cada sección lo modula antes del siguiente salto.
    """
    contador = ContadorFFT()
    T = construir_T(t, g.D)

    U = np.ones(t.shape, dtype=np.complex128)     # U_{-1}: onda plana de referencia
    for d in range(g.D):
        U = U * T[:, :, d]                        # modula con la sección d
        U = propagar(U, g.dz, g, contador)        # y salta dz al siguiente plano

    return U, contador


# --- Paso 4: holograma ------------------------------------------------------
def holograma_en_eje(U_objeto: np.ndarray, referencia: complex = 1.0 + 0j) -> np.ndarray:
    """Holograma de amplitud en el eje: I = |U_obj + U_ref|².

    En el eje, la referencia es colineal con la onda objeto. Es lo que hace que
    el holograma sea "on-axis" y también la causa del término gemelo.
    """
    return np.abs(U_objeto + referencia) ** 2


def reconstruir(hologram: np.ndarray, z: float, g: Geometria) -> np.ndarray:
    """Reconstrucción computacional: propagar el holograma la distancia inversa."""
    contador = ContadorFFT()
    return np.abs(propagar(hologram.astype(np.complex128), -z, g, contador))


def objeto_de_prueba(M: int, N: int) -> np.ndarray:
    """Objeto sintético determinista.

    ⚠️ NO es el objeto de las figs. 5b/11a del paper, que no está disponible.
    Por tanto las imágenes reconstruidas NO son comparables una a una con las
    del paper; sí lo son el conteo de FFT y las restricciones geométricas.
    """
    rng = np.random.default_rng(SEMILLA)   # declarada aunque no se use aún
    t = np.ones((M, N), dtype=np.complex128)
    t[M // 4: M // 2, N // 4: 3 * N // 4] = 0.1        # barra opaca
    t[3 * M // 5: 4 * M // 5, N // 3: N // 2] = 0.3    # bloque semiopaco
    return t


def verificar() -> dict:
    """C1 y C6, en formato máquina."""
    g = Geometria()
    t = objeto_de_prueba(g.M, g.N)

    U, contador = propagacion_iterativa(t, g)
    H = holograma_en_eje(U)
    rec = reconstruir(H, g.D * g.dz, g)

    # C6: el coste declarado es η·O(u·M·N·(log M + log N)).
    fft_por_propagacion = 2          # una fft2 + una ifft2, medido por el contador
    eta_esperado = g.D * fft_por_propagacion
    coste_teorico = eta_esperado * g.M * g.N * (np.log2(g.M) + np.log2(g.N))

    return {
        "C1_metodo_4_pasos": {
            "ejecuta_sin_error": True,
            "holograma_shape": list(H.shape),
            "holograma_finito": bool(np.all(np.isfinite(H))),
            "holograma_no_trivial": bool(H.std() > 1e-12),
            "reconstruccion_finita": bool(np.all(np.isfinite(rec))),
            # El método corre y produce un holograma no trivial. Que sea EL del
            # paper no está demostrado: falta el objeto original y contrastar
            # las ecuaciones contra el PDF.
            "replica": None,
            "nota": "ejecuta y produce holograma no trivial; equivalencia con el paper NO demostrada",
        },
        "C6_coste_computacional": {
            "afirmado": "eta * O(u*M*N*(log M + log N))",
            "fft_contadas": contador.n,
            "eta_esperado": eta_esperado,
            "fft_por_propagacion": fft_por_propagacion,
            "propagaciones": g.D,
            "coste_teorico_unidades": float(coste_teorico),
            "replica": contador.n == eta_esperado,
            "nota": "el conteo de FFT casa con D propagaciones x 2 FFT. El escalado O(MN log MN) "
                    "es propiedad de la FFT, no del metodo.",
        },
    }


if __name__ == "__main__":
    import json
    print(json.dumps(verificar(), indent=2))
