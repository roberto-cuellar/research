// Parser YAML mínimo, sin dependencias.
//
// POR QUÉ NO SE USA LA LIBRERÍA `yaml`
//
// Estos ficheros son política de gobernanza: los escribe `sem lock` o una
// persona, y usan un subconjunto pequeño y estable (mapas anidados por
// indentación, listas, escalares, comentarios). Traer un parser completo para
// eso añade superficie que nadie audita.
//
// LA REGLA QUE LO HACE ACEPTABLE: **falla cerrado**. Cualquier construcción que
// no entienda —anclas, alias, tags, multi-documento, bloques literales— lanza
// en vez de devolver algo a medias. Un fichero de política parseado a medias es
// más peligroso que uno que no se parsea: autoriza sin que nadie lo sepa.
//
// Si el subconjunto se queda corto, se añade `yaml` como dependencia CON EL DATO
// que lo justifique, no por si acaso.

const NO_SOPORTADO = [
  [/^\s*&\w/, 'anclas (&)'],
  // Un alias aparece casi siempre como VALOR (`b: *ancla`), no al inicio de
  // línea. Anclar la regex al principio dejaba pasar la forma habitual.
  [/(^|:\s)\*\w/, 'alias (*)'],
  [/^\s*!!?\w/, 'tags (!)'],
  [/^---\s*$/, 'multi-documento (---)'],
  [/:\s*[|>][-+\d]*\s*$/, 'bloques literales (| y >)'],
  [/^\s*\?\s/, 'claves complejas (?)'],
];

export class YamlError extends Error {}

function escalar(bruto) {
  const s = bruto.trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;

  // Comillas: se respeta el contenido literal, incluidos los `#`.
  if ((s.startsWith('"') && s.endsWith('"') && s.length > 1)
    || (s.startsWith("'") && s.endsWith("'") && s.length > 1)) {
    return s.slice(1, -1);
  }

  // Lista en línea: [a, b, c]
  if (s.startsWith('[') && s.endsWith(']')) {
    const dentro = s.slice(1, -1).trim();
    return dentro ? dentro.split(',').map((x) => escalar(x)) : [];
  }

  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d*\.?\d+([eE][-+]?\d+)?$/.test(s)) return Number(s);
  return s;
}

/** Quita el comentario de una línea, respetando los `#` dentro de comillas. */
function sinComentario(linea) {
  let comilla = null;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (comilla) {
      if (c === comilla) comilla = null;
    } else if (c === '"' || c === "'") {
      comilla = c;
    } else if (c === '#' && (i === 0 || /\s/.test(linea[i - 1]))) {
      return linea.slice(0, i);
    }
  }
  return linea;
}

/**
 * Parsea el subconjunto soportado. Lanza `YamlError` ante cualquier otra cosa.
 */
