import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createWaTestEnv, PNG_1X1, seedTemplate, type WaTestEnv } from './meta-simulator/harness';
import { AGENT_EMAIL, ADMIN_EMAIL, loginAs } from './utils/app';
import { CampaignClock } from '../src/modules/campaigns/campaigns.clock';
import { CampaignRunnerService } from '../src/modules/campaigns/campaign-runner.service';
import { ConsentService } from '../src/modules/contacts/consent.service';
import { DomainEvents } from '../src/modules/events/domain-events.service';
import { MediaService } from '../src/modules/media/media.service';
import { SettingsService } from '../src/modules/settings/settings.service';

let env: WaTestEnv;
let clock: CampaignClock;
let runner: CampaignRunnerService;
let T0: Date;

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
  T0 = new Date();
  clock.set(T0);
});

const prisma = () => env.t.prisma;
const MAPPING = { 'body.1': { field: 'firstName', fallback: 'cliente' }, 'button.0': { text: 'tintes' } } as const;

let phoneSeq = 0;
/** Crea n contactos (teléfonos +34 6xx consecutivos). */
async function mkContacts(n: number, o: Partial<{ consent: 'UNKNOWN' | 'GRANTED' | 'REVOKED'; phoneInvalid: boolean; deleted: boolean; firstName: string | null }> = {}) {
  const base = 600000000 + phoneSeq;
  phoneSeq += n;
  const data = Array.from({ length: n }, (_, i) => ({
    phoneE164: `+34${base + i}`,
    waId: `34${base + i}`,
    firstName: o.firstName === undefined ? `Cliente${base + i}` : o.firstName,
    consentStatus: o.consent ?? ('UNKNOWN' as const),
    phoneInvalid: o.phoneInvalid ?? false,
    deletedAt: o.deleted ? new Date() : null,
  }));
  await prisma().contact.createMany({ data });
  return prisma().contact.findMany({ where: { phoneE164: { in: data.map((d) => d.phoneE164) } }, orderBy: { phoneE164: 'asc' } });
}

async function admin() {
  return loginAs(env.t, ADMIN_EMAIL);
}
async function agent() {
  return loginAs(env.t, AGENT_EMAIL);
}

