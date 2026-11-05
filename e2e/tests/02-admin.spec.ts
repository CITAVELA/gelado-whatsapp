/**
 * Recorrido de la administradora: (e) importar un CSV pequeño y ver el informe · (f) crear una plantilla
 * y enviarla a revisión · (g) campaña de prueba y su informe · (h) un agente no ve Ajustes ni lanza campañas.
 */
import { expect, test, type APIRequestContext } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ADMIN, CRISTINA, api, ensureApprovedTemplate, json, login, phone, simGet, simPost } from '../helpers';

test.describe.configure({ mode: 'serial' });
let admin: APIRequestContext;
test.beforeAll(async () => {
  admin = await api(ADMIN);
});
test.afterAll(async () => admin?.dispose());

/** CSV al estilo Superchat con los problemas típicos; los teléfonos son únicos por ejecución. */
function buildCsv() {
  const f = phone().wa.slice(2), a = phone().wa.slice(2), b = phone().wa.slice(2), c = phone().wa.slice(2), d = phone().wa.slice(2), e = phone().wa.slice(2);
  const sp = (n: string) => `${n.slice(0, 3)} ${n.slice(3, 5)} ${n.slice(5, 7)} ${n.slice(7)}`;
  const rows = [
    'Nombre;Apellido;Teléfono;Correo;Código;DNI;Teléfono Fijo;Listas',
    `Ana;Ruiz Soler;${a};ana@peluqueria-ana.es;C-0001;21345678Z;965123456;PELUQUERÍA`,
    `Marta 🌸;Gómez;+34 ${sp(b)};;C-0002;B12345678;;ESTÉTICA`,
    `Luis;Pérez;0034 ${c};;C-0003;;;BARBERÍA`,
    `Luis;Pérez;${c};;C-0003;;;BARBERÍA`,
    `Pierre;Dupont;+33 ${f[0]} ${f.slice(1, 3)} ${f.slice(3, 5)} ${f.slice(5, 7)} ${f.slice(7)};;C-0004;;;`,
    'Carmen;Sanz;12345;;C-0005;;;PELUQUERÍA',
    `Jubilado;Antiguo;${d};;C-0006;;;JUBILADO, NO PUBLICIDAD`,
    ';;;;;;;',
    `Rosa;Vidal;${e};;C-0007;X1234567L;;INSTITUTO`,
  ];
  const file = path.join(os.tmpdir(), `contactos-qa-${a}.csv`);
  fs.writeFileSync(file, rows.join('\n'), 'utf8');
  return { file, phones: { ana: `+34${a}`, marta: `+34${b}`, luis: `+34${c}`, jubilado: `+34${d}`, rosa: `+34${e}` } };
}

test('(e) importar un CSV: mapear, reglas, vista previa, importar e informe', async ({ page }) => {
  const csv = buildCsv();
  await login(page, ADMIN, '/contactos');
  await page.getByRole('link', { name: /Importar/ }).click();
  await page.getByLabel('Archivo a importar').setInputFiles(csv.file);
  await expect(page.getByText(/9 filas/)).toBeVisible();
  // 2 · columnas: el asistente reconoce las de Superchat
  await expect(page.getByRole('combobox').nth(2)).toHaveValue('phone');
  await page.getByRole('button', { name: /Siguiente: reglas/ }).click();
  // 3 · reglas (por defecto: ES, actualizar duplicados, NO PUBLICIDAD = baja)
  await expect(page.getByText(/La etiqueta NO PUBLICIDAD significa baja/)).toBeVisible();
  await page.getByRole('button', { name: /Siguiente/ }).click();
  // 4 · vista previa con problemas
  await expect(page.getByText('Vista previa del resultado')).toBeVisible();
  await expect(page.getByText('Duplicado del teléfono de la fila 4 (unido)')).toBeVisible();
  await expect(page.getByText('Teléfono no válido (se descarta la fila)')).toBeVisible();
  await expect(page.getByText('Fila vacía (se ignora)')).toBeVisible();
  await page.getByRole('button', { name: 'Importar 6 contactos' }).click();
  // 5 · informe
  await expect(page.getByRole('main').getByText('Importación terminada')).toBeVisible({ timeout: 20_000 });
  const stat = (k: string) => page.locator('.stat', { hasText: k }).locator('.v');
  await expect(stat('Creados')).toHaveText('6');
  await expect(stat('Omitidos')).toHaveText('3');
  await expect(stat('Dados de baja')).toHaveText('1');
  await expect(page.getByText(/Informe \(3 incidencias\)/)).toBeVisible();
  // el informe descargable existe y es un CSV
  const href = await page.getByRole('link', { name: 'Descargar informe' }).getAttribute('href');
  const rep = await admin.get(href!);
  expect(rep.ok()).toBe(true);
  expect(await rep.text()).toMatch(/Teléfono no válido/);
  // los contactos están: el que tenía NO PUBLICIDAD, de baja, y el extranjero conservado
  const contacts = await json(await admin.get('/api/contacts', { params: { q: csv.phones.jubilado.slice(3) } }));
  const j = (contacts.items ?? contacts.data)[0];
  expect(j.consentStatus).toBe('REVOKED');
  expect(j.labels.map((l: any) => l.name)).toEqual(['JUBILADO']);
  const marta = (await json(await admin.get('/api/contacts', { params: { q: csv.phones.marta.slice(3) } }))).items[0];
  expect(marta.firstName).toBe('Marta'); // sin el emoji
  expect(marta.taxId).toBe('B12345678');
  // «Ver contactos»
  await page.getByRole('link', { name: 'Ver contactos' }).click();
  await expect(page).toHaveURL(/\/contactos/);
  await expect(page.getByText('Rosa Vidal').first()).toBeVisible();
});

