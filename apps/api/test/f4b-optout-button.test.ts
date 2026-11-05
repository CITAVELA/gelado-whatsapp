/**
 * F4b · S9 #1 (crítico): el botón de baja se reconoce por TEXTO EXACTO («No recibir más», sin distinguir tildes ni
 * mayúsculas), nunca por subcadena. «Ver rebajas» no es una baja; la plantilla de marketing siempre lleva el botón real.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { editorToComponents, hasOptOutButton, optOutButtonIndex, isOptOutButtonText, type TemplateComponent } from '@gelado/shared';
import { createWaTestEnv, seedConversation, type WaTestEnv } from './meta-simulator/harness';
import { ADMIN_EMAIL, loginAs } from './utils/app';
import { MessagingService } from '../src/modules/whatsapp/messaging.service';
import { TemplatesService } from '../src/modules/templates/templates.service';

let env: WaTestEnv;
beforeAll(async () => {
  env = await createWaTestEnv();
});
afterAll(async () => env.close());
beforeEach(async () => {
  await env.t.reset();
  env.clear();
});

const editorDto = (buttons: any[], over: Record<string, unknown> = {}) =>
  ({ displayName: 'Rebajas', name: 'rebajas_nov', category: 'MARKETING', language: 'es', header: { format: 'NONE' }, body: 'Llegan las rebajas', bodyExamples: [], buttons, addOptOutButton: true, ...over }) as any;
const qrs = (...texts: string[]): TemplateComponent[] => [{ type: 'BODY', text: 'Hola' }, { type: 'BUTTONS', buttons: texts.map((text) => ({ type: 'QUICK_REPLY' as const, text })) }];

describe('F4b · detector del botón de baja (texto exacto)', () => {
  it.each(['Ver rebajas', 'Bajar catálogo', 'Trabajamos hasta las 8', 'Non-stop', 'Stop', 'Baja', 'No recibir más ofertas de verano', 'Rebaja'])('«%s» NO es un botón de baja', (text) => {
    expect(isOptOutButtonText(text)).toBe(false);
    expect(hasOptOutButton(qrs(text))).toBe(false);
    expect(optOutButtonIndex(qrs(text))).toBe(-1);
  });

  it.each(['No recibir más', 'NO RECIBIR MAS', '  no   recibir  más. ', 'No recibir mas publicidad', 'Darme de baja'])('«%s» sí es un botón de baja', (text) => {
    expect(hasOptOutButton(qrs(text))).toBe(true);
    expect(optOutButtonIndex(qrs('Ver rebajas', text))).toBe(1);
  });

  it('solo cuenta una respuesta rápida (un botón de enlace con el texto no vale)', () => {
    const comps: TemplateComponent[] = [{ type: 'BODY', text: 'Hola' }, { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'No recibir más', url: 'https://gelado.eu' }] }];
    expect(hasOptOutButton(comps)).toBe(false);
  });

  it('S9-H1: el editor añade «No recibir más» aunque haya un botón «Ver rebajas»; el payload de baja va en el botón real', () => {
    const comps = editorToComponents(editorDto([{ type: 'QUICK_REPLY', text: 'Ver rebajas' }]));
    const btns = comps.find((c) => c.type === 'BUTTONS')!.buttons!.map((b) => b.text);
    expect(btns).toEqual(['Ver rebajas', 'No recibir más']);
    expect(hasOptOutButton(comps)).toBe(true);
    expect(optOutButtonIndex(comps)).toBe(1);
  });

  it('el editor no duplica el botón si ya viene exactamente «NO RECIBIR MAS»', () => {
    const comps = editorToComponents(editorDto([{ type: 'QUICK_REPLY', text: 'NO RECIBIR MAS' }]));
    expect(comps.find((c) => c.type === 'BUTTONS')!.buttons!.map((b) => b.text)).toEqual(['NO RECIBIR MAS']);
  });
});

describe('F4b · sincronización, recálculo y duplicado', () => {
  it('la sincronización marca «Ver rebajas» SIN botón de baja y no la deja usar en campañas; «No recibir más» sí', async () => {
    env.sim.templates.set('900', { id: '900', name: 'rebajas', language: 'es', category: 'MARKETING', status: 'APPROVED', quality_score: { score: 'GREEN' }, components: qrs('Ver rebajas') });
    env.sim.templates.set('901', { id: '901', name: 'baja_ok', language: 'es', category: 'MARKETING', status: 'APPROVED', quality_score: { score: 'GREEN' }, components: qrs('Ver rebajas', 'No recibir más') });
    const a = await loginAs(env.t, ADMIN_EMAIL);
    expect((await a.post('/api/templates/sync')).status).toBe(201);
    const list = (await a.get('/api/templates')).body;
    expect(list.find((x: any) => x.name === 'rebajas')).toMatchObject({ hasOptOutButton: false, usableInCampaigns: false });
    expect(list.find((x: any) => x.name === 'baja_ok')).toMatchObject({ hasOptOutButton: true, usableInCampaigns: true });
  });

  it('recalcula hasOptOutButton de las plantillas ya guardadas (marcadas por error con la regla antigua)', async () => {
    const bad = await env.t.prisma.template.create({ data: { name: 'vieja', language: 'es', category: 'MARKETING', status: 'APPROVED', components: qrs('Ver rebajas') as any, hasOptOutButton: true } });
    const good = await env.t.prisma.template.create({ data: { name: 'buena', language: 'es', category: 'MARKETING', status: 'APPROVED', components: qrs('No recibir más') as any, hasOptOutButton: false } });
    const fixed = await env.t.app.get(TemplatesService).recomputeOptOutFlags();
    expect(fixed).toBe(2);
    expect((await env.t.prisma.template.findUniqueOrThrow({ where: { id: bad.id } })).hasOptOutButton).toBe(false);
    expect((await env.t.prisma.template.findUniqueOrThrow({ where: { id: good.id } })).hasOptOutButton).toBe(true);
  });

  it('duplicar conserva los botones legítimos («Ver rebajas») y solo reemplaza el de baja real', async () => {
    const t = await env.t.prisma.template.create({ data: { name: 'rebajas', language: 'es', category: 'MARKETING', status: 'APPROVED', components: qrs('Ver rebajas', 'No recibir más') as any, hasOptOutButton: true } });
    const a = await loginAs(env.t, ADMIN_EMAIL);
    const r = await a.post(`/api/templates/${t.id}/duplicate`);
    expect(r.status).toBe(201);
    expect(r.body.draft.buttons).toEqual([{ type: 'QUICK_REPLY', text: 'Ver rebajas' }]);
    expect(r.body.draft.addOptOutButton).toBe(true);
    expect(r.body.notes.join(' ')).not.toMatch(/Se ha añadido el botón/);

    const t2 = await env.t.prisma.template.create({ data: { name: 'rebajas2', language: 'es', category: 'MARKETING', status: 'APPROVED', components: qrs('Ver rebajas') as any, hasOptOutButton: false } });
    const r2 = await a.post(`/api/templates/${t2.id}/duplicate`);
    expect(r2.body.draft.buttons).toEqual([{ type: 'QUICK_REPLY', text: 'Ver rebajas' }]);
    expect(r2.body.notes.join(' ')).toMatch(/No recibir más/);
  });
});

describe('F4b · pulsar «Ver rebajas» no da de baja (S9-H1b)', () => {
  it('el payload OPT_OUT viaja en «No recibir más»; el botón «Ver rebajas» no lo lleva y su pulsación no revoca', async () => {
    const { conversation, contact } = await seedConversation(env.t, { windowOpen: false });
    const comps = editorToComponents(editorDto([{ type: 'QUICK_REPLY', text: 'Ver rebajas' }]));
    const tpl = await env.t.prisma.template.create({ data: { name: 'rebajas', language: 'es', category: 'MARKETING', status: 'APPROVED', components: comps as any, hasOptOutButton: hasOptOutButton(comps) } });
    await env.t.app.get(MessagingService).sendTemplate(conversation.id, tpl.id, {});
    const sent = env.sim.sent.find((s) => s.body?.type === 'template')!;
    const buttons = (sent.body.template.components as any[]).filter((c) => c.type === 'button');
    expect(buttons).toEqual([{ type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: 'OPT_OUT' }] }]);

    // el cliente pulsa «Ver rebajas» (botón 0, sin payload de baja)
    await env.sim.sendInbound({ from: '34600111222', type: 'button', button: { text: 'Ver rebajas', payload: 'Ver rebajas' } });
    expect((await env.t.prisma.contact.findUniqueOrThrow({ where: { id: contact.id } })).consentStatus).toBe('UNKNOWN');

    // y si pulsa «No recibir más», sí queda de baja
    await env.sim.sendInbound({ from: '34600111222', type: 'button', button: { text: 'No recibir más', payload: 'OPT_OUT' } });
    expect((await env.t.prisma.contact.findUniqueOrThrow({ where: { id: contact.id } })).consentStatus).toBe('REVOKED');
  });
});
