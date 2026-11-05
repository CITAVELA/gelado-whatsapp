// Regresiones de la re-revisión de S9 en la parte del orquestador: N1, N5, N8.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createWaTestEnv, seedTemplate, type WaTestEnv } from './meta-simulator/harness';
import { ADMIN_EMAIL, AGENT_EMAIL, loginAs } from './utils/app';
import { CampaignClock } from '../src/modules/campaigns/campaigns.clock';
import { CampaignRunnerService } from '../src/modules/campaigns/campaign-runner.service';
import { accountEventSeverity } from '../src/modules/quality/quality.service';
import { AlertsService } from '../src/modules/quality/alerts.service';
import { MessageStatusService } from '../src/modules/whatsapp/message-status.service';

let env: WaTestEnv;
let clock: CampaignClock;
let runner: CampaignRunnerService;
beforeAll(async () => {
  env = await createWaTestEnv();
  clock = env.t.app.get(CampaignClock);
  runner = env.t.app.get(CampaignRunnerService);
});
afterAll(async () => {
  clock.set(null);
  await env.close();
});
beforeEach(async () => {
  await env.t.reset();
  env.clear();
  clock.set(new Date());
});
const prisma = () => env.t.prisma;

async function runningCampaign(n = 30) {
  const tpl = await seedTemplate(env.t, { header: false });
  await prisma().contact.createMany({ data: Array.from({ length: n }, (_, i) => ({ phoneE164: `+3461100${String(i).padStart(4, '0')}`, waId: `3461100${String(i).padStart(4, '0')}`, firstName: `C${i}` })) });
  const a = await loginAs(env.t, ADMIN_EMAIL);
  const d = await a.post('/api/campaigns', { name: 'N1', templateId: tpl.id, variableMapping: { 'body.1': { field: 'firstName', fallback: 'x' }, 'button.0': { text: 'y' } }, audience: { allContacts: true }, ratePerMinute: 5 });
  expect(d.status, JSON.stringify(d.body)).toBe(201);
  const l = await a.post(`/api/campaigns/${d.body.id}/launch`, {});
  expect(l.status, JSON.stringify(l.body)).toBe(201);
  return { tpl, id: d.body.id as string, a };
}

describe('N1 · campaña en curso con plantilla de marketing que pierde el botón de baja', () => {
  it('el siguiente minuto la pausa con motivo y no envía más; reanudar da 409', async () => {
    const { tpl, id, a } = await runningCampaign();
    const before = env.sim.sent.length;
    await prisma().template.update({ where: { id: tpl.id }, data: { hasOptOutButton: false } });
    clock.advance(61_000);
    await runner.tick();
    const c = await prisma().campaign.findUniqueOrThrow({ where: { id } });
    expect(c.status).toBe('PAUSED');
    expect(c.stopReason).toMatch(/No recibir más/);
    expect(env.sim.sent.length).toBe(before);
    const r = await a.post(`/api/campaigns/${id}/resume`, {});
    expect(r.status).toBe(409);
  });
});

describe('N5 · alertas de cuenta con salida', () => {
  it('DISABLED_UPDATE con REINSTATE es recuperación; ACCOUNT_VIOLATION es aviso, no bloqueo', () => {
    expect(accountEventSeverity('DISABLED_UPDATE', { ban_info: { waba_ban_state: 'REINSTATE' } })).toBe('recovered');
    expect(accountEventSeverity('DISABLED_UPDATE', { ban_info: { waba_ban_state: 'DISABLE' } })).toBe('critical');
    expect(accountEventSeverity('ACCOUNT_VIOLATION', {})).toBe('warning');
  });
  it('la administradora marca una alerta crítica como resuelta (auditado); un agente no puede', async () => {
    const alerts = env.t.app.get(AlertsService);
    await alerts.raise({ dedupeKey: 'account', kind: 'account', level: 'critical', message: 'Cuenta restringida' });
    const id = (await alerts.active())[0]!.id;
    const ag = await loginAs(env.t, AGENT_EMAIL);
    expect((await ag.post(`/api/alerts/${id}/resolve`, {})).status).toBe(403);
    const ad = await loginAs(env.t, ADMIN_EMAIL);
    expect((await ad.post(`/api/alerts/${id}/resolve`, {})).status).toBe(200);
    expect(await alerts.active()).toEqual([]);
    expect(await prisma().auditLog.count({ where: { action: 'resolve_alert' } })).toBe(1);
  });
});

describe('N8 · markSent no hace retroceder un estado ya avanzado', () => {
  it('si un estado DELIVERED llegó antes (enlazado por datos opacos), markSent no lo devuelve a SENT', async () => {
    const contact = await prisma().contact.create({ data: { phoneE164: '+34612000111', waId: '34612000111' } });
    const conv = await prisma().conversation.create({ data: { contactId: contact.id } });
    const m = await prisma().message.create({ data: { conversationId: conv.id, direction: 'OUTBOUND', kind: 'TEXT', body: 'hola', status: 'DELIVERED', wamid: 'wamid.X1', deliveredAt: new Date() } });
    const out = await env.t.app.get(MessageStatusService).markSent(m.id, 'wamid.X1');
    expect(out.status).toBe('DELIVERED');
  });
});
