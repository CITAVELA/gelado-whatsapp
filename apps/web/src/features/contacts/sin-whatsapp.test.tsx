import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ContactDto, ImportField } from '@gelado/shared';
import { NoWhatsappPill } from './NoWhatsappPill';
import { MappingStep } from './MappingStep';
import { readFilters, filtersToApi } from './ContactListPage';
import { ContactDetailPage } from './ContactDetailPage';

const phoneless = { id: 'c1', displayName: 'bea@ejemplo.test', phoneE164: null, waId: null, firstName: null, lastName: null, profileName: null, email: 'bea@ejemplo.test', company: null, customerCode: '12', taxId: null, landline: null, notes: null, consentStatus: 'UNKNOWN', consentAt: null, phoneInvalid: false, labels: [], conversationId: null, lastActivityAt: null, createdAt: '2026-11-05T10:00:00Z', updatedAt: '2026-11-05T10:00:00Z' } as ContactDto;

vi.mock('./hooks', () => ({
  errMsg: (e: unknown) => String(e),
  useContact: () => ({ data: phoneless, isLoading: false, isError: false }),
  useSaveContact: () => ({ mutate: vi.fn(), isPending: false }),
  useRefreshContact: () => vi.fn(),
  useOpenConversation: () => vi.fn(),
}));
vi.mock('../../lib/auth', () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock('./Campaigns', () => ({ CampaignsList: () => null }));
vi.mock('./ConsentBlock', () => ({ ConsentBlock: () => null }));
vi.mock('./ContactFields', () => ({ ContactFields: () => null }));
vi.mock('./LabelPicker', () => ({ LabelPicker: () => null }));
vi.mock('../../components/ui', async (orig) => ({ ...(await orig<typeof import('../../components/ui')>()), useToast: () => vi.fn() }));

describe('Sin WhatsApp (P16)', () => {
  it('chip gris «Sin WhatsApp»', () => {
    render(<NoWhatsappPill />);
    expect(screen.getByText('Sin WhatsApp')).toHaveClass('p-grey');
  });

  it('la ficha de un contacto sin teléfono muestra el chip y «Abrir conversación» deshabilitado', () => {
    render(
      <MemoryRouter initialEntries={['/contactos/c1']}>
        <Routes><Route path="/contactos/:id" element={<ContactDetailPage />} /></Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('Sin WhatsApp')).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: /Abrir conversación/ });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', expect.stringContaining('Sin WhatsApp'));
  });

  it('el filtro Con / sin WhatsApp viaja en la URL y a la API', () => {
    const f = readFilters(new URLSearchParams('whatsapp=without'));
    expect(f.whatsapp).toBe('without');
    expect(filtersToApi(f)).toMatchObject({ whatsapp: 'without' });
    expect(readFilters(new URLSearchParams('whatsapp=xx')).whatsapp).toBe('');
  });

  it('el mapeo del importador no exige el teléfono si hay correo o código', () => {
    const columns = ['Nombre', 'Dirección de correo electrónico'];
    const mapping: Record<string, ImportField> = { Nombre: 'firstName', 'Dirección de correo electrónico': 'email' };
    render(<MappingStep columns={columns} mapping={mapping} sampleRows={[]} onChange={() => undefined} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
