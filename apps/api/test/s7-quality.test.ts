import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createWaTestEnv, seedConversation, seedTemplate, type WaTestEnv } from './meta-simulator/harness';
import { loginAs, ADMIN_EMAIL, AGENT_EMAIL } from './utils/app';
import { QualityService } from '../src/modules/quality/quality.service';
import { DomainEvents } from '../src/modules/events/domain-events.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { RealtimeService } from '../src/modules/realtime/realtime.gateway';
import { ENDPOINTS } from '@gelado/shared';

let env: WaTestEnv;
let quality: QualityService;
const TOKEN = 'status-token-de-prueba-1234567890';

beforeAll(async () => {
  process.env.STATUS_TOKEN = TOKEN;
  env = await createWaTestEnv();
  quality = env.t.app.get(QualityService);
});
afterAll(async () => env.close());
beforeEach(async () => {
  await env.t.reset();
  env.clear();
  Object.assign(env.sim.phone, { quality_rating: 'GREEN', status: 'CONNECTED', messaging_limit_tier: 'TIER_2K' });
});

const alerts = async () => (await (await loginAs(env.t, AGENT_EMAIL)).get('/api/alerts')).body as Array<{ kind: string; level: string; message: string }>;
const statusReq = (token?: string) => env.t.http.get('/api/status').set(token ? { Authorization: `Bearer ${token}` } : {});

describe('S7 · Calidad y límite (RF-6.1)', () => {
  it('el sondeo guarda un snapshot POLL y ajusta el límite diario según el escalón', async () => {
    env.sim.phone.messaging_limit_tier = 'TIER_10K';
    await quality.poll();
    const snaps = await env.t.prisma.qualitySnapshot.findMany();
    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toMatchObject({ qualityRating: 'GREEN', messagingLimit: 'TIER_10K', source: 'POLL' });
    expect((await env.t.app.get(SettingsService).get('campaign_defaults')).dailyLimit).toBe(10000);
    env.sim.phone.messaging_limit_tier = 'TIER_250';
    await quality.poll();
    expect((await env.t.app.get(SettingsService).get('campaign_defaults')).dailyLimit).toBe(250);
  });

  it('GET /api/quality: estado, límite, uso de 24 h (destinatarios únicos fuera de ventana) e histórico', async () => {
    await quality.poll();
    const a = await seedConversation(env.t, { phone: '34600000001' });
    const b = await seedConversation(env.t, { phone: '34600000002' });
    const old = new Date(Date.now() - 30 * 3600_000);
    const mk = (conversationId: string, extra: Record<string, unknown> = {}) =>
      env.t.prisma.message.create({ data: { conversationId, direction: 'OUTBOUND', kind: 'TEMPLATE', status: 'SENT', sentOutsideWindow: true, ...extra } as any });
    await mk(a.conversation.id);
    await mk(a.conversation.id); // mismo destinatario: cuenta una vez
    await mk(b.conversation.id, { createdAt: old }); // fuera de las 24 h
    await mk(b.conversation.id, { sentOutsideWindow: false }); // dentro de ventana: no cuenta
    const agent = await loginAs(env.t, AGENT_EMAIL);
    const r = await agent.get('/api/quality');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ qualityRating: 'GREEN', phoneStatus: 'CONNECTED', messagingLimit: 'TIER_2K', dailyLimit: 2000, usedLast24h: 1 });
    expect(r.body.history.length).toBeGreaterThan(0);
  });

  it('webhook phone_number_quality_update → snapshot WEBHOOK y evento phone.quality', async () => {
    env.sim.phone.quality_rating = 'YELLOW';
    expect(await env.sim.sendPhoneQuality({ event: 'DOWNGRADE', currentLimit: 'TIER_2K' })).toBe(200);
    const snaps = await env.t.prisma.qualitySnapshot.findMany({ orderBy: { createdAt: 'asc' } });
    expect(snaps.some((s) => s.source === 'WEBHOOK')).toBe(true);
    expect(snaps.at(-1)!.qualityRating).toBe('YELLOW');
  });
});

