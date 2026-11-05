/**
 * P16 (S12): importador de Superchat y contactos «Sin WhatsApp» (sin teléfono).
 * Fixture sintético de 6.560 filas: 6.253 con WhatsApp, 307 sin WhatsApp y 3 bajas.
 */
import { expect, test, type APIRequestContext } from '@playwright/test';
import path from 'node:path';
import { ADMIN, api, ensureApprovedTemplate, json, login, phone, simGet, simPost } from '../helpers';

test.describe.configure({ mode: 'serial' });
let admin: APIRequestContext;
test.beforeAll(async () => { admin = await api(ADMIN); });
test.afterAll(async () => admin?.dispose());

const FIXTURE = path.resolve(__dirname, '../../apps/api/test/fixtures/superchat-export-sintetico.csv');

test('importar el export sintético de Superchat por la interfaz: 6.253 con WhatsApp, 307 sin WhatsApp y 3 bajas', async ({ page }) => {
  test.setTimeout(240_000);
  const total = async (params: Record<string, string>) => (await json(await admin.get('/api/contacts', { params: { pageSize: '1', ...params } }))).total;
  const antes = { con: await total({ whatsapp: 'with' }), sin: await total({ whatsapp: 'without' }), baja: await total({ consent: 'REVOKED' }) };
  await login(page, ADMIN, '/contactos');
  await page.getByRole('link', { name: /Importar/ }).click();
  await page.getByLabel('Archivo a importar').setInputFiles(FIXTURE);
  await expect(page.getByText(/6\.?560 filas/)).toBeVisible({ timeout: 60_000 });
  // las cabeceras de Superchat se mapean solas (Teléfono, Dirección de correo electrónico, Etiquetas, Código, DNI, Teléfono Fijo…)
  await page.screenshot({ path: 'test-results/p16-columnas.png', fullPage: true });
  await page.getByRole('button', { name: /Siguiente: reglas/ }).click();
  await page.getByRole('button', { name: /Siguiente/ }).click();
  await expect(page.getByText('Vista previa del resultado')).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: 'test-results/p16-preview.png', fullPage: true });
  await page.getByRole('button', { name: /^Importar [\d.]+ contactos$/ }).click();
  await expect(page.getByRole('main').getByText('Importación terminada')).toBeVisible({ timeout: 180_000 });
  await page.screenshot({ path: 'test-results/p16-informe.png', fullPage: true });
  const stat = (k: string) => page.locator('.stat', { hasText: k }).locator('.v');
  await expect(stat('Sin WhatsApp')).toHaveText('307');
  await expect(stat('Dados de baja')).toHaveText('3');
  await expect(stat('Creados')).toHaveText(/^6\.?560$/); // son contactos nuevos solo si no existían: el teléfono de (e) no se repite en el fixture
  // la base queda como dice el informe: 6.253 con WhatsApp, 307 sin WhatsApp y 3 bajas
  expect(await total({ whatsapp: 'with' })).toBe(antes.con + 6253);
  expect(await total({ whatsapp: 'without' })).toBe(antes.sin + 307);
  expect(await total({ consent: 'REVOKED' })).toBe(antes.baja + 3);
  await expect(stat('Con WhatsApp')).toHaveText('6.253'); // F-20: el informe da también el total con WhatsApp
});

