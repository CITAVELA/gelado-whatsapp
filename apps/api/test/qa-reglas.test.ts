/**
 * QA · reglas de negocio:
 *  - docs/05 «Reglas que el modelo debe garantizar» (M1–M7)
 *  - docs/03 «Reglas de negocio transversales» (T1–T8)
 * Las pruebas que demuestran un fallo van con `it.fails` (la suite sigue en verde y el fallo queda documentado en docs/trabajo/QA.md).
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createWaTestEnv, seedConversation, seedTemplate, type WaTestEnv } from './meta-simulator/harness';
import { ADMIN_EMAIL, AGENT_EMAIL, loginAs } from './utils/app';

let env: WaTestEnv;
beforeAll(async () => {
  env = await createWaTestEnv();
});
afterAll(async () => env.close());
beforeEach(async () => {
  await env.t.reset();
  env.clear();
});
const prisma = () => env.t.prisma;
const text = (from: string, body: string, extra: Record<string, unknown> = {}) => ({ from, type: 'text', text: { body }, ...extra });

describe('M1 · Contact.phoneE164 único y siempre normalizado', () => {
  it('la BD rechaza dos contactos con el mismo teléfono', async () => {
    await prisma().contact.create({ data: { phoneE164: '+34617498222' } });
    await expect(prisma().contact.create({ data: { phoneE164: '+34617498222' } })).rejects.toThrow(/Unique constraint/);
  });

  it('por la API, todos los formatos del mismo móvil dan 409 tras el primero', async () => {
    const a = await loginAs(env.t, ADMIN_EMAIL);
    const first = await a.post('/api/contacts', { phone: '617498222', firstName: 'Uno' });
    expect(first.status).toBe(201);
    expect(first.body.phoneE164).toBe('+34617498222');
    for (const phone of ['+34 617 49 82 22', '0034617498222', '34617498222', '617 49 82 22', '+34-617-498-222']) {
      const r = await a.post('/api/contacts', { phone, firstName: 'Dos' });
      expect(r.status, phone).toBe(409);
    }
    expect(await prisma().contact.count()).toBe(1);
  });

  it('un teléfono que no es un móvil/E.164 válido no se guarda tal cual', async () => {
    const a = await loginAs(env.t, ADMIN_EMAIL);
    for (const phone of ['abc', '123', '+34 12', '']) {
      const r = await a.post('/api/contacts', { phone });
      expect(r.status, phone).toBe(400);
    }
    expect(await prisma().contact.count()).toBe(0);
  });

  it('el entrante de 34617498222 reutiliza al contacto creado a mano con 617498222', async () => {
    const a = await loginAs(env.t, ADMIN_EMAIL);
    await a.post('/api/contacts', { phone: '617498222', firstName: 'Ginés' });
    await env.sim.sendInbound(text('34617498222', 'Hola'));
    expect(await prisma().contact.count()).toBe(1);
    expect(await prisma().conversation.count()).toBe(1);
  });
});

describe('M2 · una sola Conversation por contacto (también con concurrencia)', () => {
  it('la BD rechaza una segunda conversación del mismo contacto', async () => {
    const { contact } = await seedConversation(env.t);
    await expect(prisma().conversation.create({ data: { contactId: contact.id } })).rejects.toThrow(/Unique constraint/);
  });

  it('5 mensajes de un número nuevo llegando a la vez → 1 contacto, 1 conversación, 5 mensajes', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => env.sim.sendInbound(text('34655000111', `mensaje ${i}`))));
    expect(results).toEqual([200, 200, 200, 200, 200]);
    // el worker en línea puede reintentar: damos un margen
    for (let i = 0; i < 20 && (await prisma().message.count({ where: { direction: 'INBOUND' } })) < 5; i++) await new Promise((r) => setTimeout(r, 200));
    expect(await prisma().contact.count()).toBe(1);
    expect(await prisma().conversation.count()).toBe(1);
    expect(await prisma().message.count({ where: { direction: 'INBOUND' } })).toBe(5);
    expect(env.t.jobs.inlineErrors).toEqual([]);
  });

  // FALLO F-1: la carrera crea contacto/conversación dos veces y la BD rechaza la segunda → 500
  it.fails('POST /api/conversations a la vez con el mismo teléfono → una sola conversación y ningún 500', async () => {
    const a = await loginAs(env.t, ADMIN_EMAIL);
    const rs = await Promise.all(Array.from({ length: 4 }, () => a.post('/api/conversations', { phone: '655 222 333' })));
    expect(rs.every((r) => r.status < 300), JSON.stringify(rs.map((r) => [r.status, r.body]))).toBe(true);
    expect(new Set(rs.map((r) => r.body.id)).size).toBe(1);
    expect(await prisma().conversation.count()).toBe(1);
  });
});

describe('M3 · Message.wamid único (un webhook repetido no duplica)', () => {
  it('la BD rechaza dos mensajes con el mismo wamid', async () => {
    const { conversation } = await seedConversation(env.t);
    const m = { conversationId: conversation.id, direction: 'INBOUND' as const, kind: 'TEXT' as const, wamid: 'wamid.UNICO', body: 'x', status: 'DELIVERED' as const };
    await prisma().message.create({ data: m });
    await expect(prisma().message.create({ data: m })).rejects.toThrow(/Unique constraint/);
  });

  it('el mismo webhook enviado 6 veces en paralelo crea un solo mensaje y suma un solo no leído', async () => {
    const payload = env.sim.inboundPayload(text('34655000222', 'duplicado', { id: 'wamid.PARALELO' }));
    await Promise.all(Array.from({ length: 6 }, () => env.sim.postWebhook(payload)));
    for (let i = 0; i < 20 && (await prisma().message.count()) < 1; i++) await new Promise((r) => setTimeout(r, 200));
    await new Promise((r) => setTimeout(r, 500));
    expect(await prisma().message.count({ where: { wamid: 'wamid.PARALELO' } })).toBe(1);
    const conv = await prisma().conversation.findFirstOrThrow();
    expect(conv.unreadCount).toBe(1);
    expect(env.t.jobs.inlineErrors).toEqual([]);
  });
});

describe('M4 · los estados solo avanzan; FAILED gana a todo', () => {
  async function outbound() {
    const { conversation } = await seedConversation(env.t);
    const a = await loginAs(env.t, ADMIN_EMAIL);
    const r = await a.post(`/api/conversations/${conversation.id}/messages`, { type: 'text', body: 'Hola' });
    expect(r.status).toBe(201);
    return prisma().message.findFirstOrThrow({ where: { direction: 'OUTBOUND' } });
  }
  it.each([
    [['read', 'delivered', 'sent'], 'READ'],
    [['delivered', 'sent'], 'DELIVERED'],
    [['sent', 'delivered', 'read', 'delivered'], 'READ'],
    [['failed', 'read'], 'FAILED'],
    [['read', 'failed', 'delivered'], 'FAILED'],
  ] as const)('secuencia %j → %s', async (seq, final) => {
    const m = await outbound();
    for (const s of seq) await env.sim.sendStatus({ wamid: m.wamid!, status: s, ...(s === 'failed' ? { errorCode: 131049 } : {}) });
    expect((await prisma().message.findUniqueOrThrow({ where: { id: m.id } })).status).toBe(final);
  });
});

describe('M5 · REVOKED no se reactiva sin ConsentEvent con origen y usuario', () => {
  async function revoked() {
    const a = await loginAs(env.t, ADMIN_EMAIL);
    const c = await prisma().contact.create({ data: { phoneE164: '+34611000111', waId: '34611000111', consentStatus: 'REVOKED', firstName: 'Baja' } });
    return { a, c };
  }
  it('PATCH de la ficha con consentStatus se ignora (el consentimiento solo cambia por su endpoint)', async () => {
    const { a, c } = await revoked();
    const r = await a.patch(`/api/contacts/${c.id}`, { phone: '611000111', consentStatus: 'GRANTED' });
    expect(r.status).toBeLessThan(500);
    expect((await prisma().contact.findUniqueOrThrow({ where: { id: c.id } })).consentStatus).toBe('REVOKED');
  });
  it('POST /consent a GRANTED con sesión deja ConsentEvent con origen y usuario; sin sesión es imposible', async () => {
    const { a, c } = await revoked();
    expect((await env.t.http.post(`/api/contacts/${c.id}/consent`).set('X-Requested-With', 'XMLHttpRequest').send({ status: 'GRANTED' })).status).toBe(401);
    const r = await a.post(`/api/contacts/${c.id}/consent`, { status: 'GRANTED', source: 'MANUAL', note: 'Lo pidió por teléfono' });
    expect(r.status).toBeLessThan(300);
    const ev = await prisma().consentEvent.findFirstOrThrow({ where: { contactId: c.id } });
    expect(ev).toMatchObject({ status: 'GRANTED', source: 'MANUAL', userId: a.user.id, note: 'Lo pidió por teléfono' });
  });
  it('un mensaje normal del contacto dado de baja no lo reactiva ni le hace entrar en campañas', async () => {
    const { c } = await revoked();
    await env.sim.sendInbound(text('34611000111', 'Hola, quería hacer un pedido'));
    expect((await prisma().contact.findUniqueOrThrow({ where: { id: c.id } })).consentStatus).toBe('REVOKED');
    expect(await prisma().consentEvent.count({ where: { contactId: c.id, status: { not: 'REVOKED' } } })).toBe(0);
  });
  it('una acción en bloque a GRANTED sobre dados de baja exige ser una persona (queda ConsentEvent por contacto)', async () => {
    const { a, c } = await revoked();
    const r = await a.post('/api/contacts/bulk', { contactIds: [c.id], action: 'setConsent', consent: { status: 'GRANTED', source: 'MANUAL', note: 'lote' } });
    expect(r.status).toBeLessThan(300);
    expect(await prisma().consentEvent.count({ where: { contactId: c.id, status: 'GRANTED', userId: a.user.id } })).toBe(1);
  });
  it('estático: nadie fuera de ConsentService y del alta/importación escribe consentStatus', () => {
    const src = path.resolve(__dirname, '../src');
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name);
        if (f.isDirectory()) walk(p);
        else if (p.endsWith('.ts') && /consentStatus\s*:\s*['"A-Za-z(]/.test(fs.readFileSync(p, 'utf8').replace(/where:\s*\{[^}]*\}/g, ''))) offenders.push(path.relative(src, p));
      }
    };
    walk(src);
    const allowed = ['modules/contacts/consent.service.ts', 'modules/contacts/import.service.ts', 'modules/contacts/contacts.service.ts', 'modules/inbox/mappers.ts', 'modules/campaigns/audience.service.ts', 'modules/campaigns/campaign-runner.service.ts', 'modules/whatsapp/messaging.service.ts', 'modules/webhooks/inbound-messages.service.ts'];
    expect(offenders.filter((o) => !allowed.includes(o))).toEqual([]);
  });
});

describe('M7 · borrado lógico, borrado físico con registro y supresión completa', () => {
  async function contactWithHistory() {
    const a = await loginAs(env.t, ADMIN_EMAIL);
    await env.sim.sendInbound(text('34622333444', 'Hola, soy Ginés Pérez, mi CIF es B12345678', { name: 'Ginés Pérez' }));
    const contact = await prisma().contact.findFirstOrThrow({ where: { phoneE164: '+34622333444' } });
    return { a, contact };
  }
  it('el borrado lógico oculta el contacto pero conserva la fila (deletedAt)', async () => {
    const { a, contact } = await contactWithHistory();
    expect((await a.del(`/api/contacts/${contact.id}`)).status).toBe(200);
    expect((await prisma().contact.findUniqueOrThrow({ where: { id: contact.id } })).deletedAt).toBeInstanceOf(Date);
    expect((await a.get(`/api/contacts/${contact.id}`)).status).toBe(404);
  });
  it('el borrado físico elimina contacto, conversación, mensajes y consentimientos, y deja AuditLog sin datos personales', async () => {
    const { a, contact } = await contactWithHistory();
    expect((await a.del(`/api/contacts/${contact.id}?hard=true`)).status).toBe(200);
    expect(await prisma().contact.count()).toBe(0);
    expect(await prisma().conversation.count()).toBe(0);
    expect(await prisma().message.count()).toBe(0);
    const log = await prisma().auditLog.findFirstOrThrow({ where: { action: 'hard_delete_contact' } });
    expect(JSON.stringify(log)).not.toContain('34622333444');
  });
  // CORREGIDO F-3 (F4b)
  it('derecho de supresión: tras el borrado físico no queda el teléfono ni el texto en los eventos crudos del webhook (WebhookEvent.payload)', async () => {
    const { a, contact } = await contactWithHistory();
    await a.del(`/api/contacts/${contact.id}?hard=true`);
    const raw = await prisma().webhookEvent.findMany();
    expect(JSON.stringify(raw.map((e) => e.payload))).not.toContain('34622333444');
  });
});

describe('T1 · la ventana de 24 h solo la abre o renueva un mensaje del CLIENTE', () => {
  it('un entrante abre la ventana; enviar plantilla o texto no la renueva', async () => {
    const a = await loginAs(env.t, ADMIN_EMAIL);
    const { conversation } = await seedConversation(env.t, { windowOpen: false });
    const tpl = await seedTemplate(env.t, { header: false });
    const before = (await prisma().conversation.findUniqueOrThrow({ where: { id: conversation.id } })).windowExpiresAt!;
    const r = await a.post(`/api/conversations/${conversation.id}/messages`, { type: 'template', templateId: tpl.id, params: { 'body.1': 'Ginés', 'button.0': 'x' } });
    expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
    const after = (await prisma().conversation.findUniqueOrThrow({ where: { id: conversation.id } })).windowExpiresAt!;
    expect(after.getTime()).toBe(before.getTime());
    expect((await a.post(`/api/conversations/${conversation.id}/messages`, { type: 'text', body: 'hola' })).status).toBe(409);
    // el cliente contesta → ventana abierta y el texto ya se puede enviar
    const contact = await prisma().contact.findFirstOrThrow();
    await env.sim.sendInbound(text(contact.waId!, 'Hola'));
    const reopened = (await prisma().conversation.findUniqueOrThrow({ where: { id: conversation.id } })).windowExpiresAt!;
    expect(reopened.getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
    expect((await a.post(`/api/conversations/${conversation.id}/messages`, { type: 'text', body: 'hola' })).status).toBe(201);
  });
  it('un mensaje del cliente con timestamp antiguo (reintento de Meta) no recorta una ventana más reciente', async () => {
    const { conversation, contact } = await seedConversation(env.t);
    const open = (await prisma().conversation.findUniqueOrThrow({ where: { id: conversation.id } })).windowExpiresAt!;
    await env.sim.sendInbound(text(contact.waId!, 'antiguo', { timestamp: Math.floor(Date.now() / 1000) - 20 * 3600 }));
    const after = (await prisma().conversation.findUniqueOrThrow({ where: { id: conversation.id } })).windowExpiresAt!;
    expect(after.getTime()).toBeGreaterThanOrEqual(open.getTime() - 1000);
  });
});

describe('T4 · todo lo que pasa en la conversación queda en su historial', () => {
  it('asignar, posponer, finalizar, reabrir y etiquetar dejan evento con quién', async () => {
    const a = await loginAs(env.t, ADMIN_EMAIL);
    const { conversation } = await seedConversation(env.t);
    const label = await prisma().label.findFirstOrThrow({ where: { scope: 'CONVERSATION' } });
    await a.post(`/api/conversations/${conversation.id}/assign`, { assigneeId: a.user.id });
    await a.post(`/api/conversations/${conversation.id}/labels`, { add: [label.id] });
    await a.post(`/api/conversations/${conversation.id}/snooze`, { preset: '1h' });
    await a.post(`/api/conversations/${conversation.id}/reopen`);
    await a.post(`/api/conversations/${conversation.id}/done`);
    const ev = await prisma().conversationEvent.findMany({ where: { conversationId: conversation.id } });
    const types = ev.map((e) => e.type);
    for (const t of ['ASSIGNED', 'LABEL_ADDED', 'SNOOZED', 'DONE']) expect(types, t).toContain(t);
    expect(ev.filter((e) => e.type !== 'CONSENT_CHANGED').every((e) => e.actorId === a.user.id)).toBe(true);
  });
});

describe('T5 · interfaz en español, Europe/Madrid, EUR', () => {
  // CORREGIDO F-2: los errores de zod llegan en inglés («phone: Required»)
  it('los errores de validación de los formularios están en español (sin mensajes por defecto de zod)', async () => {
    const a = await loginAs(env.t, ADMIN_EMAIL);
    const bad: Array<[string, string, any]> = [
      ['post', '/api/contacts', {}],
      ['post', '/api/contacts', { phone: 5 }],
      ['post', '/api/labels', {}],
      ['post', '/api/campaigns', {}],
      ['post', '/api/templates', {}],
      ['post', '/api/users', {}],
      ['post', '/api/conversations', {}],
      ['put', '/api/settings/rates', { x: 1 }],
      ['put', '/api/settings/business_hours', {}],
      ['post', '/api/auth/login', {}],
    ];
    const english = /\b(Required|Invalid input|Expected \w+, received|Invalid (email|uuid|enum)|String must contain|Too (small|big)|must be)\b/;
    const offenders: string[] = [];
    for (const [m, url, body] of bad) {
      const r = await (a as any)[m](url, body);
      const msg = JSON.stringify(r.body);
      if (english.test(msg)) offenders.push(`${m.toUpperCase()} ${url} → ${msg.slice(0, 160)}`);
    }
    expect(offenders).toEqual([]);
  });
  it('los costes se expresan en EUR y la zona del horario es Europe/Madrid', async () => {
    const a = await loginAs(env.t, ADMIN_EMAIL);
    const costs = await a.get('/api/quality/costs');
    expect(costs.body.currency).toBe('EUR');
    const settings = await a.get('/api/settings');
    expect(JSON.stringify(settings.body)).toContain('Europe/Madrid');
    expect(JSON.stringify(settings.body)).toMatch(/EUR/);
  });
});

describe('T6 · coste estimado antes de lanzar, con la tarifa configurada', () => {
  it('audience-count devuelve el coste con la tarifa de marketing (0,0585 €) y cambia si se edita la tarifa', async () => {
    const a = await loginAs(env.t, ADMIN_EMAIL);
    await prisma().contact.createMany({ data: Array.from({ length: 10 }, (_, i) => ({ phoneE164: `+3461100${1000 + i}`, waId: `3461100${1000 + i}` })) });
    const ids = (await prisma().contact.findMany()).map((c) => c.id);
    const r1 = await a.post('/api/campaigns/audience-count', { audience: { contactIds: ids } });
    expect(r1.body.estimatedCost).toBeCloseTo(10 * 0.0585, 4);
    const rates = (await a.get('/api/settings')).body;
    const cur = rates.rates ?? rates.settings?.rates;
    expect(cur?.marketing ?? cur?.value?.marketing).toBeCloseTo(0.0585, 4);
  });
});

describe('T8 · sin correo saliente en el MVP', () => {
  it('no hay dependencias ni código de correo (SMTP, nodemailer, proveedores de email)', () => {
    const root = path.resolve(__dirname, '../../..');
    const deps = ['apps/api/package.json', 'apps/web/package.json', 'package.json'].map((p) => fs.readFileSync(path.join(root, p), 'utf8')).join('\n');
    expect(deps).not.toMatch(/nodemailer|sendgrid|mailgun|postmark|@aws-sdk\/client-ses|resend|emailjs/i);
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name);
        if (f.isDirectory() && f.name !== 'node_modules') walk(p);
        else if (/\.(ts|tsx)$/.test(f.name) && /(createTransport|smtp\.|sendMail\()/i.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(root, p));
      }
    };
    walk(path.join(root, 'apps/api/src'));
    walk(path.join(root, 'apps/web/src'));
    expect(hits).toEqual([]);
  });
  it('las invitaciones devuelven un enlace en la respuesta (no se envían por correo)', async () => {
    const a = await loginAs(env.t, ADMIN_EMAIL);
    const r = await a.post('/api/users', { email: 'nueva@gelado.eu', name: 'Nueva', role: 'AGENT' });
    expect(r.body.link.url).toMatch(/\/crear-contrasena\//);
  });
});

describe('Reglas 4 y 5 de CLAUDE.md · solo API oficial, nunca /register', () => {
  it('el código no usa librerías no oficiales ni llama a /register', () => {
    const root = path.resolve(__dirname, '../../..');
    const pk = fs.readFileSync(path.join(root, 'apps/api/package.json'), 'utf8') + fs.readFileSync(path.join(root, 'package.json'), 'utf8');
    expect(pk).not.toMatch(/baileys|whatsapp-web\.js|waha|venom-bot|wppconnect/i);
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name);
        if (f.isDirectory()) walk(p);
        else if (p.endsWith('.ts') && /['"`/]register['"`]|\/register\b/.test(fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''))) hits.push(path.relative(root, p));
      }
    };
    walk(path.join(root, 'apps/api/src'));
    expect(hits).toEqual([]);
  });
  it('la base de la Graph API en pruebas es siempre el simulador', async () => {
    const { WhatsAppGateway } = await import('../src/modules/whatsapp/whatsapp.gateway');
    const gw = env.t.app.get(WhatsAppGateway) as any;
    expect(JSON.stringify(gw.opts ?? gw.config ?? gw)).not.toContain('graph.facebook.com');
  });
});
