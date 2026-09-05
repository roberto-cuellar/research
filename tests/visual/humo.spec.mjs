import { expect, test } from '@playwright/test';

// Prueba de humo de la Fase 3: demuestra que Playwright captura y compara contra
// una baseline versionada. La primera ejecución GENERA la baseline; las
// siguientes comparan. Ese fichero es el "golden" y va a git.

test('captura una página determinista y compara contra baseline', async ({ page }) => {
  // Página inline: sin red, sin fuentes externas, sin nada que cambie entre
  // ejecuciones. Una baseline que depende de la red no es una baseline.
  await page.setContent(`
    <style>
      body { margin:0; background:#1c1e24; font-family: monospace; }
      .caja { position:absolute; left:100px; top:120px; width:60px; height:80px; background:#468cdc; }
      .sol  { position:absolute; left:250px; top:90px; width:60px; height:60px;
              border-radius:50%; background:#dcb446; }
      .suelo{ position:absolute; left:40px; top:200px; width:320px; height:60px; background:#3c463c; }
    </style>
    <div class="suelo"></div><div class="caja"></div><div class="sol"></div>
  `);
  await page.waitForLoadState('domcontentloaded');
  await expect(page).toHaveScreenshot('escena-base.png');
});
