import { expect, test } from '@playwright/test';

// Golden de la cinemática. Lo que la hace capturable sin flakies: el
// reproductor expone `seek(t)`, que dibuja el instante EXACTO t. No se espera
// por reloj ni se cuentan frames.

const RUTA = '/games/dorian-intro/index.html';

async function abrir(page) {
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  await page.goto(RUTA);
  await page.waitForFunction(() => window.__DORIAN__, null, { timeout: 30000 });
  return errores;
}

test('carga las 18 capas y expone la duración calculada desde tweaks', async ({ page }) => {
  const errores = await abrir(page);
  const d = await page.evaluate(() => ({
    capas: window.__DORIAN__.capas,
    cuadros: window.__DORIAN__.cuadros,
    duracion: window.__DORIAN__.duracion,
    porCuadro: window.__DORIAN__.porCuadro,
  }));
  expect(errores, errores.join(' | ')).toHaveLength(0);
  expect(d.cuadros).toBe(6);
  expect(d.capas).toBe(18);                       // 6 cuadros x 3 capas
  expect(d.duracion).toBeCloseTo(d.porCuadro * 6, 5);
});

test('el texto se escribe y termina dentro de su cuadro', async ({ page }) => {
  await abrir(page);
  const medio = await page.evaluate(() => window.__DORIAN__.seek(3.0));
  const final = await page.evaluate((t) => window.__DORIAN__.seek(t - 0.3),
    await page.evaluate(() => window.__DORIAN__.porCuadro));

  expect(medio.cuadro).toBe('01-siluetas');
  expect(medio.texto.caracteres).toBeGreaterThan(0);
  expect(medio.texto.terminado).toBe(false);
  expect(final.texto.terminado, 'el texto debe estar completo al acabar el cuadro').toBe(true);
});

test('las capas derivan a distinta velocidad: eso es el parallax', async ({ page }) => {
  await abrir(page);
  const e = await page.evaluate(() => window.__DORIAN__.seek(4.0));
  const [fondo, medio, figura] = e.capas;
  expect(Math.abs(fondo.dx)).toBeLessThan(Math.abs(medio.dx));
  expect(Math.abs(medio.dx)).toBeLessThan(Math.abs(figura.dx));
  expect(figura.escala, 'la figura hace un zoom lento').toBeGreaterThan(1);
});

// Un golden por cuadro, tomado en su fase de lectura con el texto ya escrito.
for (const [i, id] of ['01-siluetas', '02-rey-vs-dragon', '03-caida',
                       '04-heroe', '05-batalla', '06-reino'].entries()) {
  test(`golden del cuadro ${id}`, async ({ page }) => {
    const errores = await abrir(page);
    const e = await page.evaluate(async (idx) => {
      const d = window.__DORIAN__;
      return d.seek(idx * d.porCuadro + d.porCuadro * 0.78);
    }, i);
    expect(errores, errores.join(' | ')).toHaveLength(0);
    expect(e.cuadro).toBe(id);
    expect(e.opacidad).toBeGreaterThan(0.9);
    await expect(page).toHaveScreenshot(`dorian-${id}.png`);
  });
}
