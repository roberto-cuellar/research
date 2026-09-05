import { expect, test } from '@playwright/test';

// Golden visual del juego. Es el verificador de `similitud_visual` del GOALS.
//
// Lo que hace comparable esta captura: el canvas tiene tamaño FIJO en píxeles
// de dibujo, la simulación es de paso fijo, y la espera es por una BANDERA del
// propio juego, no por reloj. Esperar por tiempo es lo que produce flakies.

test('nivel-01 se carga, el jugador se apoya y la escena coincide con su golden', async ({ page }) => {
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));

  await page.goto('/games/pixel-borislov/index.html');
  await page.waitForFunction(() => window.__SEM_LISTO__, null, { timeout: 15000 });

  const estado = await page.evaluate(() => window.__SEM_LISTO__);

  expect(errores, `errores de página: ${errores.join(' | ')}`).toHaveLength(0);
  expect(estado.tiles).toBe(46);
  expect(estado.solidos).toBe(7);
  // Lo que de verdad importa: el nivel es jugable, no solo dibujable.
  expect(estado.apoyado, 'el jugador debe quedar apoyado en el suelo').toBe(true);
  expect(estado.superficie).toBe('hierba');

  await expect(page).toHaveScreenshot('nivel-01-juego.png');
});
