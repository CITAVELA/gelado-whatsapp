/**
 * Regresiones de los defectos de interfaz que encontró la revisión de QA (docs/trabajo/QA.md, F-10 a F-14).
 * Ya están corregidos: estas pruebas evitan que vuelvan.
 */
import { expect, test } from '@playwright/test';
import { ADMIN, CRISTINA, api, ensureApprovedTemplate, inboundText, json, login, phone, simGet, simPost } from '../helpers';

test('F-10 · tras enviar varios mensajes seguidos, ninguno se queda en «Enviando» (reloj) cuando el servidor ya lo envió', async ({ page }) => {
  await login(page, CRISTINA);
  const p = phone();
  const name = `Carrera ${p.wa.slice(-8)}`;
  await inboundText(p.wa, 'hola', name);
  await page.getByRole('list', { name: 'Lista de conversaciones' }).getByRole('link', { name: new RegExp(name) }).click();
  const box = page.getByLabel('Escribe un mensaje');
  for (let i = 0; i < 8; i++) {
    await box.fill(`mensaje ${i}`);
    await box.press('Enter');
    await page.waitForTimeout(150);
  }
  await expect.poll(async () => (await simGet('/_sim/sent')).filter((s: any) => s.body?.to === p.wa).length, { timeout: 10_000 }).toBe(8);
  await page.waitForTimeout(3000);
  await expect(page.locator('.msg[data-status="PENDING"]')).toHaveCount(0);
});

test('F-11 · la tabla «Equipo» de Ajustes no recorta la columna de acciones a 1440 px', async ({ page }) => {
  await login(page, ADMIN, '/ajustes');
  const last = page.getByRole('row', { name: /Cristina Lopez/ }).getByRole('button').or(page.getByRole('row', { name: /Cristina Lopez/ }).getByRole('link')).last();
  const panel = page.locator('.panel, table').first();
  const [a, b] = [await last.boundingBox(), await panel.boundingBox()];
  expect(a!.x + a!.width).toBeLessThanOrEqual(b!.x + b!.width + 1);
});

test('F-12 · el informe de campaña no recorta «Abrir conversación» en la lista de destinatarios', async ({ page }) => {
  test.setTimeout(120_000);
  const admin = await api(ADMIN);
  const tpl = await ensureApprovedTemplate(admin, { name: `oferta_qa_${Date.now()}`, displayName: 'Oferta QA', category: 'MARKETING', body: 'Hola {{1}}, tenemos una oferta para ti en Exclusivas Gelado.' });
  const label = await json(await admin.post('/api/labels', { data: { name: `QA-F12 ${Date.now()}`.slice(0, 30), color: '#2457C5', scope: 'CONTACT' } }));
  const p = phone();
  const c = await json(await admin.post('/api/contacts', { data: { phone: p.e164, firstName: 'Elena', lastName: 'Prueba Con Apellidos Largos', labelIds: [label.id] } }));
  const camp = await json(await admin.post('/api/campaigns', { data: { name: `F12 ${Date.now()}`, templateId: tpl.id, variableMapping: { 'body.1': { field: 'firstName', fallback: 'cliente' } }, audience: { includeLabelIds: [label.id] }, ratePerMinute: 20 } }));
  await json(await admin.post(`/api/campaigns/${camp.id}/launch`, { data: {} }));
  await expect.poll(async () => (await simGet('/_sim/sent')).some((s: any) => s.body?.to === p.wa), { timeout: 90_000, intervals: [2000] }).toBe(true);
  expect(c.id).toBeTruthy();
  // la entrega falla con el tope de marketing: la fila lleva el motivo largo que ensancha la tabla
  const wamid = (await simGet('/_sim/sent')).find((s: any) => s.body?.to === p.wa).id;
  await simPost('/_sim/status', { wamid, status: 'failed', recipient: p.wa, errorCode: 131049 });
  await login(page, ADMIN, `/campanas/${camp.id}`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByText(/tope de marketing/).first()).toBeVisible();
  const link = page.getByRole('link', { name: /Abrir|Ver/ }).last();
  const panel = page.locator('.panel').filter({ has: page.getByRole('tab', { name: /Todos/ }) });
  const [a, b] = [await link.boundingBox(), await panel.boundingBox()];
  expect(a!.x + a!.width).toBeLessThanOrEqual(b!.x + b!.width + 1);
  await admin.dispose();
});

test('F-13 · Ajustes → WhatsApp no deja palabras en inglés («nombre approved»)', async ({ page }) => {
  await login(page, ADMIN, '/ajustes');
  await page.getByRole('link', { name: /WhatsApp y tarifas/ }).or(page.getByRole('button', { name: /WhatsApp y tarifas/ })).first().click();
  await expect(page.getByText('Estado del número')).toBeVisible();
  await expect(page.getByText(/Conectado/)).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(/\bapproved\b|\bconnected\b/i);
});

test('F-14 · el listado de plantillas muestra el idioma en español («Español», no «es»)', async ({ page }) => {
  const admin = await api(ADMIN);
  await ensureApprovedTemplate(admin, { name: 'aviso_pedido', displayName: 'Aviso de pedido', category: 'UTILITY' });
  await login(page, ADMIN, '/plantillas');
  const row = page.getByRole('row', { name: /Aviso de pedido/ });
  await expect(row).toContainText(/Español/);
  await admin.dispose();
});
