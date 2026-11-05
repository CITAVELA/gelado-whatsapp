import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createWaTestEnv, seedConversation, seedTemplate, PNG_1X1, type WaTestEnv } from './meta-simulator/harness';
import { ADMIN_EMAIL, AGENT_EMAIL, loginAs } from './utils/app';
import { InboxActionsService, snoozeUntil } from '../src/modules/inbox/inbox-actions.service';
import { CountsService } from '../src/modules/inbox/counts.service';
import { MediaService } from '../src/modules/media/media.service';
import { WINDOW_CLOSED_MESSAGE } from '../src/modules/whatsapp/messaging.service';

let env: WaTestEnv;
let admin: Awaited<ReturnType<typeof loginAs>>;
let agent: Awaited<ReturnType<typeof loginAs>>;
beforeAll(async () => {
  env = await createWaTestEnv();
});
afterAll(async () => env.close());
beforeEach(async () => {
  await env.t.reset();
  env.clear();
  admin = await loginAs(env.t, ADMIN_EMAIL);
  agent = await loginAs(env.t, AGENT_EMAIL);
});

const prisma = () => env.t.prisma;
let n = 0;
/** contacto + conversación con los campos que se pidan */
async function mk(o: { first?: string | null; last?: string | null; phone?: string; status?: 'OPEN' | 'SNOOZED' | 'DONE'; assigneeId?: string | null; starred?: boolean; unread?: number; at?: Date; snoozedUntil?: Date; windowOpen?: boolean; deleted?: boolean; contactLabel?: string; code?: string } = {}) {
  n++;
  const phone = o.phone ?? `3460000${String(1000 + n)}`;
  const contact = await prisma().contact.create({
    data: { phoneE164: '+' + phone, waId: phone, firstName: o.first === undefined ? `Cliente${n}` : o.first, lastName: o.last ?? null, customerCode: o.code ?? null, deletedAt: o.deleted ? new Date() : null },
  });
  if (o.contactLabel) await prisma().contactLabel.create({ data: { contactId: contact.id, labelId: o.contactLabel } });
  const open = o.windowOpen ?? true;
  const conversation = await prisma().conversation.create({
    data: {
      contactId: contact.id,
      status: o.status ?? 'OPEN',
      assigneeId: o.assigneeId ?? null,
      starred: o.starred ?? false,
      unreadCount: o.unread ?? 0,
      snoozedUntil: o.snoozedUntil ?? null,
      lastMessageAt: o.at ?? new Date(Date.now() - n * 1000),
      lastMessagePreview: 'hola',
      lastMessageKind: 'TEXT',
      lastMessageDirection: 'INBOUND',
      lastInboundAt: new Date(Date.now() - (open ? 3600_000 : 30 * 3600_000)),
      windowExpiresAt: new Date(Date.now() + (open ? 23 * 3600_000 : -6 * 3600_000)),
    },
  });
  return { contact, conversation };
}
const label = (name: string, scope: 'CONTACT' | 'CONVERSATION') => prisma().label.findFirstOrThrow({ where: { name, scope } });
const msg = (conversationId: string, body: string, extra: Record<string, unknown> = {}) =>
  prisma().message.create({ data: { conversationId, direction: 'INBOUND', kind: 'TEXT', body, status: 'RECEIVED', ...extra } as any });

