/**
 * «Guardar borrador» en el editor de plantillas: la administradora guarda un borrador incompleto (sin llamar a Meta),
 * lo reabre desde el listado, lo completa, lo guarda de nuevo (mismo registro) y lo envía a revisión.
 * Un agente no ve los borradores. Todo contra el simulador de Meta.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { ADMIN, CRISTINA, api, json, login, simPost } from '../helpers';

test.describe.configure({ mode: 'serial' });
let admin: APIRequestContext;
let agent: APIRequestContext;
test.beforeAll(async () => {
  admin = await api(ADMIN);
  agent = await api(CRISTINA);
});
test.afterAll(async () => {
  await admin?.dispose();
  await agent?.dispose();
});

const STAMP = String(Date.now()).slice(-6);
const TITLE = `Borrador otoño QA ${STAMP}`;
let metaName = '';
let draftId = '';

/**
 * Pulsa «Guardar borrador» y espera la respuesta del servidor a ESE guardado (POST la primera vez, PUT después):
 * los avisos de guardados anteriores pueden seguir en pantalla (móvil), así que el aviso solo no demuestra nada.
 */
async function saveDraft(page: Page, method: 'POST' | 'PUT') {
  const done = page.waitForResponse((r) => r.request().method() === method && /\/api\/templates\/(draft|[0-9a-f-]{36}\/draft)$/.test(new URL(r.url()).pathname));
  await page.getByRole('button', { name: 'Guardar borrador' }).click();
  expect((await done).ok()).toBe(true);
  await expect(page.getByText(/Borrador «.*» guardado/).last()).toBeVisible();
}

const findByName = async (ctx: APIRequestContext, name: string) => (await json<any[]>(await ctx.get('/api/templates'))).find((x) => x.name === name);

test('guardar un borrador incompleto, reabrirlo, editarlo y enviarlo a revisión', async ({ page }) => {
  await login(page, ADMIN, '/plantillas');
  await page.getByRole('button', { name: /Nueva plantilla/ }).click();

  // el botón «Guardar borrador» está junto a «Enviar a revisión de Meta»
  await expect(page.getByRole('button', { name: 'Enviar a revisión de Meta' })).toBeVisible();
  await page.getByLabel('Nombre de la plantilla').fill(TITLE);
  metaName = await page.getByLabel('Nombre en Meta').inputValue();
  expect(metaName).toMatch(/^borrador_oto.*_qa_\d{6}$/);
  // contenido incompleto a propósito: variable sin ejemplo (enviar fallaría, guardar no)
  await page.getByLabel('Mensaje').fill('Hola {{1}}, ya tenemos las novedades de otoño');
  await saveDraft(page, 'POST');

  // en la BD es un LOCAL_DRAFT y no ha ido a Meta
  const saved = await findByName(admin, metaName);
  expect(saved).toMatchObject({ status: 'LOCAL_DRAFT', metaTemplateId: null, displayName: TITLE });
  draftId = saved.id;

  // listado: sale con el estado «Borrador»
  await page.getByRole('button', { name: 'Volver al listado' }).click();
  await expect(page).toHaveURL(/\/plantillas$/);
  const row = page.getByRole('row', { name: new RegExp(TITLE) });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Borrador');

  // reabrir desde el listado: el editor trae el contenido guardado
  await row.getByRole('button', { name: /Editar borrador/ }).click();
  await expect(page).toHaveURL(new RegExp(`/plantillas/borrador/${draftId}$`));
  await expect(page.getByLabel('Nombre de la plantilla')).toHaveValue(TITLE);
  await expect(page.getByLabel('Nombre en Meta')).toHaveValue(metaName);
  await expect(page.getByLabel('Mensaje')).toHaveValue('Hola {{1}}, ya tenemos las novedades de otoño');

  // enviar así, incompleto, se rechaza con el motivo y sigue siendo borrador
  await page.getByRole('button', { name: 'Enviar a revisión de Meta' }).click();
  await expect(page.getByRole('alert')).toContainText(/Falta el ejemplo de la variable/);
  expect((await findByName(admin, metaName)).status).toBe('LOCAL_DRAFT');

  // completar, editar y guardar de nuevo: mismo registro
  await page.getByLabel('Ejemplo de la variable 1').fill('Ginés');
  await page.getByLabel('Pie de página (opcional)').fill('Exclusivas Gelado');
  await saveDraft(page, 'PUT');
  const again = (await json<any[]>(await admin.get('/api/templates'))).filter((x) => x.name === metaName);
  expect(again).toHaveLength(1);
  expect(again[0]).toMatchObject({ id: draftId, status: 'LOCAL_DRAFT' });
  expect(again[0].draft).toMatchObject({ footer: 'Exclusivas Gelado', bodyExamples: ['Ginés'] });

  // un agente no ve el borrador (ni en el listado ni en el detalle)
  expect(await findByName(agent, metaName)).toBeUndefined();
  expect((await agent.get(`/api/templates/${draftId}`)).status()).toBe(404);

  // enviar a revisión desde el borrador: el mismo registro pasa a PENDING y el botón de baja se impone
  await page.getByRole('button', { name: 'Enviar a revisión de Meta' }).click();
  await expect(page).toHaveURL(/\/plantillas$/);
  const sentRow = page.getByRole('row', { name: new RegExp(TITLE) });
  await expect(sentRow).toContainText(/En revisión/i);
  const pending = await findByName(admin, metaName);
  expect(pending).toMatchObject({ id: draftId, status: 'PENDING', hasOptOutButton: true });
  expect(pending.metaTemplateId).toBeTruthy();
  expect(pending.draft ?? null).toBeNull();
  // el simulador la tiene de verdad: una sincronización no la da por borrada
  await json(await admin.post('/api/templates/sync'));
  expect((await findByName(admin, metaName)).status).toBe('PENDING');

  // Meta la aprueba y la lista se actualiza; ya no se puede editar como borrador
  await simPost('/_sim/template-status', { event: 'APPROVED', templateId: pending.metaTemplateId, name: metaName });
  await expect(sentRow).toContainText(/Aprobada/i, { timeout: 10_000 });
  expect((await admin.put(`/api/templates/${draftId}/draft`, { data: { name: metaName, language: 'es' } })).status()).toBe(409);
});

test('un borrador se puede borrar (solo local) y su nombre queda libre', async ({ page }) => {
  await login(page, ADMIN, '/plantillas');
  await page.getByRole('button', { name: /Nueva plantilla/ }).click();
  const title = `Borrador a borrar QA ${STAMP}`;
  await page.getByLabel('Nombre de la plantilla').fill(title);
  await saveDraft(page, 'POST');
  await page.getByRole('button', { name: 'Volver al listado' }).click();
  const row = page.getByRole('row', { name: new RegExp(title) });
  await expect(row).toBeVisible();
  const created = await findByName(admin, title.toLowerCase().replace(/ /g, '_'));
  expect(created).toMatchObject({ status: 'LOCAL_DRAFT' });
  await row.getByRole('button', { name: /^Borrar/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Borrar', exact: true }).click();
  await expect(row).toHaveCount(0);
  // se comprueba por id, no por nombre: el registro tiene que haber desaparecido de verdad (404), no solo del listado
  expect((await admin.get(`/api/templates/${created.id}`)).status()).toBe(404);
});