async function draft(a: Awaited<ReturnType<typeof admin>>, o: { templateId?: string; audience?: any; rate?: number; name?: string; scheduledAt?: string } = {}) {
  const templateId = o.templateId ?? (await prisma().template.findFirst({ where: { name: 'campana_imagen' } }))?.id ?? (await seedTemplate(env.t, { header: false })).id;
  const res = await a.post('/api/campaigns', {
    name: o.name ?? 'Campaña de prueba',
    templateId,
    variableMapping: MAPPING,
    audience: o.audience ?? { allContacts: true },
    ratePerMinute: o.rate ?? 20,
    ...(o.scheduledAt ? { scheduledAt: o.scheduledAt } : {}),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; templateId: string };
}

async function launch(a: Awaited<ReturnType<typeof admin>>, id: string, body: object = {}) {
  const res = await a.post(`/api/campaigns/${id}/launch`, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

/** Avanza el reloj `ms` y ejecuta un minuto del envío. */
async function minute(ms = 61_000) {
  clock.advance(ms);
  await runner.tick();
}

const camp = (id: string) => prisma().campaign.findUniqueOrThrow({ where: { id } });
const countRec = (id: string, status?: string) => prisma().campaignRecipient.count({ where: { campaignId: id, ...(status ? { status: status as any } : {}) } });

describe('S6 · Audiencia y exclusiones (RF-5.2, RF-5.3)', () => {
  it('recuento en vivo con desglose y la selección manual nunca incluye a un dado de baja', async () => {
    const a = await admin();
    const label = await prisma().label.create({ data: { name: 'Barbería', color: '#2457C5', scope: 'CONTACT' } });
    const jub = await prisma().label.create({ data: { name: 'Jubilado', color: '#999999', scope: 'CONTACT' } });
    const ok = await mkContacts(3);
    const unknownGranted = await mkContacts(1, { consent: 'GRANTED' });
    const revoked = await mkContacts(2, { consent: 'REVOKED' });
    const invalid = await mkContacts(2, { phoneInvalid: true });
    const deleted = await mkContacts(1, { deleted: true });
    const jubilado = await mkContacts(1);
    // duplicado por teléfono: mismo wa_id con otro formato de E.164
    const dup = await prisma().contact.create({ data: { phoneE164: '+34 ' + ok[0]!.waId!.slice(2), waId: null } });
    const everyone = [...ok, ...unknownGranted, ...revoked, ...invalid, ...deleted, ...jubilado, dup];
    await prisma().contactLabel.createMany({ data: everyone.map((c) => ({ contactId: c.id, labelId: label.id })) });
    await prisma().contactLabel.create({ data: { contactId: jubilado[0]!.id, labelId: jub.id } });

    const res = await a.post('/api/campaigns/audience-count', { audience: { includeLabelIds: [label.id], excludeLabelIds: [jub.id] } });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      selected: 11, excludedByLabel: 1, excludedDeleted: 1, excludedRevoked: 2, excludedInvalid: 2, excludedDuplicate: 1, willReceive: 4,
      dailyLimit: 2000, usedLast24h: 0, estimatedMinutes: 1,
    });
    expect(res.body.estimatedCost).toBeCloseTo(4 * 0.0585, 4);
    expect(res.body.plan).toEqual([{ day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), count: 4 }]);

    // Selección manual con un dado de baja y un borrado: no cuentan
    const manual = await a.post('/api/campaigns/audience-count', { audience: { contactIds: [revoked[0]!.id, deleted[0]!.id, ok[1]!.id] } });
    expect(manual.body).toMatchObject({ selected: 3, excludedRevoked: 1, excludedDeleted: 1, willReceive: 1 });
    // Sin criterios no hay audiencia
    expect((await a.post('/api/campaigns/audience-count', { audience: {} })).body).toMatchObject({ selected: 0, willReceive: 0, plan: [] });
  });

  it('al lanzar: REVOKED (también con selección manual), inválidos, borrados y duplicados quedan SKIPPED con motivo y nadie recibe nada', async () => {
    const a = await admin();
    const ok = await mkContacts(3);
    const rev = await mkContacts(2, { consent: 'REVOKED' });
    const inv = await mkContacts(1, { phoneInvalid: true });
    const del = await mkContacts(1, { deleted: true });
    const dup = await prisma().contact.create({ data: { phoneE164: '+34 ' + ok[0]!.waId!.slice(2), waId: null } });
    const d = await draft(a, { audience: { allContacts: true, contactIds: [rev[0]!.id] } });
    const out = await launch(a, d.id);
    expect(out.scheduled).toBe(false);

    const recs = await prisma().campaignRecipient.findMany({ where: { campaignId: d.id }, include: { contact: true } });
    const skipped = Object.fromEntries(recs.filter((r) => r.status === 'SKIPPED').map((r) => [r.contactId, r.skipReason]));
    expect(skipped[rev[0]!.id]).toBe('REVOKED');
    expect(skipped[rev[1]!.id]).toBe('REVOKED');
    expect(skipped[inv[0]!.id]).toBe('PHONE_INVALID');
    expect(skipped[del[0]!.id]).toBe('DELETED');
    expect(skipped[dup.id]).toBe('DUPLICATE');
    // Solo reciben los 3 válidos: nada llegó a un dado de baja, a un inválido, a un borrado ni al duplicado
    expect(env.sim.sent).toHaveLength(3);
    const sentTo = env.sim.sent.map((s) => s.body.to).sort();
    expect(sentTo).toEqual(ok.map((c) => c.waId).sort());
    const c = await camp(d.id);
    expect(c).toMatchObject({ status: 'COMPLETED', totalRecipients: 3, sentCount: 3, skippedCount: 5 });
    const rep = (await a.get(`/api/campaigns/${d.id}`)).body;
    expect(rep.skipReasons.map((s: any) => [s.reason, s.count]).sort()).toEqual([['DELETED', 1], ['DUPLICATE', 1], ['PHONE_INVALID', 1], ['REVOKED', 2]]);
    expect(rep.skipReasons.find((s: any) => s.reason === 'REVOKED').title).toMatch(/baja/);
  });

  it('una baja posterior al lanzamiento se respeta: no se envía a quien se da de baja con la campaña en marcha', async () => {
    const a = await admin();
    const cs = await mkContacts(10);
    const d = await draft(a, { rate: 4 });
    await launch(a, d.id);
    expect(env.sim.sent).toHaveLength(4);
    const queued = await prisma().campaignRecipient.findMany({ where: { campaignId: d.id, status: 'QUEUED' }, orderBy: { id: 'asc' } });
    // uno se da de baja desde la bandeja y otro se queda con el estado desactualizado en la campaña (carrera)
    await env.t.app.get(ConsentService).setConsent(queued[0]!.contactId, 'REVOKED', 'MANUAL', { userId: (await prisma().user.findFirstOrThrow()).id });
    await prisma().contact.update({ where: { id: queued[1]!.contactId }, data: { consentStatus: 'REVOKED' } });
    for (let i = 0; i < 4; i++) await minute();
    const gotIt = new Set(env.sim.sent.map((s) => s.body.to));
    for (const q of queued.slice(0, 2)) expect(gotIt.has(cs.find((c) => c.id === q.contactId)!.waId!)).toBe(false);
    expect(env.sim.sent).toHaveLength(8);
    const r = await prisma().campaignRecipient.findMany({ where: { id: { in: queued.slice(0, 2).map((q) => q.id) } } });
    expect(r.every((x) => x.status === 'SKIPPED' && x.skipReason === 'REVOKED')).toBe(true);
    expect(await camp(d.id)).toMatchObject({ status: 'COMPLETED', totalRecipients: 8, skippedCount: 2 });
  });
});

