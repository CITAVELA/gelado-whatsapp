// Móvil: mantener pulsado el micrófono graba y soltar envía (R-1: el permiso del micrófono puede tardar).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../components/ui';
import { setInboxApi } from './api';
import { createMockApi } from './mock';
import { InboxPage } from './InboxPage';

vi.mock('../../lib/socket', () => ({ getSocket: () => ({ on() {}, off() {}, emit() {} }), useSocketEvent() {} }));
vi.mock('../../lib/auth', () => ({ useAuth: () => ({ user: { id: 'u-maria', name: 'María Iborra', role: 'ADMIN', email: '' }, isAdmin: true }) }));

const w = window as any;
const saved = { PointerEvent: w.PointerEvent, MediaRecorder: w.MediaRecorder, mediaDevices: Object.getOwnPropertyDescriptor(navigator, 'mediaDevices') };
let grant!: () => void;
let uploads: any[];
let stops: number;

class FakeRecorder {
  state = 'inactive'; mimeType = 'audio/webm'; ondataavailable: any = null; onstop: any = null;
  static isTypeSupported() { return true; }
  start() { this.state = 'recording'; }
  stop() { stops++; this.state = 'inactive'; setTimeout(() => { this.ondataavailable?.({ data: new Blob([new Uint8Array(500)], { type: 'audio/webm' }) }); this.onstop?.(); }, 0); }
}

beforeEach(() => {
  uploads = []; stops = 0;
  w.PointerEvent = class extends MouseEvent { pointerType: string; constructor(t: string, i: any = {}) { super(t, i); this.pointerType = i.pointerType ?? 'mouse'; } };
  w.MediaRecorder = FakeRecorder;
  // getUserMedia que tarda: el aviso de permiso del micrófono sigue en pantalla hasta que se concede
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => new Promise((r) => { grant = () => r({ getTracks: () => [] }); }) } });
});
afterEach(() => {
  w.PointerEvent = saved.PointerEvent; w.MediaRecorder = saved.MediaRecorder;
  if (saved.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', saved.mediaDevices); else delete (navigator as any).mediaDevices;
  vi.useRealTimers();
});

function setup() {
  const mock = createMockApi({ delay: 0 });
  const upload = vi.spyOn(mock, 'uploadMedia').mockImplementation((async (f: File) => { uploads.push(f); return { id: 'm1', mimeType: f.type, sizeBytes: f.size, fileName: f.name, url: '' }; }) as any);
  setInboxApi(mock);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}><ToastProvider>
      <MemoryRouter initialEntries={['/bandeja/c/c1']}><Routes><Route path="/bandeja/*" element={<InboxPage />} /></Routes></MemoryRouter>
    </ToastProvider></QueryClientProvider>,
  );
  return upload;
}
const touch = (type: string, target: Element | Window) => fireEvent(target, new w.PointerEvent(type, { bubbles: true, pointerType: 'touch' }));

describe('mantener pulsado el micrófono (móvil)', () => {
  it('suelta antes de que se conceda el permiso: no se envía nada y queda la barra «Grabando»', async () => {
    const upload = setup();
    const mic = await screen.findByRole('button', { name: 'Mantén pulsado para grabar nota de voz' });
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'], shouldAdvanceTime: true });
    touch('pointerdown', mic);
    touch('pointerup', window); // el dedo se levanta para pulsar «Permitir»
    await act(async () => { vi.advanceTimersByTime(3000); }); // el agente tarda en conceder
    await act(async () => { grant(); });
    expect(await screen.findByText('Grabando')).toBeInTheDocument(); // la barra queda para enviar o cancelar a mano
    await act(async () => { vi.advanceTimersByTime(50); });
    expect(stops).toBe(0);
    expect(upload).not.toHaveBeenCalled();
  });

  it('mantiene pulsado ≥ 0,7 s con el micrófono ya concedido y suelta: se envía', async () => {
    const upload = setup();
    const mic = await screen.findByRole('button', { name: 'Mantén pulsado para grabar nota de voz' });
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'], shouldAdvanceTime: true });
    touch('pointerdown', mic);
    await act(async () => { grant(); });
    await screen.findByText('Grabando');
    await act(async () => { vi.advanceTimersByTime(1500); });
    touch('pointerup', window);
    await act(async () => { vi.advanceTimersByTime(100); });
    expect(stops).toBe(1);
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(uploads[0].type).toBe('audio/webm');
  });

  it('toque corto con el micrófono ya concedido: la barra queda y no se envía', async () => {
    const upload = setup();
    const mic = await screen.findByRole('button', { name: 'Mantén pulsado para grabar nota de voz' });
    touch('pointerdown', mic);
    await act(async () => { grant(); });
    await screen.findByText('Grabando');
    touch('pointerup', window);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(stops).toBe(0);
    expect(upload).not.toHaveBeenCalled();
  });

  it('«Enviar» de la barra con menos de 1 s: se descarta con un aviso, sin nota vacía', async () => {
    const upload = setup();
    const mic = await screen.findByRole('button', { name: 'Mantén pulsado para grabar nota de voz' });
    touch('pointerdown', mic);
    await act(async () => { grant(); });
    await screen.findByText('Grabando');
    touch('pointerup', window);
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByText(/demasiado corta/)).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
    expect(screen.queryByText('Grabando')).toBeNull();
  });
});
