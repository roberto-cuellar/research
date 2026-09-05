"""Generador de vitrales: shader procedural + máscara + horneado por capas.

    blender --background --python tools/vitral/build_vitral.py -- \
        --guion games/dorian-intro/assets/guion.json --cuadro 01-siluetas

DE DÓNDE SALE LA TÉCNICA
------------------------
Del `vitral.blend` que ya funcionaba en MrHector. Su hallazgo, leído del grafo de
nodos, es este:

    Voronoi(F1).Position  ->  Vector de la textura

Alimentar el *Vector* con la **posición del centro de celda** hace que toda la
celda muestree UN SOLO punto. Eso es lo que produce **color plano por pieza de
vidrio** en vez de una foto borrosa, y es lo que hace que parezca vidrio cortado.
El segundo Voronoi en `DISTANCE_TO_EDGE` da el plomo entre piezas, y un MULTIPLY
los junta.

QUÉ AÑADE ESTE FICHERO SOBRE AQUELLO
------------------------------------
1. **Máscara**: la forma la decide un PNG, no el shader. Blanco es figura, gris
   es plano medio, negro es fondo. Repintar el PNG cambia el vitral entero.
2. **Paleta**: el color sale de una rampa declarada en JSON, no de una foto
   suelta. Cambiar la paleta es editar cinco colores.
3. **Capas**: hornea fondo / medio / figura por separado, con alfa, que es lo
   que permite el parallax en el navegador.
4. **Emission explícita**: el original conectaba color crudo a Surface. El vidrio
   no recibe luz, la deja pasar: emisión es lo correcto y además hace el render
   independiente de la iluminación.

EL .blend ES DEL USUARIO
------------------------
Se guarda uno por cuadro y **no se sobrescribe sin `--force`** (§11.2). Ábrelo,
mueve el Voronoi, cambia la rampa, y vuelve a hornear con `--solo-hornear`.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import bpy

# Determinismo (§8.2): sin esto, dos horneados de la misma escena difieren y la
# cascada visual da falsos positivos.
SEMILLA = 0
MUESTRAS = 16          # EEVEE con emisión pura: más muestras no aportan nada

CAPAS = ("fondo", "medio", "figura")


def log(m):
    print(f"[vitral] {m}", file=sys.stderr)


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--guion", required=True)
    p.add_argument("--cuadro", required=True)
    p.add_argument("--force", action="store_true")
    p.add_argument("--solo-hornear", action="store_true",
                   help="abre el .blend existente y solo re-hornea, respetando tus ediciones")
    return p.parse_args(argv)


def hex_a_rgba(h):
    h = h.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    # sRGB -> lineal: Blender trabaja en lineal y meter sRGB crudo lava los colores.
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in (r, g, b)]
    return (*lin, 1.0)


def limpiar():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def _rampa(nt, colores, x, y):
    """ColorRamp con la paleta repartida uniformemente."""
    n = nt.nodes.new("ShaderNodeValToRGB")
    n.location = (x, y)
    ramp = n.color_ramp
    while len(ramp.elements) > 1:
        ramp.elements.remove(ramp.elements[-1])
    ramp.elements[0].position = 0.0
    ramp.elements[0].color = hex_a_rgba(colores[0])
    for i, c in enumerate(colores[1:], start=1):
        e = ramp.elements.new(i / (len(colores) - 1))
        e.color = hex_a_rgba(c)
    ramp.interpolation = "CONSTANT"   # vidrio: saltos de color, no degradados
    return n


def material_vitral(nombre, paleta, ruta_mascara, capa, escala_celda):
    """El shader. Un material por capa, porque cada capa recorta distinto."""
    mat = bpy.data.materials.new(nombre)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()

    coord = nt.nodes.new("ShaderNodeTexCoord"); coord.location = (-1400, 0)

    # Mapping expuesto a propósito: es el nodo que el usuario mueve para
    # recolocar el patrón de vidrio sin tocar nada más.
    mapping = nt.nodes.new("ShaderNodeMapping"); mapping.location = (-1200, 0)
    mapping.label = "AJUSTE DEL VIDRIO"
    nt.links.new(coord.outputs["Generated"], mapping.inputs["Vector"])

    # --- las dos Voronoi, con los mismos parámetros: han de coincidir celda a
    # celda o el plomo no caería sobre las juntas del color.
    v_col = nt.nodes.new("ShaderNodeTexVoronoi"); v_col.location = (-1000, 200)
    v_col.feature = "F1"; v_col.voronoi_dimensions = "3D"
    v_bor = nt.nodes.new("ShaderNodeTexVoronoi"); v_bor.location = (-1000, -200)
    v_bor.feature = "DISTANCE_TO_EDGE"; v_bor.voronoi_dimensions = "3D"
    for v in (v_col, v_bor):
        v.inputs["Scale"].default_value = escala_celda
        v.inputs["Randomness"].default_value = 0.77
        nt.links.new(mapping.outputs["Vector"], v.inputs["Vector"])

    # --- color plano por celda ------------------------------------------
    # Voronoi.Color da un color ALEATORIO por celda. Su luminancia es un valor
    # constante dentro de la celda: exactamente el "un valor por pieza" que
    # buscamos, y sin depender de ninguna foto.
    lum = nt.nodes.new("ShaderNodeRGBToBW"); lum.location = (-800, 260)
    nt.links.new(v_col.outputs["Color"], lum.inputs["Color"])

    # --- máscara: la FORMA ------------------------------------------------
    tex_m = nt.nodes.new("ShaderNodeTexImage"); tex_m.location = (-1000, 560)
    tex_m.label = "MASCARA (blanco=figura)"
    tex_m.image = bpy.data.images.load(ruta_mascara, check_existing=True)
    tex_m.image.colorspace_settings.name = "Non-Color"   # es datos, no color
    tex_m.interpolation = "Closest"
    tex_m.extension = "EXTEND"
    # UV, NO Generated. El plano está tumbado en XZ, así que en coordenadas
    # Generated la componente Y es degenerada; una textura de imagen usa las dos
    # primeras componentes del vector como UV, luego muestreaba X y una Y
    # constante — y la máscara salía en FRANJAS VERTICALES en vez de siluetas.
    # Las Voronoi no lo sufren porque son 3D y usan las tres componentes.
    nt.links.new(coord.outputs["UV"], tex_m.inputs["Vector"])

    # La máscara DESPLAZA la posición en la rampa: la figura cae en la zona
    # clara de la paleta y el fondo en la oscura. Es lo que hace que figura y
    # fondo compartan familia cromática sin ser el mismo color.
    mezcla_pos = nt.nodes.new("ShaderNodeMix"); mezcla_pos.location = (-600, 300)
    mezcla_pos.data_type = "FLOAT"; mezcla_pos.blend_type = "MIX"
    nt.links.new(tex_m.outputs["Color"], mezcla_pos.inputs["Factor"])
    mezcla_pos.inputs[2].default_value = 0.10    # fondo: extremo oscuro
    nt.links.new(lum.outputs["Val"], mezcla_pos.inputs[3])

    rampa = _rampa(nt, paleta["rampa"], -400, 300)
    nt.links.new(mezcla_pos.outputs[0], rampa.inputs["Fac"])

    # --- plomo ------------------------------------------------------------
    r_plomo = nt.nodes.new("ShaderNodeValToRGB"); r_plomo.location = (-600, -200)
    r_plomo.label = "PLOMO (grosor)"
    r_plomo.color_ramp.elements[0].position = 0.0
    r_plomo.color_ramp.elements[0].color = hex_a_rgba(paleta.get("plomo", "#0a0a0c"))
    r_plomo.color_ramp.elements[1].position = 0.06   # cuanto mayor, más fino
    r_plomo.color_ramp.elements[1].color = (1, 1, 1, 1)
    nt.links.new(v_bor.outputs["Distance"], r_plomo.inputs["Fac"])

    mult = nt.nodes.new("ShaderNodeMix"); mult.location = (-200, 100)
    mult.data_type = "RGBA"; mult.blend_type = "MULTIPLY"
    mult.inputs["Factor"].default_value = 1.0
    nt.links.new(rampa.outputs["Color"], mult.inputs[6])
    nt.links.new(r_plomo.outputs["Color"], mult.inputs[7])

    # --- emisión: el vidrio deja pasar la luz, no la recibe ---------------
    emi = nt.nodes.new("ShaderNodeEmission"); emi.location = (0, 100)
    emi.inputs["Strength"].default_value = 1.0
    nt.links.new(mult.outputs[2], emi.inputs["Color"])

    # --- alfa por capa: es lo que permite superponerlas en el navegador ---
    transp = nt.nodes.new("ShaderNodeBsdfTransparent"); transp.location = (0, -150)
    recorte = nt.nodes.new("ShaderNodeMixShader"); recorte.location = (250, 0)
    nt.links.new(transp.outputs["BSDF"], recorte.inputs[1])
    nt.links.new(emi.outputs["Emission"], recorte.inputs[2])

    if capa == "figura":
        nt.links.new(tex_m.outputs["Color"], recorte.inputs["Fac"])       # solo lo blanco
    elif capa == "medio":
        inv = nt.nodes.new("ShaderNodeMath"); inv.location = (-600, 620)
        inv.operation = "SMOOTH_MIN" if False else "SUBTRACT"
        inv.inputs[0].default_value = 1.0
        nt.links.new(tex_m.outputs["Color"], inv.inputs[1])
        umbral = nt.nodes.new("ShaderNodeMath"); umbral.location = (-400, 620)
        umbral.operation = "SMOOTHSTEP" if hasattr(inv, "operation") and False else "GREATER_THAN"
        umbral.inputs[1].default_value = 0.25
        nt.links.new(inv.outputs[0], umbral.inputs[0])
        nt.links.new(umbral.outputs[0], recorte.inputs["Fac"])
    else:
        recorte.inputs["Fac"].default_value = 1.0                          # fondo: opaco

    out = nt.nodes.new("ShaderNodeOutputMaterial"); out.location = (500, 0)
    nt.links.new(recorte.outputs["Shader"], out.inputs["Surface"])

    mat.blend_method = "BLEND"
    return mat


def plano(nombre, z):
    """Un quad de 16:9 centrado, a la profundidad z."""
    ancho, alto = 16.0, 9.0
    malla = bpy.data.meshes.new(nombre)
    malla.from_pydata(
        [(-ancho / 2, z, -alto / 2), (ancho / 2, z, -alto / 2),
         (ancho / 2, z, alto / 2), (-ancho / 2, z, alto / 2)],
        [], [(0, 1, 2, 3)])
    malla.update()
    uv = malla.uv_layers.new(name="UVMap")
    for i, c in enumerate([(0, 0), (1, 0), (1, 1), (0, 1)]):
        uv.data[i].uv = c
    obj = bpy.data.objects.new(nombre, malla)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def montar(cuadro, paleta, ruta_mascara, resolucion):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x, sc.render.resolution_y = resolucion
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True          # imprescindible para superponer
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "Standard"
    if hasattr(sc, "eevee"):
        for attr, val in (("taa_render_samples", MUESTRAS), ("use_bloom", False)):
            if hasattr(sc.eevee, attr):
                setattr(sc.eevee, attr, val)

    # Cada capa con una ESCALA de celda distinta: las piezas del fondo son
    # grandes y las de la figura finas. Es lo que da profundidad al vitral, y de
    # paso lo que hace que el parallax se lea.
    escalas = {"fondo": 9.0, "medio": 15.0, "figura": 26.0}
    profundidades = {"fondo": 6.0, "medio": 3.0, "figura": 0.0}

    for capa in CAPAS:
        obj = plano(f"capa_{capa}", profundidades[capa])
        obj.data.materials.append(
            material_vitral(f"Vitral_{cuadro['id']}_{capa}", paleta, ruta_mascara, capa, escalas[capa]))
        obj["parallax"] = cuadro.get("parallax", {}).get(capa, 1.0)

    cam_data = bpy.data.cameras.new("CamOrto")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 16.0
    cam = bpy.data.objects.new("CamOrto", cam_data)
    sc.collection.objects.link(cam)
    cam.location = (0.0, -20.0, 0.0)
    cam.rotation_euler = (1.5707963, 0.0, 0.0)
    sc.camera = cam


def hornear(cuadro, destino_dir, resolucion):
    """Una pasada por capa, ocultando las demás. Devuelve el manifiesto."""
    sc = bpy.context.scene
    os.makedirs(destino_dir, exist_ok=True)
    capas = []

    objetos = {c: bpy.data.objects.get(f"capa_{c}") for c in CAPAS}
    faltan = [c for c, o in objetos.items() if o is None]
    if faltan:
        raise SystemExit(f"faltan capas en el .blend: {faltan}. ¿Lo editaste y las borraste?")

    for capa in CAPAS:
        for c, o in objetos.items():
            o.hide_render = (c != capa)
        salida = os.path.join(destino_dir, f"{cuadro['id']}_{capa}.png")
        sc.render.filepath = salida
        bpy.ops.render.render(write_still=True)
        capas.append({
            "capa": capa,
            "png": os.path.basename(salida),
            "parallax": objetos[capa].get("parallax", 1.0),
        })
        log(f"horneada {capa}")

    for o in objetos.values():
        o.hide_render = False

    return {
        "cuadro": cuadro["id"],
        "resolucion": list(resolucion),
        "capas": capas,
        "determinismo": {"semilla": SEMILLA, "muestras": MUESTRAS, "motor": sc.render.engine},
    }


def main():
    a = parse_args()
    guion = json.loads(open(a.guion, encoding="utf-8").read())
    base = os.path.dirname(os.path.abspath(a.guion))
    raiz = os.path.dirname(base)

    cuadro = next((c for c in guion["cuadros"] if c["id"] == a.cuadro), None)
    if cuadro is None:
        raise SystemExit(f"no existe el cuadro «{a.cuadro}» en el guion")

    paleta = json.loads(open(os.path.join(base, cuadro["paleta"]), encoding="utf-8").read())
    mascara = os.path.join(base, cuadro["mascara"])
    if not os.path.exists(mascara):
        raise SystemExit(f"falta la mascara: {mascara}. Generala con tools/vitral/mascaras.py")

    blend = os.path.join(raiz, "assets", "blender", f"{cuadro['id']}.blend")
    salida = os.path.join(base, "vitrales", cuadro["id"])
    resolucion = tuple(guion.get("resolucion", [1280, 720]))

    if a.solo_hornear:
        if not os.path.exists(blend):
            raise SystemExit(f"--solo-hornear pero no existe {blend}")
        bpy.ops.wm.open_mainfile(filepath=blend)
    else:
        if os.path.exists(blend) and not a.force:
            raise SystemExit(
                f"ya existe: {blend}\n"
                "Si lo editaste, ese fichero manda. Usa --solo-hornear para re-hornear "
                "respetando tus cambios, o --force para regenerarlo y PERDERLOS.")
        limpiar()
        montar(cuadro, paleta, mascara, resolucion)
        os.makedirs(os.path.dirname(blend), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=blend)
        log(f"guardado {blend}")

    manifiesto = hornear(cuadro, salida, resolucion)
    manifiesto["blend"] = os.path.relpath(blend, raiz).replace("\\", "/")
    manifiesto["mascara"] = cuadro["mascara"]
    manifiesto["paleta"] = paleta["id"]

    with open(os.path.join(salida, "manifiesto.json"), "w", encoding="utf-8") as f:
        json.dump(manifiesto, f, indent=2, ensure_ascii=False)

    print(json.dumps(manifiesto, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