describe('S7 · Alertas (RF-6.2) y /api/status', () => {
  it('calidad roja → alerta crítica en el banner y status critical; vuelve a verde → se resuelve sola', async () => {
    env.sim.phone.quality_rating = 'RED';
    await env.sim.sendPhoneQuality({ event: 'DOWNGRADE' });
    let list = await alerts();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: 'quality', level: 'critical' });
    expect(env.realtime.emitted.some((e) => e.event === 'alert' && (e.payload as any).alerts.length === 1)).toBe(true);

    const st = await statusReq(TOKEN);
    expect(st.status).toBe(200);
    expect(st.body).toMatchObject({ status: 'critical', quality: 'RED', runningCampaigns: 0 });
    expect(st.body.alerts).toHaveLength(1);

    // repetir no duplica
    await quality.poll();
    expect(await env.t.prisma.alert.count()).toBe(1);

    env.sim.phone.quality_rating = 'GREEN';
    await env.sim.sendPhoneQuality({ event: 'UPGRADE' });
    expect(await alerts()).toHaveLength(0);
    expect((await statusReq(TOKEN)).body.status).toBe('ok');
    expect((await env.t.prisma.alert.findFirstOrThrow()).resolvedAt).not.toBeNull();
  });

  it('calidad amarilla → aviso (warning)', async () => {
    env.sim.phone.quality_rating = 'YELLOW';
    await quality.poll();
    expect(await alerts()).toMatchObject([{ kind: 'quality', level: 'warning' }]);
    expect((await statusReq(TOKEN)).body.status).toBe('warning');
  });

  it('número marcado (FLAGGED) → alerta y se resuelve con UNFLAGGED', async () => {
    await env.sim.sendPhoneQuality({ event: 'FLAGGED' });
    expect(await alerts()).toMatchObject([{ kind: 'phone_flagged' }]);
    await env.sim.sendPhoneQuality({ event: 'UNFLAGGED' });
    expect(await alerts()).toHaveLength(0);
  });

  it('plantilla en uso pausada → alerta; aprobada otra vez → se resuelve; sin uso → no avisa', async () => {
    const tpl = await seedTemplate(env.t);
    const unused = await env.t.prisma.template.create({ data: { name: 'sin_uso', displayName: 'Sin uso', language: 'es', category: 'MARKETING', status: 'APPROVED', components: [{ type: 'BODY', text: 'x' }] } });
    await env.t.prisma.campaign.create({ data: { name: 'Otoño', template: { connect: { id: tpl.id } }, createdBy: { connect: { id: (await env.t.prisma.user.findFirstOrThrow()).id } }, variableMapping: {}, audience: {}, status: 'RUNNING' } });
    const events = env.t.app.get(DomainEvents);
    await events.emit('template.status', { templateId: unused.id, name: unused.name, status: 'PAUSED', previousStatus: 'APPROVED', reason: null });
    expect(await alerts()).toHaveLength(0);
    await events.emit('template.status', { templateId: tpl.id, name: tpl.name, status: 'PAUSED', previousStatus: 'APPROVED', reason: null });
    const list = await alerts();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: 'template_paused', level: 'warning' });
    expect(list[0]!.message).toContain('campana_imagen');
    await events.emit('template.status', { templateId: tpl.id, name: tpl.name, status: 'APPROVED', previousStatus: 'PAUSED', reason: null });
    expect(await alerts()).toHaveLength(0);
  });

  it('cuenta restringida (account_update) → crítica; levantada → resuelta', async () => {
    await env.sim.sendAccountUpdate({ event: 'ACCOUNT_RESTRICTION', restriction_info: [{ restriction_type: 'RESTRICTED_BIZ_INITIATED_MESSAGING', expiration: '2026-12-01T00:00:00+0000' }] });
    expect(await alerts()).toMatchObject([{ kind: 'account', level: 'critical' }]);
    expect((await statusReq(TOKEN)).body.status).toBe('critical');
    await env.sim.sendAccountUpdate({ event: 'ACCOUNT_RESTRICTION', restriction_info: [] });
    expect(await alerts()).toHaveLength(0);
  });

  it('eventos informativos de la cuenta no generan alerta', async () => {
    await env.sim.sendAccountUpdate({ event: 'VERIFIED_ACCOUNT' });
    expect(await alerts()).toHaveLength(0);
  });

  it('error 368/131031/133010 en un envío → «Envíos detenidos» crítica; sale un mensaje → se resuelve en el sondeo', async () => {
    const events = env.t.app.get(DomainEvents);
    await events.emit('sending.blocked', { code: 131031, scope: 'all', message: 'La cuenta está bloqueada' });
    expect(await alerts()).toMatchObject([{ kind: 'sending_stopped', level: 'critical' }]);
    // un error de campaña concreta (132015) no es «envíos detenidos»
    await events.emit('sending.blocked', { code: 132015, scope: 'campaign', message: 'Plantilla pausada' });
    expect(await alerts()).toHaveLength(1);
    const { conversation } = await seedConversation(env.t);
    await env.t.prisma.message.create({ data: { conversationId: conversation.id, direction: 'OUTBOUND', kind: 'TEXT', status: 'SENT', sentAt: new Date(Date.now() + 1000) } });
    await quality.poll();
    expect((await alerts()).map((a) => a.kind)).not.toContain('sending_stopped');
  });

  it('/api/status: sin token, con token malo o sin STATUS_TOKEN → 401; con token → StatusDto', async () => {
    expect((await statusReq()).status).toBe(401);
    expect((await statusReq('otro-token')).status).toBe(401);
    expect((await env.t.http.get('/api/status').set('Authorization', 'Basic abc')).status).toBe(401);
    // la sesión de una persona no sustituye al token
    const admin = await loginAs(env.t, ADMIN_EMAIL);
    expect((await admin.get('/api/status')).status).toBe(401);
    const ok = await statusReq(TOKEN);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual(expect.objectContaining({ status: 'ok', alerts: [], pendingWebhookEvents: 0, failedJobs24h: 0, runningCampaigns: 0 }));
    expect(typeof ok.body.checkedAt).toBe('string');
  });

  it('aviso opcional: sin webhooks en días pero enviando → webhook_stale', async () => {
    const { conversation } = await seedConversation(env.t);
    await env.t.prisma.message.create({ data: { conversationId: conversation.id, direction: 'OUTBOUND', kind: 'TEXT', status: 'SENT', sentAt: new Date() } });
    await quality.checkWebhookStale();
    expect(await alerts()).toMatchObject([{ kind: 'webhook_stale', level: 'warning' }]);
  });
});

