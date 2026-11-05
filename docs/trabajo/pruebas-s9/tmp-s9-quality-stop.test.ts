/**
 * S9 · Prueba TEMPORAL: FLAGGED no para campañas; una programada arranca con la calidad en ROJO.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createWaTestEnv, seedTemplate, type WaTestEnv } from './meta-simulator/harness';
import { CampaignRunnerService } from '../src/modules/campaigns/campaign-runner.service';
import { QualityService } from '../src/modules/quality/quality.service';

let env: WaTestEnv;
beforeAll(async () => {
  env = await createWaTestEnv();
});
afterAll(async () => env.close());
beforeEach(async () => {
  await env.t.reset();
  env.clear();
});

async function campaign(status: 'RUNNING' | 'SCHEDULED') {
  const tpl = await seedTemplate(env.t, { header: false });
  const user = await env.t.prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
  await env.t.prisma.contact.create({ data: { phoneE164: '+34600999001', waId: '34600999001', firstName: 'A' } });
  return env.t.prisma.campaign.create({
    data: {
      name: 'C', templateId: tpl.id, createdById: user.id, status,
      variableMapping: { 'body.1': { field: 'firstName', fallback: 'x' }, 'button.0': { text: 'x' } },
      audience: { includeLabelIds: [], excludeLabelIds: [], allContacts: true },
      scheduledAt: status === 'SCHEDULED' ? new Date(Date.now() - 60_000) : null,
      startedAt: status === 'RUNNING' ? new Date() : null,
    },
  });
}

describe('S9 · tmp calidad', () => {
  it('H9: el número marcado (FLAGGED) no pausa una campaña en curso', async () => {
    const c = await campaign('RUNNING');
    await env.sim.sendPhoneQuality({ event: 'FLAGGED' });
    expect((await env.t.prisma.campaign.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('RUNNING');
    expect((await env.t.prisma.alert.findMany({ where: { resolvedAt: null } })).map((a) => a.kind)).toContain('phone_flagged');
  });

  it('H10: con la calidad en ROJO, una campaña programada arranca igualmente', async () => {
    await env.t.app.get(QualityService).applySnapshot({ qualityRating: 'RED', messagingLimit: 'TIER_2K', phoneStatus: 'CONNECTED', source: 'POLL', event: null, raw: {} });
    const c = await campaign('SCHEDULED');
    await env.t.app.get(CampaignRunnerService).tick();
    expect((await env.t.prisma.campaign.findUniqueOrThrow({ where: { id: c.id } })).status).not.toBe('SCHEDULED');
    // siguiente minuto: envía con el número en ROJO
    const runner = env.t.app.get(CampaignRunnerService) as any;
    runner.lastDispatch.clear();
    await runner.tick();
    const recips = await env.t.prisma.campaignRecipient.findMany({ where: { campaignId: c.id } });
    expect(recips.map((r) => r.status)).toEqual(['SENT']);
  });
});
