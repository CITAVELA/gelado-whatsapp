import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Recorridos manuales guiados con capturas 1440×900 (docs/08): `pnpm -F @gelado/e2e recorridos`.
// Mismo build y mismo simulador que los e2e; las capturas van a docs/trabajo/capturas/recorridos/{agente,admin}/.
export default defineConfig({
  ...base,
  testDir: './recorridos',
  reporter: [['list']],
  timeout: 240_000,
  use: {
    ...base.use,
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'off',
    permissions: ['microphone'],
  },
  // micrófono falso del navegador para grabar la nota de voz sin hardware
  projects: [{
    name: 'chromium',
    use: { browserName: 'chromium', launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH || undefined, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } },
  }],
});
