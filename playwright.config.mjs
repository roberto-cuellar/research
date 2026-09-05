import { defineConfig, devices } from '@playwright/test';

// La descarga del Chromium empaquetado falla en esta máquina: los CDN responden
// (400/403 son respuestas HTTP válidas, no fallos de conexión), pero la
// transferencia del binario grande se corta por timeout. Diagnosticado el
// 2026-09-05 tras tres intentos.
//
// Se usa el Chrome del sistema con `channel: 'chrome'`, que ya está instalado.
// CONSECUENCIA A VIGILAR: la versión del navegador deja de estar anclada por
// Playwright y pasa a depender de las actualizaciones de Chrome. Para golden
// tests visuales eso es una fuente real de deriva — un cambio de versión puede
// mover el antialiasing y romper baselines sin que el código cambie.
// En CI (ubuntu) SÍ se usa el Chromium empaquetado, donde la descarga funciona.

const enCI = !!process.env.CI;

export default defineConfig({
  testDir: './tests/visual',
  fullyParallel: false,        // los golden visuales no se paralelizan: comparten baseline
  forbidOnly: enCI,
  retries: 0,                  // un test visual flaky es un test roto, no uno que reintentar
  reporter: enCI ? 'github' : 'list',

  expect: {
    toHaveScreenshot: {
      // Umbral verificado contra la doc oficial. `maxDiffPixelRatio` y `threshold`
      // NO están confirmados en esa página: comprobarlos contra la versión
      // instalada (1.63.0) antes de usarlos.
      maxDiffPixels: 100,
    },
  },

  use: {
    ...devices['Desktop Chrome'],
    ...(enCI ? {} : { channel: 'chrome' }),
    // Determinismo: sin él los niveles 1-3 de la cascada dan falsos positivos.
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    screenshot: 'only-on-failure',
  },
});