describe('S5 · Lista, vistas y contadores', () => {
  it('vistas, pestañas, orden, etiquetas y exclusión de contactos borrados', async () => {
    const maria = admin.user.id;
    const pelu = await label('PELUQUERÍA', 'CONTACT');
    const a = await mk({ unread: 2, contactLabel: pelu.id });
    const b = await mk({ assigneeId: maria, starred: true });
    const c = await mk({ assigneeId: agent.user.id });
    await mk({ status: 'DONE' });
    const s1 = await mk({ status: 'SNOOZED', snoozedUntil: new Date(Date.now() + 2 * 3600_000) });
    const s2 = await mk({ status: 'SNOOZED', snoozedUntil: new Date(Date.now() + 3600_000) });
    await mk({ deleted: true, unread: 5 });

    const ids = async (qs: string, who = admin) => ((await who.get('/api/conversations?' + qs)).body.items as any[]).map((i) => i.id);
    expect(await ids('view=all')).toEqual([a.conversation.id, b.conversation.id, c.conversation.id]); // más reciente primero
    expect(await ids('view=mine')).toEqual([b.conversation.id]);
    expect(await ids('view=mine', agent)).toEqual([c.conversation.id]);
    expect(await ids('view=unassigned')).toEqual([a.conversation.id]);
    expect(await ids('view=unread')).toEqual([a.conversation.id]);
    expect(await ids('view=starred')).toEqual([b.conversation.id]);
    expect(await ids(`labelId=${pelu.id}`)).toEqual([a.conversation.id]);
    expect(await ids(`assigneeId=${agent.user.id}`)).toEqual([c.conversation.id]);
    expect(await ids('status=SNOOZED')).toEqual([s2.conversation.id, s1.conversation.id]); // por vencimiento
    expect((await ids('status=DONE')).length).toBe(1);

    const counts = (await admin.get('/api/conversations/counts')).body;
    expect(counts).toMatchObject({ views: { all: 3, mine: 1, unassigned: 1, unread: 1, starred: 1 }, tabs: { OPEN: 3, SNOOZED: 2, DONE: 1 }, totalUnread: 2 });
    expect(counts.byLabel[pelu.id]).toBe(1);
    expect((await agent.get('/api/conversations/counts')).body.views.mine).toBe(1);

    const item = (await admin.get('/api/conversations?view=unread')).body.items[0];
    expect(item).toMatchObject({ displayName: expect.any(String), unreadCount: 2, contactLabels: [{ name: 'PELUQUERÍA' }], lastCampaignName: null });
  });

  it('paginación por cursor sin repetir ni saltar', async () => {
    for (let i = 0; i < 5; i++) await mk({ at: new Date(Date.now() - i * 60_000) });
    const p1 = (await admin.get('/api/conversations?limit=2')).body;
    expect(p1.items).toHaveLength(2);
    const p2 = (await admin.get(`/api/conversations?limit=2&cursor=${p1.nextCursor}`)).body;
    const p3 = (await admin.get(`/api/conversations?limit=2&cursor=${p2.nextCursor}`)).body;
    expect(p3.nextCursor).toBeNull();
    const all = [...p1.items, ...p2.items, ...p3.items].map((i: any) => i.id);
    expect(new Set(all).size).toBe(5);
    const sorted = [...p1.items, ...p2.items, ...p3.items].map((i: any) => i.lastMessageAt);
    expect(sorted).toEqual([...sorted].sort().reverse());
  });

  it('lastCampaignName viene de la última campaña', async () => {
    const { conversation } = await mk();
    const user = await prisma().user.findFirstOrThrow();
    const tpl = await seedTemplate(env.t);
    const camp = await prisma().campaign.create({ data: { name: 'Primavera 2026', templateId: tpl.id, createdById: user.id, variableMapping: {}, audience: {} } as any });
    await prisma().conversation.update({ where: { id: conversation.id }, data: { lastCampaignId: camp.id } });
    expect((await admin.get('/api/conversations')).body.items[0].lastCampaignName).toBe('Primavera 2026');
  });

  it('badge.counts: se emite con antirrebote tras cambios y tras mensajes entrantes', async () => {
    const { conversation } = await seedConversation(env.t);
    env.clear();
    await admin.post(`/api/conversations/${conversation.id}/star`, { starred: true });
    await admin.post(`/api/conversations/${conversation.id}/unread`);
    await new Promise((r) => setTimeout(r, 500));
    const badges = env.realtime.emitted.filter((e) => e.event === 'badge.counts');
    expect(badges.length).toBe(3); // una ráfaga → una emisión por cada usuario activo
    expect((badges[0]!.payload as any).views.starred).toBe(1);
    env.clear();
    await env.sim.sendInbound({ from: '34600111222', type: 'text', text: { body: 'hola' } });
    await new Promise((r) => setTimeout(r, 500));
    const after = env.realtime.emitted.filter((e) => e.event === 'badge.counts');
    expect(after.length).toBeGreaterThan(0);
    expect((after[0]!.payload as any).totalUnread).toBeGreaterThan(0);
  });
});

