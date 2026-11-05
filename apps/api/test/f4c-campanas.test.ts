/**
 * F4c · Regresiones de campañas y calidad (S9 #11 #12 #13 #14 #15 · S10 B7 B8 B9).
 * Las dos primeras (H9, H10) son las pruebas de confirmación de S9 con la aserción invertida.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWaTestEnv, seedTemplate, type WaTestEnv } from './meta-simulator/harness';
import { ADMIN_EMAIL, loginAs } from './utils/app';
import { CampaignClock } from '../src/modules/campaigns/campaigns.clock';
import { CampaignRunnerService } from '../src/modules/campaigns/campaign-runner.service';
import { CampaignsService } from '../src/modules/campaigns/campaigns.service';
import { QualityService } from '../src/modules/quality/quality.service';
import { DomainEvents } from '../src/modules/events/domain-events.service';
import { attachmentDisposition } from '../src/common/content-disposition';

let env: WaTestEnv;
let clock: CampaignClock;
let runner: CampaignRunnerService;
let quality: QualityService;

beforeAll(async () => {
  env = await createWaTestEnv();
  clock = env.t.app.get(CampaignClock);
  runner = env.t.app.get(CampaignRunnerService);
  quality = env.t.app.get(QualityService);
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
const MAPPING = { 'body.1': { field: 'firstName', fallback: 'cliente' }, 'button.0': { text: 'tintes' } } as const;
const camp = (id: string) => prisma().campaign.findUniqueOrThrow({ where: { id } });
const admin = () => loginAs(env.t, ADMIN_EMAIL);

let phoneSeq = 0;
async function mkContacts(n: number) {
  const base = 610000000 + phoneSeq;
  phoneSeq += n;
  const data = Array.from({ length: n }, (_, i) => ({ phoneE164: `+34${base + i}`, waId: `34${base + i}`, firstName: `Cliente${base + i}` }));
  await prisma().contact.createMany({ data });
  return prisma().contact.findMany({ where: { phoneE164: { in: data.map((d) => d.phoneE164) } }, orderBy: { phoneE164: 'asc' } });
}

async function draft(a: Awaited<ReturnType<typeof admin>>, o: { rate?: number; name?: string } = {}) {
  const templateId = (await prisma().template.findFirst({ where: { name: 'campana_imagen' } }))?.id ?? (await seedTemplate(env.t, { header: false })).id;
  const res = await a.post('/api/campaigns', { name: o.name ?? 'Campaña de prueba', templateId, variableMapping: MAPPING, audience: { allContacts: true }, ratePerMinute: o.rate ?? 20 });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; templateId: string };
}

/** Campaña ya creada en BD (sin pasar por el asistente), en el estado pedido. */
async function dbCampaign(status: 'RUNNING' | 'SCHEDULED' | 'PAUSED', startedAt: Date | null = status === 'SCHEDULED' ? null : new Date()) {
  const tpl = (await prisma().template.findFirst({ where: { name: 'campana_imagen' } })) ?? (await seedTemplate(env.t, { header: false }));
  const user = await prisma().user.findFirstOrThrow({ where: { role: 'ADMIN' } });
  return prisma().campaign.create({
    data: {
      name: 'C', templateId: tpl.id, createdById: user.id, status, variableMapping: MAPPING as any,
      audience: { includeLabelIds: [], excludeLabelIds: [], allContacts: true },
      scheduledAt: status === 'SCHEDULED' ? new Date(Date.now() - 60_000) : null, startedAt,
    },
  });
}

const snapshot = (qualityRating: any, phoneStatus: string | null = 'CONNECTED') =>
  quality.applySnapshot({ qualityRating, messagingLimit: 'TIER_2K', phoneStatus, source: 'POLL', event: null, raw: {} });

async function minute(ms = 61_000) {
  clock.advance(ms);
  await runner.tick();
}

