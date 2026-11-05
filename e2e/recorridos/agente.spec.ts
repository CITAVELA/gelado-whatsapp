/**
 * Recorrido manual 1 (docs/08): AGENTE. Recibir, responder con texto, PDF de la biblioteca, nota de voz,
 * plantilla con la ventana cerrada, asignar, etiquetar, posponer y finalizar. Capturas 1440×900 numeradas.
 */
import { expect, test } from '@playwright/test';
import { ADMIN, CRISTINA, api, ensureApprovedTemplate, ensureLibraryPdf, inboundText, json, login, phone, simGet, simPost } from '../helpers';
import { capturas } from '../helpers-capturas';

test('recorrido de agente (Cristina Lopez)', async ({ page }) => {
  const shot = capturas('agente');
  const admin = await api(ADMIN);
  await ensureLibraryPdf(admin);
  await ensureApprovedTemplate(admin, { name: 'aviso_pedido', displayName: 'Aviso de pedido', category: 'UTILITY' });
  await simPost('/_sim/reset');
  const cliente = phone();
  const nombre = 'Ginés Pérez';

  // 1 · entrada
  await page.goto('/login');
  await shot(page, 'login');
  await login(page, CRISTINA);
  await shot(page, 'bandeja-al-entrar');

  // 2 · recibir un mensaje (sin recargar)
  await inboundText(cliente.wa, 'Hola, ¿tenéis tinte DOUSSE del 7.1? Necesito 6 unidades para el viernes.', nombre);
  const card = page.getByRole('list', { name: 'Lista de conversaciones' }).getByRole('link', { name: new RegExp(nombre) });
  await expect(card).toBeVisible({ timeout: 5000 });
  await shot(page, 'mensaje-entrante-en-la-lista');
  await card.click();
  await expect(page.getByText('Ventana abierta: quedan')).toBeVisible();
  await shot(page, 'conversacion-abierta-ventana-24h');

  // 3 · responder con texto
  const box = page.getByLabel('Escribe un mensaje');
  await box.fill('¡Hola Ginés! Sí, tenemos el 7.1 en stock. Te lo mandamos con el transporte del jueves.');
  await shot(page, 'escribiendo-respuesta');
  await box.press('Enter');
  const chat = page.getByRole('main', { name: /^Conversación con/ });
  await expect(chat.getByText('Te lo mandamos con el transporte del jueves.')).toHaveCount(1);
  const sentText = await expect.poll(async () => (await simGet('/_sim/sent')).find((s: any) => s.body?.type === 'text')).toBeTruthy();
  const out = (await simGet('/_sim/sent')).find((s: any) => s.body?.type === 'text');
  await simPost('/_sim/status', { wamid: out.id, status: 'delivered', recipient: cliente.wa });
  await simPost('/_sim/status', { wamid: out.id, status: 'read', recipient: cliente.wa });
  await expect(page.getByLabel(/leído/i).first()).toBeVisible({ timeout: 8000 });
  await shot(page, 'respuesta-enviada-y-leida');

  // 4 · PDF de la biblioteca
  await page.getByRole('button', { name: 'Adjuntar archivo' }).click();
  const modal = page.getByRole('dialog', { name: 'Adjuntar archivos' });
  await expect(modal).toBeVisible();
  await shot(page, 'adjuntar-biblioteca');
  await modal.getByRole('cell', { name: 'Catálogos' }).click();
  await modal.getByRole('row', { name: /Catálogo DOUSSE 2026/ }).click();
  await modal.getByLabel(/Texto que acompaña/).fill('Aquí tienes el catálogo actualizado');
  await shot(page, 'adjuntar-pdf-seleccionado');
  await modal.getByRole('button', { name: 'Enviar 1 archivo' }).click();
  await expect(modal).toBeHidden({ timeout: 15_000 });
  await expect.poll(async () => (await simGet('/_sim/sent')).some((s: any) => s.body?.type === 'document')).toBe(true);
  await shot(page, 'pdf-enviado');

  // 5 · nota de voz (micrófono simulado del navegador)
  await page.getByRole('button', { name: 'Grabar nota de voz' }).click();
  await expect(page.getByText('Grabando')).toBeVisible();
  await page.waitForTimeout(2200);
  await shot(page, 'nota-de-voz-grabando');
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect.poll(async () => (await simGet('/_sim/sent')).some((s: any) => s.body?.type === 'audio'), { timeout: 20_000 }).toBe(true);
  const audio = (await simGet('/_sim/sent')).find((s: any) => s.body?.type === 'audio');
  expect(audio.body.to).toBe(cliente.wa);
  await expect(chat.getByRole('button', { name: /Reproducir/ })).toBeVisible({ timeout: 10_000 });
  await shot(page, 'nota-de-voz-enviada');

  // 6 · asignar, etiquetar, posponer
  await page.getByRole('button', { name: 'Asignar', exact: true }).first().click();
  await shot(page, 'menu-asignar');
  await page.getByRole('menuitem', { name: /Lolo Gelado/ }).click();
  await page.getByRole('button', { name: 'Etiquetar' }).click();
  await shot(page, 'menu-etiquetar');
  await page.getByRole('menuitem', { name: /PEDIDO/i }).click();
  await page.keyboard.press('Escape');
  await shot(page, 'asignada-y-etiquetada');
  await page.getByRole('button', { name: 'Posponer' }).click();
  await shot(page, 'menu-posponer');
  await page.getByRole('menuitem', { name: /Mañana/ }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole('tab', { name: 'Pospuestas' }).click();
  await expect(card).toBeVisible();
  await shot(page, 'pestana-pospuestas');

  // 7 · finalizar
  await card.click();
  await page.getByRole('button', { name: 'Marcar como finalizada' }).click();
  await page.getByRole('tab', { name: 'Finalizadas' }).click();
  await expect(card).toBeVisible();
  await card.click();
  await shot(page, 'conversacion-finalizada-con-historial');

  // 8 · el cliente vuelve a escribir → se reabre sola
  await inboundText(cliente.wa, 'Perfecto, muchas gracias. Una cosa más: ¿hacéis envíos en sábado?', nombre);
  await page.getByRole('tab', { name: 'Abiertos' }).click();
  await expect(card).toBeVisible({ timeout: 5000 });
  await shot(page, 'reabierta-al-escribir-el-cliente');

  // 9 · ventana cerrada: solo plantilla
  const nuevo = phone();
  const conv = await json(await admin.post('/api/conversations', { data: { phone: nuevo.e164 } }));
  await page.goto(`/bandeja/c/${conv.id}`);
  await expect(page.getByText('Ventana cerrada: solo plantillas')).toBeVisible();
  await shot(page, 'ventana-cerrada-solo-plantilla');
  await page.getByRole('button', { name: 'Enviar plantilla' }).click();
  const tm = page.getByRole('dialog', { name: /Enviar plantilla de WhatsApp/ });
  await tm.getByRole('button', { name: /Aviso de pedido/ }).click();
  await tm.getByPlaceholder(/Ej\.:/).fill('Marta');
  await shot(page, 'modal-plantilla-con-vista-previa');
  await tm.getByRole('button', { name: 'Enviar plantilla' }).click();
  await expect(tm).toBeHidden({ timeout: 10_000 });
  await expect(chat.getByText(/tu pedido está en camino/)).toBeVisible();
  await shot(page, 'plantilla-enviada');
  await admin.dispose();
});
