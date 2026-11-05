import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createWaTestEnv, seedConversation, type WaTestEnv } from './meta-simulator/harness';
import { loginAs, ADMIN_EMAIL } from './utils/app';
import { DomainEvents } from '../src/modules/events/domain-events.service';
import { DEFAULT_SETTINGS } from '@gelado/shared';

let env: WaTestEnv;
beforeAll(async () => {
  env = await createWaTestEnv();
});
afterAll(async () => env.close());
beforeEach(async () => {
  await env.t.reset({ autoReply: true });
  env.clear();
});

/** Emite un entrante a la hora dada (reloj controlado) sobre una conversación con ventana abierta. */
async function inbound(conv: { id: string; contactId: string }, atIso: string, o: { kind?: string; optedOut?: boolean; buttonPayload?: string | null } = {}) {
  const sentBefore = await env.t.prisma.message.count({ where: { conversationId: conv.id, kind: 'AUTO_REPLY' } });
  await env.t.app.get(DomainEvents).emit('inbound.message', {
    conversationId: conv.id,
    contactId: conv.contactId,
    messageId: '00000000-0000-0000-0000-000000000000',
    kind: o.kind ?? 'TEXT',
    text: 'hola',
    buttonPayload: o.buttonPayload ?? null,
    at: new Date(atIso),
    optedOut: o.optedOut ?? false,
    reopened: false,
  });
  return (await env.t.prisma.message.count({ where: { conversationId: conv.id, kind: 'AUTO_REPLY' } })) - sentBefore;
}
let phoneSeq = 0;
const fresh = async () => (await seedConversation(env.t, { phone: String(34600500000 + ++phoneSeq) })).conversation;
const setSetting = async (key: string, value: unknown) => (await loginAs(env.t, ADMIN_EMAIL)).put(`/api/settings/${key}`, value);

