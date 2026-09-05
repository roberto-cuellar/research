"""Construye un escenario de pixel-borislov en Blender y lo deja EDITABLE.

    blender --background --python tools/build_scenario.py -- --nivel assets/levels/nivel-01.json

QUÉ HACE Y POR QUÉ ASÍ
----------------------
Sigue el patrón de `assets3d/tools/bake_scenario.py` de MrHector, que monta la
escena **por código** desde datos y no desde un `.blend` guardado. La diferencia
es el destino: aquel horneaba a capas de parallax y tiraba la escena; este
**guarda un `.blend` que el usuario abre y retoca a mano**.

Decisión de arte cerrada (§11.3.2): el escenario son **planos texturizados con el
tileset CC0 de 16×16**, no geometría 3D modelada. Cada tile es un quad con su UV
apuntando a la celda del atlas.

DETERMINISMO (§8.2) — es el motivo por el que este fichero existe
----------------------------------------------------------------
Cámara ortográfica fija, sol fijo, semilla fija, sin denoiser, resolución fija.
Sin esto, dos renders de la misma escena difieren en el ruido y los niveles 1–3
de la cascada visual dan falsos positivos. Cerraba TDB-004.

Ortográfica y no perspectiva: un nivel de plataformas es plano; con perspectiva
los tiles de los bordes saldrían inclinados y no encajarían al desplazar la cámara.

EL .blend ES DEL USUARIO
------------------------
Si el fichero de salida ya existe, el script **se niega a sobrescribirlo** salvo
`--force`. §11.2: el agente nunca pisa un `.blend` fuente. En cuanto lo abres y
lo tocas, pasa a ser autoría tuya y este script deja de mandar sobre él.
"""

import argparse
import json
import math
import os
import sys

import bpy

# --- constantes del pack CC0 (medidas, no supuestas) -----------------------
TILE_PX = 16
ATLAS_COLS = 22        # 352 / 16
ATLAS_FILAS = 11       # 176 / 16

# 1 tile = 1 unidad de Blender. El jugador mide 1.48 de alto en el motor
# heredado (p_player.js), así que ~1.5 tiles: la proporción de Pixel Adventure.
UNIDAD = 1.0

SEMILLA = 0
RESOLUCION = (960, 540)
MUESTRAS = 32


def log(msg):
    print(f"[escenario] {msg}", file=sys.stderr)


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--nivel", required=True, help="JSON con la definición del nivel")
    p.add_argument("--out", default=None, help="ruta del .blend (por defecto, junto al nivel)")
    p.add_argument("--force", action="store_true",
                   help="sobrescribe un .blend existente. NO usar sobre uno que hayas editado.")
    return p.parse_args(argv)


def limpiar_escena():
    """Escena vacía y reproducible: sin el cubo por defecto ni restos."""
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material_atlas(nombre, ruta_png, alfa=True, teselar=False):
    """Material sin sombreado y con filtro NEAREST.

    Interpolación lineal sobre pixel art lo emborrona y además hace que el
    resultado dependa de la resolución de render: dos tamaños distintos darían
    imágenes distintas y la comparación visual dejaría de ser estable.
    """
    mat = bpy.data.materials.new(nombre)
    mat.use_nodes = True
    mat.blend_method = "CLIP" if alfa else "OPAQUE"
    nt = mat.node_tree
    nt.nodes.clear()

    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(ruta_png, check_existing=True)
    tex.interpolation = "Closest"          # pixel art: nunca interpolar
    # CLIP para el atlas: sus UV viven dentro de [0,1] y REPEAT sangraria los
    # tiles vecinos. REPEAT para los fondos, que teselan con UV de 0 a N.
    tex.extension = "REPEAT" if teselar else "CLIP"

    # Emission y no Principled: el escenario es 2D texturizado, y un BSDF
    # metería sombreado dependiente de la luz donde no debe haberlo.
    emi = nt.nodes.new("ShaderNodeEmission")
    emi.inputs["Strength"].default_value = 1.0
    out = nt.nodes.new("ShaderNodeOutputMaterial")

    if alfa:
        mezcla = nt.nodes.new("ShaderNodeMixShader")
        transp = nt.nodes.new("ShaderNodeBsdfTransparent")
        nt.links.new(tex.outputs["Color"], emi.inputs["Color"])
        nt.links.new(tex.outputs["Alpha"], mezcla.inputs["Fac"])
        nt.links.new(transp.outputs["BSDF"], mezcla.inputs[1])
        nt.links.new(emi.outputs["Emission"], mezcla.inputs[2])
        nt.links.new(mezcla.outputs["Shader"], out.inputs["Surface"])
    else:
        nt.links.new(tex.outputs["Color"], emi.inputs["Color"])
        nt.links.new(emi.outputs["Emission"], out.inputs["Surface"])
    return mat


