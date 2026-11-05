import { defineConfig } from '@playwright/test';

// e2e contra el build de producción (api + web en :3100) y el simulador de Meta (:4110). Nunca Meta real.
const DB = process.env.E2E_DATABASE_URL || 'postgresql://gelado:gelado@localhost:5432/gelado_e2e?schema=app';
const env = {
  NODE_ENV: 'development',
  PORT: '3100',
  APP_URL: 'http://localhost:3100',
  DATABASE_URL: DB,
  DIRECT_URL: DB,
  META_GRAPH_BASE_URL: 'http://127.0.0.1:4110',
  META_APP_SECRET: 'e2e-app-secret',
  WA_VERIFY_TOKEN: 'e2e-verify',
  STATUS_TOKEN: 'e2e-status-token',
  STORAGE_DRIVER: 'local',
  LOCAL_STORAGE_DIR: './storage-e2e',
  WORKER_ENABLED: 'true',
  SESSION_SECRET: 'e2e-session-secret-0123456789abcdef',
};

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://localhost:3100', trace: 'retain-on-failure', screenshot: 'only-on-failure', locale: 'es-ES', timezoneId: 'Europe/Madrid' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium', launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH || undefined } } }],
  webServer: [
    {
      command: 'pnpm -F @gelado/api exec tsx test/meta-simulator/cli.ts',
      cwd: '..',
      port: 4110,
      env: { ...env, META_SIM_PORT: '4110', META_SIM_WEBHOOK_URL: 'http://localhost:3100/webhooks/whatsapp' },
      reuseExistingServer: false,
    },
    {
      command: 'node apps/api/dist/main.js',
      cwd: '..',
      url: 'http://localhost:3100/health',
      env,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