describe('F4c #11 · paradas automáticas completas', () => {
  it('H9: el número marcado (FLAGGED) pausa la campaña en curso, con motivo', async () => {
    await mkContacts(5);
    const a = await admin();
    const d = await draft(a, { rate: 2 });
    expect((await a.post(`/api/campaigns/${d.id}/launch`, {})).status).toBe(201);
    expect((await camp(d.id)).status).toBe('RUNNING');
    await env.sim.sendPhoneQuality({ event: 'FLAGGED' });
    const c = await camp(d.id);
    expect(c.status).toBe('PAUSED');
    expect(c.stopReason).toMatch(/FLAGGED/);
    expect((await prisma().alert.findMany({ where: { resolvedAt: null } })).map((x) => x.kind)).toContain('phone_flagged');
    const sent = env.sim.sent.length;
    await minute();
    expect(env.sim.sent).toHaveLength(sent);
  });

  it.each([
    ['RED', 'CONNECTED'],
    ['GREEN', 'FLAGGED'],
    ['GREEN', 'RESTRICTED'],
  ])('H10: con la calidad %s y el número %s, una campaña programada NO arranca y queda pausada con motivo', async (rating, phoneStatus) => {
    await snapshot(rating, phoneStatus);
    await mkContacts(3);
    const c = await dbCampaign('SCHEDULED');
    await runner.tick();
    await minute();
    const after = await camp(c.id);
    expect(after.status).toBe('PAUSED');
    expect(after.stopReason).toMatch(/Parada automática/);
    expect(await prisma().campaignRecipient.count({ where: { campaignId: c.id } })).toBe(0);
    expect(env.sim.sent).toHaveLength(0);
  });

  it('start() directo tampoco arranca con un estado bloqueante', async () => {
    await snapshot('RED');
    await mkContacts(2);
    const c = await dbCampaign('SCHEDULED');
    expect(await runner.start(c.id)).toBe(false);
    expect((await camp(c.id)).status).toBe('SCHEDULED');
  });

  it('lanzar ahora con el número en rojo → 409 con motivo; programar para más tarde sí se permite', async () => {
    await snapshot('RED');
    await mkContacts(3);
    const a = await admin();
    const d = await draft(a);
    const r = await a.post(`/api/campaigns/${d.id}/launch`, {});
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/No se puede lanzar ahora.*rojo/);
    expect((await camp(d.id)).status).toBe('DRAFT');
    const later = new Date(Date.now() + 3 * 3600_000).toISOString();
    const s = await a.post(`/api/campaigns/${d.id}/launch`, { scheduledAt: later });
    expect(s.status).toBe(201);
    expect(s.body.scheduled).toBe(true);
  });

  it('reanudar: 409 en español con calidad en rojo, FLAGGED, cuenta restringida o envíos detenidos; vuelve a funcionar al resolverse', async () => {
    await mkContacts(6);
    const a = await admin();
    const d = await draft(a, { rate: 2 });
    await a.post(`/api/campaigns/${d.id}/launch`, {});
    await a.post(`/api/campaigns/${d.id}/pause`);

    await snapshot('RED');
    let r = await a.post(`/api/campaigns/${d.id}/resume`);
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/No se puede reanudar.*rojo/);
    await snapshot('GREEN', 'FLAGGED');
    r = await a.post(`/api/campaigns/${d.id}/resume`);
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/FLAGGED/);
    await snapshot('GREEN', 'CONNECTED');

    // cuenta restringida: alerta crítica activa
    await env.sim.sendAccountUpdate({ event: 'ACCOUNT_RESTRICTION', restriction_info: [{ restriction_type: 'RESTRICTED_BIZ_INITIATED_MESSAGING' }] });
    r = await a.post(`/api/campaigns/${d.id}/resume`);
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/restringido la cuenta/);
    await env.sim.sendAccountUpdate({ event: 'ACCOUNT_RESTRICTION', restriction_info: [] });

    // «Envíos detenidos»
    await env.t.app.get(DomainEvents).emit('sending.blocked', { code: 131031, scope: 'all', message: 'La cuenta está bloqueada' });
    r = await a.post(`/api/campaigns/${d.id}/resume`);
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/detenidos/);
    // sale un mensaje bien después del aviso → el bloqueo se cierra solo
    const { conversation } = await (await import('./meta-simulator/harness')).seedConversation(env.t, { phone: '34699000111' });
    await prisma().message.create({ data: { conversationId: conversation.id, direction: 'OUTBOUND', kind: 'TEXT', status: 'SENT', sentAt: new Date(Date.now() + 5000) } });
    r = await a.post(`/api/campaigns/${d.id}/resume`);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect((await camp(d.id)).status).toBe('RUNNING');
  });

  it('restricción de la cuenta (account_update) pausa las campañas en curso; un aviso informativo no', async () => {
    await mkContacts(6);
    const a = await admin();
    const d = await draft(a, { rate: 2 });
    await a.post(`/api/campaigns/${d.id}/launch`, {});
    await env.sim.sendAccountUpdate({ event: 'VERIFIED_ACCOUNT' });
    expect((await camp(d.id)).status).toBe('RUNNING');
    await env.sim.sendAccountUpdate({ event: 'ACCOUNT_RESTRICTION', restriction_info: [{ restriction_type: 'RESTRICTED_BIZ_INITIATED_MESSAGING' }] });
    const c = await camp(d.id);
    expect(c.status).toBe('PAUSED');
    expect(c.stopReason).toMatch(/restringido la cuenta/);
  });

  it('red de seguridad: si se perdió el evento, el tick pausa igualmente la campaña en curso', async () => {
    await mkContacts(4);
    const c = await dbCampaign('RUNNING');
    // snapshot en rojo escrito sin pasar por el bus de eventos
    await prisma().qualitySnapshot.create({ data: { qualityRating: 'RED', phoneStatus: 'CONNECTED', source: 'POLL' } });
    await minute();
    expect(await camp(c.id)).toMatchObject({ status: 'PAUSED' });
    expect(env.sim.sent).toHaveLength(0);
  });

  it('sin campañas en curso ni programadas, el tick no consulta la calidad (consumo en reposo)', async () => {
    const spy = vi.spyOn(quality, 'blockingReason');
    await minute();
    await minute();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('F4c #12 · destinatarios SENDING huérfanos', () => {
  it('el tick devuelve a QUEUED (y envía) los SENDING de más de 10 min sin mensaje; deja los recientes y los que ya tienen mensaje', async () => {
    const cs = await mkContacts(3);
    const c = await dbCampaign('RUNNING');
    const old = new Date(Date.now() - 11 * 60_000);
    const fresh = new Date(Date.now() - 2 * 60_000);
    await prisma().campaignRecipient.createMany({
      data: [
        { campaignId: c.id, contactId: cs[0]!.id, phoneE164: cs[0]!.phoneE164, status: 'SENDING', claimedAt: old },
        { campaignId: c.id, contactId: cs[1]!.id, phoneE164: cs[1]!.phoneE164, status: 'SENDING', claimedAt: fresh },
        { campaignId: c.id, contactId: cs[2]!.id, phoneE164: cs[2]!.phoneE164, status: 'SENDING', claimedAt: old },
      ],
    });
    // el tercero SÍ tiene mensaje creado (se envió, solo falta enlazarlo): no se vuelve a enviar
    const conv = await prisma().conversation.create({ data: { contactId: cs[2]!.id } });
    await prisma().message.create({ data: { conversationId: conv.id, campaignId: c.id, direction: 'OUTBOUND', kind: 'TEMPLATE', status: 'SENT', wamid: 'wamid.ya', sentAt: new Date() } });

    // el reloj de la campaña es el real: un tick sin avanzar el tiempo
    await runner.tick();
    const rec = await prisma().campaignRecipient.findMany({ where: { campaignId: c.id }, orderBy: { phoneE164: 'asc' } });
    expect(rec[0]!.status).not.toBe('SENDING'); // devuelto a la cola y enviado
    expect(rec[0]!.status).toBe('SENT');
    expect(rec[1]!.status).toBe('SENDING'); // reciente: no se toca
    expect(rec[2]!.status).toBe('SENDING'); // con mensaje: no se reencola
    expect(env.sim.sent.map((s) => s.body.to)).toEqual([cs[0]!.waId]);
  });
});

describe('F4c #13 · mismo criterio de coste en el informe y en Calidad', () => {
  it('solo cuentan entregados/leídos facturables: el coste del informe de campaña coincide con el de Calidad', async () => {
    const a = await admin();
    const c = await dbCampaign('RUNNING');
    const { seedConversation } = await import('./meta-simulator/harness');
    const { conversation } = await seedConversation(env.t, { phone: '34699000222' });
    const at = new Date();
    const mk = (n: number, status: string, extra: Record<string, unknown> = {}) =>
      prisma().message.createMany({
        data: Array.from({ length: n }, () => ({ conversationId: conversation.id, campaignId: c.id, direction: 'OUTBOUND', kind: 'TEMPLATE', status, pricingCategory: 'marketing', billable: true, sentAt: at, deliveredAt: status === 'DELIVERED' || status === 'READ' ? at : null, ...extra })) as any,
      });
    await mk(4, 'DELIVERED');
    await mk(2, 'READ');
    await mk(3, 'SENT'); // enviados sin entregar aún: aún no facturados
    await mk(2, 'FAILED');
    await mk(1, 'DELIVERED', { billable: false });
    const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit' }).format(at).slice(0, 7);
    const rep = (await a.get(`/api/campaigns/${c.id}`)).body;
    const costs = (await a.get('/api/quality/costs').query({ month })).body;
    expect(rep.cost.billableMessages).toBe(6);
    expect(rep.cost.actual).toBeCloseTo(6 * 0.0585, 4);
    expect(costs.byCampaign).toEqual([{ campaignId: c.id, name: 'C', count: 6, cost: rep.cost.actual }]);
  });
});

describe('F4c #14 / B7 · editar un borrador no pisa una campaña ya lanzada', () => {
  it('si la campaña deja de ser borrador entre la lectura y la escritura → 409 y no se modifica', async () => {
    await mkContacts(2);
    const a = await admin();
    const d = await draft(a, { name: 'Original' });
    const svc = env.t.app.get(CampaignsService);
    const real = (svc as any).load.bind(svc);
    // simula la carrera: `load` aún ve el borrador, pero otra petición ya la ha lanzado
    const spy = vi.spyOn(svc as any, 'load').mockImplementationOnce((async (id: string) => ({ ...(await real(id)), status: 'DRAFT' })) as any);
    await prisma().campaign.update({ where: { id: d.id }, data: { status: 'RUNNING', startedAt: new Date() } });
    const res = await a.patch(`/api/campaigns/${d.id}`, { name: 'Editada', templateId: d.templateId, variableMapping: MAPPING, audience: { allContacts: true }, ratePerMinute: 20 });
    spy.mockRestore();
    expect(res.status).toBe(409);
    expect((await camp(d.id)).name).toBe('Original');
  });

  it('un borrador sigue pudiéndose editar', async () => {
    await mkContacts(2);
    const a = await admin();
    const d = await draft(a, { name: 'Original' });
    const res = await a.patch(`/api/campaigns/${d.id}`, { name: 'Editada', templateId: d.templateId, variableMapping: MAPPING, audience: { allContacts: true }, ratePerMinute: 30 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ name: 'Editada', ratePerMinute: 30 });
  });
});

describe('F4c #15 · cancelar deja el informe sin pendientes', () => {
  it('QUEUED/SENDING sin mensaje → SKIPPED «CANCELLED»; sin pendientes ni plan; el motivo sale en español', async () => {
    await mkContacts(12);
    const a = await admin();
    const d = await draft(a, { rate: 4 });
    expect((await a.post(`/api/campaigns/${d.id}/launch`, {})).status).toBe(201);
    // uno en vuelo (SENDING sin mensaje)
    const q = await prisma().campaignRecipient.findFirstOrThrow({ where: { campaignId: d.id, status: 'QUEUED' } });
    await prisma().campaignRecipient.update({ where: { id: q.id }, data: { status: 'SENDING', claimedAt: new Date() } });
    expect((await a.post(`/api/campaigns/${d.id}/cancel`)).body.campaign.status).toBe('CANCELLED');
    expect(await prisma().campaignRecipient.count({ where: { campaignId: d.id, status: { in: ['QUEUED', 'SENDING'] } } })).toBe(0);
    const rep = (await a.get(`/api/campaigns/${d.id}`)).body;
    expect(rep.pending).toBe(0);
    expect(rep.remainingPlan).toEqual([]);
    expect(rep.funnel.sent).toBe(4);
    expect(rep.skipReasons).toEqual([{ reason: 'CANCELLED', title: expect.stringMatching(/cancelada/i), count: 8 }]);
    expect(rep.campaign.skippedCount).toBe(8);
  });
});

describe('F4c B8 · Content-Disposition con nombres no ASCII', () => {
  it('attachmentDisposition: ASCII en filename y UTF-8 en filename*', () => {
    const h = attachmentDisposition('campana_Łódź_ñandú ✓.csv');
    expect(h).toMatch(/^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''[A-Za-z0-9%._-]+$/);
    expect(h).toContain("filename*=UTF-8''campana_%C5%81%C3%B3d%C5%BA_%C3%B1and%C3%BA%20%E2%9C%93.csv");
    expect(attachmentDisposition('a"b\\c\r\nd.csv')).not.toMatch(/[\r\n\\]/);
  });

  it('exportar una campaña llamada «Łódź ✓» responde 200 (antes 500 por ERR_INVALID_CHAR)', async () => {
    await mkContacts(2);
    const a = await admin();
    const d = await draft(a, { name: 'Łódź ✓ Verano' });
    const res = await a.get(`/api/campaigns/${d.id}/export`);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''campana_%C5%81%C3%B3d%C5%BA/);
    expect(res.text.startsWith('﻿Nombre;')).toBe(true);
  });
});

describe('F4c B9 · auditoría con IP', () => {
  it('lanzar, programar, pausar, reanudar, cancelar, probar, exportar y borrar quedan auditados con IP', async () => {
    await mkContacts(6);
    const a = await admin();
    const d = await draft(a, { rate: 2 });
    await a.post(`/api/campaigns/${d.id}/test`, { phone: '617498222' });
    await a.post(`/api/campaigns/${d.id}/launch`, {});
    await a.post(`/api/campaigns/${d.id}/pause`);
    await a.post(`/api/campaigns/${d.id}/resume`);
    await a.get(`/api/campaigns/${d.id}/export`);
    await a.post(`/api/campaigns/${d.id}/cancel`);
    const d2 = await draft(a, { name: 'Programada' });
    await a.post(`/api/campaigns/${d2.id}/launch`, { scheduledAt: new Date(Date.now() + 3 * 3600_000).toISOString() });
    const d3 = await draft(a, { name: 'Borrar' });
    await a.del(`/api/campaigns/${d3.id}`);
    const rows = await prisma().auditLog.findMany({ where: { entityType: 'Campaign' } });
    const actions = rows.map((r) => r.action).sort();
    expect(actions).toEqual(['cancel_campaign', 'delete_campaign', 'export_campaign', 'launch_campaign', 'pause_campaign', 'resume_campaign', 'schedule_campaign', 'test_campaign']);
    for (const r of rows) expect(r.ip, r.action).toBeTruthy();
  });
});