def quad(nombre, x, y, z, ancho, alto, uv):
    """Un quad en el plano XZ, mirando a -Y (la cámara viene de +Y)."""
    malla = bpy.data.meshes.new(nombre)
    verts = [
        (x, y, z), (x + ancho, y, z),
        (x + ancho, y, z + alto), (x, y, z + alto),
    ]
    malla.from_pydata(verts, [], [(0, 1, 2, 3)])
    malla.update()

    capa = malla.uv_layers.new(name="UVMap")
    u0, v0, u1, v1 = uv
    for i, coord in enumerate([(u0, v0), (u1, v0), (u1, v1), (u0, v1)]):
        capa.data[i].uv = coord

    obj = bpy.data.objects.new(nombre, malla)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def uv_de_tile(indice):
    """Celda del atlas -> rectángulo UV. Fila 0 es la de ARRIBA en el PNG."""
    col = indice % ATLAS_COLS
    fila = indice // ATLAS_COLS
    u0 = col / ATLAS_COLS
    u1 = (col + 1) / ATLAS_COLS
    # V se invierte: en imagen la fila 0 está arriba, en UV el 0 está abajo.
    v1 = 1.0 - (fila / ATLAS_FILAS)
    v0 = 1.0 - ((fila + 1) / ATLAS_FILAS)
    return (u0, v0, u1, v1)


def coleccion(nombre):
    col = bpy.data.collections.new(nombre)
    bpy.context.scene.collection.children.link(col)
    return col


def mover_a(obj, col):
    for c in obj.users_collection:
        c.objects.unlink(obj)
    col.objects.link(obj)


def construir_terreno(nivel, base_assets):
    """Un quad por tile. Colección propia para que el usuario la aísle al editar."""
    ruta = os.path.join(base_assets, nivel["tileset"])
    if not os.path.exists(ruta):
        raise SystemExit(f"no existe el tileset: {ruta}")

    mat = material_atlas("Terreno", ruta, alfa=True)
    col = coleccion("Terreno")
    n = 0
    for t in nivel["terreno"]:
        obj = quad(
            f"tile_{t['x']}_{t['y']}",
            t["x"] * UNIDAD, 0.0, t["y"] * UNIDAD,
            UNIDAD, UNIDAD, uv_de_tile(t["tile"]),
        )
        obj.data.materials.append(mat)
        # La superficie viaja como propiedad del objeto: es lo que el motor lee
        # para elegir la fricción (SURFACE en w_contracts.js). Datos, no código.
        obj["surface"] = t.get("surface", "TIERRA")
        mover_a(obj, col)
        n += 1
    log(f"terreno: {n} tiles")
    return n


def construir_fondos(nivel, base_assets):
    """Planos de parallax. El factor lo consume r_parallax.js, no Blender."""
    col = coleccion("Fondos")
    n = 0
    for capa in nivel.get("fondos", []):
        ruta = os.path.join(base_assets, capa["textura"])
        if not os.path.exists(ruta):
            log(f"AVISO: fondo ausente, se omite -> {ruta}")
            continue
        mat = material_atlas(f"Fondo_{capa['nombre']}", ruta, alfa=False, teselar=True)
        obj = quad(
            f"fondo_{capa['nombre']}",
            capa["x"], capa["z_profundidad"], capa["y"],
            capa["ancho"], capa["alto"], (0.0, 0.0, capa.get("repeticiones_u", 1.0), capa.get("repeticiones_v", 1.0)),
        )
        obj.data.materials.append(mat)
        if capa["z_profundidad"] >= 0:
            # La camara viene de +Y y mira a -Y. Un fondo con profundidad >= 0
            # queda DELANTE del terreno y lo oculta por completo.
            raise SystemExit(
                f"fondo '{capa['nombre']}' con z_profundidad={capa['z_profundidad']}: "
                "debe ser NEGATIVA para quedar detras del terreno")
        obj["parallax"] = capa["parallax"]
        mover_a(obj, col)
        n += 1
    log(f"fondos: {n} capas")
    return n


