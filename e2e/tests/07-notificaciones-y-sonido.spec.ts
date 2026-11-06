/**
 * Notificaciones y sonido en Safari/WebKit, Firefox y móvil (RF-2.20):
 *  · el permiso se pide solo con un clic, nunca al cargar;
 *  · en iOS Safari normal no existe `Notification`: mensaje claro en vez de un botón muerto;
 *  · el AudioContext se desbloquea con el primer gesto (en WebKit nace «suspended») y el aviso suena.
 */
import { expect, test } from '@playwright/test';
import { CRISTINA, NO_AUDIO_DEVICE, inboundText, login, phone } from '../helpers';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.__permRequests = 0;
    w.__contexts = [] as any[];
    w.__beeps = 0;
    const Ctx = window.AudioContext ?? w.webkitAudioContext;
    if (Ctx) {
      const orig = Ctx.prototype.createOscillator;
      Ctx.prototype.createOscillator = function (...a: any[]) { w.__beeps++; return orig.apply(this, a); };
      const Wrapped = class extends Ctx { constructor(...a: any[]) { super(...a); w.__contexts.push(this); } };
      if (window.AudioContext) w.AudioContext = Wrapped; else w.webkitAudioContext = Wrapped;
    }
    if (typeof w.Notification === 'function') {
      Object.defineProperty(w.Notification, 'permission', { get: () => w.__perm ?? 'default', configurable: true });
      w.Notification.requestPermission = (cb?: (p: string) => void) => { w.__permRequests++; w.__perm = 'granted'; cb?.('granted'); return Promise.resolve('granted'); };
    }
  });
});

test('el permiso de notificaciones solo se pide con un clic; sin API (iOS) hay un mensaje claro', async ({ page }) => {
  await login(page, CRISTINA);
  const hasApi = await page.evaluate(() => typeof (window as any).Notification === 'function');
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as any).__permRequests)).toBe(0); // ni al cargar ni al iniciar sesión
  if (hasApi) {
    await page.getByRole('button', { name: 'Activar notificaciones del navegador' }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__permRequests)).toBe(1);
    await expect(page.getByRole('button', { name: 'Activar notificaciones del navegador' })).toHaveCount(0);
  } else {
    await expect(page.getByRole('button', { name: 'Activar notificaciones del navegador' })).toHaveCount(0);
    await expect(page.getByRole('note')).toContainText(/Safari no permite notificaciones/);
    await expect(page.getByRole('note')).toContainText(/sonido de aviso/);
  }
});

test('el audio se desbloquea con el primer gesto y el aviso suena aunque no haya notificaciones', async ({ page, browserName }) => {
  test.skip(browserName === 'firefox', NO_AUDIO_DEVICE);
  await login(page, CRISTINA); // el clic de «Entrar» ya es un gesto
  await expect.poll(() => page.evaluate(() => (window as any).__contexts[0]?.state)).toBe('running');
  const p = phone();
  const name = `Audio ${p.wa.slice(-8)}`;
  await inboundText(p.wa, 'Suena el aviso', name);
  await expect(page.getByRole('list', { name: 'Lista de conversaciones' }).getByRole('link', { name: new RegExp(name) })).toBeVisible({ timeout: 8000 });
  await expect.poll(() => page.evaluate(() => (window as any).__beeps), { timeout: 8000 }).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(() => (window as any).__contexts.length)).toBe(1); // un único contexto reutilizado
});
