/**
 * Utilidades de las pruebas de S1: app real + simulador de Meta en un puerto aleatorio, con el webhook
 * del simulador apuntando a la propia app (que escucha en un puerto aleatorio).
 */
import type { AddressInfo } from 'node:net';
import { startMetaSimulator, type MetaSimulator } from './simulator';
import { createTestApp, type TestApp } from '../utils/app';
import { DomainEvents, type DomainEventMap } from '../../src/modules/events/domain-events.service';
import { RealtimeService } from '../../src/modules/realtime/realtime.gateway';

export const APP_SECRET = 'test-app-secret';

export interface WaTestEnv {
  t: TestApp;
  sim: MetaSimulator;
  appUrl: string;
  webhookUrl: string;
  realtime: RealtimeService;
  /** eventos internos capturados desde el último `clear()` */
  domain: Array<{ event: keyof DomainEventMap; payload: any }>;
  clear(): void;
  close(): Promise<void>;
}

export async function createWaTestEnv(): Promise<WaTestEnv> {
  const sim = await startMetaSimulator({ appSecret: APP_SECRET });
  const t = await createTestApp({ META_GRAPH_BASE_URL: sim.baseUrl });
  await t.app.listen(0);
  const port = (t.app.getHttpServer().address() as AddressInfo).port;
  const appUrl = `http://127.0.0.1:${port}`;
  const webhookUrl = `${appUrl}/webhooks/whatsapp`;
  sim.opts.webhookUrl = webhookUrl;

  const realtime = t.app.get(RealtimeService);
  const domain: WaTestEnv['domain'] = [];
  const events = t.app.get(DomainEvents);
  for (const e of ['inbound.message', 'message.status', 'contact.opted_out', 'sending.blocked'] as const) {
    events.on(e, 'test-capture', (payload: any) => void domain.push({ event: e, payload }));
  }
  return {
    t,
    sim,
    appUrl,
    webhookUrl,
    realtime,
    domain,
    clear() {
      domain.length = 0;
      realtime.emitted.length = 0;
      t.jobs.inlineErrors.length = 0;
      sim.reset();
    },
    async close() {
      await sim.stop();
      await t.close();
    },
  };
}

/** Contacto + conversación (ventana abierta por defecto). */
export async function seedConversation(
  t: TestApp,
  o: { phone?: string; firstName?: string | null; windowOpen?: boolean; consent?: 'UNKNOWN' | 'GRANTED' | 'REVOKED' } = {},
) {
  const phone = o.phone ?? '34600111222';
  const contact = await t.prisma.contact.create({
    data: { phoneE164: '+' + phone, waId: phone, firstName: o.firstName === undefined ? 'Ginés' : o.firstName, consentStatus: o.consent ?? 'UNKNOWN' },
  });
  const open = o.windowOpen ?? true;
  const conversation = await t.prisma.conversation.create({
    data: {
      contactId: contact.id,
      lastInboundAt: new Date(Date.now() - (open ? 3600_000 : 30 * 3600_000)),
      windowExpiresAt: new Date(Date.now() + (open ? 23 * 3600_000 : -6 * 3600_000)),
    },
  });
  return { contact, conversation };
}

/** Plantilla de marketing con cabecera de imagen, 1 variable, botón URL con variable y botón «No recibir más». */
export async function seedTemplate(t: TestApp, o: { category?: 'MARKETING' | 'UTILITY'; header?: boolean; status?: 'APPROVED' | 'PENDING' } = {}) {
  const components: any[] = [];
  if (o.header !== false) components.push({ type: 'HEADER', format: 'IMAGE' });
  components.push({ type: 'BODY', text: 'Hola {{1}}, mira nuestras novedades' });
  components.push({
    type: 'BUTTONS',
    buttons: [
      { type: 'URL', text: 'Ver catálogo', url: 'https://gelado.eu/catalogo/{{1}}' },
      { type: 'QUICK_REPLY', text: 'No recibir más' },
    ],
  });
  return t.prisma.template.create({
    data: {
      name: 'campana_imagen',
      displayName: 'Campaña con imagen',
      language: 'es',
      category: o.category ?? 'MARKETING',
      status: o.status ?? 'APPROVED',
      components,
      hasOptOutButton: true,
    },
  });
}

/** PNG mínimo válido (1×1). */
export const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