def marcadores(nivel):
    """Spawn, checkpoints y meta como Empties: visibles y arrastrables a mano."""
    col = coleccion("Marcadores")
    n = 0
    for m in nivel.get("marcadores", []):
        e = bpy.data.objects.new(m["nombre"], None)
        e.empty_display_type = "PLAIN_AXES"
        e.empty_display_size = 0.5
        e.location = (m["x"] * UNIDAD, 0.0, m["y"] * UNIDAD)
        e["tipo"] = m["tipo"]
        bpy.context.scene.collection.objects.link(e)
        mover_a(e, col)
        n += 1
    log(f"marcadores: {n}")
    return n


def setup_determinista(nivel):
    """TODO lo que introduce varianza, fijado. Es el punto del fichero."""
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"          # la GPU introduce diferencias entre drivers
    sc.cycles.samples = MUESTRAS
    sc.cycles.seed = SEMILLA
    sc.cycles.use_animated_seed = False
    sc.cycles.use_denoising = False   # el denoiser varía entre ejecuciones
    sc.render.resolution_x, sc.render.resolution_y = RESOLUCION
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGB"
    sc.view_settings.view_transform = "Standard"   # sin filmico: es arte plano

    cam_ancho = nivel.get("camara", {}).get("ancho_tiles", 20)
    cam_data = bpy.data.cameras.new("CamOrto")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = cam_ancho * UNIDAD
    cam = bpy.data.objects.new("CamOrto", cam_data)
    sc.collection.objects.link(cam)
    centro = nivel.get("camara", {})
    cam.location = (centro.get("x", 10.0), 40.0, centro.get("y", 6.0))
    cam.rotation_euler = (math.radians(90), 0.0, math.radians(180))
    sc.camera = cam

    # Sol suave: los materiales son Emission, así que la luz apenas influye.
    # Está para que la escena sea usable en el viewport al editarla a mano.
    sol_data = bpy.data.lights.new("Sol", type="SUN")
    sol_data.energy = 1.0
    sol = bpy.data.objects.new("Sol", sol_data)
    sc.collection.objects.link(sol)
    sol.rotation_euler = (math.radians(50), 0.0, math.radians(150))

    mundo = bpy.data.worlds.new("Mundo")
    mundo.use_nodes = True
    fondo = nivel.get("color_fondo", [0.10, 0.11, 0.14])
    mundo.node_tree.nodes["Background"].inputs[0].default_value = (*fondo, 1.0)
    mundo.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    sc.world = mundo


def main():
    args = parse_args()
    raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    with open(args.nivel, encoding="utf-8") as f:
        nivel = json.load(f)

    salida = args.out or os.path.join(raiz, "assets", "blender", f"{nivel['id']}.blend")
    if os.path.exists(salida) and not args.force:
        # §11.2: el agente NUNCA sobrescribe un .blend fuente. En cuanto el
        # usuario lo abre y lo toca, el fichero es suyo.
        raise SystemExit(
            f"ya existe: {salida}\n"
            "Si lo has editado a mano, ese fichero manda y este script no debe pisarlo.\n"
            "Para regenerarlo desde cero y PERDER esas ediciones: --force"
        )

    limpiar_escena()
    base = os.path.join(raiz, "assets")
    n_tiles = construir_terreno(nivel, base)
    n_fondos = construir_fondos(nivel, base)
    n_marcas = marcadores(nivel)
    setup_determinista(nivel)

    os.makedirs(os.path.dirname(salida), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=salida)

    informe = {
        "nivel": nivel["id"],
        "blend": salida,
        "tiles": n_tiles,
        "fondos": n_fondos,
        "marcadores": n_marcas,
        "determinismo": {
            "semilla": SEMILLA, "muestras": MUESTRAS,
            "resolucion": list(RESOLUCION), "denoiser": False, "dispositivo": "CPU",
        },
    }
    ruta_informe = os.path.join(raiz, "assets", "blender", f"{nivel['id']}_informe.json")
    with open(ruta_informe, "w", encoding="utf-8") as f:
        json.dump(informe, f, indent=2, ensure_ascii=False)

    # Regla 2 del pipeline heredado: medir, no deducir. Cada script emite un
    # informe de lo que midió; si trae avisos, no está hecho.
    log(f"guardado: {salida}")
    print(json.dumps(informe, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
