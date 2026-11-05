// F-10 · la caché de mensajes nunca retrocede de estado ni duplica un mensaje.
import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { MessageDto } from '@gelado/shared';
import { K, applyMessageStatus, upsertMessage } from './hooks';

const CONV = 'c1';
const msg = (over: Partial<MessageDto>): MessageDto =>
  ({
    id: 'm1', conversationId: CONV, direction: 'OUTBOUND', kind: 'TEXT', body: 'hola', media: null, templateName: null, templateParams: null, payload: null,
    wamid: null, contextWamid: null, quoted: null, reactions: [], status: 'PENDING', errorCode: null, errorTitle: null, retryable: false,
    sentBy: { id: 'u1', name: 'Cristina', initials: 'C' }, campaignId: null, campaignName: null, createdAt: '2026-11-05T10:00:00.000Z',
    sentAt: null, deliveredAt: null, readAt: null, ...over,
  }) as MessageDto;

function setup() {
  const qc = new QueryClient();
  qc.setQueryData(K.timeline(CONV), { pageParams: [undefined], pages: [{ items: [], nextCursor: null }] });
  const all = () => (qc.getQueryData<any>(K.timeline(CONV)).pages.flatMap((p: any) => p.items) as any[]).filter((i) => i.type === 'message').map((i) => i.message as MessageDto);
  return { qc, all };
}

describe('F-10 · estados que no retroceden', () => {
  it('la respuesta HTTP (PENDING) no pisa el SENT llegado antes por socket', () => {
    const { qc, all } = setup();
    upsertMessage(qc, CONV, msg({}));
    applyMessageStatus(qc, CONV, 'm1', { status: 'SENT', sentAt: '2026-11-05T10:00:01.000Z' });
    upsertMessage(qc, CONV, msg({ status: 'PENDING' })); // respuesta HTTP tardía
    expect(all()).toHaveLength(1);
    expect(all()[0]!.status).toBe('SENT');
    expect(all()[0]!.sentAt).toBe('2026-11-05T10:00:01.000Z');
  });

  it('si el estado llega antes que el mensaje, se recuerda y la respuesta HTTP no lo retrocede', () => {
    const { qc, all } = setup();
    applyMessageStatus(qc, CONV, 'm9', { status: 'DELIVERED', deliveredAt: '2026-11-05T10:00:02.000Z' });
    upsertMessage(qc, CONV, msg({ id: 'm9', status: 'PENDING' }));
    expect(all()[0]!.status).toBe('DELIVERED');
  });

  it('un estado atrasado por socket (SENT tras DELIVERED) se ignora; FAILED gana siempre', () => {
    const { qc, all } = setup();
    upsertMessage(qc, CONV, msg({ id: 'm2', status: 'DELIVERED' }));
    applyMessageStatus(qc, CONV, 'm2', { status: 'SENT' });
    expect(all()[0]!.status).toBe('DELIVERED');
    applyMessageStatus(qc, CONV, 'm2', { status: 'FAILED', errorTitle: 'Falló' });
    expect(all()[0]!.status).toBe('FAILED');
    upsertMessage(qc, CONV, msg({ id: 'm2', status: 'SENT' }));
    expect(all()[0]!.status).toBe('FAILED');
  });

  it('el mensaje real recibido por socket sustituye al provisional (sin burbuja duplicada)', () => {
    const { qc, all } = setup();
    upsertMessage(qc, CONV, msg({ id: 'tmp-1' }));
    upsertMessage(qc, CONV, msg({ id: 'm3' }));
    expect(all().map((m) => m.id)).toEqual(['m3']);
  });

  it('dos textos iguales seguidos conservan sus dos burbujas', () => {
    const { qc, all } = setup();
    upsertMessage(qc, CONV, msg({ id: 'tmp-1' }));
    upsertMessage(qc, CONV, msg({ id: 'tmp-2' }));
    upsertMessage(qc, CONV, msg({ id: 'm4' }));
    expect(all().map((m) => m.id)).toEqual(['tmp-2', 'm4']);
    upsertMessage(qc, CONV, msg({ id: 'm5' }));
    expect(all().map((m) => m.id)).toEqual(['m4', 'm5']);
  });
});