// ───────── (f) crear plantilla ─────────
const STAMP = String(Date.now()).slice(-6);
const TPL_NAME = `Novedades de otoño QA ${STAMP}`;
let tplMetaName = '';

test('(f) crear una plantilla de marketing: botón «No recibir más» obligatorio, enviar a revisión y aprobación', async ({ page }) => {
  await login(page, ADMIN, '/plantillas');
  await page.getByRole('button', { name: /Nueva plantilla/ }).click();
  await page.getByLabel('Nombre de la plantilla').fill(TPL_NAME);
  // el nombre en Meta se genera solo, en minúsculas y con guion bajo
  tplMetaName = await page.getByLabel('Nombre en Meta').inputValue();
  expect(tplMetaName).toMatch(/^novedades_de_oto.*_qa_\d{6}$/);
  await page.getByLabel('Categoría').selectOption('MARKETING');
  await page.getByLabel('Mensaje').fill('Hola {{1}}, ya tenemos las novedades de otoño en Exclusivas Gelado. Pídenos tu catálogo.');
  await page.getByLabel('Ejemplo de la variable 1').fill('Ginés');
  await page.getByLabel('Pie de página (opcional)').fill('Exclusivas Gelado');
  // vista previa tipo WhatsApp y botón de baja bloqueado
  await expect(page.getByText('Vista previa').first()).toBeVisible();
  await expect(page.getByText(/No recibir más/).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/f-editor.png' });
  await page.getByRole('button', { name: 'Enviar a revisión de Meta' }).click();
  await expect(page).toHaveURL(/\/plantillas$/);
  const row = page.getByRole('row', { name: new RegExp(TPL_NAME) });
  await expect(row).toBeVisible();
  await expect(row).toContainText(/En revisión/i);
  // Meta la aprueba (webhook del simulador) y la lista se actualiza
  const t = (await json<any[]>(await admin.get('/api/templates'))).find((x) => x.name === tplMetaName);
  expect(t.hasOptOutButton).toBe(true);
  expect(t.status).toBe('PENDING');
  await simPost('/_sim/template-status', { event: 'APPROVED', templateId: t.metaTemplateId, name: t.name });
  await expect(row).toContainText(/Aprobada/i, { timeout: 10_000 });
});

test('(f) una plantilla de marketing ya sincronizada SIN botón de baja no se puede usar en campañas', async ({ page }) => {
  // plantilla antigua (como las 12 de Superchat) aprobada en Meta, sin botón de baja
  const name = `buenos_dias_${STAMP}`;
  await fetch(`http://127.0.0.1:${process.env.E2E_SIM_PORT || '4110'}/v21.0/24936790469294569/message_templates`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer x' },
    body: JSON.stringify({ name, language: 'es', category: 'MARKETING', status: 'APPROVED', components: [{ type: 'BODY', text: 'Buenos días, ¿necesitas algo de Exclusivas Gelado?' }] }),
  });
  await admin.post('/api/templates/sync');
  await login(page, ADMIN, '/plantillas');
  const row = page.getByRole('row', { name: new RegExp(name.replace(/_/g, '.')) });
  await expect(row).toContainText(/Sin botón de baja/i);
  await expect(row.getByRole('button', { name: /Duplicar con botón de baja/ })).toBeVisible();
  // en el asistente de campañas aparece deshabilitada
  await page.goto('/campanas/nueva');
  const opt = page.locator('#cmp-tpl option', { hasText: new RegExp(name.replace(/_/g, '.')) });
  await expect(opt).toBeDisabled();
});

