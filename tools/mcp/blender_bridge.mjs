#!/usr/bin/env node
// Puente MCP <-> addon MCP oficial de Blender.
//
// POR QUÉ HACE FALTA UN PUENTE
//
// El addon oficial (Blender Lab, `mcp` en extensions/user_default) NO habla MCP
// por stdio ni MCP por HTTP: abre un socket TCP en 9876 y espera **JSON
// delimitado por byte nulo**. opencode solo sabe hablar `type: "local"` (stdio)
// o `type: "remote"` (url). Ninguno encaja, así que este proceso traduce.
//
// 🔴 NO instalar `uvx blender-mcp`: es el puente del addon de terceros
// (ahujasid/blender-mcp), que NO es el que está corriendo aquí.
//
// PROTOCOLO, verificado leyendo la fuente del addon y probándolo el 2026-09-05
// (mcp_to_blender_server.py, SPDX "Blender Authors"):
//
//   peticion:  {"type":"execute","code":"<python>","strict_json":<bool>} + "\0"
//   respuesta: {"status":"ok","result":...} | {"status":"error","message":...} + "\0"
//
//   `strict_json` es OBLIGATORIO y debe ser booleano: si falta, el addon
//   responde con un error explícito de "bug en la herramienta que generó esto".
//   Con strict_json=false, los valores no serializables se pasan por repr().
//
// El código Python debe asignar a una variable `result` lo que quiera devolver.

import net from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const HOST = process.env.BLENDER_MCP_HOST ?? '127.0.0.1';
const PORT = Number(process.env.BLENDER_MCP_PORT ?? 9876);
const TIMEOUT_MS = Number(process.env.BLENDER_MCP_TIMEOUT ?? 120_000);

const NUL = '\0';

/**
 * Una conexión por petición. El addon es no bloqueante y acepta varios clientes,
 * pero mantener un socket vivo entre llamadas obliga a reconciliar estado tras
 * un reinicio de Blender. Abrir y cerrar es más lento y mucho más predecible.
 */
function ejecutarEnBlender(code, strictJson = true) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: HOST, port: PORT });
    let buffer = Buffer.alloc(0);
    let resuelto = false;

    const fin = (fn, arg) => {
      if (resuelto) return;
      resuelto = true;
      socket.destroy();
      fn(arg);
    };

    socket.setTimeout(TIMEOUT_MS);

    socket.on('connect', () => {
      // El terminador NUL no es opcional: sin él el addon se queda esperando el
      // resto del mensaje y acaba respondiendo "Client timed out".
      socket.write(JSON.stringify({ type: 'execute', code, strict_json: strictJson }) + NUL);
    });

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.at(-1) !== 0) return;   // respuesta incompleta
      try {
        fin(resolve, JSON.parse(buffer.subarray(0, -1).toString('utf8')));
      } catch (e) {
        fin(reject, new Error(`respuesta no parseable de Blender: ${e.message}`));
      }
    });

    socket.on('timeout', () => fin(reject, new Error(
      `Blender no respondió en ${TIMEOUT_MS} ms. Si el script es largo, sube BLENDER_MCP_TIMEOUT.`)));

    socket.on('error', (e) => fin(reject, new Error(
      `no se pudo hablar con el addon en ${HOST}:${PORT} — ${e.message}\n`
      + 'Comprueba que Blender está abierto y la extensión MCP activa.')));
  });
}

/** Envuelve la respuesta del addon en el formato de contenido de MCP. */
function comoContenido(respuesta) {
  const esError = respuesta?.status === 'error';
  return {
    isError: esError,
    content: [{
      type: 'text',
      text: esError
        ? `Blender devolvió error: ${respuesta.message}`
        : JSON.stringify(respuesta.result ?? respuesta, null, 2),
    }],
  };
}

const server = new McpServer({ name: 'blender-bridge', version: '0.1.0' });

server.registerTool(
  'blender_execute',
  {
    title: 'Ejecutar Python en Blender',
    description:
      'Ejecuta código Python dentro de la instancia de Blender en marcha. '
      + 'El código DEBE asignar a una variable `result` un DICCIONARIO. El addon rechaza '
      + 'cualquier otro tipo con: "The result variable must be a dict, not str". '
      + 'Ejemplo: `import bpy; result = {"objetos": [o.name for o in bpy.data.objects]}`',
    inputSchema: {
      code: z.string().describe('Python a ejecutar. Asigna el retorno a `result` COMO DICCIONARIO.'),
      strict_json: z.boolean().default(true)
        .describe('true exige que `result` sea serializable a JSON; false pasa lo no serializable por repr().'),
    },
  },
  async ({ code, strict_json }) => comoContenido(await ejecutarEnBlender(code, strict_json)),
);

