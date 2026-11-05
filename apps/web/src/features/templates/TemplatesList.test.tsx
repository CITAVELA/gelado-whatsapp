import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const auth = vi.hoisted(() => ({ isAdmin: true }));
vi.mock('../../lib/auth', () => ({ useAuth: () => ({ isAdmin: auth.isAdmin }) }));
vi.mock('../../lib/socket', () => ({ useSocketEvent: () => undefined }));
vi.mock('../../lib/api', async (orig) => {
  const real = await orig<typeof import('../../lib/api')>();
  return { ...real, api: { get: vi.fn().mockResolvedValue([]), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), upload: vi.fn() } };
});
import { queryClient } from '../../lib/query';
import { TemplatesList } from './TemplatesList';

const renderList = () => render(<QueryClientProvider client={queryClient}><MemoryRouter><TemplatesList /></MemoryRouter></QueryClientProvider>);

describe('TemplatesList · filtro de estado', () => {
  beforeEach(() => queryClient.clear());
  it('la administradora puede filtrar por «Borrador»', () => {
    auth.isAdmin = true;
    renderList();
    expect(screen.getByRole('option', { name: 'Borrador' })).toBeInTheDocument();
  });
  it('a un agente no se le ofrece «Borrador» (nunca ve borradores)', () => {
    auth.isAdmin = false;
    renderList();
    expect(screen.queryByRole('option', { name: 'Borrador' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Aprobada' })).toBeInTheDocument();
  });
});
