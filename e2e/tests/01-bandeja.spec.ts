/**
 * Recorrido de la bandeja como agente (docs/08 · criterios de aceptación):
 * (a) entrante en < 5 s sin recargar · (b) responder con texto y plantilla con la ventana cerrada
 * (c) PDF de la biblioteca y foto del ordenador · (d) asignar, etiquetar, posponer y finalizar.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { ADMIN, CRISTINA, PNG_PATH, api, ensureApprovedTemplate, ensureLibraryPdf, inboundText, json, login, phone, simGet, simPost } from '../helpers';

test.describe.configure({ mode: 'serial' });

let admin: APIRequestContext;
const client = phone();
const NAME = `Ginés Pérez QA${client.wa.slice(-8)}`;

test.beforeAll(async () => {
  admin = await api(ADMIN);
  await ensureLibraryPdf(admin);
  await ensureApprovedTemplate(admin, { name: 'aviso_pedido', displayName: 'Aviso de pedido', category: 'UTILITY' });
  await simPost('/_sim/reset');
});
test.afterAll(async () => admin?.dispose());

const card = (page: Page, name = NAME) => page.getByRole('list', { name: 'Lista de conversaciones' }).getByRole('link', { name: new RegExp(name) });
const chat = (page: Page) => page.getByRole('main', { name: /^Conversación con/ });
const sentTypes = async () => (await simGet('/_sim/sent')).map((s: any) => s.body?.type);

test('(a) un mensaje entrante aparece en la bandeja en menos de 5 s, sin recargar la página', async ({ page }) => {
  await login(page, CRISTINA);
  await page.evaluate(() => { (window as any).__sinRecarga = true; });
  const t0 = Date.now();
  await inboundText(client.wa, 'Hola, ¿tenéis tinte DOUSSE del 7.1?', NAME);
  await expect(card(page)).toBeVisible({ timeout: 5000 });
  const ms = Date.now() - t0;
  expect(await page.evaluate(() => (window as any).__sinRecarga)).toBe(true); // la página no se recargó
  console.log(`Entrante visible en la bandeja en ${ms} ms`);
  expect(ms).toBeLessThan(5000);
  await expect(card(page)).toContainText('tinte DOUSSE');
  await expect(page).toHaveTitle(/^\(\d+\) Gelado WhatsApp/);
});

test('(a) aviso sonoro y notificación del navegador al entrar un mensaje; sin aviso si ya estás en esa conversación', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'es-ES', baseURL: `http://localhost:${process.env.E2E_PORT || '3100'}`, permissions: ['notifications'] });
  await ctx.addInitScript(() => {
    (window as any).__beeps = 0;
    (window as any).__notifs = [] as string[];
    const proto = (window.AudioContext ?? (window as any).webkitAudioContext)?.prototype;
    if (proto) {
      const orig = proto.createOscillator;
      proto.createOscillator = function (...a: any[]) { (window as any).__beeps++; return orig.apply(this, a); };
    }
    const Real = window.Notification;
    (window as any).Notification = class extends Real { constructor(t: string, o?: NotificationOptions) { super(t, o); (window as any).__notifs.push(`${t}|${o?.body ?? ''}`); } };
    Object.defineProperty((window as any).Notification, 'permission', { get: () => 'granted' });
  });
  const page = await ctx.newPage();
  await login(page, CRISTINA);
  const a = phone(), b = phone();
  const nameA = `Sonido ${a.wa.slice(-8)}`, nameB = `Otro ${b.wa.slice(-8)}`;
  await inboundText(a.wa, 'Primer aviso', nameA);
  await expect(card(page, nameA)).toBeVisible({ timeout: 5000 });
  await expect.poll(() => page.evaluate(() => (window as any).__beeps)).toBeGreaterThanOrEqual(2); // dos pitidos
  await expect.poll(() => page.evaluate(() => (window as any).__notifs)).toContainEqual(expect.stringContaining(`${nameA}|Primer aviso`));
  // con la conversación A abierta y visible, otro mensaje de A no avisa; uno de B sí
  await card(page, nameA).click();
  await expect(chat(page)).toBeVisible();
  const before = await page.evaluate(() => (window as any).__beeps);
  await inboundText(a.wa, 'Segundo mensaje, ya estás mirando', nameA);
  await expect(chat(page).getByText('Segundo mensaje, ya estás mirando')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as any).__beeps)).toBe(before);
  await inboundText(b.wa, 'Soy otro cliente', nameB);
  await expect(card(page, nameB)).toBeVisible({ timeout: 5000 });
  await expect.poll(() => page.evaluate(() => (window as any).__beeps)).toBeGreaterThan(before);
  await ctx.close();
});

test('(b) responder con texto: Enter envía, sale por la API de Meta y el cliente lo recibe', async ({ page }) => {
  await login(page, CRISTINA);
  await card(page).click();
  await expect(page.getByText('Ventana abierta: quedan')).toBeVisible();
  const box = page.getByLabel('Escribe un mensaje');
  await box.fill('¡Hola Ginés! Sí, tenemos el 7.1 en stock.');
  await box.press('Enter');
  // el mensaje provisional (optimista) debe ser sustituido por el real: al final, una sola burbuja
  await expect(chat(page).getByText('¡Hola Ginés! Sí, tenemos el 7.1 en stock.', { exact: true })).toHaveCount(1, { timeout: 5000 });
  await expect.poll(sentTypes).toContain('text');
  const sent = (await simGet('/_sim/sent')).find((s: any) => s.body?.type === 'text');
  expect(sent.body.to).toBe(client.wa);
  expect(sent.body.text.body).toContain('7.1 en stock');
  // el cliente recibe doble check: el simulador confirma entrega y lectura
  await simPost('/_sim/status', { wamid: sent.id, status: 'delivered', recipient: client.wa });
  await simPost('/_sim/status', { wamid: sent.id, status: 'read', recipient: client.wa });
  await expect(page.getByLabel(/leído/i).first()).toBeVisible({ timeout: 8000 });
});

test('(c) adjuntar el PDF de la biblioteca y una foto del ordenador', async ({ page }) => {
  await login(page, CRISTINA);
  await card(page).click();
  await page.getByRole('button', { name: 'Adjuntar archivo' }).click();
  const modal = page.getByRole('dialog', { name: 'Adjuntar archivos' });
  await expect(modal).toBeVisible();
  await modal.getByRole('cell', { name: 'Catálogos' }).click();
  await modal.getByRole('row', { name: /Catálogo DOUSSE 2026/ }).click();
  await modal.getByLabel('Elegir archivos del ordenador').setInputFiles(PNG_PATH);
  await modal.getByLabel(/Texto que acompaña/).fill('Aquí tienes el catálogo y la foto');
  await expect(modal.getByRole('button', { name: 'Enviar 2 archivos' })).toBeEnabled();
  await modal.getByRole('button', { name: 'Enviar 2 archivos' }).click();
  await expect(modal).toBeHidden({ timeout: 15_000 });
  await expect.poll(sentTypes, { timeout: 10_000 }).toEqual(expect.arrayContaining(['document', 'image']));
  const doc = (await simGet('/_sim/sent')).find((s: any) => s.body?.type === 'document');
  expect(doc.body.document.filename).toMatch(/\.pdf$/i);
  await expect(chat(page).getByText(/catalogo-dousse\.pdf|Catálogo DOUSSE/).first()).toBeVisible();
});

test('(d) asignar, etiquetar, posponer y finalizar dejan su rastro en el historial', async ({ page }) => {
  await login(page, CRISTINA);
  await card(page).click();
  const id = page.url().split('/').pop()!;
  // asignar a mí
  await page.getByRole('button', { name: 'Asignar', exact: true }).click();
  await page.getByRole('menuitem', { name: /Cristina Lopez \(tú\)/ }).click();
  await expect(page.getByText(/asignó|asignada/i).first()).toBeVisible();
  // etiquetar
  await page.getByRole('button', { name: 'Etiquetar' }).click();
  await page.getByRole('menuitem', { name: /PEDIDO/i }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByText(/PEDIDO/).first()).toBeVisible();
  // posponer 1 hora → pasa a Pospuestas y sale de Abiertos
  await page.getByRole('button', { name: 'Posponer' }).click();
  await page.getByRole('menuitem', { name: /1 hora/ }).click();
  await expect(card(page)).toHaveCount(0);
  await page.getByRole('tab', { name: 'Pospuestas' }).click();
  await expect(card(page)).toBeVisible();
  await card(page).click();
  await expect(page.getByText(/pospuso|pospuesta/i).first()).toBeVisible();
  // finalizar → pasa a Finalizadas
  await page.getByRole('button', { name: 'Marcar como finalizada' }).click();
  await page.getByRole('tab', { name: 'Finalizadas' }).click();
  await expect(card(page)).toBeVisible();
  const tl = await json(await admin.get(`/api/conversations/${id}/timeline`));
  const types = (tl.items ?? tl.data ?? []).filter((i: any) => i.type === 'event').map((i: any) => i.event.type);
  expect(types).toEqual(expect.arrayContaining(['ASSIGNED', 'LABEL_ADDED', 'SNOOZED', 'DONE']));
  // si el cliente vuelve a escribir, la conversación se reabre sola
  await inboundText(client.wa, 'Una cosa más: ¿hacéis envíos el sábado?', NAME);
  await page.getByRole('tab', { name: 'Abiertos' }).click();
  await expect(card(page)).toBeVisible({ timeout: 5000 });
});

test('(b) con la ventana cerrada solo se puede enviar plantilla, y funciona', async ({ page }) => {
  // conversación nueva por la API: el cliente aún no ha escrito → ventana cerrada
  const closed = phone();
  const conv = await json(await admin.post('/api/conversations', { data: { phone: closed.e164 } }));
  await simPost('/_sim/reset');
  await login(page, CRISTINA);
  await page.goto(`/bandeja/c/${conv.id}`);
  await expect(page.getByText('Ventana cerrada: solo plantillas')).toBeVisible();
  await expect(page.getByLabel('Escribe un mensaje')).toHaveCount(0); // no hay caja de texto libre
  await page.getByRole('button', { name: 'Enviar plantilla' }).click();
  const modal = page.getByRole('dialog', { name: /Enviar plantilla de WhatsApp/ });
  await modal.getByRole('button', { name: /Aviso de pedido/ }).click();
  await modal.getByPlaceholder(/Ej\.:/).fill('Marta');
  await expect(modal.getByText(/Coste estimado de este envío/)).toBeVisible();
  await modal.getByRole('button', { name: 'Enviar plantilla' }).click();
  await expect(modal).toBeHidden({ timeout: 10_000 });
  await expect.poll(sentTypes, { timeout: 10_000 }).toContain('template');
  const t = (await simGet('/_sim/sent')).find((s: any) => s.body?.type === 'template');
  expect(t.body.template.name).toBe('aviso_pedido');
  expect(t.body.to).toBe(closed.wa);
  await expect(chat(page).getByText(/tu pedido está en camino/)).toBeVisible();
  // por la API tampoco se puede saltar la regla
  const r = await admin.post(`/api/conversations/${conv.id}/messages`, { data: { type: 'text', body: 'a ver si cuela' } });
  expect(r.status()).toBe(409);
});
