# Paleta del tileset — índices MEDIDOS

`terrain_16.png` es 352×176 = **22 columnas × 11 filas** de 16 px.
`indice = fila * 22 + columna`.

Medidos analizando el PNG, no estimados a ojo:

| Material | Izquierda | Centro | Derecha | Fila |
|---|---|---|---|---|
| **Hierba** (superficie) | 6 | 7 | 8 | 0 |
| **Tierra** (relleno) | 28 | 29 | 30 | 1 |

El atlas tiene cuatro bloques de material por fila de bloques: piedra gris
(cols 0–5), hierba/tierra (6–11), madera (12–17), cadenas (18–21). Las filas
inferiores repiten la estructura con otros materiales: ladrillo, metal, arena,
oro.

> **Trampa ya pagada:** los índices se adivinaron la primera vez (0,1,2 y 23) y
> el render salió con piedra gris arriba y **negro** debajo — la celda 23 está
> vacía. Un índice equivocado no da error: da un tile transparente y una escena
> que parece rota sin decir por qué. **Medir, no deducir.**