describe('S5 · Búsqueda (RF-2.19)', () => {
  it('por nombre sin tildes, teléfono, código y texto de mensajes con fragmento', async () => {
    const a = await mk({ first: 'José', last: 'Álvarez', phone: '34611111111', code: 'C-0042' });
    const b = await mk({ first: 'Marta', phone: '34622222222' });
    await msg(b.conversation.id, 'Necesito tintes de la carta de color para mañana');
    const find = async (q: string) => ((await admin.get('/api/conversations?q=' + encodeURIComponent(q))).body.items as any[]);
    expect((await find('jose alvarez')).map((i) => i.id)).toEqual([a.conversation.id]);
    expect((await find('ÁLVAREZ')).map((i) => i.id)).toEqual([a.conversation.id]);
    expect((await find('611 11')).map((i) => i.id)).toEqual([a.conversation.id]);
    expect((await find('c-0042')).map((i) => i.id)).toEqual([a.conversation.id]);
    const byText = await find('tinte');
    expect(byText.map((i) => i.id)).toEqual([b.conversation.id]);
    expect(byText[0].searchSnippet).toMatch(/tintes/);
    expect((await find('nada de nada')).length).toBe(0);
    expect((await find('%')).length).toBe(0); // los comodines no se interpretan
    expect(byText[0].searchSnippet).not.toBeNull();
    expect((await find('Marta'))[0].searchSnippet).toBeNull();
  });
});

