/**
 * Recorrido manual 2 (docs/08): ADMINISTRADORA. Importar contactos, crear plantilla, campaña de prueba e informe.
 * Capturas 1440×900 numeradas. Los datos son sintéticos y los envíos van al simulador de Meta.
 */
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ADMIN, api, inboundText, json, login, phone, simGet, simPost } from '../helpers';
import { capturas } from '../helpers-capturas';

const STAMP = String(Date.now()).slice(-6);

function csv() {
  const n = () => phone().wa.slice(2);
  const [a, b, c, d, e, f] = [n(), n(), n(), n(), n(), n()];
  const sp = (x: string) => `${x.slice(0, 3)} ${x.slice(3, 5)} ${x.slice(5, 7)} ${x.slice(7)}`;
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
  const file = path.join(os.tmpdir(), `contactos-superchat-${a}.csv`);
  fs.writeFileSync(file, rows.join('\n'), 'utf8');
  return file;
}

test('recorrido de administradora (María Iborra)', async ({ page }) => {
  const shot = capturas('admin');
  const admin = await api(ADMIN);
  await simPost('/_sim/reset');

  // 1 · contactos (vacío) e importación
  await login(page, ADMIN, '/contactos');
  await shot(page, 'contactos-antes-de-importar');
  await page.getByRole('link', { name: /Importar/ }).click();
  await shot(page, 'importar-1-subir-archivo');
  await page.getByLabel('Archivo a importar').setInputFiles(csv());
  await expect(page.getByText(/9 filas/)).toBeVisible();
  await shot(page, 'importar-2-columnas');
  await page.getByRole('button', { name: /Siguiente: reglas/ }).click();
  await expect(page.getByText(/La etiqueta NO PUBLICIDAD significa baja/)).toBeVisible();
  await shot(page, 'importar-3-reglas');
  await page.getByRole('button', { name: /Siguiente/ }).click();
  await expect(page.getByText('Vista previa del resultado')).toBeVisible();
  await shot(page, 'importar-4-vista-previa-con-problemas');
  await page.getByRole('button', { name: /^Importar \d+ contactos$/ }).click();
  await expect(page.getByRole('main').getByText('Importación terminada')).toBeVisible({ timeout: 20_000 });
  await shot(page, 'importar-5-informe');
  await page.getByRole('link', { name: 'Ver contactos' }).click();
  await expect(page.getByText('Rosa Vidal').first()).toBeVisible();
  await shot(page, 'contactos-despues-de-importar');
  // ficha de la persona dada de baja (NO PUBLICIDAD → baja)
  await page.getByText('Jubilado Antiguo').first().click();
  await shot(page, 'ficha-contacto-dado-de-baja');

  // 2 · plantilla: crear, enviar a revisión, aprobada
  await page.goto('/plantillas');
  await shot(page, 'plantillas-listado');
  await page.getByRole('button', { name: /Nueva plantilla/ }).click();
  await shot(page, 'plantilla-editor-vacio');
  const nombre = `Novedades de otoño ${STAMP}`;
  await page.getByLabel('Nombre de la plantilla').fill(nombre);
  await page.getByLabel('Categoría').selectOption('MARKETING');
  await page.getByLabel('Mensaje').fill('Hola {{1}}, ya tenemos las novedades de otoño en Exclusivas Gelado. Pídenos tu catálogo.');
  await page.getByLabel('Ejemplo de la variable 1').fill('Ginés');
  await page.getByLabel('Pie de página (opcional)').fill('Exclusivas Gelado');
  await shot(page, 'plantilla-editor-con-vista-previa-y-boton-de-baja');
  await page.getByRole('button', { name: 'Enviar a revisión de Meta' }).click();
  await expect(page).toHaveURL(/\/plantillas$/);
  const row = page.getByRole('row', { name: new RegExp(nombre) });
  await expect(row).toContainText(/En revisión/i);
  await shot(page, 'plantilla-en-revision');
  const t = (await json<any[]>(await admin.get('/api/templates'))).find((x) => x.displayName === nombre);
  await simPost('/_sim/template-status', { event: 'APPROVED', templateId: t.metaTemplateId, name: t.name });
  await expect(row).toContainText(/Aprobada/i, { timeout: 10_000 });
  await shot(page, 'plantilla-aprobada');

  // 3 · campaña de prueba
  const etiqueta = `CAMPAÑA ${STAMP}`;
  const label = await json(await admin.post('/api/labels', { data: { name: etiqueta, color: '#2457C5', scope: 'CONTACT' } }));
  const personas: Array<{ id: string; wa: string; nombre: string }> = [];
  for (const [i, n] of ['Alba', 'Berta', 'Carla', 'Dani'].entries()) {
    const p = phone();
    const c = await json(await admin.post('/api/contacts', { data: { phone: p.e164, firstName: n, lastName: 'Demo', labelIds: [label.id] } }));
    personas.push({ id: c.id, wa: p.wa, nombre: n });
    if (i === 3) await json(await admin.post(`/api/contacts/${c.id}/consent`, { data: { status: 'REVOKED', source: 'MANUAL', note: 'Pidió la baja por teléfono' } }));
  }
  await page.goto('/campanas');
  await shot(page, 'campanas-listado-vacio');
  await page.getByRole('button', { name: /Nueva campaña/ }).click();
  await page.getByLabel(/Nombre de la campaña/).fill(`Novedades de otoño · ${etiqueta}`);
  await page.locator('#cmp-tpl').selectOption({ label: `${nombre} · Marketing` });
  await page.getByLabel('Añadir etiqueta').first().selectOption({ label: etiqueta });
  await expect(page.getByText('3 recibirán el mensaje')).toBeVisible();
  await shot(page, 'campana-asistente-recuento-con-baja-excluida');
  await page.getByRole('button', { name: 'Enviar mensaje de prueba' }).click();
  const prueba = phone();
  await page.getByLabel('Número de teléfono').fill(prueba.e164);
  await shot(page, 'campana-enviar-prueba');
  await page.getByRole('dialog', { name: 'Enviar mensaje de prueba' }).getByRole('button', { name: /Enviar/ }).click();
  await expect.poll(async () => (await simGet('/_sim/sent')).filter((s: any) => s.body?.type === 'template').length, { timeout: 15_000 }).toBe(1);
  await shot(page, 'campana-prueba-enviada');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Lanzar campaña' }).click();
  await shot(page, 'campana-confirmar-lanzamiento');
  await page.getByRole('button', { name: 'Lanzar ahora' }).click();
  await expect(page).toHaveURL(/\/campanas\/[0-9a-f-]{36}/, { timeout: 15_000 });
  await shot(page, 'campana-informe-al-lanzar');
  await expect.poll(async () => (await simGet('/_sim/sent')).filter((s: any) => s.body?.type === 'template').length, { timeout: 120_000, intervals: [2000] }).toBe(4);

  // 4 · resultados: entregado, leído, respondido, fallido y baja
  const enviados = (await simGet('/_sim/sent')).filter((s: any) => s.body?.type === 'template' && s.body.to !== prueba.wa);
  const idDe = (wa: string) => enviados.find((s: any) => s.body.to === wa).id;
  const [alba, berta, carla] = personas;
  const precio = { billable: true, pricing_model: 'PMP', category: 'marketing' };
  await simPost('/_sim/status', { wamid: idDe(alba!.wa), status: 'delivered', recipient: alba!.wa, pricing: precio });
  await simPost('/_sim/status', { wamid: idDe(alba!.wa), status: 'read', recipient: alba!.wa, pricing: precio });
  await simPost('/_sim/status', { wamid: idDe(berta!.wa), status: 'delivered', recipient: berta!.wa, pricing: precio });
  await simPost('/_sim/status', { wamid: idDe(carla!.wa), status: 'failed', recipient: carla!.wa, errorCode: 131049 });
  await inboundText(alba!.wa, 'Me interesa el catálogo, gracias', 'Alba Demo');
  await simPost('/_sim/inbound', { from: berta!.wa, name: 'Berta Demo', type: 'button', button: { text: 'No recibir más', payload: 'OPT_OUT' } });
  const campId = page.url().split('/').pop()!;
  await expect.poll(async () => {
    const c = (await json(await admin.get(`/api/campaigns/${campId}`))).campaign;
    return [c.sentCount, c.deliveredCount, c.readCount, c.repliedCount, c.failedCount, c.skippedCount, c.optOutCount].join(',');
  }, { timeout: 15_000 }).toBe('3,2,1,1,1,1,1');
  await page.reload();
  await expect(page.getByRole('main')).toContainText('Completada');
  await shot(page, 'campana-informe-embudo-y-motivos');
  await page.getByRole('main').evaluate((m) => m.querySelector('.panel:last-of-type')?.scrollIntoView());
  await page.mouse.wheel(0, 900);
  await shot(page, 'campana-informe-destinatarios');
  await page.getByRole('tab', { name: /Fallido/ }).click();
  await shot(page, 'campana-informe-pestana-fallidos');
  await page.goto('/campanas');
  await shot(page, 'campanas-listado-con-resultado');

  // 5 · calidad y costes, ajustes y privacidad
  await page.goto('/calidad');
  await shot(page, 'calidad-y-costes');
  await page.goto('/ajustes');
  await shot(page, 'ajustes-equipo');
  for (const seccion of ['Horario', 'WhatsApp', 'Privacidad', 'Registro']) {
    const link = page.getByRole('link', { name: new RegExp(seccion) }).or(page.getByRole('tab', { name: new RegExp(seccion) })).or(page.getByRole('button', { name: new RegExp(seccion) })).first();
    if (await link.count()) {
      await link.click();
      if (seccion === 'Privacidad') await expect(page.locator('.pv, .preview, [aria-label*="Vista previa"]').first().or(page.getByText('Vista previa').first())).toBeVisible();
      await page.waitForTimeout(1200);
      await shot(page, `ajustes-${seccion.toLowerCase()}`);
    }
  }
  await admin.dispose();
});