// ───────── (g) campaña de prueba e informe ─────────
test('(g) campaña: etiqueta, recuento con baja excluida, prueba, lanzar y ver el informe', async ({ page }) => {
  test.setTimeout(180_000);
  const labelName = `QA CAMPAÑA ${STAMP}`;
  const label = await json(await admin.post('/api/labels', { data: { name: labelName, color: '#2457C5', scope: 'CONTACT' } }));
  const people = [] as Array<{ id: string; wa: string; e164: string; name: string }>;
  for (const [i, n] of ['Alba', 'Berta', 'Carla', 'Dani'].entries()) {
    const p = phone();
    const c = await json(await admin.post('/api/contacts', { data: { phone: p.e164, firstName: `${n}${STAMP}`, labelIds: [label.id] } }));
    people.push({ id: c.id, wa: p.wa, e164: p.e164, name: `${n}${STAMP}` });
    if (i === 3) await json(await admin.post(`/api/contacts/${c.id}/consent`, { data: { status: 'REVOKED', source: 'MANUAL', note: 'Pidió la baja por teléfono' } }));
  }
  await simPost('/_sim/reset');
  await login(page, ADMIN, '/campanas');
  await page.getByRole('button', { name: /Nueva campaña/ }).click();
  await page.getByLabel(/Nombre de la campaña/).fill(`Novedades otoño ${STAMP}`);
  await page.locator('#cmp-tpl').selectOption({ label: `${TPL_NAME} · Marketing` });
  // variable {{1}} = Nombre del contacto (por defecto)
  await page.getByLabel('Añadir etiqueta').first().selectOption({ label: labelName });
  await expect(page.getByText('3 recibirán el mensaje')).toBeVisible();
  await expect(page.getByText(/1.*dados de baja \(no reciben nunca\)/)).toBeVisible();
  await expect(page.getByText(/Coste estimado|0,18/).first()).toBeVisible();
  // envío de prueba a un número
  await page.getByRole('button', { name: 'Enviar mensaje de prueba' }).click();
  const testPhone = phone();
  await page.getByLabel('Número de teléfono').fill(testPhone.e164);
  await page.getByRole('dialog', { name: 'Enviar mensaje de prueba' }).getByRole('button', { name: /Enviar/ }).click();
  await expect.poll(async () => (await simGet('/_sim/sent')).filter((s: any) => s.body?.type === 'template').length, { timeout: 15_000 }).toBe(1);
  expect((await simGet('/_sim/sent'))[0].body.to).toBe(testPhone.wa);
  await page.screenshot({ path: 'test-results/g-wizard.png' });
  await page.keyboard.press('Escape');
  // lanzar
  await page.getByRole('button', { name: 'Lanzar campaña' }).click();
  await expect(page.getByRole('dialog', { name: 'Lanzar campaña' })).toContainText('Se enviará ahora mismo a 3 contactos');
  await page.getByRole('button', { name: 'Lanzar ahora' }).click();
  await expect(page).toHaveURL(/\/campanas\/[0-9a-f-]{36}/, { timeout: 15_000 });
  // los 3 mensajes salen (escalonados) y NUNCA el dado de baja
  await expect.poll(async () => (await simGet('/_sim/sent')).filter((s: any) => s.body?.type === 'template').length, { timeout: 120_000, intervals: [2000] }).toBe(4);
  const sent = (await simGet('/_sim/sent')).filter((s: any) => s.body?.type === 'template');
  expect(sent.map((s: any) => s.body.to)).not.toContain(people[3]!.wa);
  expect(sent.map((s: any) => s.body.to).sort()).toEqual([testPhone.wa, people[0]!.wa, people[1]!.wa, people[2]!.wa].sort());
  // el último de cada envío trae el botón de baja con payload OPT_OUT
  const campSends = sent.filter((s: any) => s.body.to !== testPhone.wa);
  for (const s of campSends) expect(JSON.stringify(s.body.template.components)).toContain('OPT_OUT');
  // estados: Alba leído, Berta entregado, Carla fallido (tope de marketing 131049)
  const [alba, berta, carla] = people;
  const idOf = (wa: string) => campSends.find((s: any) => s.body.to === wa).id;
  await simPost('/_sim/status', { wamid: idOf(alba!.wa), status: 'delivered', recipient: alba!.wa, pricing: { billable: true, pricing_model: 'PMP', category: 'marketing' } });
  await simPost('/_sim/status', { wamid: idOf(alba!.wa), status: 'read', recipient: alba!.wa });
  await simPost('/_sim/status', { wamid: idOf(berta!.wa), status: 'delivered', recipient: berta!.wa, pricing: { billable: true, pricing_model: 'PMP', category: 'marketing' } });
  await simPost('/_sim/status', { wamid: idOf(carla!.wa), status: 'failed', recipient: carla!.wa, errorCode: 131049 });
  // Alba responde y Berta pulsa «No recibir más»
  await inboundTextFrom(alba!.wa, 'Me interesa el catálogo, gracias');
  await simPost('/_sim/inbound', { from: berta!.wa, type: 'button', button: { text: 'No recibir más', payload: 'OPT_OUT' } });
  // informe: embudo y lista de destinatarios
  await expect(page.getByText('Enviados').first()).toBeVisible();
  const campId = page.url().split('/').pop()!;
  await expect.poll(async () => {
    const c = (await json(await admin.get(`/api/campaigns/${campId}`))).campaign;
    return [c.sentCount, c.deliveredCount, c.readCount, c.repliedCount, c.failedCount, c.skippedCount, c.optOutCount].join(',');
  }, { timeout: 15_000 }).toBe('3,2,1,1,1,1,1');
  await page.reload();
  await page.screenshot({ path: 'test-results/g-report.png', fullPage: true });
  const body = page.getByRole('main');
  await expect(body).toContainText('Entregado');
  await expect(body).toContainText('Leído');
  await expect(body).toContainText('Respondido');
  await expect(body).toContainText('Fallido');
  await expect(body).toContainText(/131049|no entrega|protege|tope/i);
  await expect(body).toContainText(`Alba${STAMP}`);
  // pestañas de destinatarios y exportación
  await page.getByRole('tab', { name: /Fallido/ }).click();
  await expect(body).toContainText(`Carla${STAMP}`);
  await expect(body).not.toContainText(`Alba${STAMP}`);
  const id = page.url().split('/').pop()!;
  const csv = await admin.get(`/api/campaigns/${id}/export`);
  expect(csv.ok()).toBe(true);
  // la baja generada por la campaña quedó registrada
  const berta2 = await json(await admin.get(`/api/contacts/${berta!.id}`));
  expect(berta2.consentStatus).toBe('REVOKED');
  // y el cliente que respondió tiene su conversación marcada con la campaña
  const convs = await json(await admin.get('/api/conversations', { params: { q: alba!.wa } }));
  expect(convs.items[0].lastCampaignName).toContain('Novedades otoño');
});

