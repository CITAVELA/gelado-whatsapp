import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createWaTestEnv, type WaTestEnv } from './meta-simulator/harness';

let env: WaTestEnv;
beforeAll(async () => {
  env = await createWaTestEnv();
});
afterAll(async () => env.close());
beforeEach(async () => {
  await env.t.reset();
  env.clear();
});

const FROM = '34600111222';

/** Envía un entrante y devuelve el mensaje guardado */
async function inbound(fields: Record<string, unknown>) {
  const status = await env.sim.sendInbound({ from: FROM, ...fields } as any);
  expect(status).toBe(200);
  return env.t.prisma.message.findFirstOrThrow({ orderBy: { createdAt: 'desc' }, include: { conversation: true } });
}

describe('S1 · Entrantes de todos los tipos (prueba 2)', () => {
  it('text', async () => {
    const m = await inbound({ type: 'text', text: { body: 'Hola' } });
    expect(m).toMatchObject({ kind: 'TEXT', body: 'Hola', status: 'RECEIVED', direction: 'INBOUND' });
    expect(m.raw).toMatchObject({ type: 'text' });
  });

  it.each([
    ['image', 'IMAGE', { id: 'm1', mime_type: 'image/jpeg', sha256: 'abc', caption: 'Mira' }, 'Mira', '📷 Mira'],
    ['video', 'VIDEO', { id: 'm2', mime_type: 'video/mp4', sha256: 'abc', caption: 'Vídeo' }, 'Vídeo', '🎬 Vídeo'],
    ['document', 'DOCUMENT', { id: 'm3', mime_type: 'application/pdf', sha256: 'abc', filename: 'Carta.pdf', caption: 'Carta' }, 'Carta', '📄 Carta.pdf'],
    ['sticker', 'STICKER', { id: 'm4', mime_type: 'image/webp', sha256: 'abc', animated: false }, null, 'Sticker'],
    ['audio', 'AUDIO', { id: 'm5', mime_type: 'audio/mpeg', sha256: 'abc', voice: false }, null, '🎵 Audio'],
    ['audio', 'VOICE', { id: 'm6', mime_type: 'audio/ogg; codecs=opus', sha256: 'abc', voice: true }, null, '🎤 Nota de voz'],
  ])('%s → %s guarda el id de media y queda pendiente de descarga', async (type, kind, obj, body, preview) => {
    const m = await inbound({ type, [type as string]: obj });
    expect(m.kind).toBe(kind);
    expect(m.body).toBe(body);
    expect(m.payload).toMatchObject({ waMediaId: (obj as any).id, mimeType: (obj as any).mime_type, sha256: 'abc' });
    expect(m.conversation.lastMessagePreview).toBe(preview);
    // la descarga falla porque el simulador no tiene ese media: el mensaje queda pendiente, no se pierde
    expect(m.mediaId).toBeNull();
    const created = env.realtime.emitted.filter((e) => e.event === 'message.created').at(-1)!.payload as any;
    expect(created.message.media).toMatchObject({ pending: true });
  });

  it('document guarda el nombre de archivo en el payload', async () => {
    const m = await inbound({ type: 'document', document: { id: 'x', mime_type: 'application/pdf', filename: 'Carta.pdf' } });
    expect((m.payload as any).fileName).toBe('Carta.pdf');
  });

  it('location', async () => {
    const m = await inbound({ type: 'location', location: { latitude: 38.3452, longitude: -0.481, name: 'Almacén', address: 'C/ Mayor 1, Alicante' } });
    expect(m.kind).toBe('LOCATION');
    expect(m.payload).toMatchObject({ latitude: 38.3452, longitude: -0.481, name: 'Almacén', address: 'C/ Mayor 1, Alicante' });
    expect((m.payload as any).mapUrl).toContain('maps');
    expect(m.conversation.lastMessagePreview).toBe('📍 Ubicación');
  });

  it('contacts', async () => {
    const m = await inbound({ type: 'contacts', contacts: [{ name: { formatted_name: 'Pedro Gómez', first_name: 'Pedro' }, phones: [{ phone: '+34 600 000 000', wa_id: '34600000000' }] }] });
    expect(m.kind).toBe('CONTACTS');
    expect(m.body).toBe('Pedro Gómez');
    expect((m.payload as any).contacts[0].phones[0].wa_id).toBe('34600000000');
  });

  it('button (respuesta a botón de plantilla)', async () => {
    const m = await inbound({ type: 'button', button: { text: 'Más información', payload: 'INFO' } });
    expect(m).toMatchObject({ kind: 'BUTTON_REPLY', body: 'Más información' });
    expect(m.payload).toMatchObject({ text: 'Más información', payload: 'INFO' });
    expect(env.domain.find((d) => d.event === 'inbound.message')!.payload).toMatchObject({ buttonPayload: 'INFO', text: 'Más información', optedOut: false });
  });

  it('interactive button_reply y list_reply', async () => {
    const a = await inbound({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'PEDIDO', title: 'Hacer un pedido' } } });
    expect(a).toMatchObject({ kind: 'BUTTON_REPLY', body: 'Hacer un pedido' });
    expect(a.payload).toMatchObject({ id: 'PEDIDO', title: 'Hacer un pedido', type: 'button_reply' });
    const b = await inbound({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'L1', title: 'Opción 1', description: 'desc' } } });
    expect(b).toMatchObject({ kind: 'BUTTON_REPLY', body: 'Opción 1' });
    expect(b.payload).toMatchObject({ id: 'L1', type: 'list_reply', description: 'desc' });
  });

  it('reaction: kind REACTION con message_id y emoji; no suma no leídos', async () => {
    await inbound({ type: 'text', text: { body: 'Hola' } });
    const m = await inbound({ type: 'reaction', reaction: { message_id: 'wamid.ORIG', emoji: '👍' } });
    expect(m.kind).toBe('REACTION');
    expect(m.payload).toEqual({ message_id: 'wamid.ORIG', emoji: '👍' });
    expect(m.conversation.unreadCount).toBe(1);
    expect(m.conversation.lastMessagePreview).toBe('Reaccionó 👍');
  });

  it.each(['order', 'system', 'unsupported', 'ephemeral'])('%s → UNSUPPORTED con raw y texto en español', async (type) => {
    const m = await inbound({ type, [type]: { foo: 'bar' }, errors: [{ code: 131051, title: 'Message type is not currently supported' }] });
    expect(m.kind).toBe('UNSUPPORTED');
    expect(m.body).toBe(`Tipo de mensaje no soportado: ${type}`);
    expect((m.raw as any).type).toBe(type);
    expect((m.raw as any)[type]).toEqual({ foo: 'bar' });
    expect(m.conversation.lastMessagePreview).toBe('Mensaje no soportado');
  });
});