describe('S6 · Ritmo, límite de 24 h y reparto (RF-5.5)', () => {
  it('envía como máximo ratePerMinute por minuto y no repite dentro del mismo minuto', async () => {
    const a = await admin();
    await mkContacts(25);
    const d = await draft(a, { rate: 10 });
    await launch(a, d.id);
    expect(env.sim.sent).toHaveLength(10);
    await runner.tick(); // mismo minuto: nada
    expect(env.sim.sent).toHaveLength(10);
    await minute();
    expect(env.sim.sent).toHaveLength(20);
    expect((await camp(d.id)).status).toBe('RUNNING');
    await minute();
    expect(env.sim.sent).toHaveLength(25);
    expect(await camp(d.id)).toMatchObject({ status: 'COMPLETED', sentCount: 25, totalRecipients: 25 });
    expect(await camp(d.id).then((c) => c.completedAt)).toBeTruthy();
  });

  it('el uso de las últimas 24 h incluye mensajes de otro origen y reduce lo que cabe hoy', async () => {
    const a = await admin();
    await env.t.app.get(SettingsService).set('campaign_defaults', { ratePerMinute: 20, dailyLimit: 10, requireOptOutButton: true });
    // 6 plantillas previas fuera de ventana (p. ej. de otra campaña o del chat)
    const prev = await mkContacts(6);
    const tpl = await seedTemplate(env.t, { header: false });
    for (const c of prev) {
      const conv = await prisma().conversation.create({ data: { contactId: c.id } });
      await prisma().message.create({ data: { conversationId: conv.id, direction: 'OUTBOUND', kind: 'TEMPLATE', templateId: tpl.id, status: 'SENT', sentOutsideWindow: true, wamid: 'wamid.prev' + c.id } });
    }
    await prisma().contact.updateMany({ where: { id: { in: prev.map((c) => c.id) } }, data: { deletedAt: new Date() } }); // fuera de la audiencia
    await mkContacts(9);
    const count = await a.post('/api/campaigns/audience-count', { audience: { allContacts: true } });
    expect(count.body).toMatchObject({ willReceive: 9, dailyLimit: 10, usedLast24h: 6 });
    expect(count.body.plan.map((p: any) => p.count)).toEqual([4, 5]);
    const d = await draft(a, { templateId: tpl.id, rate: 100 });
    const out = await launch(a, d.id);
    expect(out.plan.map((p: any) => p.count)).toEqual([4, 5]);
    expect(env.sim.sent).toHaveLength(4);
    await minute();
    expect(env.sim.sent).toHaveLength(4); // el resto espera a mañana
    clock.advance(25 * 3600_000);
    await runner.tick();
    expect(env.sim.sent).toHaveLength(9);
    expect((await camp(d.id)).status).toBe('COMPLETED');
  });

  it('2.500 destinatarios con límite 2.000: se reparte en 2 días y el informe cuadra al 100 %', async () => {
    const a = await admin();
    await mkContacts(2500);
    const d = await draft(a, { rate: 600, name: 'Campaña grande' });
    const out = await launch(a, d.id);
    expect(out.plan.map((p: any) => p.count)).toEqual([2000, 500]);
    expect(out.plan[0].day).not.toBe(out.plan[1].day);

    // Día 1: 600 por minuto hasta agotar el límite de 2.000
    for (let i = 0; i < 6; i++) await minute();
    expect(await countRec(d.id, 'SENT')).toBe(2000);
    expect(await countRec(d.id, 'QUEUED')).toBe(500);
    expect(env.sim.sent).toHaveLength(2000);
    expect((await camp(d.id)).status).toBe('RUNNING');
    const used = await prisma().message.count({ where: { campaignId: d.id, sentOutsideWindow: true } });
    expect(used).toBe(2000);
    // Informe a mitad: pendiente = 500 y plan restante en el día siguiente
    const mid = (await a.get(`/api/campaigns/${d.id}`)).body;
    expect(mid.pending).toBe(500);
    expect(mid.remainingPlan.reduce((s: number, p: any) => s + p.count, 0)).toBe(500);

    // Día 2
    clock.advance(25 * 3600_000);
    for (let i = 0; i < 3; i++) await minute();
    expect(env.sim.sent).toHaveLength(2500);

    const c = await camp(d.id);
    expect(c).toMatchObject({ status: 'COMPLETED', totalRecipients: 2500, sentCount: 2500, failedCount: 0, skippedCount: 0 });
    const rep = (await a.get(`/api/campaigns/${d.id}`)).body;
    expect(rep.funnel.sent + rep.pending + rep.campaign.failedCount).toBe(2500);
    expect(rep.pending).toBe(0);
    // cuadre real contra los mensajes: uno por destinatario, ninguno repetido
    const msgs = await prisma().message.findMany({ where: { campaignId: d.id }, select: { conversationId: true, wamid: true } });
    expect(msgs).toHaveLength(2500);
    expect(new Set(msgs.map((m) => m.conversationId)).size).toBe(2500);
    expect(new Set(msgs.map((m) => m.wamid)).size).toBe(2500);
    expect(new Set(env.sim.sent.map((s) => s.body.to)).size).toBe(2500);
    const recs = await prisma().campaignRecipient.findMany({ where: { campaignId: d.id }, select: { plannedFor: true } });
    expect(new Set(recs.map((r) => r.plannedFor!.toISOString())).size).toBe(2);
  }, 240_000);

  it('programada: queda SCHEDULED y arranca sola al llegar la hora', async () => {
    const a = await admin();
    await mkContacts(5);
    const at = new Date(T0.getTime() + 2 * 3600_000).toISOString();
    const d = await draft(a, { scheduledAt: at });
    const out = await launch(a, d.id);
    expect(out.scheduled).toBe(true);
    expect(await camp(d.id)).toMatchObject({ status: 'SCHEDULED' });
    expect(await countRec(d.id)).toBe(0);
    await minute(30 * 60_000);
    expect(env.sim.sent).toHaveLength(0);
    await minute(95 * 60_000);
    expect(env.sim.sent).toHaveLength(5);
    expect(await camp(d.id)).toMatchObject({ status: 'COMPLETED', sentCount: 5 });
  });
});

