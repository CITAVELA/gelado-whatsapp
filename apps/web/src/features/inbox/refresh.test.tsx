import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { createBatchedRefresh } from './refresh';

const handlers: Record<string, (p: any) => void> = {};
vi.mock('./realtime', () => ({ useRealtime: (event: string, h: (p: any) => void) => void (handlers[event] = h) }));
vi.mock('./notify', () => ({ getFocusedConversation: () => null, shouldNotify: () => false, showNotification() {} }));

import { useInboxRealtime } from './useInboxRealtime';
import { K } from './hooks';

function setVisibility(v: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  setVisibility('visible');
});
afterEach(() => {
  vi.useRealTimers();
});

describe('F4c #19 · refrescos agrupados y con pestaña oculta', () => {
  it('varias peticiones dentro de la ventana son un solo refresco', () => {
    const run = vi.fn();
    const r = createBatchedRefresh(run, 4000);
    for (let i = 0; i < 50; i++) r.request();
    vi.advanceTimersByTime(3999);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(run).toHaveBeenCalledTimes(1);
    r.dispose();
  });

  it('N6 · con un refresco lento pendiente (campaña, 30 s), una petición de 4 s lo adelanta; la inversa no lo retrasa', () => {
    const run = vi.fn();
    const r = createBatchedRefresh(run, 4000);
    r.request(30_000);
    vi.advanceTimersByTime(1000);
    r.request(4000); // entrante normal
    vi.advanceTimersByTime(3999);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(run).toHaveBeenCalledTimes(1);
    r.request(4000);
    r.request(30_000); // una ventana más larga no retrasa la pendiente
    vi.advanceTimersByTime(4001);
    expect(run).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(60_000);
    expect(run).toHaveBeenCalledTimes(2);
    r.dispose();
  });

  it('con la pestaña oculta no refresca; al volver a ser visible refresca una vez', () => {
    const run = vi.fn();
    const r = createBatchedRefresh(run, 4000);
    setVisibility('hidden');
    for (let i = 0; i < 20; i++) r.request();
    vi.advanceTimersByTime(60_000);
    expect(run).not.toHaveBeenCalled();
    setVisibility('visible');
    expect(run).toHaveBeenCalledTimes(1);
    setVisibility('hidden');
    setVisibility('visible'); // nada sucio: no repite
    expect(run).toHaveBeenCalledTimes(1);
    r.dispose();
  });

  it('si la pestaña se oculta con el temporizador en marcha, no refresca hasta volver', () => {
    const run = vi.fn();
    const r = createBatchedRefresh(run, 4000);
    r.request();
    setVisibility('hidden');
    vi.advanceTimersByTime(5000);
    expect(run).not.toHaveBeenCalled();
    setVisibility('visible');
    expect(run).toHaveBeenCalledTimes(1);
    r.dispose();
  });

  function setup() {
    const qc = new QueryClient();
    const inv = vi.spyOn(qc, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>
    );
    const view = renderHook(() => useInboxRealtime(), { wrapper });
    const listCalls = () => inv.mock.calls.filter((c) => JSON.stringify((c[0] as any)?.queryKey) === JSON.stringify(K.lists)).length;
    return { qc, view, listCalls };
  }
  const msg = (id: string, o: Record<string, unknown> = {}) => ({ id, conversationId: 'c1', direction: 'OUTBOUND', kind: 'TEMPLATE', body: 'x', campaignId: null, createdAt: new Date().toISOString(), ...o });
  const conv = (o: Record<string, unknown> = {}) => ({ id: 'c1', displayName: 'A', phoneE164: '+34600', status: 'OPEN', unreadCount: 0, lastMessagePreview: 'nuevo', ...o });

  it('500 mensajes entrantes en ráfaga → una sola invalidación de listas por ventana (no una por evento)', () => {
    const { listCalls, view } = setup();
    act(() => {
      for (let i = 0; i < 500; i++) handlers['message.created']!({ conversationId: 'c1', message: msg(`m${i}`, { direction: 'INBOUND' }), notify: false });
    });
    expect(listCalls()).toBe(0);
    act(() => void vi.advanceTimersByTime(4100));
    expect(listCalls()).toBe(1);
    view.unmount();
  });

  it('pestaña oculta: ni un solo refresco por socket; al volver, uno', () => {
    const { listCalls, view } = setup();
    setVisibility('hidden');
    act(() => {
      for (let i = 0; i < 100; i++) {
        handlers['message.created']!({ conversationId: 'c1', message: msg(`m${i}`, { direction: 'INBOUND' }), notify: false });
        handlers['conversation.updated']!({ conversation: conv() });
      }
      vi.advanceTimersByTime(120_000);
    });
    expect(listCalls()).toBe(0);
    act(() => setVisibility('visible'));
    expect(listCalls()).toBe(1);
    view.unmount();
  });

  it('envíos de campaña (message.campaignId): se parchea la caché con el DTO y no se refresca por cada envío', () => {
    const { qc, listCalls, view } = setup();
    qc.setQueryData([...K.lists, { status: 'OPEN' }], { pages: [{ items: [conv({ lastMessagePreview: 'viejo' })], nextCursor: null }], pageParams: [null] });
    act(() => {
      for (let i = 0; i < 300; i++) {
        handlers['message.created']!({ conversationId: 'c1', message: msg(`m${i}`, { campaignId: 'camp1' }), notify: false });
        handlers['conversation.updated']!({ conversation: conv({ lastMessagePreview: `envio ${i}` }) });
      }
      vi.advanceTimersByTime(10_000);
    });
    expect(listCalls()).toBe(0); // ni siquiera tras la ventana normal de 4 s
    const data: any = qc.getQueriesData({ queryKey: K.lists })[0]![1];
    expect(data.pages[0].items[0].lastMessagePreview).toBe('envio 299');
    act(() => void vi.advanceTimersByTime(25_000)); // refresco lento (30 s) para corregir el orden
    expect(listCalls()).toBe(1);
    view.unmount();
  });

  it('N6 · con el refresco lento de una campaña pendiente, la respuesta de un cliente refresca la lista en ≤ 4 s', () => {
    const { listCalls, view } = setup();
    act(() => {
      handlers['message.created']!({ conversationId: 'c1', message: msg('c1m', { campaignId: 'camp1' }), notify: false });
      vi.advanceTimersByTime(2000);
      handlers['message.created']!({ conversationId: 'c2', message: msg('in1', { direction: 'INBOUND', kind: 'TEXT', body: 'hola' }), notify: false });
      vi.advanceTimersByTime(3999);
    });
    expect(listCalls()).toBe(0);
    act(() => void vi.advanceTimersByTime(2));
    expect(listCalls()).toBe(1);
    view.unmount();
  });
});