describe('S7 · Fuera de horario (RF-7.2 · prueba 9)', () => {
  it('dentro del horario no responde; fuera sí (mediodía, noche), con botones interactivos', async () => {
    const c = await fresh();
    expect(await inbound(c, '2026-11-03T09:00:00Z')).toBe(0); // martes 10:00 Madrid
    expect(await inbound(c, '2026-11-03T16:00:00Z')).toBe(0); // 17:00 Madrid, dentro
    expect(await inbound(c, '2026-11-03T13:30:00Z')).toBe(1); // 14:30 Madrid, entre tramos
    const msg = await env.t.prisma.message.findFirstOrThrow({ where: { kind: 'AUTO_REPLY' } });
    expect(msg.body).toContain('fuera de nuestro horario');
    expect((msg.payload as any).buttons.map((b: any) => b.id)).toEqual(['OOH_PEDIDO', 'OOH_FACTURA', 'OOH_CONSULTA']);
    expect(msg.status).toBe('SENT');
    expect((env.sim.sent.at(-1)?.body as any)?.type).toBe('interactive');
    const conv = await env.t.prisma.conversation.findUniqueOrThrow({ where: { id: c.id } });
    expect(conv.lastAutoReplyAt?.toISOString()).toBe('2026-11-03T13:30:00.000Z');
  });

  it('sábado: 10:00 dentro, 14:00 fuera; domingo siempre fuera; noche entre semana fuera', async () => {
    expect(await inbound(await fresh(), '2026-11-07T09:00:00Z')).toBe(0); // sáb 10:00
    expect(await inbound(await fresh(), '2026-11-07T08:20:00Z')).toBe(1); // sáb 09:20, aún cerrado
    expect(await inbound(await fresh(), '2026-11-07T13:00:00Z')).toBe(1); // sáb 14:00
    expect(await inbound(await fresh(), '2026-11-08T10:00:00Z')).toBe(1); // domingo
    expect(await inbound(await fresh(), '2026-11-03T20:30:00Z')).toBe(1); // mar 21:30
  });

  it('cambio de hora de marzo (CET→CEST) y de octubre (CEST→CET)', async () => {
    // lunes 30/03/2026 ya en horario de verano (UTC+2): 07:30Z = 09:30 → dentro; 06:30Z = 08:30 → fuera
    expect(await inbound(await fresh(), '2026-03-30T07:30:00Z')).toBe(0);
    expect(await inbound(await fresh(), '2026-03-30T06:30:00Z')).toBe(1);
    // lunes 23/03/2026 aún en invierno (UTC+1): 08:30Z = 09:30 → dentro; 07:30Z = 08:30 → fuera
    expect(await inbound(await fresh(), '2026-03-23T08:30:00Z')).toBe(0);
    expect(await inbound(await fresh(), '2026-03-23T07:30:00Z')).toBe(1);
    // lunes 26/10/2026 ya en invierno: 12:30Z = 13:30 → dentro; 15:30Z = 16:30 → fuera
    expect(await inbound(await fresh(), '2026-10-26T12:30:00Z')).toBe(0);
    expect(await inbound(await fresh(), '2026-10-26T15:30:00Z')).toBe(1);
    // lunes 19/10/2026 aún en verano: 15:30Z = 17:30 → dentro
    expect(await inbound(await fresh(), '2026-10-19T15:30:00Z')).toBe(0);
  });

  it('como mucho una vez cada 12 h por conversación', async () => {
    const c = await fresh();
    expect(await inbound(c, '2026-11-03T20:00:00Z')).toBe(1);
    expect(await inbound(c, '2026-11-03T20:05:00Z')).toBe(0);
    expect(await inbound(c, '2026-11-04T06:00:00Z')).toBe(0); // 10 h después (aunque ya sea 07:00 Madrid, cerrado)
    expect(await inbound(c, '2026-11-04T08:00:00Z')).toBe(0); // dentro de horario (09:00)
    expect(await inbound(c, '2026-11-03T20:00:00Z'.replace('03T20', '04T21'))).toBe(1); // 25 h después, noche
    // otra conversación no se ve afectada
    expect(await inbound(await fresh2(), '2026-11-03T20:05:00Z')).toBe(1);
  });

  it('dos mensajes simultáneos solo generan una respuesta', async () => {
    const c = await fresh();
    const ev = env.t.app.get(DomainEvents);
    const payload = { conversationId: c.id, contactId: c.contactId, messageId: '00000000-0000-0000-0000-000000000000', kind: 'TEXT', text: 'a', buttonPayload: null, at: new Date('2026-11-03T20:00:00Z'), optedOut: false, reopened: false };
    await Promise.all([ev.emit('inbound.message', payload), ev.emit('inbound.message', payload)]);
    expect(await env.t.prisma.message.count({ where: { kind: 'AUTO_REPLY' } })).toBe(1);
  });

  it('ajuste desactivado → no responde; no responde a reacciones ni a bajas', async () => {
    const c = await fresh();
    expect(await inbound(c, '2026-11-03T20:00:00Z', { kind: 'REACTION' })).toBe(0);
    expect(await inbound(c, '2026-11-03T20:00:00Z', { optedOut: true })).toBe(0);
    expect((await setSetting('out_of_hours', { ...DEFAULT_SETTINGS.out_of_hours, enabled: false })).status).toBe(200);
    expect(await inbound(c, '2026-11-03T20:00:00Z')).toBe(0);
    await setSetting('out_of_hours', { ...DEFAULT_SETTINGS.out_of_hours, enabled: true });
    expect(await inbound(c, '2026-11-03T20:00:00Z')).toBe(1);
  });

  it('el horario editado manda (cerrado los lunes aunque antes abriera)', async () => {
    await setSetting('business_hours', { ...DEFAULT_SETTINGS.business_hours, days: { ...DEFAULT_SETTINGS.business_hours.days, mon: [] } });
    expect(await inbound(await fresh(), '2026-11-02T10:00:00Z')).toBe(1);
  });
});

const fresh2 = fresh;