describe('S6 · Pausar, reanudar y cancelar (RF-5.6)', () => {
  it('pausar y reanudar no duplica ni pierde envíos, y un destinatario en vuelo vuelve a la cola', async () => {
    const a = await admin();
    await mkContacts(30);
    const d = await draft(a, { rate: 10 });
    await launch(a, d.id);
    expect(env.sim.sent).toHaveLength(10);
    expect((await a.post(`/api/campaigns/${d.id}/pause`)).body.campaign.status).toBe('PAUSED');
    await minute();
    expect(env.sim.sent).toHaveLength(10);
    // uno quedó reclamado (SENDING) pero sin mensaje cuando se pausó
    const one = await prisma().campaignRecipient.findFirstOrThrow({ where: { campaignId: d.id, status: 'QUEUED' } });
    await prisma().campaignRecipient.update({ where: { id: one.id }, data: { status: 'SENDING' } });
    await runner.sendOne(one.id); // el worker lo encuentra con la campaña pausada: lo devuelve a la cola
    expect((await prisma().campaignRecipient.findUniqueOrThrow({ where: { id: one.id } })).status).toBe('QUEUED');
    await prisma().campaignRecipient.update({ where: { id: one.id }, data: { status: 'SENDING' } });
    expect((await a.post(`/api/campaigns/${d.id}/resume`)).status).toBe(201);
    expect((await prisma().campaignRecipient.findUniqueOrThrow({ where: { id: one.id } })).status).not.toBe('SENDING');
    await minute();
    await minute();
    expect(env.sim.sent).toHaveLength(30);
    expect(new Set(env.sim.sent.map((s) => s.body.to)).size).toBe(30);
    expect(await prisma().message.count({ where: { campaignId: d.id } })).toBe(30);
    expect((await camp(d.id)).status).toBe('COMPLETED');
    // un reenvío del mismo destinatario (job duplicado) no crea otro mensaje
    await prisma().campaignRecipient.update({ where: { id: one.id }, data: { status: 'SENDING', messageId: null } });
    await runner.sendOne(one.id);
    expect(env.sim.sent).toHaveLength(30);
    expect(await prisma().message.count({ where: { campaignId: d.id } })).toBe(30);
  });

  it('dos reclamos simultáneos nunca reciben el mismo destinatario', async () => {
    const a = await admin();
    await mkContacts(40);
    const d = await draft(a, { rate: 1 });
    await prisma().campaign.update({ where: { id: d.id }, data: { status: 'DRAFT' } });
    await runner.start(d.id);
    // lo que ya se envió al arrancar no cuenta: reclamamos lo que quede en cola
    const claim = (n: number) => (runner as any).claim(d.id, n, clock.now()) as Promise<string[]>;
    const [x, y, z] = await Promise.all([claim(10), claim(10), claim(10)]);
    const all = [...x, ...y, ...z];
    expect(all.length).toBe(30);
    expect(new Set(all).size).toBe(30);
  });

  it('cancelar: no se envía nada más, lo pendiente se queda sin enviar y el informe cuadra', async () => {
    const a = await admin();
    await mkContacts(20);
    const d = await draft(a, { rate: 5 });
    await launch(a, d.id);
    expect((await a.post(`/api/campaigns/${d.id}/cancel`)).body.campaign.status).toBe('CANCELLED');
    await minute();
    await minute();
    expect(env.sim.sent).toHaveLength(5);
    const rep = (await a.get(`/api/campaigns/${d.id}`)).body;
    expect(rep.funnel.sent).toBe(5);
    // F4c #15: lo que no salió queda SKIPPED «CANCELLED»; el informe no muestra pendientes
    expect(rep.pending).toBe(0);
    expect(rep.skipReasons).toEqual([{ reason: 'CANCELLED', title: expect.any(String), count: 15 }]);
    expect(rep.funnel.sent).toBe(rep.campaign.totalRecipients);
    expect((await a.post(`/api/campaigns/${d.id}/resume`)).status).toBe(409);
    expect((await a.post(`/api/campaigns/${d.id}/cancel`)).status).toBe(409);
  });
});

