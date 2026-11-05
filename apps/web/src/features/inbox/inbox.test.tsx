import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../components/ui';
import { setInboxApi } from './api';
import { createMockApi } from './mock';
import { InboxPage } from './InboxPage';
import { fmtDayLabel, snoozeOptions } from './utils';
import { renderWhatsApp } from './whatsappFormat';

vi.mock('../../lib/socket', () => ({ getSocket: () => ({ on() {}, off() {}, emit() {} }), useSocketEvent() {} }));
vi.mock('../../lib/auth', () => ({ useAuth: () => ({ user: { id: 'u-maria', name: 'María Iborra', role: 'ADMIN', email: '' }, isAdmin: true }) }));

let mock: ReturnType<typeof createMockApi>;
function setup(path = '/bandeja') {
  mock = createMockApi({ delay: 0 });
  setInboxApi(mock);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><ToastProvider>
      <MemoryRouter initialEntries={[path]}><Routes><Route path="/bandeja/*" element={<InboxPage />} /></Routes></MemoryRouter>
    </ToastProvider></QueryClientProvider>,
  );
}
beforeEach(() => { try { localStorage.clear(); } catch { /* */ } });

describe('bandeja', () => {
  it('lista con contadores de vistas', async () => {
    setup();
    expect(await screen.findByText('Peluquería Marisol')).toBeInTheDocument();
    const mine = screen.getByRole('button', { name: /Asignado a mí/ });
    await waitFor(() => expect(within(mine).getByText('3')).toBeInTheDocument());
    expect(screen.getByText('Tipo de cliente')).toBeInTheDocument();
  });

  it('cambia de pestaña a Pospuestas', async () => {
    setup();
    await screen.findByText('Peluquería Marisol');
    fireEvent.click(screen.getByRole('tab', { name: 'Pospuestas' }));
    expect(await screen.findByText('Sonia Vidal')).toBeInTheDocument();
    expect(screen.queryByText('Peluquería Marisol')).not.toBeInTheDocument();
  });

  it('Enter envía y Mayús+Enter no', async () => {
    setup('/bandeja/c/c1');
    const box = await screen.findByLabelText('Escribe un mensaje');
    fireEvent.change(box, { target: { value: 'Hola equipo' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(await screen.findByRole('log')).toBeInTheDocument();
    expect(screen.queryByText('Hola equipo', { selector: '.msg-text span' })).not.toBeInTheDocument();
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(screen.getAllByText('Hola equipo').length).toBeGreaterThan(0));
    expect(box).toHaveValue('');
  });

  it('ventana cerrada bloquea el texto y ofrece plantilla', async () => {
    setup('/bandeja/c/c5');
    expect(await screen.findByText('Ventana cerrada: solo plantillas')).toBeInTheDocument();
    expect(screen.queryByLabelText('Escribe un mensaje')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar plantilla' }));
    expect(await screen.findByRole('dialog', { name: /Enviar plantilla de WhatsApp/ })).toBeInTheDocument();
  });

  it('burbuja fallida con motivo y Reintentar', async () => {
    setup('/bandeja/c/c8');
    expect(await screen.findByText(/Error temporal de WhatsApp/)).toBeInTheDocument();
    const retry = screen.getAllByRole('button', { name: 'Reintentar' });
    expect(retry).toHaveLength(1); // la otra no es reintentable
    fireEvent.click(retry[0]!);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument());
  });

  it('separadores de fecha', async () => {
    setup('/bandeja/c/c1');
    const log = await screen.findByRole('log');
    await waitFor(() => expect(within(log).getAllByText(/^(Hoy|Ayer|\d{2}\/\d{2}\/\d{4})$/).length).toBeGreaterThan(1));
    expect(within(log).getByText('Hoy')).toBeInTheDocument();
  });
});

describe('utilidades', () => {
  it('fmtDayLabel', () => {
    const now = new Date('2026-11-05T12:00:00Z');
    expect(fmtDayLabel('2026-11-05T08:00:00Z', now)).toBe('Hoy');
    expect(fmtDayLabel('2026-11-04T08:00:00Z', now)).toBe('Ayer');
    expect(fmtDayLabel('2026-10-16T08:00:00Z', now)).toBe('16/10/2026');
  });
  it('atajos de posponer', () => {
    const o = snoozeOptions(new Date('2026-11-05T11:59:00Z'));
    expect(o.map((x) => x.preset)).toEqual(['tomorrow8', 'monday8', '1h', '1d', '1w']);
    expect(o[0]!.hint).toBe('06/11, 08:00');
    expect(o[1]!.hint).toBe('09/11, 08:00');
  });
  it('formato WhatsApp', () => {
    const { container } = render(<>{renderWhatsApp('*hola* _a_ ~b~ `c` https://x.es/a.')}</>);
    expect(container.querySelector('strong')?.textContent).toBe('hola');
    expect(container.querySelector('em')?.textContent).toBe('a');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://x.es/a');
  });
});
