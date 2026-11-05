import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createWaTestEnv, seedTemplate, type WaTestEnv } from './meta-simulator/harness';
import { ADMIN_EMAIL, loginAs } from './utils/app';
import { CampaignClock } from '../src/modules/campaigns/campaigns.clock';
import { CampaignRunnerService } from '../src/modules/campaigns/campaign-runner.service';

/** S12 · P16: los contactos sin teléfono («Sin WhatsApp») se excluyen siempre de las campañas, también en selección manual. */
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

async function mk() {
  const label = await prisma().label.create({ data: { name: 'Lista S12', color: '#2457C5', scope: 'CONTACT' } });
  const withPhone = await Promise.all([0, 1, 2].map((i) => prisma().contact.create({ data: { phoneE164: `+3461700000${i}`, waId: `3461700000${i}`, firstName: `Con${i}` } })));
  const noPhone = await Promise.all([0, 1].map((i) => prisma().contact.create({ data: { phoneE164: null, email: `sin${i}@ejemplo.test`, firstName: `Sin${i}` } })));
  const noPhoneRevoked = await prisma().contact.create({ data: { phoneE164: null, email: 'baja@ejemplo.test', consentStatus: 'REVOKED' } });
  await prisma().contactLabel.createMany({ data: [...withPhone, ...noPhone, noPhoneRevoked].map((c) => ({ contactId: c.id, labelId: label.id })) });
  return { label, withPhone, noPhone, noPhoneRevoked };
}

describe('S12 · campañas: NO_PHONE («Sin WhatsApp»)', () => {
  it('el recuento los desglosa como «sin WhatsApp» y no entran en willReceive (etiqueta, todos y selección manual)', async () => {
    const a = await loginAs(env.t, ADMIN_EMAIL);
    const { label, withPhone, noPhone, noPhoneRevoked } = await mk();
    const byLabel = (await a.post('/api/campaigns/audience-count', { audience: { includeLabelIds: [label.id] } })).body;
    expect(byLabel).toMatchObject({ selected: 6, willReceive: 3, excludedNoPhone: 2, excludedRevoked: 1 }); // el de baja sin teléfono cuenta como baja
    const all = (await a.post('/api/campaigns/audience-count', { audience: { allContacts: true } })).body;
    expect(all).toMatchObject({ willReceive: 3, excludedNoPhone: 2, excludedRevoked: 1 });
    const manual = (await a.post('/api/campaigns/audience-count', { audience: { contactIds: [withPhone[0]!.id, noPhone[0]!.id, noPhone[1]!.id, noPhoneRevoked.id] } })).body;
    expect(manual).toMatchObject({ selected: 4, willReceive: 1, excludedNoPhone: 2, excludedRevoked: 1 });
  });

  it('al lanzar: quedan SKIPPED con skipReason NO_PHONE (teléfono null), no se les envía y el informe dice «Sin WhatsApp»', async () => {
    const a = await loginAs(env.t, ADMIN_EMAIL);
    const { withPhone, noPhone } = await mk();
    const tpl = await seedTemplate(env.t, { header: false });
    const d = await a.post('/api/campaigns', {
      name: 'Mixta', templateId: tpl.id, audience: { contactIds: [...withPhone.map((c) => c.id), ...noPhone.map((c) => c.id)] },
      variableMapping: { 'body.1': { field: 'firstName', fallback: 'cliente' }, 'button.0': { text: 'tintes' } }, ratePerMinute: 20,
    });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    expect((await a.post(`/api/campaigns/${d.body.id}/launch`, {})).status).toBe(201);
    clock.advance(61_000);
    await runner.tick();
    const recs = await prisma().campaignRecipient.findMany({ where: { campaignId: d.body.id } });
    expect(recs).toHaveLength(5);
    const skipped = recs.filter((r) => r.status === 'SKIPPED');
    expect(skipped).toHaveLength(2);
    expect(skipped.every((r) => r.skipReason === 'NO_PHONE' && r.phoneE164 === null)).toBe(true);
    expect(env.sim.sent).toHaveLength(3);
    expect(await prisma().conversation.count({ where: { contactId: { in: noPhone.map((c) => c.id) } } })).toBe(0);
    const rep = (await a.get(`/api/campaigns/${d.body.id}`)).body;
    expect(rep.skipReasons).toEqual([{ reason: 'NO_PHONE', title: 'Sin WhatsApp', count: 2 }]);
    const recipients = (await a.get(`/api/campaigns/${d.body.id}/recipients?tab=skipped`)).body;
    expect(recipients.items.map((r: any) => r.phoneE164)).toEqual([null, null]);
    expect(recipients.items.map((r: any) => r.displayName).sort()).toEqual(['Sin0', 'Sin1']);
    expect((await a.get(`/api/campaigns/${d.body.id}/export`)).status).toBe(200);
  });
});