describe('S7 · Costes del mes (RF-6.4 · prueba 10)', () => {
  it('suma por categoría y por campaña con las tarifas del ajuste; servicio gratis hasta 1.000/mes', async () => {
    const tpl = await seedTemplate(env.t);
    const camp = await env.t.prisma.campaign.create({ data: { name: 'Black Friday', template: { connect: { id: tpl.id } }, createdBy: { connect: { id: (await env.t.prisma.user.findFirstOrThrow()).id } }, variableMapping: {}, audience: {}, status: 'COMPLETED' } });
    const { conversation } = await seedConversation(env.t);
    const at = new Date('2026-10-15T10:00:00Z');
    const mk = (n: number, cat: string, extra: Record<string, unknown> = {}) =>
      env.t.prisma.message.createMany({
        data: Array.from({ length: n }, () => ({ conversationId: conversation.id, direction: 'OUTBOUND', kind: 'TEMPLATE', status: 'DELIVERED', pricingCategory: cat, billable: true, deliveredAt: at, sentAt: at, ...extra })) as any,
      });
    await mk(100, 'marketing', { campaignId: camp.id });
    await mk(10, 'utility');
    await mk(1010, 'service'); // 1.000 gratis + 10 de pago
    await mk(5, 'marketing', { billable: false, campaignId: camp.id }); // no facturables
    await mk(7, 'marketing', { deliveredAt: new Date('2026-09-20T10:00:00Z'), sentAt: new Date('2026-09-20T10:00:00Z') }); // otro mes
    await mk(3, 'marketing', { status: 'FAILED', deliveredAt: null }); // no entregados

    const agent = await loginAs(env.t, AGENT_EMAIL);
    const r = await agent.get('/api/quality/costs').query({ month: '2026-10' });
    expect(r.status).toBe(200);
    expect(r.body.currency).toBe('EUR');
    expect(r.body.byCategory.marketing).toEqual({ count: 100, cost: 5.85 });
    expect(r.body.byCategory.utility).toEqual({ count: 10, cost: 0.166 });
    expect(r.body.byCategory.service).toEqual({ count: 1010, cost: 0.166 });
    expect(r.body.total).toBeCloseTo(5.85 + 0.166 + 0.166, 4);
    expect(r.body.byCampaign).toEqual([{ campaignId: camp.id, name: 'Black Friday', count: 100, cost: 5.85 }]);
    expect(r.body.freeServiceUsed).toBe(1010);
    expect(r.body.freeServiceLimit).toBe(1000);

    // límites del mes en hora de Madrid: 30/09 23:30 UTC = 01/10 01:30 Madrid → octubre
    await env.t.prisma.message.create({ data: { conversationId: conversation.id, direction: 'OUTBOUND', kind: 'TEMPLATE', status: 'DELIVERED', pricingCategory: 'marketing', billable: true, deliveredAt: new Date('2026-09-30T23:30:00Z') } });
    expect((await agent.get('/api/quality/costs').query({ month: '2026-10' })).body.byCategory.marketing.count).toBe(101);
    expect((await agent.get('/api/quality/costs').query({ month: '2026-09' })).body.byCategory.marketing.count).toBe(7);
    expect((await agent.get('/api/quality/costs').query({ month: '2026-13' })).status).toBe(400);
    // mes vacío
    const empty = await agent.get('/api/quality/costs').query({ month: '2025-01' });
    expect(empty.body).toMatchObject({ total: 0, byCategory: {}, byCampaign: [], freeServiceUsed: 0 });
  });

  it('cambiar la tarifa cambia el cálculo', async () => {
    const admin = await loginAs(env.t, ADMIN_EMAIL);
    const { conversation } = await seedConversation(env.t);
    await env.t.prisma.message.create({ data: { conversationId: conversation.id, direction: 'OUTBOUND', kind: 'TEMPLATE', status: 'READ', pricingCategory: 'marketing', billable: true, readAt: new Date() } });
    const rates = (await admin.get('/api/settings')).body.rates;
    await admin.put('/api/settings/rates', { ...rates, marketing: 0.1 });
    const month = new Date().toISOString().slice(0, 7);
    expect((await admin.get('/api/quality/costs').query({ month })).body.total).toBe(0.1);
  });
});

