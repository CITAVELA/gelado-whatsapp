/**
 * Utilidades comunes de los e2e: inicio de sesión por la interfaz, cliente HTTP con sesión para preparar datos,
 * y control del simulador de Meta (nunca la Meta real).
 */
import { expect, request as pwRequest, type APIRequestContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

export const PORT = process.env.E2E_PORT || '3100';
export const SIM_PORT = process.env.E2E_SIM_PORT || '4110';
export const BASE = `http://localhost:${PORT}`;
export const SIM = `http://127.0.0.1:${SIM_PORT}`;
export const WABA = '24936790469294569';
export const PASSWORD = 'e2e-password-123';
export const ADMIN = { email: 'gelado.comercial@gmail.com', name: 'María Iborra' };
export const CRISTINA = { email: 'administracion2@gelado.eu', name: 'Cristina Lopez' };
export const LOLO = { email: 'geladoexclusivas@gmail.com', name: 'Lolo Gelado' };
export const FIXTURES = path.resolve(__dirname, 'fixtures');

let seq = Math.floor(Math.random() * 9000) * 1000;
/** Móvil español único por llamada: 6xx xxx xxx (sin repetir entre ejecuciones de un mismo test). */
export function phone() {
  seq += 1;
  return { wa: `346${String(10_000_000 + seq).slice(-8)}`, e164: `+346${String(10_000_000 + seq).slice(-8)}` };
}

export async function simPost(p: string, body: unknown = {}) {
  const r = await fetch(`${SIM}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`simulador ${p} → ${r.status} ${await r.text()}`);
  return r.json() as Promise<any>;
}
export const simGet = async (p: string) => (await fetch(`${SIM}${p}`)).json() as Promise<any>;
/** Mensaje de texto entrante del cliente (firmado por el simulador hacia la app). */
export const inboundText = (from: string, body: string, name = 'Cliente de prueba') => simPost('/_sim/inbound', { from, name, type: 'text', text: { body } });

export async function login(page: Page, who: { email: string } = ADMIN, to = '/bandeja') {
  await page.goto('/login');
  await page.getByLabel('Correo').fill(who.email);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/bandeja/);
  if (to !== '/bandeja') await page.goto(to);
}

/** Cliente HTTP con sesión (cookie + cabecera CSRF) para preparar datos sin pasar por la interfaz. */
export async function api(who: { email: string } = ADMIN): Promise<APIRequestContext> {
  const ctx = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { 'X-Requested-With': 'XMLHttpRequest' } });
  const r = await ctx.post('/api/auth/login', { data: { email: who.email, password: PASSWORD } });
  if (!r.ok()) throw new Error(`login ${who.email} → ${r.status()}`);
  return ctx;
}

export async function json<T = any>(r: import('@playwright/test').APIResponse): Promise<T> {
  if (!r.ok()) throw new Error(`${r.url()} → ${r.status()} ${await r.text()}`);
  return r.json() as Promise<T>;
}

/** Espera a que el servidor tenga la conversación del teléfono y devuelve su id. */
export async function conversationIdFor(ctx: APIRequestContext, e164: string) {
  let id: string | undefined;
  await expect.poll(async () => {
    const list = await json(await ctx.get('/api/conversations', { params: { q: e164.replace('+', '') } }));
    id = (list.items ?? list.data ?? [])[0]?.id;
    return id;
  }, { timeout: 10_000 }).toBeTruthy();
  return id!;
}

export const PDF_PATH = path.join(FIXTURES, 'catalogo-dousse.pdf');
export const PNG_PATH = path.join(FIXTURES, 'foto-pedido.png');

/** Sube a la biblioteca (como administradora) el catálogo PDF si aún no está. */
export async function ensureLibraryPdf(admin: APIRequestContext, name = 'Catálogo DOUSSE 2026') {
  const files = await json<any[]>(await admin.get('/api/library/files', { params: { q: name } }));
  if (files.some((f) => f.name === name)) return files.find((f) => f.name === name);
  let folders = await json<any[]>(await admin.get('/api/library/folders'));
  let folder = folders.find((f) => f.name === 'Catálogos');
  if (!folder) folder = await json(await admin.post('/api/library/folders', { data: { name: 'Catálogos' } }));
  return json(await admin.post('/api/library/files', {
    multipart: { name, folderId: folder.id, file: { name: 'catalogo-dousse.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(PDF_PATH) } },
  }));
}

/** Plantilla creada por la API y aprobada por el simulador (webhook message_template_status_update). */
export async function ensureApprovedTemplate(admin: APIRequestContext, o: { name: string; displayName: string; category?: 'MARKETING' | 'UTILITY'; body?: string; examples?: string[] }) {
  const list = await json<any[]>(await admin.get('/api/templates'));
  let t = list.find((x) => x.name === o.name);
  if (!t) {
    const created = await admin.post('/api/templates', {
      data: {
        displayName: o.displayName, name: o.name, category: o.category ?? 'UTILITY', language: 'es',
        header: { format: 'NONE' }, body: o.body ?? 'Hola {{1}}, tu pedido está en camino. ¡Gracias por confiar en Exclusivas Gelado!',
        bodyExamples: o.examples ?? ['Ginés'], buttons: [], addOptOutButton: (o.category ?? 'UTILITY') === 'MARKETING',
      },
    });
    t = await json(created);
  }
  if (t.status !== 'APPROVED') {
    await simPost('/_sim/template-status', { event: 'APPROVED', templateId: t.metaTemplateId, name: t.name });
    await expect.poll(async () => (await json<any>(await admin.get(`/api/templates/${t.id}`))).status, { timeout: 10_000 }).toBe('APPROVED');
  }
  return json<any>(await admin.get(`/api/templates/${t.id}`));
}