describe('S6 · Paradas automáticas', () => {
  it('132015 (plantilla pausada): para esa campaña con motivo en español y no envía más', async () => {
    const a = await admin();
    await mkContacts(20);
    const d = await draft(a, { rate: 5 });
    const other = await draft(a, { name: 'Otra', templateId: (await prisma().template.create({ data: { name: 'otra', displayName: 'Otra', language: 'es', category: 'MARKETING', status: 'APPROVED', hasOptOutButton: true, components: [{ type: 'BODY', text: 'Hola {{1}}' }, { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'No recibir más' }] }] } })).id });
    env.sim.failNext({ code: 132015, path: 'messages' });
    await launch(a, d.id);
    const c = await camp(d.id);
    expect(c.status).toBe('PAUSED');
    expect(c.stopReason).toMatch(/Parada automática/);
    expect(c.stopReason).toMatch(/pausada/i);
    expect(c.stopReason).toContain('132015');
    const sentBefore = env.sim.sent.length;
    await minute();
    expect(env.sim.sent).toHaveLength(sentBefore);
    expect((await prisma().campaignRecipient.findMany({ where: { campaignId: d.id, status: 'FAILED' } })).map((r) => r.errorCode)).toEqual([132015]);
    expect((await camp(other.id)).status).toBe('DRAFT'); // otra campaña no se toca
    // reanudar con la plantilla aún pausada en Meta no se permite
    await prisma().template.update({ where: { id: c.templateId }, data: { status: 'PAUSED' } });
    expect((await a.post(`/api/campaigns/${d.id}/resume`)).status).toBe(409);
  });

  it('132001 (plantilla inexistente): la campaña pasa a FALLIDA', async () => {
    const a = await admin();
    await mkContacts(6);
    const d = await draft(a, { rate: 3 });
    env.sim.failNext({ code: 132001, path: 'messages' });
    await launch(a, d.id);
    expect(await camp(d.id)).toMatchObject({ status: 'FAILED' });
    expect((await camp(d.id)).stopReason).toContain('132001');
  });

  it('368 (cuenta restringida): para TODAS las campañas en curso', async () => {
    const a = await admin();
    await mkContacts(30);
    const d1 = await draft(a, { rate: 5, name: 'Una' });
    const tpl2 = await prisma().template.create({ data: { name: 'dos', displayName: 'Dos', language: 'es', category: 'MARKETING', status: 'APPROVED', hasOptOutButton: true, components: [{ type: 'BODY', text: 'Hola {{1}}' }, { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'No recibir más' }] }] } });
    const d2 = await a.post('/api/campaigns', { name: 'Dos', templateId: tpl2.id, variableMapping: { 'body.1': { field: 'firstName', fallback: 'cliente' } }, audience: { allContacts: true }, ratePerMinute: 5 });
    await launch(a, d1.id);
    await launch(a, d2.body.id);
    expect((await camp(d1.id)).status).toBe('RUNNING');
    expect((await camp(d2.body.id)).status).toBe('RUNNING');
    env.sim.failNext({ code: 368, path: 'messages' });
    await minute();
    expect((await camp(d1.id)).status).toBe('PAUSED');
    expect((await camp(d2.body.id)).status).toBe('PAUSED');
    expect((await camp(d1.id)).stopReason).toContain('368');
    const sent = env.sim.sent.length;
    await minute();
    expect(env.sim.sent).toHaveLength(sent);
  });

  it('calidad en rojo y plantilla pausada/desactivada también paran; calidad verde no', async () => {
    const a = await admin();
    await mkContacts(20);
    const events = env.t.app.get(DomainEvents);
    const d = await draft(a, { rate: 5 });
    await launch(a, d.id);
    await events.emit('phone.quality', { qualityRating: 'GREEN', messagingLimit: null, phoneStatus: null, event: 'UPGRADE', source: 'WEBHOOK', raw: {} });
    expect((await camp(d.id)).status).toBe('RUNNING');
    await events.emit('phone.quality', { qualityRating: 'RED', messagingLimit: null, phoneStatus: null, event: 'DOWNGRADE', source: 'WEBHOOK', raw: {} });
    expect(await camp(d.id)).toMatchObject({ status: 'PAUSED' });
    expect((await camp(d.id)).stopReason).toMatch(/calidad/i);

    await prisma().campaign.update({ where: { id: d.id }, data: { status: 'RUNNING', stopReason: null } });
    await events.emit('template.status', { templateId: (await camp(d.id)).templateId, name: 'campana_imagen', status: 'DISABLED', previousStatus: 'APPROVED', reason: null });
    expect(await camp(d.id)).toMatchObject({ status: 'PAUSED' });
    expect((await camp(d.id)).stopReason).toMatch(/plantilla/i);
  });
});

