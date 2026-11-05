/**
 * Utilidades de prueba: app Nest real contra la BD de pruebas, agentes supertest con sesión y CSRF,
 * limpieza de tablas y usuarios de prueba.
 */
import 'reflect-metadata';
import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { resetConfigCache } from '../../src/common/config';
import { createApp } from '../../src/bootstrap';
import { JobsService } from '../../src/modules/jobs/jobs.service';
import { seed } from '../../prisma/seed';
import { AuthService } from '../../src/modules/auth/auth.service';

export const TEST_PASSWORD = 'contraseña-de-prueba-1';

export interface TestApp {
  app: NestExpressApplication;
  http: ReturnType<typeof request>;
  prisma: PrismaClient;
  jobs: JobsService;
  /** resetDb + límites de login a cero */
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function createTestApp(env: Record<string, string> = {}): Promise<TestApp> {
  resetConfigCache(env);
  const app = await createApp({ logger: false });
  await app.init();
  const prisma = new PrismaClient();
  return {
    app,
    http: request(app.getHttpServer()),
    prisma,
    jobs: app.get(JobsService),
    async reset() {
      app.get(AuthService).limiter.clear();
      await resetDb(prisma);
    },
    async close() {
      await prisma.$disconnect();
      await app.close();
    },
  };
}

/** Vacía todas las tablas del esquema app (menos migraciones) y vuelve a sembrar etiquetas y ajustes. */
export async function resetDb(prisma: PrismaClient, opts: { seed?: boolean } = { seed: true }) {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'app' AND tablename <> '_prisma_migrations'`;
  if (rows.length) await prisma.$executeRawUnsafe(`TRUNCATE ${rows.map((r) => `"app"."${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  if (opts.seed !== false) {
    const prev = process.env.SEED_DEV_PASSWORD;
    process.env.SEED_DEV_PASSWORD = TEST_PASSWORD;
    await seed(prisma, { quiet: true });
    process.env.SEED_DEV_PASSWORD = prev;
  }
}

export async function createUser(prisma: PrismaClient, data: { email: string; name?: string; role?: 'ADMIN' | 'AGENT'; password?: string; active?: boolean }) {
  return prisma.user.create({
    data: {
      email: data.email,
      name: data.name ?? data.email.split('@')[0]!,
      role: data.role ?? 'AGENT',
      active: data.active ?? true,
      passwordHash: await argon2.hash(data.password ?? TEST_PASSWORD, { type: argon2.argon2id }),
    },
  });
}

/** Agente HTTP con sesión iniciada; `send` añade la cabecera CSRF. */
export async function loginAs(t: TestApp, email: string, password = TEST_PASSWORD) {
  const agent = request.agent(t.app.getHttpServer());
  const res = await agent.post('/api/auth/login').set('X-Requested-With', 'XMLHttpRequest').send({ email, password });
  if (res.status !== 200) throw new Error(`login ${email} → ${res.status} ${JSON.stringify(res.body)}`);
  const csrf = { 'X-Requested-With': 'XMLHttpRequest' };
  return {
    agent,
    user: res.body as { id: string; email: string; role: string; name: string },
    get: (url: string) => agent.get(url),
    post: (url: string, body?: unknown) => agent.post(url).set(csrf).send(body as any),
    patch: (url: string, body?: unknown) => agent.patch(url).set(csrf).send(body as any),
    put: (url: string, body?: unknown) => agent.put(url).set(csrf).send(body as any),
    del: (url: string) => agent.delete(url).set(csrf),
  };
}

export const ADMIN_EMAIL = 'gelado.comercial@gmail.com';
export const AGENT_EMAIL = 'administracion2@gelado.eu';
