import { defineConfig } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Express `sendFile` devuelve 404 si la ruta absoluta contiene una carpeta oculta (p. ej. `.worktrees/`).
// Si pasa, se sirve una copia de la web compilada desde el directorio temporal (ver QA.md, fallo «sendFile con ruta oculta»).
const webDist = path.resolve(__dirname, '../apps/web/dist');
let WEB_DIST_DIR = '';
if (path.relative('/', webDist).split(path.sep).some((s) => s.startsWith('.'))) {
  WEB_DIST_DIR = path.join(os.tmpdir(), `gelado-e2e-web-${process.env.E2E_PORT || '3100'}`);
  fs.rmSync(WEB_DIST_DIR, { recursive: true, force: true });
  fs.cpSync(webDist, WEB_DIST_DIR, { recursive: true });
}

// e2e contra el build de producción (api + web en :3100) y el simulador de Meta (:4110). Nunca Meta real.
const PORT = process.env.E2E_PORT || '3100';
const SIM_PORT = process.env.E2E_SIM_PORT || '4110';
const DB = process.env.E2E_DATABASE_URL || 'postgresql://gelado:gelado@localhost:5432/gelado_e2e?schema=app';
const env = {
  NODE_ENV: 'development',
  PORT,
  APP_URL: `http://localhost:${PORT}`,
  DATABASE_URL: DB,
  DIRECT_URL: DB,
  META_GRAPH_BASE_URL: `http://127.0.0.1:${SIM_PORT}`,
  META_APP_SECRET: 'e2e-app-secret',
  WA_VERIFY_TOKEN: 'e2e-verify',
  STATUS_TOKEN: 'e2e-status-token',
  STORAGE_DRIVER: 'local',
  LOCAL_STORAGE_DIR: './storage-e2e',
  WORKER_ENABLED: 'true',
  WEB_DIST_DIR,
  SESSION_SECRET: 'e2e-session-secret-0123456789abcdef',
};

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure', screenshot: 'only-on-failure', locale: 'es-ES', timezoneId: 'Europe/Madrid' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium', launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH || undefined } } }],
  webServer: [
    {
      command: 'pnpm -F @gelado/api exec tsx test/meta-simulator/cli.ts',
      cwd: '..',
      port: Number(SIM_PORT),
      env: { ...env, META_SIM_PORT: SIM_PORT, META_SIM_WEBHOOK_URL: `http://localhost:${PORT}/webhooks/whatsapp` },
      reuseExistingServer: false,
    },
    {
      command: 'node apps/api/dist/main.js',
      cwd: '..',
      url: `http://localhost:${PORT}/health`,
      env,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