describe('S6 · Seguimiento, contadores e informe (RF-5.7, RF-5.9)', () => {
  async function sentCampaign(n: number, rate = 100) {
    const a = await admin();
    const cs = await mkContacts(n);
    const d = await draft(a, { rate });
    await launch(a, d.id);
    const msgs = await prisma().message.findMany({ where: { campaignId: d.id }, include: { conversation: { include: { contact: true } } }, orderBy: { createdAt: 'asc' } });
    return { a, cs, d, msgs };
  }
  const mkt = { billable: true, pricing_model: 'PMP', category: 'marketing' };

  it('los contadores se recalculan desde los destinatarios, también con estados fuera de orden', async () => {
    const { a, d, msgs } = await sentCampaign(5);
    // contador manipulado: el siguiente evento lo corrige (nunca se incrementa)
    await prisma().campaign.update({ where: { id: d.id }, data: { sentCount: 999, deliveredCount: 999 } });
    // «leído» llega ANTES que «entregado»
    await env.sim.sendStatus({ wamid: msgs[0]!.wamid!, status: 'read', pricing: mkt });
    let c = await camp(d.id);
    expect(c).toMatchObject({ sentCount: 5, deliveredCount: 1, readCount: 1 });
    await env.sim.sendStatus({ wamid: msgs[0]!.wamid!, status: 'delivered', pricing: mkt });
    c = await camp(d.id);
    expect(c).toMatchObject({ sentCount: 5, deliveredCount: 1, readCount: 1 });
    const r0 = await prisma().campaignRecipient.findFirstOrThrow({ where: { messageId: msgs[0]!.id } });
    expect(r0.status).toBe('READ'); // no retrocede a «entregado»
    expect(r0.deliveredAt).toBeTruthy();
    for (const m of msgs.slice(1, 4)) await env.sim.sendStatus({ wamid: m.wamid!, status: 'delivered', pricing: mkt });
    await env.sim.sendStatus({ wamid: msgs[1]!.wamid!, status: 'read', pricing: mkt });
    c = await camp(d.id);
    expect(c).toMatchObject({ sentCount: 5, deliveredCount: 4, readCount: 2, failedCount: 0 });
    // duplicado del mismo estado: nada cambia
    await env.sim.sendStatus({ wamid: msgs[1]!.wamid!, status: 'read', pricing: mkt, repeat: 2 });
    expect(await camp(d.id)).toMatchObject({ deliveredCount: 4, readCount: 2 });
    const rep = (await a.get(`/api/campaigns/${d.id}`)).body;
    expect(rep.funnel).toEqual({ sent: 5, delivered: 4, read: 2, replied: 0 });
  });

  it('un fallo de Meta (131049) no se reintenta y aparece agrupado con motivo en español', async () => {
    const a = await admin();
    await mkContacts(6);
    const d = await draft(a, { rate: 100 });
    env.sim.failNext({ code: 131049, count: 2, path: 'messages' });
    await launch(a, d.id);
    expect(env.t.jobs.inlineErrors).toHaveLength(0);
    const c = await camp(d.id);
    expect(c).toMatchObject({ status: 'COMPLETED', failedCount: 2, sentCount: 4, totalRecipients: 6 });
    const rep = (await a.get(`/api/campaigns/${d.id}`)).body;
    expect(rep.failureReasons).toHaveLength(1);
    expect(rep.failureReasons[0]).toMatchObject({ code: 131049, count: 2 });
    expect(rep.failureReasons[0].title).toMatch(/[a-záéíóú]{4}/);
    const failedTab = (await a.get(`/api/campaigns/${d.id}/recipients?tab=failed`)).body;
    expect(failedTab.total).toBe(2);
    expect(failedTab.items[0]).toMatchObject({ status: 'FAILED', errorCode: 131049 });
    expect(failedTab.tabCounts).toMatchObject({ all: 6, failed: 2 });
  });

  it('respuestas (72 h), conversación marcada con la campaña y bajas (botón y 131050) en el informe', async () => {
    const { a, cs, d, msgs } = await sentCampaign(4);
    const phone = (i: number) => cs.find((c) => c.id === msgs[i]!.conversation.contactId)!.waId!;
    await env.sim.sendInbound({ from: phone(0), type: 'text', text: { body: 'Me interesa' } });
    await env.sim.sendInbound({ from: phone(0), type: 'text', text: { body: 'Otra vez' } }); // la segunda no cuenta
    let c = await camp(d.id);
    expect(c.repliedCount).toBe(1);
    const conv0 = await prisma().conversation.findUniqueOrThrow({ where: { id: msgs[0]!.conversationId } });
    expect(conv0.lastCampaignId).toBe(d.id);
    // baja por botón: no cuenta como respuesta pero sí como baja
    await env.sim.sendInbound({ from: phone(1), type: 'button', button: { text: 'No recibir más', payload: 'OPT_OUT' } });
    c = await camp(d.id);
    expect(c).toMatchObject({ repliedCount: 1, optOutCount: 1 });
    expect((await prisma().contact.findUniqueOrThrow({ where: { id: msgs[1]!.conversation.contactId } })).consentStatus).toBe('REVOKED');
    // respuesta fuera de las 72 h: no cuenta
    await prisma().campaignRecipient.updateMany({ where: { messageId: msgs[2]!.id }, data: { sentAt: new Date(Date.now() - 80 * 3600_000) } });
    await env.sim.sendInbound({ from: phone(2), type: 'text', text: { body: 'tarde' } });
    expect((await camp(d.id)).repliedCount).toBe(1);

    const rep = (await a.get(`/api/campaigns/${d.id}`)).body;
    expect(rep.funnel.replied).toBe(1);
    expect(rep.campaign.optOutCount).toBe(1);
    const replied = (await a.get(`/api/campaigns/${d.id}/recipients?tab=replied`)).body;
    expect(replied.total).toBe(1);
    expect(replied.items[0].conversationId).toBe(msgs[0]!.conversationId);
    const q = (await a.get(`/api/campaigns/${d.id}/recipients?q=${encodeURIComponent(cs.find((x) => x.waId === phone(3))!.firstName!)}`)).body;
    expect(q.items.map((i: any) => i.contactId)).toEqual([msgs[3]!.conversation.contactId]);
  });

  it('una baja por 131050 durante la campaña marca la baja y el contacto no vuelve a recibir', async () => {
    const a = await admin();
    const cs = await mkContacts(3);
    const d = await draft(a, { rate: 100 });
    env.sim.failNext({ code: 131050, path: 'messages' });
    await launch(a, d.id);
    const rec = await prisma().campaignRecipient.findFirstOrThrow({ where: { campaignId: d.id, errorCode: 131050 } });
    expect(rec.status).toBe('FAILED');
    expect(rec.optedOutAt).toBeTruthy();
    expect((await prisma().contact.findUniqueOrThrow({ where: { id: rec.contactId } })).consentStatus).toBe('REVOKED');
    expect(await camp(d.id)).toMatchObject({ optOutCount: 1, failedCount: 1, sentCount: 2 });
    // nueva campaña: ese contacto queda excluido
    const d2 = await draft(a, { name: 'Segunda' });
    await launch(a, d2.id);
    expect(env.sim.sent.filter((s) => s.body.to === cs.find((c) => c.id === rec.contactId)!.waId)).toHaveLength(0);
  });

  it('coste real con el precio de Meta (computeCost) frente al estimado', async () => {
    const { a, d, msgs } = await sentCampaign(6);
    for (const m of msgs.slice(0, 4)) await env.sim.sendStatus({ wamid: m.wamid!, status: 'delivered', pricing: mkt });
    await env.sim.sendStatus({ wamid: msgs[4]!.wamid!, status: 'delivered', pricing: { billable: false, pricing_model: 'PMP', category: 'marketing' } });
    const rep = (await a.get(`/api/campaigns/${d.id}`)).body;
    expect(rep.cost.billableMessages).toBe(4);
    expect(rep.cost.actual).toBeCloseTo(4 * 0.0585, 4);
    expect(rep.cost.estimated).toBeCloseTo(6 * 0.0585, 4);
    expect(rep.cost.byCategory.marketing).toMatchObject({ count: 4 });
    expect(rep.campaign.actualCost).toBeCloseTo(0.234, 4);
    expect(rep.campaign.currency).toBe('EUR');
  });

  it('exporta CSV con «;» y BOM (solo administración) y la analítica compara campañas', async () => {
    const { a, d, msgs } = await sentCampaign(4);
    for (const m of msgs.slice(0, 3)) await env.sim.sendStatus({ wamid: m.wamid!, status: 'delivered', pricing: mkt });
    await env.sim.sendStatus({ wamid: msgs[0]!.wamid!, status: 'read', pricing: mkt });
    const csv = await a.get(`/api/campaigns/${d.id}/export`);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.headers['content-disposition']).toMatch(/attachment/);
    const text = csv.text;
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).trim().split('\r\n');
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe('Nombre;Teléfono;Estado;Motivo de omisión;Error;Enviado;Entregado;Leído;Respondió;Se dio de baja');
    expect(lines.filter((l) => l.includes(';READ;'))).toHaveLength(1);
    expect((await (await agent()).get(`/api/campaigns/${d.id}/export`)).status).toBe(403);
    expect(await prisma().auditLog.count({ where: { action: 'export_campaign' } })).toBe(1);

    const an = (await a.get('/api/campaigns/analytics')).body;
    expect(an).toHaveLength(1);
    expect(an[0]).toMatchObject({ campaignId: d.id, recipients: 4, deliveredPct: 75, readPct: 25, repliedPct: 0, optOutPct: 0 });
  });
});

