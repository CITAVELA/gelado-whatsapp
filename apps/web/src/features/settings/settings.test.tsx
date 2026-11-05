import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { DEFAULT_SETTINGS, privacyPlaceholders } from '@gelado/shared';
import { queryClient } from '../../lib/query';
import { ToastProvider } from '../../components/ui';
import { api } from '../../lib/api';
import { newButtonId, summarizeHours, validateHours, validateOutOfHours, validateVacation } from './hoursModel';
import { parseDecimal } from './WhatsAppSection';
import { actionLabel } from './AuditSection';
import { HoursSection } from './HoursSection';
import { PrivacySection } from './PrivacySection';

const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={queryClient}><ToastProvider><MemoryRouter>{ui}</MemoryRouter></ToastProvider></QueryClientProvider>);
const clone = <T,>(x: T) => structuredClone(x);

describe('hoursModel', () => {
  it('el horario por defecto es válido y se resume', () => {
    expect(validateHours(DEFAULT_SETTINGS.business_hours)).toEqual({});
    expect(summarizeHours(DEFAULT_SETTINGS.business_hours)).toBe('L–V 09:00–14:00 y 17:00–20:00 · S 09:30–13:30');
  });
  it('detecta tramos al revés o solapados', () => {
    const bh = clone(DEFAULT_SETTINGS.business_hours);
    bh.days.mon = [{ from: '14:00', to: '09:00' }];
    bh.days.tue = [{ from: '09:00', to: '15:00' }, { from: '14:00', to: '20:00' }];
    const e = validateHours(bh);
    expect(e.mon).toMatch(/anterior/);
    expect(e.tue).toMatch(/solapan/);
    expect(e.wed).toBeUndefined();
  });
  it('botones: máximo 20 caracteres y 3 botones', () => {
    const o = clone(DEFAULT_SETTINGS.out_of_hours);
    expect(validateOutOfHours(o)).toEqual([]);
    o.buttons[0]!.title = 'x'.repeat(21);
    expect(validateOutOfHours(o)[0]).toMatch(/20 caracteres/);
    o.buttons = [...o.buttons, { id: 'a', title: 'cuarto' }];
    expect(validateOutOfHours(o).join()).toMatch(/Máximo 3/);
    expect(newButtonId(DEFAULT_SETTINGS.out_of_hours)).toBe('OOH_1');
  });
  it('vacaciones activas necesitan fechas coherentes', () => {
    expect(validateVacation({ ...DEFAULT_SETTINGS.vacation, enabled: true })[0]).toMatch(/fechas/);
    expect(validateVacation({ enabled: true, from: '2026-08-10', to: '2026-08-01', text: 'x' })[0]).toMatch(/posterior/);
    expect(validateVacation({ enabled: true, from: '2026-08-01', to: '2026-08-10', text: 'x' })).toEqual([]);
  });
});

describe('utilidades', () => {
  it('parseDecimal admite coma y punto', () => {
    expect(parseDecimal('0,0585')).toBe(0.0585);
    expect(parseDecimal('0.0166')).toBe(0.0166);
    expect(parseDecimal('abc')).toBeNaN();
    expect(parseDecimal('-1')).toBeNaN();
  });
  it('acciones del registro en español', () => {
    expect(actionLabel('update_setting')).toBe('Ajuste modificado');
    expect(actionLabel('otra')).toBe('otra');
  });
  it('campos [entre corchetes] pendientes, sin contar enlaces', () => {
    expect(privacyPlaceholders('CIF [CIF], [domicilio social] y [web](https://x.es) [CIF]')).toEqual(['[CIF]', '[domicilio social]']);
  });
});

beforeEach(() => { queryClient.clear(); vi.restoreAllMocks(); });

describe('HoursSection', () => {
  it('carga los ajustes, avisa si un botón pasa de 20 caracteres y deshabilita Guardar', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (url: string) => (url.startsWith('/api/labels') ? [] : DEFAULT_SETTINGS) as any);
    wrap(<HoursSection />);
    const input = await screen.findByLabelText('Texto del botón 1');
    expect(input).toHaveValue('Hacer un pedido');
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled();
    fireEvent.change(input, { target: { value: 'Este texto es demasiado largo' } });
    expect(screen.getAllByRole('alert')[0]).toHaveTextContent(/20 caracteres/);
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
    // la vista previa refleja el texto
    expect(screen.getByLabelText('Vista previa')).toHaveTextContent('Este texto es demasiado largo');
  });

  it('guarda horario, fuera de horario y vacaciones con PUT', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (url: string) => (url.startsWith('/api/labels') ? [] : DEFAULT_SETTINGS) as any);
    const put = vi.spyOn(api, 'put').mockResolvedValue({} as any);
    wrap(<HoursSection />);
    await screen.findByLabelText('Texto del botón 1');
    fireEvent.click(screen.getByRole('switch', { name: 'Modo vacaciones' }));
    // activar vacaciones sin fechas bloquea el guardado
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
    fireEvent.click(screen.getByRole('switch', { name: 'Modo vacaciones' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(3));
    expect(put.mock.calls.map((c) => c[0])).toEqual(['/api/settings/business_hours', '/api/settings/out_of_hours', '/api/settings/vacation']);
  });
});

describe('PrivacySection', () => {
  it('muestra el aviso de campos sin rellenar y la vista previa saneada del servidor', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ markdown: '## Responsable\n\nCIF [CIF]', updatedAt: new Date().toISOString() } as any);
    vi.spyOn(api, 'post').mockResolvedValue({ html: '<h2 id="responsable">Responsable</h2><p>CIF [CIF]</p>', placeholders: ['[CIF]'] } as any);
    wrap(<PrivacySection />);
    expect(await screen.findByText(/Quedan campos por rellenar/)).toBeInTheDocument();
    expect(screen.getByText(/Quedan campos por rellenar/).parentElement).toHaveTextContent('[CIF]');
    expect(screen.getByLabelText('Vista previa de la política').querySelector('h2')).toHaveAttribute('id', 'responsable');
    expect(screen.getByRole('link', { name: /Ver página pública/ })).toHaveAttribute('href', '/privacidad');
    expect(screen.getByRole('button', { name: 'Guardar y publicar' })).toBeDisabled();
  });
});
