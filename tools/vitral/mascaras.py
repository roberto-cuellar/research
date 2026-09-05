"""Generador de máscaras de silueta para los vitrales.

QUÉ ES UNA MÁSCARA AQUÍ
-----------------------
Un PNG en escala de grises del tamaño del cuadro. **El blanco es figura y el
negro es fondo**; los grises intermedios son el plano medio. Es lo único que
decide la FORMA del vitral: el shader no sabe qué está dibujando, solo dónde
hay figura.

Consecuencia práctica: **cambiar la máscara cambia el vitral entero** sin tocar
una línea de shader. Puedes abrir el PNG en cualquier editor, repintarlo, y
volver a hornear.

⚠️ LO QUE GENERA ESTE FICHERO ES ARTE DE RELLENO
------------------------------------------------
Las siluetas se componen con primitivas —elipses, polígonos, arcos— y **no
pretenden ser la ilustración final**. Existen para que el pipeline entero
—máscara → shader → capas → navegador— se pueda cerrar y medir hoy, y para que
tengas un fichero con las dimensiones y el encuadre correctos sobre el que
pintar encima.

Sustituir una máscara por una pintada a mano no requiere cambiar nada: mismo
nombre, mismo tamaño, y a hornear.

    python tools/vitral/mascaras.py --guion games/dorian-intro/assets/guion.json
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

# Tres niveles y solo tres: el shader los lee como figura / medio / fondo.
FIGURA, MEDIO, FONDO = 255, 128, 0


def lienzo(ancho: int, alto: int) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    im = Image.new("L", (ancho, alto), FONDO)
    return im, ImageDraw.Draw(im)


def _guerrero(d, cx, base, alto, ancho, nivel=FIGURA, mirando=1):
    """Silueta humanoide de pie: cabeza, torso, piernas, brazo con arma."""
    cab = alto * 0.16
    d.ellipse([cx - cab / 2, base - alto, cx + cab / 2, base - alto + cab], fill=nivel)
    hombro = base - alto + cab * 0.9
    d.polygon([
        (cx - ancho / 2, base), (cx - ancho * 0.38, hombro),
        (cx + ancho * 0.38, hombro), (cx + ancho / 2, base),
    ], fill=nivel)
    # Arma: una línea larga inclinada, que es lo que lee como "guerrero".
    px = cx + mirando * ancho * 0.45
    d.line([(px, hombro + alto * 0.05), (px + mirando * ancho * 0.5, base - alto * 1.05)],
           fill=nivel, width=max(2, int(ancho * 0.09)))


def _dragon(d, cx, base, alto, ancho, nivel=FIGURA, mirando=-1):
    """Dragón antropomórfico: cuerpo, cuello curvo, cabeza con cuernos, ala."""
    d.polygon([
        (cx - ancho * 0.34, base), (cx - ancho * 0.22, base - alto * 0.55),
        (cx + ancho * 0.22, base - alto * 0.55), (cx + ancho * 0.34, base),
    ], fill=nivel)
    # Cuello: arco de círculos, que da una curva suave sin trigonometría fina.
    for t in range(14):
        f = t / 13
        x = cx + mirando * ancho * 0.30 * f
        y = base - alto * (0.55 + 0.30 * f)
        r = ancho * (0.13 - 0.04 * f)
        d.ellipse([x - r, y - r, x + r, y + r], fill=nivel)
    hx, hy = cx + mirando * ancho * 0.30, base - alto * 0.85
    d.ellipse([hx - ancho * 0.16, hy - ancho * 0.11, hx + ancho * 0.16, hy + ancho * 0.11], fill=nivel)
    d.polygon([(hx + mirando * ancho * 0.16, hy),
               (hx + mirando * ancho * 0.34, hy + ancho * 0.05),
               (hx + mirando * ancho * 0.16, hy + ancho * 0.09)], fill=nivel)   # hocico
    for s in (-1, 1):                                                          # cuernos
        d.polygon([(hx - ancho * 0.05 * s, hy - ancho * 0.09),
                   (hx - ancho * 0.16 * s, hy - ancho * 0.30),
                   (hx + ancho * 0.02 * s, hy - ancho * 0.10)], fill=nivel)
    d.polygon([(cx, base - alto * 0.50), (cx - mirando * ancho * 0.62, base - alto * 0.92),
               (cx - mirando * ancho * 0.50, base - alto * 0.30)], fill=nivel)  # ala


def _arco_ventana(d, ancho, alto, grosor):
    """Marco de vitral: arco de medio punto sobre jambas, como en el Minish Cap."""
    m = int(min(ancho, alto) * 0.06)
    d.arc([m, m, ancho - m, alto * 1.05], 180, 360, fill=FIGURA, width=grosor)
    d.line([(m, alto * 0.52), (m, alto - m)], fill=FIGURA, width=grosor)
    d.line([(ancho - m, alto * 0.52), (ancho - m, alto - m)], fill=FIGURA, width=grosor)


def _montanas(d, ancho, alto, nivel=MEDIO):
    base = alto * 0.86
    for cx, h, w in ((ancho * 0.25, alto * 0.30, ancho * 0.34),
                     (ancho * 0.55, alto * 0.42, ancho * 0.40),
                     (ancho * 0.82, alto * 0.26, ancho * 0.30)):
        d.polygon([(cx - w / 2, base), (cx, base - h), (cx + w / 2, base)], fill=nivel)


def _reino(d, ancho, alto, nivel=MEDIO):
    base = alto * 0.90
    for i in range(9):
        x = ancho * (0.10 + i * 0.09)
        h = alto * (0.10 + 0.09 * ((i * 7) % 4) / 3)
        w = ancho * 0.045
        d.rectangle([x - w / 2, base - h, x + w / 2, base], fill=nivel)
        if i % 3 == 1:   # torre con almena
            d.polygon([(x - w / 2, base - h), (x, base - h - alto * 0.06), (x + w / 2, base - h)], fill=nivel)


def _ejercito(d, ancho, alto, nivel=MEDIO):
    base = alto * 0.88
    for i in range(11):
        x = ancho * (0.06 + i * 0.085)
        h = alto * 0.11
        d.ellipse([x - ancho * 0.011, base - h, x + ancho * 0.011, base - h + ancho * 0.022], fill=nivel)
        d.rectangle([x - ancho * 0.014, base - h + ancho * 0.02, x + ancho * 0.014, base], fill=nivel)
        d.line([(x + ancho * 0.02, base), (x + ancho * 0.02, base - h * 1.5)], fill=nivel, width=2)


# --- una función por cuadro. La clave es el `id` del guion. -----------------

def cuadro_01_siluetas(d, w, h):
    """David y Goliat: dos guerreros enfrentados, uno grande y uno pequeño."""
    _montanas(d, w, h, MEDIO)
    _guerrero(d, w * 0.30, h * 0.86, h * 0.34, w * 0.09, FIGURA, mirando=1)
    _guerrero(d, w * 0.70, h * 0.86, h * 0.62, w * 0.17, FIGURA, mirando=-1)


def cuadro_02_rey_vs_dragon(d, w, h):
    _montanas(d, w, h, MEDIO)
    _guerrero(d, w * 0.26, h * 0.87, h * 0.44, w * 0.12, FIGURA, mirando=1)
    _dragon(d, w * 0.68, h * 0.87, h * 0.68, w * 0.30, FIGURA, mirando=-1)


def cuadro_03_caida(d, w, h):
    """La pata aplastando la cabeza. El ejército, al fondo, en plano medio."""
    _ejercito(d, w, h, MEDIO)
    _dragon(d, w * 0.62, h * 0.80, h * 0.74, w * 0.34, FIGURA, mirando=-1)
    # Pata sobre la cabeza caída, abajo a la izquierda.
    d.polygon([(w * 0.30, h * 0.86), (w * 0.46, h * 0.62), (w * 0.52, h * 0.88)], fill=FIGURA)
    d.ellipse([w * 0.24, h * 0.84, w * 0.34, h * 0.92], fill=FIGURA)
    for i in range(3):                                   # garras
        x = w * (0.30 + i * 0.05)
        d.polygon([(x, h * 0.86), (x + w * 0.02, h * 0.93), (x + w * 0.04, h * 0.86)], fill=FIGURA)


def cuadro_04_heroe(d, w, h):
    """Contraluz: la luna es figura, el héroe es figura, el reino queda al fondo."""
    d.ellipse([w * 0.60, h * 0.10, w * 0.82, h * 0.42], fill=FIGURA)   # luna
    _reino(d, w, h, MEDIO)
    _montanas(d, w, h, MEDIO)
    _guerrero(d, w * 0.34, h * 0.80, h * 0.50, w * 0.14, FIGURA, mirando=1)
    # Capa: el rasgo que lo hace leer como héroe y no como soldado.
    d.polygon([(w * 0.30, h * 0.48), (w * 0.20, h * 0.82), (w * 0.38, h * 0.80)], fill=FIGURA)


def cuadro_05_batalla(d, w, h):
    _dragon(d, w * 0.66, h * 0.88, h * 0.72, w * 0.32, FIGURA, mirando=-1)
    # El héroe LANZADO: inclinado, no de pie.
    d.polygon([(w * 0.30, h * 0.52), (w * 0.50, h * 0.34), (w * 0.54, h * 0.44), (w * 0.34, h * 0.62)], fill=FIGURA)
    d.line([(w * 0.50, h * 0.38), (w * 0.68, h * 0.24)], fill=FIGURA, width=max(3, int(w * 0.012)))
    # Doncella en halo: rayos que salen hacia el héroe.
    dx, dy = w * 0.14, h * 0.58
    d.ellipse([dx - w * 0.05, dy - h * 0.10, dx + w * 0.05, dy + h * 0.14], fill=FIGURA)
    for i in range(9):
        a = math.radians(-90 + (i - 4) * 16)
        d.line([(dx, dy), (dx + math.cos(a) * w * 0.26, dy + math.sin(a) * w * 0.26)],
               fill=MEDIO, width=max(2, int(w * 0.006)))


def cuadro_06_reino(d, w, h):
    """De espaldas, iluminado, con el reino celebrando al fondo."""
    _reino(d, w, h, MEDIO)
    _guerrero(d, w * 0.42, h * 0.90, h * 0.44, w * 0.13, FIGURA, mirando=1)
    dx = w * 0.58
    d.ellipse([dx - w * 0.045, h * 0.50, dx + w * 0.045, h * 0.62], fill=FIGURA)
    d.polygon([(dx - w * 0.06, h * 0.90), (dx - w * 0.035, h * 0.58),
               (dx + w * 0.035, h * 0.58), (dx + w * 0.06, h * 0.90)], fill=FIGURA)


CUADROS = {
    "01-siluetas": cuadro_01_siluetas,
    "02-rey-vs-dragon": cuadro_02_rey_vs_dragon,
    "03-caida": cuadro_03_caida,
    "04-heroe": cuadro_04_heroe,
    "05-batalla": cuadro_05_batalla,
    "06-reino": cuadro_06_reino,
}


def generar(cuadro_id: str, ancho: int, alto: int, con_arco: bool = True) -> Image.Image:
    fn = CUADROS.get(cuadro_id)
    if fn is None:
        raise SystemExit(f"sin silueta para «{cuadro_id}». Conocidas: {', '.join(CUADROS)}")
    im, d = lienzo(ancho, alto)
    fn(d, ancho, alto)
    if con_arco:
        _arco_ventana(d, ancho, alto, grosor=max(4, int(min(ancho, alto) * 0.018)))
    # Un desenfoque de 1 px evita el aliasing duro del borde, que el Voronoi
    # amplificaría en dientes de sierra al recortar las celdas.
    return im.filter(ImageFilter.GaussianBlur(1.0))


def main() -> int:
    p = argparse.ArgumentParser(description="Genera las máscaras de silueta del guion")
    p.add_argument("--guion", required=True, type=Path)
    p.add_argument("--ancho", type=int, default=1280)
    p.add_argument("--alto", type=int, default=720)
    p.add_argument("--force", action="store_true",
                   help="sobrescribe máscaras existentes. NO usar sobre una que hayas pintado.")
    a = p.parse_args()

    guion = json.loads(a.guion.read_text(encoding="utf-8"))
    base = a.guion.parent
    hechas, respetadas = [], []

    for c in guion["cuadros"]:
        destino = base / c["mascara"]
        if destino.exists() and not a.force:
            # El PNG pintado a mano manda sobre el generado: mismo criterio que
            # con los .blend fuente (§11.2).
            respetadas.append(destino.name)
            continue
        destino.parent.mkdir(parents=True, exist_ok=True)
        generar(c["id"], a.ancho, a.alto).save(destino)
        hechas.append(destino.name)

    print(json.dumps({
        "generadas": hechas,
        "respetadas_por_existir": respetadas,
        "tamano": [a.ancho, a.alto],
        "aviso": "arte de relleno: siluetas de primitivas, pensadas para pintarse encima",
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