describe('S6 · Prueba, borradores y permisos', () => {
  it('envío de prueba a un número: crea contacto y conversación, envía y no cuenta en la campaña', async () => {
    const a = await admin();
    const d = await draft(a);
    const res = await a.post(`/api/campaigns/${d.id}/test`, { phone: '617 49 82 22' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(env.sim.sent).toHaveLength(1);
    expect(env.sim.sent[0]!.body.to).toBe('34617498222');
    const m = await prisma().message.findFirstOrThrow({ where: { id: res.body.messageId } });
    expect(m.campaignId).toBeNull();
    expect(await countRec(d.id)).toBe(0);
    expect(await camp(d.id)).toMatchObject({ status: 'DRAFT', sentCount: 0, totalRecipients: 0 });
    expect(await prisma().auditLog.count({ where: { action: 'test_campaign' } })).toBe(1);
    expect((await a.post(`/api/campaigns/${d.id}/test`, { phone: '12' })).status).toBe(400);
    // una prueba a un número dado de baja no se envía
    await prisma().contact.update({ where: { phoneE164: '+34617498222' }, data: { consentStatus: 'REVOKED' } });
    expect((await a.post(`/api/campaigns/${d.id}/test`, { phone: '617498222' })).status).toBe(409);
    expect(env.sim.sent).toHaveLength(1);
  });

  it('el agente prepara borradores (crear, editar, duplicar, ver) pero no lanza, pausa, prueba, exporta ni borra', async () => {
    const ag = await agent();
    const a = await admin();
    await mkContacts(3);
    const tpl = await seedTemplate(env.t, { header: false });
    const body = { name: 'Borrador de Cristina', templateId: tpl.id, variableMapping: MAPPING, audience: { allContacts: true } };
    const created = await ag.post('/api/campaigns', body);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: 'DRAFT', totalRecipients: 3, templateName: 'Campaña con imagen' });
    const id = created.body.id;
    expect((await ag.patch(`/api/campaigns/${id}`, { ...body, name: 'Editado' })).body.name).toBe('Editado');
    expect((await ag.get('/api/campaigns')).body.map((c: any) => c.id)).toContain(id);
    expect((await ag.get(`/api/campaigns/${id}`)).status).toBe(200);
    expect((await ag.post(`/api/campaigns/${id}/duplicate`)).body).toMatchObject({ status: 'DRAFT', name: 'Editado (copia)' });
    expect((await ag.post('/api/campaigns/audience-count', { audience: { allContacts: true } })).status).toBe(201);
    for (const p of ['launch', 'pause', 'resume', 'cancel', 'test']) expect((await ag.post(`/api/campaigns/${id}/${p}`, { phone: '617498222' })).status, p).toBe(403);
    expect((await ag.del(`/api/campaigns/${id}`)).status).toBe(403);
    expect(env.sim.sent).toHaveLength(0);
    expect((await camp(id)).status).toBe('DRAFT');
    // la administradora sí puede, y solo borra borradores
    expect((await a.del(`/api/campaigns/${id}`)).status).toBe(200);
    expect(await prisma().auditLog.count({ where: { action: 'delete_campaign' } })).toBe(1);
  });

  it('solo plantillas de marketing aprobadas con botón «No recibir más»; variables y cabecera obligatorias', async () => {
    const a = await admin();
    await mkContacts(2);
    const noBtn = await prisma().template.create({ data: { name: 'sin_baja', language: 'es', category: 'MARKETING', status: 'APPROVED', hasOptOutButton: false, components: [{ type: 'BODY', text: 'Hola' }] } });
    const pending = await seedTemplate(env.t, { status: 'PENDING' });
    for (const templateId of [noBtn.id, pending.id]) {
      expect((await a.post('/api/campaigns', { name: 'x', templateId, audience: { allContacts: true } })).status).toBe(400);
    }
    const withHeader = await prisma().template.create({ data: { name: 'con_cab', language: 'es', category: 'MARKETING', status: 'APPROVED', hasOptOutButton: true, components: [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'Hola {{1}}' }, { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'No recibir más' }] }] } });
    const base = { name: 'Con cabecera', templateId: withHeader.id, audience: { allContacts: true } };
    // sin variables mapeadas
    let d = await a.post('/api/campaigns', base);
    expect((await a.post(`/api/campaigns/${d.body.id}/launch`, {})).body.message).toMatch(/body\.1/);
    // sin imagen de cabecera
    d = await a.post('/api/campaigns', { ...base, variableMapping: { 'body.1': { field: 'firstName', fallback: 'cliente' } } });
    expect((await a.post(`/api/campaigns/${d.body.id}/launch`, {})).body.message).toMatch(/cabecera/);
    // con imagen: se lanza y la cabecera viaja en cada mensaje
    const file = await env.t.app.get(MediaService).storeBuffer(PNG_1X1, 'image/png', 'promo.png', 'UPLOAD');
    d = await a.post('/api/campaigns', { ...base, variableMapping: { 'body.1': { field: 'firstName', fallback: 'cliente' } }, headerMediaFileId: file.id });
    expect((await a.post(`/api/campaigns/${d.body.id}/launch`, {})).status).toBe(201);
    expect(env.sim.sent.filter((s) => s.path.includes('messages'))).toHaveLength(2);
    expect(env.sim.sent[0]!.body.template.components[0]).toMatchObject({ type: 'header', parameters: [{ type: 'image' }] });
  });

  it('no se lanza una audiencia vacía; un borrador lanzado no se puede editar ni borrar; variable sin dato usa el respaldo', async () => {
    const a = await admin();
    const tpl = await seedTemplate(env.t, { header: false });
    const none = await a.post('/api/campaigns', { name: 'Vacía', templateId: tpl.id, variableMapping: MAPPING, audience: {} });
    expect((await a.post(`/api/campaigns/${none.body.id}/launch`, {})).status).toBe(400);
    await mkContacts(2, { firstName: null });
    const d = await draft(a, { templateId: tpl.id });
    await launch(a, d.id);
    const body = env.sim.sent[0]!.body.template.components.find((c: any) => c.type === 'body');
    expect(body.parameters[0].text).toBe('cliente');
    const patch = await a.patch(`/api/campaigns/${d.id}`, { name: 'x', templateId: tpl.id, variableMapping: MAPPING, audience: { allContacts: true } });
    expect(patch.status).toBe(409);
    expect((await a.del(`/api/campaigns/${d.id}`)).status).toBe(409);
    expect((await a.post(`/api/campaigns/${d.id}/launch`, {})).status).toBe(409);
    expect(await prisma().auditLog.count({ where: { action: 'launch_campaign' } })).toBe(1);
  });
});