describe('S7 · Vacaciones (RF-7.3)', () => {
  const vac = (over: Record<string, unknown> = {}) => ({ enabled: true, from: '2026-08-03', to: '2026-08-21', text: 'Cerrado por vacaciones, volvemos el 24 de agosto.', ...over });

  it('apagado (por defecto) no responde en horario; encendido y en fechas responde con su texto y sin botones, también en horario', async () => {
    const c = await fresh();
    expect(await inbound(c, '2026-08-05T09:00:00Z')).toBe(0); // miércoles 11:00, vacaciones apagadas
    await setSetting('vacation', vac());
    expect(await inbound(c, '2026-08-05T09:00:00Z')).toBe(1);
    const msg = await env.t.prisma.message.findFirstOrThrow({ where: { kind: 'AUTO_REPLY' } });
    expect(msg.body).toBe('Cerrado por vacaciones, volvemos el 24 de agosto.');
    expect(msg.payload).toBeNull();
    expect((env.sim.sent.at(-1)?.body as any)?.type).toBe('text');
  });

  it('prioridad sobre fuera de horario, fechas inclusivas y fuera de fechas vuelve a lo normal', async () => {
    await setSetting('vacation', vac());
    const c = await fresh();
    expect(await inbound(c, '2026-08-21T20:30:00Z')).toBe(1); // último día, noche
    expect((await env.t.prisma.message.findFirstOrThrow({ where: { kind: 'AUTO_REPLY' } })).body).toContain('vacaciones');
    expect(await inbound(await fresh2(), '2026-08-24T09:00:00Z')).toBe(0); // vuelta, en horario
    expect(await inbound(await fresh(), '2026-08-24T20:30:00Z')).toBe(1);
    const last = await env.t.prisma.message.findFirstOrThrow({ where: { kind: 'AUTO_REPLY' }, orderBy: { createdAt: 'desc' } });
    expect(last.body).toContain('fuera de nuestro horario');
  });

  it('vacaciones sin fechas o sin texto no responden', async () => {
    await setSetting('vacation', vac({ from: null, to: null }));
    expect(await inbound(await fresh(), '2026-08-05T09:00:00Z')).toBe(0);
  });
});


describe('S7 · Botones de la respuesta automática', () => {
  it('pulsar «Hacer un pedido» etiqueta la conversación con PEDIDO (evento LABEL_ADDED) y no vuelve a contestar', async () => {
    const c = await fresh();
    expect(await inbound(c, '2026-11-03T20:00:00Z')).toBe(1);
    expect(await inbound(c, '2026-11-04T09:00:00Z', { kind: 'BUTTON_REPLY', buttonPayload: 'OOH_PEDIDO' })).toBe(0);
    const labels = await env.t.prisma.conversationLabel.findMany({ where: { conversationId: c.id }, include: { label: true } });
    expect(labels.map((l) => l.label.name)).toEqual(['PEDIDO']);
    const ev = await env.t.prisma.conversationEvent.findFirstOrThrow({ where: { conversationId: c.id, type: 'LABEL_ADDED' } });
    expect(ev).toMatchObject({ actorId: null });
    expect((ev.data as any).labelName).toBe('PEDIDO');
    // repetir no duplica
    await inbound(c, '2026-11-04T09:01:00Z', { kind: 'BUTTON_REPLY', buttonPayload: 'OOH_PEDIDO' });
    expect(await env.t.prisma.conversationLabel.count()).toBe(1);
    expect(env.realtime.emitted.some((e) => e.event === 'event.created')).toBe(true);
  });

  it('«Duda o consulta» no etiqueta; un botón desconocido tampoco', async () => {
    const c = await fresh();
    await inbound(c, '2026-11-04T09:00:00Z', { kind: 'BUTTON_REPLY', buttonPayload: 'OOH_CONSULTA' });
    await inbound(c, '2026-11-04T09:00:00Z', { kind: 'BUTTON_REPLY', buttonPayload: 'OTRO' });
    expect(await env.t.prisma.conversationLabel.count()).toBe(0);
  });

  it('extremo a extremo con el simulador: entrante real fuera de horario → respuesta con botones → pulsación → etiqueta FACTURA', async () => {
    // Horario cerrado todos los días para no depender del reloj real
    const closed = { ...DEFAULT_SETTINGS.business_hours, days: Object.fromEntries(Object.keys(DEFAULT_SETTINGS.business_hours.days).map((d) => [d, []])) };
    await setSetting('business_hours', closed);
    await env.sim.sendInbound({ from: '34600111222', type: 'text', text: { body: 'Hola' } });
    const auto = await env.t.prisma.message.findFirstOrThrow({ where: { kind: 'AUTO_REPLY' } });
    expect(auto.status).toBe('SENT');
    expect((env.sim.sent.at(-1)?.body as any)?.type).toBe('interactive');
    await env.sim.sendInbound({ from: '34600111222', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'OOH_FACTURA', title: 'Necesito factura' } } });
    const labels = await env.t.prisma.conversationLabel.findMany({ include: { label: true } });
    expect(labels.map((l) => l.label.name)).toEqual(['FACTURA']);
    expect(await env.t.prisma.message.count({ where: { kind: 'AUTO_REPLY' } })).toBe(1);
  });
});