describe('S5 · Detalle, nueva conversación y timeline', () => {
  it('nueva conversación normaliza el teléfono, crea el contacto y no duplica', async () => {
    const r = await admin.post('/api/conversations', { phone: '617 49 82 22', firstName: 'Lola' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ phoneE164: '+34617498222', displayName: 'Lola', windowOpen: false, contact: { phoneE164: '+34617498222' } });
    const again = await admin.post('/api/conversations', { phone: '+34617498222' });
    expect(again.body.id).toBe(r.body.id);
    expect(await prisma().contact.count()).toBe(1);
    expect(await prisma().conversation.count()).toBe(1);
    expect((await admin.post('/api/conversations', { phone: '12' })).status).toBe(400);
  });

  it('detalle con ventana y contacto; 404 si no existe', async () => {
    const { conversation } = await mk({ windowOpen: false });
    const d = (await admin.get(`/api/conversations/${conversation.id}`)).body;
    expect(d).toMatchObject({ windowOpen: false, contact: { id: conversation.contactId } });
    expect((await admin.get('/api/conversations/00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });

  it('timeline: mezcla mensajes y eventos, cita resuelta, reacciones agregadas sin burbuja, cursor hacia atrás', async () => {
    const { conversation } = await mk();
    const q = await msg(conversation.id, 'Pregunta', { wamid: 'wamid.A', createdAt: new Date(Date.now() - 50_000) });
    await msg(conversation.id, 'Respuesta', { direction: 'OUTBOUND', status: 'SENT', wamid: 'wamid.B', contextWamid: 'wamid.A', createdAt: new Date(Date.now() - 40_000) });
    await prisma().message.create({ data: { conversationId: conversation.id, direction: 'INBOUND', kind: 'REACTION', body: '👍', payload: { message_id: 'wamid.B', emoji: '👍' }, status: 'RECEIVED', wamid: 'wamid.R1', createdAt: new Date(Date.now() - 30_000) } });
    await prisma().conversationEvent.create({ data: { conversationId: conversation.id, type: 'STARRED', actorId: admin.user.id, createdAt: new Date(Date.now() - 20_000) } });
    await msg(conversation.id, 'Última', { createdAt: new Date(Date.now() - 10_000) });

    const t = (await admin.get(`/api/conversations/${conversation.id}/timeline`)).body;
    expect(t.nextCursor).toBeNull();
    expect(t.items.map((i: any) => (i.type === 'message' ? i.message.body : i.event.type))).toEqual(['Pregunta', 'Respuesta', 'STARRED', 'Última']); // reacción no es burbuja
    const resp = t.items[1].message;
    expect(resp.quoted).toMatchObject({ id: q.id, body: 'Pregunta' });
    expect(resp.reactions).toMatchObject([{ emoji: '👍', direction: 'INBOUND' }]);
    expect(t.items[2].event.text).toBe('María Iborra marcó con estrella');

    const p1 = (await admin.get(`/api/conversations/${conversation.id}/timeline?limit=2`)).body;
    expect(p1.items.map((i: any) => i.message?.body ?? i.event.type)).toEqual(['STARRED', 'Última']);
    const p2 = (await admin.get(`/api/conversations/${conversation.id}/timeline?limit=2&cursor=${p1.nextCursor}`)).body;
    expect(p2.items.map((i: any) => i.message?.body)).toEqual(['Pregunta', 'Respuesta']);
    expect(p2.nextCursor).toBeNull();
  });

  it('reacción retirada (emoji vacío) quita la reacción', async () => {
    const { conversation } = await mk();
    await msg(conversation.id, 'Hola', { direction: 'OUTBOUND', status: 'SENT', wamid: 'wamid.X' });
    for (const [emoji, ago] of [['❤️', 3000], ['', 1000]] as const) {
      await prisma().message.create({ data: { conversationId: conversation.id, direction: 'INBOUND', kind: 'REACTION', body: emoji, payload: { message_id: 'wamid.X', emoji }, status: 'RECEIVED', createdAt: new Date(Date.now() - ago) } });
    }
    const t = (await admin.get(`/api/conversations/${conversation.id}/timeline`)).body;
    expect(t.items[0].message.reactions).toEqual([]);
  });

  it('botones de plantilla y de respuesta automática en payload.buttons', async () => {
    const { conversation } = await mk();
    const tpl = await seedTemplate(env.t);
    await prisma().message.create({ data: { conversationId: conversation.id, direction: 'OUTBOUND', kind: 'TEMPLATE', body: 'Hola', templateId: tpl.id, status: 'SENT' } });
    await prisma().message.create({ data: { conversationId: conversation.id, direction: 'OUTBOUND', kind: 'AUTO_REPLY', body: 'x', payload: { buttons: [{ id: 'a', title: 'Sí' }] }, status: 'SENT', createdAt: new Date(Date.now() + 1000) } });
    const t = (await admin.get(`/api/conversations/${conversation.id}/timeline`)).body;
    expect(t.items[0].message.payload.buttons).toEqual([{ text: 'Ver catálogo' }, { text: 'No recibir más' }]);
    expect(t.items[1].message.payload.buttons).toEqual([{ text: 'Sí' }]);
  });
});

describe('S5 · Envío, notas y asignación automática', () => {
  it('texto: se envía, asigna automáticamente a quien responde (evento auto) y no reasigna después', async () => {
    const { conversation } = await seedConversation(env.t);
    const r = await agent.post(`/api/conversations/${conversation.id}/messages`, { type: 'text', body: 'Hola' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ kind: 'TEXT', direction: 'OUTBOUND', sentBy: { id: agent.user.id } });
    expect(env.sim.sent).toHaveLength(1);
    const conv = await prisma().conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(conv.assigneeId).toBe(agent.user.id);
    const ev = await prisma().conversationEvent.findFirstOrThrow({ where: { conversationId: conversation.id, type: 'ASSIGNED' } });
    expect(ev).toMatchObject({ actorId: agent.user.id, data: { auto: true, assigneeId: agent.user.id } });
    await admin.post(`/api/conversations/${conversation.id}/messages`, { type: 'text', body: 'Otro' });
    expect((await prisma().conversation.findUniqueOrThrow({ where: { id: conversation.id } })).assigneeId).toBe(agent.user.id);
    expect(await prisma().conversationEvent.count({ where: { type: 'ASSIGNED' } })).toBe(1);
  });

  it('ventana cerrada → 409 con el mensaje; no se asigna ni se envía', async () => {
    const { conversation } = await seedConversation(env.t, { windowOpen: false });
    const r = await agent.post(`/api/conversations/${conversation.id}/messages`, { type: 'text', body: 'Hola' });
    expect(r.status).toBe(409);
    expect(r.body.message).toBe(WINDOW_CLOSED_MESSAGE);
    expect(env.sim.sent).toHaveLength(0);
    expect((await prisma().conversation.findUniqueOrThrow({ where: { id: conversation.id } })).assigneeId).toBeNull();
  });

  it('plantilla con ventana cerrada y media se envían y asignan', async () => {
    const closed = await seedConversation(env.t, { windowOpen: false });
    const tpl = await seedTemplate(env.t, { header: false });
    const r = await agent.post(`/api/conversations/${closed.conversation.id}/messages`, { type: 'template', templateId: tpl.id, params: { 'body.1': 'Ana', 'button.0': 'x' } });
    expect(r.status).toBe(201);
    expect(r.body.kind).toBe('TEMPLATE');
    const open = await seedConversation(env.t, { phone: '34600999888' });
    const f = await env.t.app.get(MediaService).storeBuffer(PNG_1X1, 'image/png', 'a.png', 'UPLOAD');
    const m = await admin.post(`/api/conversations/${open.conversation.id}/messages`, { type: 'media', mediaFileIds: [f.id], caption: 'Mira' });
    expect(m.status).toBe(201);
    expect(m.body).toMatchObject({ kind: 'IMAGE', body: 'Mira' });
    expect((await prisma().conversation.findUniqueOrThrow({ where: { id: open.conversation.id } })).assigneeId).toBe(admin.user.id);
  });

  it('nota interna: INTERNAL/NOTE, no llama al simulador, se emite, funciona con ventana cerrada y no asigna', async () => {
    const { conversation } = await seedConversation(env.t, { windowOpen: false });
    env.clear();
    const r = await agent.post(`/api/conversations/${conversation.id}/messages`, { type: 'note', body: 'Pasar a Lolo' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ direction: 'INTERNAL', kind: 'NOTE', body: 'Pasar a Lolo', sentBy: { id: agent.user.id } });
    expect(env.sim.sent).toHaveLength(0);
    expect(env.realtime.emitted.some((e) => e.event === 'message.created')).toBe(true);
    expect((await prisma().conversation.findUniqueOrThrow({ where: { id: conversation.id } })).assigneeId).toBeNull();
    expect((await admin.get('/api/conversations')).body.items[0].lastMessagePreview).toBe('Nota: Pasar a Lolo');
  });

  it('reintento de un envío fallido temporal', async () => {
    const { conversation } = await seedConversation(env.t);
    const failed = await prisma().message.create({ data: { conversationId: conversation.id, direction: 'OUTBOUND', kind: 'TEXT', body: 'x', status: 'FAILED', errorCode: null } });
    const r = await agent.post(`/api/conversations/${conversation.id}/messages/${failed.id}/retry`);
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('SENT');
  });

  it('cuerpo no válido → 400', async () => {
    const { conversation } = await seedConversation(env.t);
    expect((await agent.post(`/api/conversations/${conversation.id}/messages`, { type: 'text', body: '  ' })).status).toBe(400);
    expect((await agent.post(`/api/conversations/${conversation.id}/messages`, { type: 'otro' })).status).toBe(400);
  });
});

describe('S5 · Acciones con historial', () => {
  it('asignar, reasignar y quitar dejan evento con quién y cuándo', async () => {
    const { conversation } = await seedConversation(env.t);
    const url = `/api/conversations/${conversation.id}/assign`;
    expect((await admin.post(url, { assigneeId: agent.user.id })).status).toBe(201);
    expect((await admin.post(url, { assigneeId: admin.user.id })).status).toBe(201);
    expect((await admin.post(url, { assigneeId: null })).status).toBe(201);
    expect((await admin.post(url, { assigneeId: null })).status).toBe(201); // sin cambio: sin evento
    expect((await admin.post(url, { assigneeId: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
    const evs = await prisma().conversationEvent.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: 'asc' } });
    expect(evs.map((e) => e.type)).toEqual(['ASSIGNED', 'ASSIGNED', 'UNASSIGNED']);
    expect(evs.every((e) => e.actorId === admin.user.id)).toBe(true);
    expect((evs[0]!.data as any).assigneeName).toBe('Cristina Lopez');
    const tl = (await admin.get(`/api/conversations/${conversation.id}/timeline`)).body.items;
    expect(tl[0].event.text).toBe('María Iborra asignó a Cristina Lopez');
    expect(env.realtime.emitted.filter((e) => e.event === 'event.created')).toHaveLength(3);
    expect(env.realtime.emitted.some((e) => e.event === 'conversation.updated')).toBe(true);
  });

  it('finalizar y reabrir (manual y automático al escribir el cliente)', async () => {
    const { conversation } = await seedConversation(env.t);
    await admin.post(`/api/conversations/${conversation.id}/done`);
    expect((await prisma().conversation.findUniqueOrThrow({ where: { id: conversation.id } })).status).toBe('DONE');
    await admin.post(`/api/conversations/${conversation.id}/reopen`);
    expect((await prisma().conversation.findUniqueOrThrow({ where: { id: conversation.id } })).status).toBe('OPEN');
    await admin.post(`/api/conversations/${conversation.id}/done`);
    await env.sim.sendInbound({ from: '34600111222', type: 'text', text: { body: 'Hola otra vez' } });
    expect((await prisma().conversation.findUniqueOrThrow({ where: { id: conversation.id } })).status).toBe('OPEN');
    const types = (await prisma().conversationEvent.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: 'asc' } })).map((e) => [e.type, (e.data as any)?.reason]);
    expect(types).toEqual([['DONE', undefined], ['REOPENED', 'manual'], ['DONE', undefined], ['REOPENED', 'inbound']]);
  });

  it('estrella, etiquetas de conversación (con nombre en el evento) y errores de ámbito', async () => {
    const { conversation } = await seedConversation(env.t);
    const pedido = await label('PEDIDO', 'CONVERSATION');
    const factura = await label('FACTURA', 'CONVERSATION');
    const pelu = await label('PELUQUERÍA', 'CONTACT');
    await agent.post(`/api/conversations/${conversation.id}/star`, { starred: true });
    await agent.post(`/api/conversations/${conversation.id}/star`, { starred: true }); // idempotente
    await agent.post(`/api/conversations/${conversation.id}/labels`, { add: [pedido.id, factura.id] });
    await agent.post(`/api/conversations/${conversation.id}/labels`, { remove: [factura.id] });
    expect((await agent.post(`/api/conversations/${conversation.id}/labels`, { add: [pelu.id] })).status).toBe(400);
    const d = (await agent.get(`/api/conversations/${conversation.id}`)).body;
    expect(d.starred).toBe(true);
    expect(d.conversationLabels.map((l: any) => l.name)).toEqual(['PEDIDO']);
    const evs = await prisma().conversationEvent.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: 'asc' } });
    expect(evs.map((e) => [e.type, (e.data as any)?.labelName ?? null])).toEqual([['STARRED', null], ['LABEL_ADDED', 'PEDIDO'], ['LABEL_ADDED', 'FACTURA'], ['LABEL_REMOVED', 'FACTURA']]);
    expect((await admin.get(`/api/conversations?conversationLabelId=${pedido.id}`)).body.items).toHaveLength(1);
    expect((await admin.get('/api/conversations/counts')).body.byLabel[pedido.id]).toBe(1);
  });

  it('no leído y leído (marca leído en WhatsApp)', async () => {
    const { conversation } = await seedConversation(env.t);
    await prisma().message.create({ data: { conversationId: conversation.id, direction: 'INBOUND', kind: 'TEXT', body: 'x', status: 'RECEIVED', wamid: 'wamid.IN1' } });
    await agent.post(`/api/conversations/${conversation.id}/unread`);
    expect((await prisma().conversation.findUniqueOrThrow({ where: { id: conversation.id } })).unreadCount).toBe(1);
    await agent.post(`/api/conversations/${conversation.id}/unread`);
    expect((await prisma().conversation.findUniqueOrThrow({ where: { id: conversation.id } })).unreadCount).toBe(1);
    env.clear();
    const r = await agent.post(`/api/conversations/${conversation.id}/read`);
    expect(r.status).toBe(201);
    expect((await prisma().conversation.findUniqueOrThrow({ where: { id: conversation.id } })).unreadCount).toBe(0);
    expect(env.sim.reads).toEqual(['wamid.IN1']);
  });
});