test('un contacto sin teléfono muestra el chip «Sin WhatsApp» y «Abrir conversación» deshabilitado', async ({ page }) => {
  const stamp = String(Date.now()).slice(-6);
  const nombre = `Soledad${stamp} Sinmovil${stamp}`;
  const email = `solo.correo.${stamp}@ejemplo.test`;
  const c = await json(await admin.post('/api/contacts', { data: { email, firstName: `Soledad${stamp}`, lastName: `Sinmovil${stamp}` } }));
  expect(c.phoneE164).toBeNull();
  await login(page, ADMIN, `/contactos?whatsapp=without&q=Sinmovil${stamp}`);
  const row = page.getByRole('row', { name: new RegExp(nombre) });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Sin WhatsApp');
  await page.screenshot({ path: 'test-results/p16-lista-sin-whatsapp.png' });
  await row.getByText(nombre).click();
  await expect(page.getByRole('heading', { name: new RegExp(nombre) })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Abrir conversación' })).toBeDisabled();
  await expect(page.getByRole('main')).toContainText('Sin WhatsApp');
  await page.screenshot({ path: 'test-results/p16-ficha-sin-whatsapp.png' });
  // la API tampoco abre conversación para él
  const r = await admin.post('/api/conversations', { data: { contactId: c.id } });
  expect(r.status()).toBeGreaterThanOrEqual(400);
  expect(r.status()).toBeLessThan(500);
  // el filtro «Con WhatsApp» no lo muestra
  await page.goto(`/contactos?whatsapp=with&q=Sinmovil${stamp}`);
  await expect(page.getByRole('row', { name: new RegExp(nombre) })).toHaveCount(0);
});

test('campaña con audiencia que incluye contactos sin teléfono: se avisa «sin WhatsApp» y no se les envía', async ({ page }) => {
  test.setTimeout(180_000);
  const stamp = String(Date.now()).slice(-6);
  const tpl = await ensureApprovedTemplate(admin, { name: `p16_oferta_${stamp}`, displayName: `Oferta P16 ${stamp}`, category: 'MARKETING', body: 'Hola {{1}}, tenemos novedades en Exclusivas Gelado.' });
  const labelName = `P16 ${stamp}`;
  const label = await json(await admin.post('/api/labels', { data: { name: labelName, color: '#2457C5', scope: 'CONTACT' } }));
  const con = [phone(), phone()];
  for (const [i, p] of con.entries()) await json(await admin.post('/api/contacts', { data: { phone: p.e164, firstName: `Con${i}${stamp}`, labelIds: [label.id] } }));
  const sin = [];
  for (let i = 0; i < 3; i++) sin.push(await json(await admin.post('/api/contacts', { data: { email: `sin${i}.${stamp}@ejemplo.test`, firstName: `Sin${i}${stamp}`, labelIds: [label.id] } })));
  await simPost('/_sim/reset');
  await login(page, ADMIN, '/campanas/nueva');
  await page.getByLabel(/Nombre de la campaña/).fill(`Campaña P16 ${stamp}`);
  await page.locator('#cmp-tpl').selectOption({ label: `Oferta P16 ${stamp} · Marketing` });
  await page.getByLabel('Añadir etiqueta').first().selectOption({ label: labelName });
  await expect(page.getByText('2 recibirán el mensaje')).toBeVisible();
  await page.screenshot({ path: 'test-results/p16-asistente.png', fullPage: true });
  // el recuento debe explicar por qué 5 seleccionados son solo 2 destinatarios
  await expect(page.locator('.cmp-count')).toContainText(/3\s+sin WhatsApp/i);
  await page.getByRole('button', { name: 'Lanzar campaña' }).click();
  await page.getByRole('button', { name: 'Lanzar ahora' }).click();
  await expect(page).toHaveURL(/\/campanas\/[0-9a-f-]{36}/, { timeout: 15_000 });
  await expect.poll(async () => (await simGet('/_sim/sent')).filter((s: any) => s.body?.type === 'template').length, { timeout: 120_000, intervals: [2000] }).toBe(2);
  const sent = (await simGet('/_sim/sent')).map((s: any) => s.body.to).sort();
  expect(sent).toEqual(con.map((p) => p.wa).sort());
  await page.reload();
  await expect(page.getByRole('main')).toContainText(/sin WhatsApp/i);
  await expect(page.getByRole('main')).toContainText(`Sin0${stamp}`);
  await page.screenshot({ path: 'test-results/p16-informe.png', fullPage: true });
});
