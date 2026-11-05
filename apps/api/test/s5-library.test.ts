import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createWaTestEnv, seedConversation, PNG_1X1, type WaTestEnv } from './meta-simulator/harness';
import { ADMIN_EMAIL, AGENT_EMAIL, loginAs } from './utils/app';

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

const PDF = Buffer.from('%PDF-1.4 catalogo');
const upload = (who: typeof admin, buf: Buffer, name: string, mime: string, fields: Record<string, string> = {}) => {
  let r = who.agent.post('/api/library/files').set('X-Requested-With', 'XMLHttpRequest');
  for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
  return r.attach('file', buf, { filename: name, contentType: mime });
};

describe('S5 · Biblioteca (RF-2.11)', () => {
  it('admin crea carpetas y sube; el agente lista y busca pero no sube, crea, renombra ni borra', async () => {
    const f = await admin.post('/api/library/folders', { name: 'Catálogos' });
    expect(f.status).toBe(201);
    const sub = await admin.post('/api/library/folders', { name: 'DOUSSE', parentId: f.body.id });
    expect(sub.body.parentId).toBe(f.body.id);
    const up = await upload(admin, PDF, 'carta.pdf', 'application/pdf', { name: 'DOUSSE Carta de Color', folderId: sub.body.id });
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ name: 'DOUSSE Carta de Color', folderId: sub.body.id, media: { mimeType: 'application/pdf', url: expect.any(String) } });
    await upload(admin, PNG_1X1, 'logo.png', 'image/png');

    const folders = (await agent.get('/api/library/folders')).body;
    expect(folders.find((x: any) => x.id === sub.body.id).fileCount).toBe(1);
    expect((await agent.get(`/api/library/files?folderId=${sub.body.id}`)).body.map((x: any) => x.name)).toEqual(['DOUSSE Carta de Color']);
    expect((await agent.get('/api/library/files?q=carta')).body).toHaveLength(1);
    expect((await agent.get('/api/library/files')).body).toHaveLength(2);

    expect((await upload(agent, PDF, 'x.pdf', 'application/pdf')).status).toBe(403);
    expect((await agent.post('/api/library/folders', { name: 'x' })).status).toBe(403);
    expect((await agent.patch(`/api/library/files/${up.body.id}`, { name: 'x' })).status).toBe(403);
    expect((await agent.del(`/api/library/files/${up.body.id}`)).status).toBe(403);
    expect((await agent.del(`/api/library/folders/${f.body.id}`)).status).toBe(403);
  });

  it('valida el tipo, renombra/mueve, no deja ciclos y solo borra carpetas vacías', async () => {
    const a = (await admin.post('/api/library/folders', { name: 'A' })).body;
    const b = (await admin.post('/api/library/folders', { name: 'B', parentId: a.id })).body;
    expect((await upload(admin, Buffer.from('MZ'), 'virus.exe', 'application/x-msdownload')).status).toBe(400);
    expect((await admin.patch(`/api/library/folders/${a.id}`, { parentId: b.id })).status).toBe(400);
    expect((await admin.del(`/api/library/folders/${a.id}`)).status).toBe(409);
    const file = (await upload(admin, PDF, 'c.pdf', 'application/pdf')).body;
    const moved = await admin.patch(`/api/library/files/${file.id}`, { name: 'Catálogo 2026', folderId: b.id });
    expect(moved.body).toMatchObject({ name: 'Catálogo 2026', folderId: b.id });
    expect((await admin.del(`/api/library/folders/${b.id}`)).status).toBe(409);
    await admin.del(`/api/library/files/${file.id}`);
    expect((await admin.del(`/api/library/folders/${b.id}`)).status).toBe(200);
  });

  it('enviar desde la biblioteca reutiliza el id de WhatsApp; borrar no rompe mensajes ya enviados', async () => {
    const { conversation } = await seedConversation(env.t);
    const file = (await upload(admin, PDF, 'catalogo.pdf', 'application/pdf', { name: 'Catálogo' })).body;
    const send = () => agent.post(`/api/conversations/${conversation.id}/messages`, { type: 'media', mediaFileIds: [file.media.id] });
    const r1 = await send();
    expect(r1.status).toBe(201);
    expect(r1.body).toMatchObject({ kind: 'DOCUMENT', media: { id: file.media.id } });
    const uploaded = env.sim.media.size;
    await send();
    expect(env.sim.media.size).toBe(uploaded); // sin volver a subir
    expect(env.sim.sent.filter((s) => s.body.type === 'document')).toHaveLength(2);

    expect((await admin.del(`/api/library/files/${file.id}`)).status).toBe(200);
    expect(await env.t.prisma.libraryFile.count()).toBe(0);
    expect(await env.t.prisma.mediaFile.count({ where: { id: file.media.id } })).toBe(1); // lo usan mensajes
    const tl = (await agent.get(`/api/conversations/${conversation.id}/timeline`)).body.items;
    expect(tl[0].message.media.url).toEqual(expect.any(String));
  });

  it('borrar un archivo sin uso elimina también el MediaFile', async () => {
    const file = (await upload(admin, PDF, 'c.pdf', 'application/pdf')).body;
    await admin.del(`/api/library/files/${file.id}`);
    expect(await env.t.prisma.mediaFile.count()).toBe(0);
  });
});