describe('S5 · Posponer y despertar (RF-2.15)', () => {
  const madrid = (iso: string) => new Date(iso); // instantes UTC
  it('atajos en hora de Madrid, con cambio de hora de marzo y octubre', () => {
    // sábado 28-mar-2026 21:00 Madrid (CET, 20:00Z) → domingo 29 08:00 ya en CEST = 06:00Z
    expect(snoozeUntil({ preset: 'tomorrow8' }, madrid('2026-03-28T20:00:00Z')).toISOString()).toBe('2026-03-29T06:00:00.000Z');
    // sábado 24-oct-2026 → domingo 25-oct 08:00 CET (ya en horario de invierno) = 07:00Z
    expect(snoozeUntil({ preset: 'tomorrow8' }, madrid('2026-10-24T18:00:00Z')).toISOString()).toBe('2026-10-25T07:00:00.000Z');
    // viernes 27-mar → lunes 30-mar 08:00 CEST = 06:00Z
    expect(snoozeUntil({ preset: 'monday8' }, madrid('2026-03-27T10:00:00Z')).toISOString()).toBe('2026-03-30T06:00:00.000Z');
    // lunes 5-oct a las 10:00 → el lunes siguiente (12-oct) 08:00 CEST
    expect(snoozeUntil({ preset: 'monday8' }, madrid('2026-10-05T08:00:00Z')).toISOString()).toBe('2026-10-12T06:00:00.000Z');
    // domingo 25-oct (madrugada, tras el cambio) → lunes 26 08:00 CET = 07:00Z
    expect(snoozeUntil({ preset: 'monday8' }, madrid('2026-10-25T10:00:00Z')).toISOString()).toBe('2026-10-26T07:00:00.000Z');
    const now = madrid('2026-06-01T10:00:00Z');
    expect(snoozeUntil({ preset: '1h' }, now).toISOString()).toBe('2026-06-01T11:00:00.000Z');
    expect(snoozeUntil({ preset: '1d' }, now).toISOString()).toBe('2026-06-02T10:00:00.000Z');
    expect(snoozeUntil({ preset: '1w' }, now).toISOString()).toBe('2026-06-08T10:00:00.000Z');
    expect(snoozeUntil({ preset: 'custom', until: '2026-06-03T09:30:00.000Z' }, now).toISOString()).toBe('2026-06-03T09:30:00.000Z');
    expect(() => snoozeUntil({ preset: 'custom' }, now)).toThrow();
    expect(() => snoozeUntil({ preset: 'custom', until: '2026-05-01T09:30:00.000Z' }, now)).toThrow();
  });

  it('posponer por la API: estado, evento con hora legible, aparece en Pospuestas', async () => {
    const { conversation } = await seedConversation(env.t);
    const r = await admin.post(`/api/conversations/${conversation.id}/snooze`, { preset: '1d' });
    expect(r.status).toBe(201);
    const c = await prisma().conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(c.status).toBe('SNOOZED');
    expect(c.snoozedUntil!.getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
    expect((await admin.get('/api/conversations?status=SNOOZED')).body.items[0].snoozedUntil).toBe(c.snoozedUntil!.toISOString());
    expect((await admin.get('/api/conversations')).body.items).toHaveLength(0);
    const ev = await prisma().conversationEvent.findFirstOrThrow({ where: { type: 'SNOOZED' } });
    expect(ev.actorId).toBe(admin.user.id);
    expect((await admin.post(`/api/conversations/${conversation.id}/snooze`, { preset: 'custom' })).status).toBe(400);
  });

  it('el cron despierta las vencidas (WOKE_UP timer) y deja las que no', async () => {
    const due = await mk({ status: 'SNOOZED', snoozedUntil: new Date(Date.now() - 1000) });
    const later = await mk({ status: 'SNOOZED', snoozedUntil: new Date(Date.now() + 3600_000) });
    await env.t.jobs.runInline('cron-every-minute' as any, {});
    expect((await prisma().conversation.findUniqueOrThrow({ where: { id: due.conversation.id } })).status).toBe('OPEN');
    expect((await prisma().conversation.findUniqueOrThrow({ where: { id: later.conversation.id } })).status).toBe('SNOOZED');
    const ev = await prisma().conversationEvent.findFirstOrThrow({ where: { conversationId: due.conversation.id } });
    expect(ev).toMatchObject({ type: 'WOKE_UP', data: { reason: 'timer' }, actorId: null });
    expect(await env.t.app.get(InboxActionsService).wakeSnoozed()).toBe(0); // idempotente
  });

  it('despierta al escribir el cliente (WOKE_UP inbound)', async () => {
    const { conversation } = await seedConversation(env.t);
    await admin.post(`/api/conversations/${conversation.id}/snooze`, { preset: '1w' });
    await env.sim.sendInbound({ from: '34600111222', type: 'text', text: { body: 'Hola' } });
    const c = await prisma().conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(c).toMatchObject({ status: 'OPEN', snoozedUntil: null });
    const types = (await prisma().conversationEvent.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: 'asc' } })).map((e) => [e.type, (e.data as any)?.reason]);
    expect(types).toEqual([['SNOOZED', undefined], ['WOKE_UP', 'inbound']]);
  });

  it('CountsService.countsFor coincide con la lista', async () => {
    await mk({ unread: 1 });
    await mk({ status: 'DONE' });
    const c = await env.t.app.get(CountsService).countsFor(admin.user.id);
    expect(c.tabs).toEqual({ OPEN: 1, SNOOZED: 0, DONE: 1 });
  });
});
