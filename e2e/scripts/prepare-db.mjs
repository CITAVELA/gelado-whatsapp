// BD e2e desde cero (solo bases locales *_e2e): borra el esquema, migra y siembra.
import { execSync } from 'node:child_process';
import pg from 'pg';

const url = process.env.E2E_DATABASE_URL || 'postgresql://gelado:gelado@localhost:5432/gelado_e2e?schema=app';
const u = new URL(url);
const db = u.pathname.slice(1);
if (!/_e2e$/.test(db) || !['localhost', '127.0.0.1'].includes(u.hostname)) throw new Error('E2E_DATABASE_URL debe ser una base local *_e2e');
const conn = { host: u.hostname, port: Number(u.port || 5432), user: u.username, password: decodeURIComponent(u.password) };
const admin = new pg.Client({ ...conn, database: 'postgres' });
await admin.connect();
if (!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [db])).rowCount) await admin.query(`CREATE DATABASE "${db}"`);
await admin.end();
const c = new pg.Client({ ...conn, database: db });
await c.connect();
await c.query('DROP SCHEMA IF EXISTS app CASCADE; DROP SCHEMA IF EXISTS pgboss CASCADE; CREATE SCHEMA app;');
await c.end();
const env = { ...process.env, DATABASE_URL: url, DIRECT_URL: url, SEED_DEV_PASSWORD: 'e2e-password-123', NODE_ENV: 'development' };
execSync('pnpm -F @gelado/api exec prisma migrate deploy', { env, stdio: 'inherit', cwd: new URL('../..', import.meta.url).pathname });
execSync('pnpm -F @gelado/api run seed', { env, stdio: 'inherit', cwd: new URL('../..', import.meta.url).pathname });