server.registerTool(
  'blender_scene_info',
  {
    title: 'Resumen de la escena',
    description: 'Objetos, cámaras, luces, colecciones y rango de frames de la escena actual.',
    inputSchema: {},
  },
  async () => comoContenido(await ejecutarEnBlender(`
import bpy
sc = bpy.context.scene
result = {
    "blender": bpy.app.version_string,
    "escena": sc.name,
    "fichero": bpy.data.filepath or "(sin guardar)",
    "frames": [sc.frame_start, sc.frame_current, sc.frame_end],
    "render": {
        "motor": sc.render.engine,
        "resolucion": [sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage],
    },
    "camara_activa": sc.camera.name if sc.camera else None,
    "conteo": {
        "objetos": len(bpy.data.objects),
        "camaras": len([o for o in bpy.data.objects if o.type == "CAMERA"]),
        "luces": len([o for o in bpy.data.objects if o.type == "LIGHT"]),
        "mallas": len([o for o in bpy.data.objects if o.type == "MESH"]),
        "armaduras": len([o for o in bpy.data.objects if o.type == "ARMATURE"]),
    },
    "objetos": [{"nombre": o.name, "tipo": o.type} for o in bpy.data.objects],
    "colecciones": [c.name for c in bpy.data.collections],
}
`)),
);

server.registerTool(
  'blender_render_determinista',
  {
    title: 'Render determinista',
    description:
      'Renderiza a un PNG fijando TODO lo que introduce varianza: semilla, resolución, '
      + 'muestras y ruido. Es el prerrequisito de los niveles 1-3 de la cascada visual (§8.2): '
      + 'si el render no es determinista, MSE y SSIM producen falsos positivos.',
    inputSchema: {
      salida: z.string().describe('Ruta absoluta del PNG de salida.'),
      ancho: z.number().int().default(800),
      alto: z.number().int().default(600),
      semilla: z.number().int().default(0),
      muestras: z.number().int().default(32).describe('Muestras de Cycles. Ignorado en EEVEE.'),
      frame: z.number().int().optional(),
    },
  },
  async ({ salida, ancho, alto, semilla, muestras, frame }) => {
    const py = `
import bpy, json
sc = bpy.context.scene
${frame !== undefined ? `sc.frame_set(${frame})` : ''}

sc.render.resolution_x = ${ancho}
sc.render.resolution_y = ${alto}
sc.render.resolution_percentage = 100
sc.render.filepath = ${JSON.stringify(salida)}
sc.render.image_settings.file_format = "PNG"
sc.render.image_settings.color_mode = "RGB"

# La semilla es lo que hace repetible el muestreo. Sin fijarla, dos renders de
# la misma escena difieren en el ruido y la cascada visual falla en falso.
if hasattr(sc, "cycles"):
    sc.cycles.seed = ${semilla}
    sc.cycles.use_animated_seed = False
    sc.cycles.samples = ${muestras}
    # El denoiser introduce varianza propia entre ejecuciones.
    sc.cycles.use_denoising = False

if sc.camera is None:
    result = {"error": "la escena no tiene camara activa; un render sin camara no es determinista ni util"}
else:
    bpy.ops.render.render(write_still=True)
    result = {
        "salida": sc.render.filepath,
        "resolucion": [sc.render.resolution_x, sc.render.resolution_y],
        "motor": sc.render.engine,
        "semilla": ${semilla},
        "camara": sc.camera.name,
        "frame": sc.frame_current,
    }
`;
    return comoContenido(await ejecutarEnBlender(py, true));
  },
);

server.registerTool(
  'blender_ping',
  {
    title: 'Comprobar la conexión',
    description: 'Verifica que el addon responde. Devuelve versión y latencia.',
    inputSchema: {},
  },
  async () => {
    const t0 = Date.now();
    const r = await ejecutarEnBlender('import bpy; result = {"version": bpy.app.version_string}');
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          conectado: r.status === 'ok',
          blender: r.result?.version ?? null,
          endpoint: `${HOST}:${PORT}`,
          latencia_ms: Date.now() - t0,
        }, null, 2),
      }],
    };
  },
);

await server.connect(new StdioServerTransport());
