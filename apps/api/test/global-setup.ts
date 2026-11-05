import { execSync } from 'node:child_process';
import { Client } from 'pg';

/**
 * Prepara la BD de pruebas desde cero: crea la base si no existe, borra el esquema `app` y aplica
 * las migraciones con `prisma migrate deploy`. Por seguridad solo actúa sobre bases locales cuyo nombre
 * termina en `_test` (nunca sobre desarrollo ni producción).
 */
export default async function () {
  const url = process.env.TEST_DATABASE_URL || 'postgresql://gelado:gelado@localhost:5432/gelado_test?schema=app';
  const u = new URL(url);
  const dbName = u.pathname.slice(1);
  if (!/_test(_\w+)?$/.test(dbName) || !['localhost', '127.0.0.1'].includes(u.hostname)) {
    throw new Error(`TEST_DATABASE_URL debe ser una base local *_test (recibido ${u.hostname}/${dbName})`);
  }
  const conn = { host: u.hostname, port: Number(u.port || 5432), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password) };
  const admin = new Client({ ...conn, database: 'postgres' });
  await admin.connect();
  const r = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (!r.rowCount) await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();
  const db = new Client({ ...conn, database: dbName });
  await db.connect();
  await db.query('DROP SCHEMA IF EXISTS app CASCADE; DROP SCHEMA IF EXISTS pgboss CASCADE; CREATE SCHEMA app;');
  await db.end();
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url }, stdio: 'pipe' });
}