async function inboundTextFrom(wa: string, body: string) {
  await simPost('/_sim/inbound', { from: wa, name: 'Alba', type: 'text', text: { body } });
}

// ───────── (h) permisos de agente en la interfaz ─────────
test('(h) un agente no ve Ajustes, no puede entrar por URL ni lanzar campañas', async ({ page }) => {
  await login(page, CRISTINA);
  const nav = page.getByRole('navigation', { name: 'Menú principal' });
  await expect(nav.getByRole('link', { name: 'Ajustes' })).toHaveCount(0);
  await page.goto('/ajustes');
  await expect(page).toHaveURL(/\/bandeja/); // redirige
  // campañas: puede preparar borradores pero no lanzar ni crear plantillas
  await page.goto('/campanas');
  await expect(page.getByRole('button', { name: /Nueva campaña/ })).toBeVisible();
  await page.goto('/plantillas');
  await expect(page.getByRole('button', { name: /Nueva plantilla/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Sincronizar/ })).toHaveCount(0);
  await page.goto('/contactos');
  await expect(page.getByRole('button', { name: /Exportar/ })).toHaveCount(0);
  await page.goto('/campanas/nueva');
  await expect(page.getByRole('button', { name: /Lanzar campaña|Programar campaña/ })).toHaveCount(0);
  await expect(page.getByText(/solo una administradora puede lanzarlo/)).toBeVisible();
  // y por la API directa también
  const ag = await api(CRISTINA);
  expect((await ag.get('/api/settings/whatsapp')).status()).toBe(403);
  expect((await ag.get('/api/contacts/export')).status()).toBe(403);
  expect((await ag.post('/api/campaigns/00000000-0000-4000-8000-000000000000/launch', { data: {} })).status()).toBe(403);
  await ag.dispose();
});
