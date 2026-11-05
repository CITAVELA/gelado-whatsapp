/**
 * Notas de voz en cada motor (Chromium → webm/opus, Firefox → ogg/opus, WebKit/Safari → mp4/AAC).
 * No hay micrófono: `getUserMedia` se sustituye por un MediaStream de un oscilador (AudioContext.createMediaStreamDestination).
 * Se comprueba que el navegador graba, que la nota llega al simulador de Meta como audio OGG/Opus mono
 * y que la burbuja del chat es una nota de voz.
 */
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { CRISTINA, SIM, inboundText, isTouchUi, login, openCard, phone, simGet, simPost } from '../helpers';

// El WebKit de Playwright para Linux no trae MediaRecorder (Safari real sí desde la 14.1). Ahí se instala un grabador que
// imita al de Safari (isTypeSupported solo para mp4/AAC, trozo único al parar, tipo «audio/mp4») y entrega una grabación
// real de Safari (fixture MP4/AAC fragmentado): se prueba el cliente y el servidor, no el códec del navegador.
const SAFARI_MP4_B64 = fs.readFileSync(path.resolve(__dirname, '../../apps/api/test/fixtures/audio/voz-safari.mp4')).toString('base64');

test.beforeEach(async ({ page }) => {
  await page.addInitScript((safariMp4: string) => {
    const w = window as any;
    w.__gum = 0;
    const fake = async () => {
      w.__gum++;
      const Ctx = window.AudioContext ?? w.webkitAudioContext;
      const ctx = new Ctx();
      ctx.resume?.().catch?.(() => undefined); // sin esperar: en Firefox sin tarjeta de sonido no llega a resolverse
      const osc = ctx.createOscillator();
      osc.frequency.value = 440;
      const dest = ctx.createMediaStreamDestination();
      osc.connect(dest);
      osc.start();
      return dest.stream;
    };
    // En el prototipo (WebKit recrea `navigator.mediaDevices` al terminar de navegar y se perdería lo puesto en la instancia)
    if (typeof MediaDevices !== 'undefined') Object.defineProperty(MediaDevices.prototype, 'getUserMedia', { value: fake, configurable: true, writable: true });
    else {
      if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true });
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: fake, configurable: true, writable: true });
    }
    // lo que graba el motor, para el informe
    const Rec = window.MediaRecorder;
    if (!Rec) {
      w.__rec = [] as string[];
      w.__fakeRecorder = true;
      w.MediaRecorder = class extends EventTarget {
        static isTypeSupported(m: string) { return /^audio\/mp4/.test(m); }
        mimeType = ''; state = 'inactive'; ondataavailable: any = null; onstop: any = null;
        constructor(_s: MediaStream, o?: MediaRecorderOptions) { super(); this.mimeType = 'audio/mp4'; w.__rec.push(`${o?.mimeType ?? '(por defecto)'} → ${this.mimeType} [grabador simulado]`); }
        start() { this.state = 'recording'; }
        stop() {
          this.state = 'inactive';
          const bytes = Uint8Array.from(atob(safariMp4), (c) => c.charCodeAt(0));
          setTimeout(() => { this.ondataavailable?.({ data: new Blob([bytes], { type: 'audio/mp4' }) }); this.onstop?.(); }, 20);
        }
      };
    } else {
      w.__rec = [] as string[];
      w.MediaRecorder = class extends Rec { constructor(s: MediaStream, o?: MediaRecorderOptions) { super(s, o); w.__rec.push(`${o?.mimeType ?? '(por defecto)'} → ${this.mimeType}`); } };
      w.MediaRecorder.isTypeSupported = Rec.isTypeSupported.bind(Rec);
    }
  }, SAFARI_MP4_B64);
});

async function oggFromSimulator(mediaId: string): Promise<Buffer> {
  const info: any = await (await fetch(`${SIM}/v21.0/${mediaId}`, { headers: { Authorization: "Bearer e2e" } })).json();
  if (!info.url) throw new Error(`simulador: ${JSON.stringify(info)} (id ${mediaId})`);
  const r = await fetch(info.url.replace(/^https?:\/\/[^/]+/, SIM));
  return Buffer.from(await r.arrayBuffer());
}

async function recordAndSend(page: Page) {
  if (await isTouchUi(page)) {
    // móvil: se mantiene pulsado el micrófono grande y se suelta
    const mic = page.getByRole('button', { name: 'Mantén pulsado para grabar nota de voz' });
    await mic.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true });
    await expect(page.getByText('Grabando')).toBeVisible();
    await page.waitForTimeout(1500);
    // el micrófono ya no está en pantalla (lo sustituye la barra «Grabando»): el dedo se levanta sobre otro elemento
    await page.evaluate(() => document.body.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', isPrimary: true })));
  } else {
    await page.getByRole('button', { name: 'Grabar nota de voz' }).click();
    await expect(page.getByText('Grabando')).toBeVisible();
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  }
}

test('grabar una nota de voz en el navegador y enviarla: llega a Meta como OGG/Opus mono', async ({ page }, testInfo) => {
  await login(page, CRISTINA);
  const p = phone();
  const name = `Voz ${p.wa.slice(-8)}`;
  await simPost('/_sim/reset');
  await inboundText(p.wa, 'Mándame un audio', name);
  await expect(page.getByRole('list', { name: 'Lista de conversaciones' }).getByRole('link', { name: new RegExp(name) })).toBeVisible({ timeout: 8000 });
  await openCard(page, new RegExp(name));
  await expect(page.getByText('Ventana abierta')).toBeVisible();

  await recordAndSend(page);

  await expect.poll(async () => (await simGet('/_sim/sent')).some((s: any) => s.body?.type === 'audio' && s.body?.to === p.wa), { timeout: 15_000 }).toBe(true);
  const audio = (await simGet('/_sim/sent')).find((s: any) => s.body?.type === 'audio' && s.body?.to === p.wa);
  const ogg = await oggFromSimulator(audio.body.audio.id);
  expect(ogg.subarray(0, 4).toString('latin1')).toBe('OggS');
  const i = ogg.indexOf('OpusHead');
  expect(i).toBeGreaterThan(0);
  expect(ogg[i + 9]).toBe(1); // un canal (mono)
  // la burbuja del chat es una nota de voz
  await expect(page.getByRole('main', { name: /^Conversación con/ }).getByText(/Nota de voz|0:0\d/).first()).toBeVisible({ timeout: 8000 });

  const rec = await page.evaluate(() => (window as any).__rec);
  testInfo.annotations.push({ type: 'MediaRecorder', description: String(rec) });
  console.log(`[${testInfo.project.name}] MediaRecorder: ${rec} · ogg ${ogg.length} B`);
});
