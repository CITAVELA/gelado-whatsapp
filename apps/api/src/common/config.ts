import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';

/** Carga el .env de la raíz del monorepo (o de apps/api) si existe. No pisa variables ya definidas. */
export function loadDotEnv() {
  for (const f of [path.resolve(__dirname, '../../../../.env'), path.resolve(__dirname, '../../.env'), path.resolve(process.cwd(), '.env')]) {
    if (fs.existsSync(f)) {
      try {
        process.loadEnvFile(f);
      } catch {
        /* formato no válido: se ignora */
      }
      return f;
    }
  }
  return null;
}

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  APP_URL: z.string().url().default('http://localhost:3000'),
  TZ: z.string().default('Europe/Madrid'),
  SESSION_SECRET: z.string().min(16).default('dev-session-secret-change-me-0000000000'),
  STATUS_TOKEN: z.string().default(''),
  WORKER_ENABLED: bool.default(true),
  DATABASE_URL: z.string(),
  STORAGE_DRIVER: z.enum(['local', 'supabase']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default('./storage-local'),
  SUPABASE_URL: z.string().default(''),
  SUPABASE_SERVICE_ROLE_KEY: z.string().default(''),
  SUPABASE_STORAGE_BUCKET: z.string().default('media'),
  META_GRAPH_BASE_URL: z.string().url().default('http://localhost:4010'),
  GRAPH_API_VERSION: z.string().default('v23.0').transform((v) => v || 'v23.0'),
  META_APP_ID: z.string().default('sim-app-id'),
  META_APP_SECRET: z.string().default('sim-app-secret'),
  WA_SYSTEM_USER_TOKEN: z.string().default('sim-token'),
  WA_VERIFY_TOKEN: z.string().default('sim-verify-token'),
  WA_WABA_ID: z.string().default('24936790469294569'),
  WA_PHONE_NUMBER_ID: z.string().default('833139829886325'),
  META_BUSINESS_ID: z.string().default('115003938195726'),
  /** Ruta del build de la web que sirve NestJS en producción */
  WEB_DIST_DIR: z.string().default(''),
  /** Contraseña de desarrollo que pone el seed a los 3 usuarios (nunca en producción) */
  SEED_DEV_PASSWORD: z.string().default(''),
});

export type AppConfig = z.infer<typeof envSchema>;

let cached: AppConfig | null = null;

/** Lee y valida las variables de entorno. Vacías = valor por defecto de desarrollo. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const clean = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== '' && v !== undefined));
  const cfg = envSchema.parse(clean);
  if (cfg.NODE_ENV === 'production') {
    const required: (keyof AppConfig)[] = ['SESSION_SECRET', 'STATUS_TOKEN', 'META_APP_SECRET', 'WA_SYSTEM_USER_TOKEN', 'WA_VERIFY_TOKEN', 'META_APP_ID'];
    const missing = required.filter((k) => !clean[k]);
    if (cfg.STORAGE_DRIVER === 'supabase' && (!clean.SUPABASE_URL || !clean.SUPABASE_SERVICE_ROLE_KEY)) missing.push('SUPABASE_URL');
    if (missing.length) throw new Error(`Faltan variables de entorno en producción: ${missing.join(', ')}`);
    const problems: string[] = [];
    if (!cfg.META_GRAPH_BASE_URL.startsWith('https://')) problems.push('META_GRAPH_BASE_URL debe ser https:// (no el simulador)');
    if (cfg.STORAGE_DRIVER !== 'supabase') problems.push('STORAGE_DRIVER debe ser supabase en producción');
    const appHost = new URL(cfg.APP_URL).hostname;
    if (['localhost', '127.0.0.1', '0.0.0.0'].includes(appHost) || !cfg.APP_URL.startsWith('https://')) problems.push('APP_URL debe ser la dirección https pública');
    if (cfg.STATUS_TOKEN.length < 32) problems.push('STATUS_TOKEN debe tener al menos 32 caracteres');
    if (cfg.SESSION_SECRET.length < 32 || cfg.SESSION_SECRET.startsWith('dev-')) problems.push('SESSION_SECRET debe ser aleatorio (≥ 32 caracteres)');
    if (problems.length) throw new Error(`Configuración de producción no válida: ${problems.join('; ')}`);
  }
  return cfg;
}

export function config(): AppConfig {
  if (!cached) cached = loadConfig();
  return cached;
}

/** Solo para pruebas */
export function resetConfigCache(overrides?: Partial<Record<keyof AppConfig, string>>) {
  if (overrides) Object.assign(process.env, overrides);
  cached = null;
}

export const CONFIG = Symbol('CONFIG');