export function parseYaml(texto) {
  const lineas = [];

  texto.split(/\r?\n/).forEach((cruda, i) => {
    for (const [re, que] of NO_SOPORTADO) {
      if (re.test(cruda)) {
        throw new YamlError(`línea ${i + 1}: ${que} no soportado por este parser (falla cerrado): ${cruda.trim()}`);
      }
    }
    const linea = sinComentario(cruda);
    if (!linea.trim()) return;
    if (linea.includes('\t')) {
      throw new YamlError(`línea ${i + 1}: tabulador en la indentación; YAML exige espacios`);
    }
    lineas.push({ n: i + 1, sangria: linea.length - linea.trimStart().length, texto: linea.trim() });
  });

  let idx = 0;

  /**
   * Escalar plano multilínea: `clave: texto` seguido de líneas MÁS indentadas
   * que no son pares `clave: valor` ni elementos de lista. YAML las une con un
   * espacio. Es lo que permite escribir prosa en los ficheros de política sin
   * llenarlos de comillas.
   */
  function consumirContinuacion(valor, sangriaClave) {
    const partes = [valor];
    while (idx < lineas.length && lineas[idx].sangria > sangriaClave) {
      const t = lineas[idx].texto;
      if (t.startsWith('- ') || t === '-') break;
      if (/^[\w.$-]+:(\s|$)/.test(t)) break;      // es una clave, no continuación
      partes.push(t);
      idx++;
    }
    return partes.length === 1 ? escalar(valor) : partes.join(' ').replace(/^["']|["']$/g, '');
  }

  function bloque(sangriaMin) {
    // Decide si el bloque es lista o mapa por su primera línea.
    if (idx >= lineas.length || lineas[idx].sangria < sangriaMin) return null;
    return lineas[idx].texto.startsWith('- ') || lineas[idx].texto === '-'
      ? lista(lineas[idx].sangria)
      : mapa(lineas[idx].sangria);
  }

  function lista(sangria) {
    const out = [];
    while (idx < lineas.length && lineas[idx].sangria === sangria && lineas[idx].texto.startsWith('-')) {
      const { texto, n } = lineas[idx];
      const resto = texto.replace(/^-\s*/, '');
      idx++;

      if (!resto) {                       // "-" solo: el valor va debajo
        const hijo = idx < lineas.length && lineas[idx].sangria > sangria ? bloque(sangria + 1) : null;
        out.push(hijo);
        continue;
      }

      const par = resto.match(/^([\w.$-]+):\s*(.*)$/);
      if (par) {
        // "- clave: valor" abre un mapa cuyas demás claves van más indentadas.
        const obj = { [par[1]]: par[2] ? consumirContinuacion(par[2], sangria + 1) : null };
        const sangriaHijos = sangria + 2;
        if (!par[2] && idx < lineas.length && lineas[idx].sangria > sangriaHijos - 1
            && !lineas[idx].texto.startsWith('-')) {
          obj[par[1]] = mapa(lineas[idx].sangria);
        }
        while (idx < lineas.length && lineas[idx].sangria >= sangriaHijos
               && !lineas[idx].texto.startsWith('- ')) {
          const p2 = lineas[idx].texto.match(/^([\w.$-]+):\s*(.*)$/);
          if (!p2) throw new YamlError(`línea ${lineas[idx].n}: no reconocida: ${lineas[idx].texto}`);
          const sangriaActual = lineas[idx].sangria;
          idx++;
          obj[p2[1]] = p2[2]
            ? consumirContinuacion(p2[2], sangriaActual)
            : (idx < lineas.length && lineas[idx].sangria > sangriaActual ? bloque(sangriaActual + 1) : null);
        }
        out.push(obj);
        continue;
      }

      if (/^[\w.$-]+$/.test(resto) || resto.startsWith('"') || resto.startsWith("'") || /^[^:]+$/.test(resto)) {
        // Un elemento de lista también puede continuar en líneas más indentadas.
        out.push(consumirContinuacion(resto, sangria));
        continue;
      }
      throw new YamlError(`línea ${n}: elemento de lista no reconocido: ${texto}`);
    }
    return out;
  }

  function mapa(sangria) {
    const out = {};
    while (idx < lineas.length && lineas[idx].sangria === sangria) {
      const { texto, n } = lineas[idx];
      if (texto.startsWith('- ')) break;

      const par = texto.match(/^([\w.$-]+):\s*(.*)$/);
      if (!par) throw new YamlError(`línea ${n}: no es un par clave: valor -> ${texto}`);
      idx++;

      out[par[1]] = par[2]
        ? consumirContinuacion(par[2], sangria)
        : (idx < lineas.length && lineas[idx].sangria > sangria ? bloque(sangria + 1) : null);
    }
    return out;
  }

  const raiz = lineas.length ? bloque(lineas[0].sangria) : {};
  if (idx < lineas.length) {
    throw new YamlError(`línea ${lineas[idx].n}: indentación inconsistente, quedó sin parsear: ${lineas[idx].texto}`);
  }
  return raiz ?? {};
}

export async function leerYaml(ruta) {
  const { readFile } = await import('node:fs/promises');
  try {
    return parseYaml(await readFile(ruta, 'utf8'));
  } catch (e) {
    throw e instanceof YamlError ? new YamlError(`${ruta}: ${e.message}`) : e;
  }
}