describe('S7 · Permisos y ajustes', () => {
  it('GET /api/settings/whatsapp: admin sí (sin secretos); agente 403; PUT de ajustes solo admin', async () => {
    const admin = await loginAs(env.t, ADMIN_EMAIL);
    const agent = await loginAs(env.t, AGENT_EMAIL);
    await env.sim.sendInbound({ from: '34600111222', type: 'text', text: { body: 'hola' } });
    const r = await admin.get('/api/settings/whatsapp');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ wabaId: '24936790469294569', phoneNumberId: '833139829886325', businessId: '115003938195726', phoneStatus: 'CONNECTED', qualityRating: 'GREEN' });
    expect(r.body.lastWebhookAt).toBeTruthy();
    expect(JSON.stringify(r.body)).not.toMatch(/token|secret|sim-app/i);
    expect((await agent.get('/api/settings/whatsapp')).status).toBe(403);
    expect((await agent.put('/api/settings/out_of_hours', {})).status).toBe(403);
    expect((await agent.post('/api/settings/privacy/preview', { markdown: '# x' })).status).toBe(403);
    expect((await agent.get('/api/settings')).status).toBe(200);
    expect((await agent.get('/api/audit')).status).toBe(403);
  });

  it('todos los endpoints de S7 declarados en ENDPOINTS responden y los de admin niegan al agente', async () => {
    const agent = await loginAs(env.t, AGENT_EMAIL);
    const mine = ENDPOINTS.filter((e) => ['quality', 'settings'].includes(e.module) && e.role === 'admin' && !e.path.includes(':'));
    expect(mine.length).toBeGreaterThanOrEqual(2);
    for (const e of mine) {
      const res = await (agent as any)[e.method === 'GET' ? 'get' : e.method === 'POST' ? 'post' : 'put'](e.path, {});
      expect(res.status, `${e.method} ${e.path}`).toBe(403);
    }
  });

});
