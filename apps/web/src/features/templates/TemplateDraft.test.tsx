import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { TemplateDto } from '@gelado/shared';

vi.mock('../../lib/api', async (orig) => {
  const real = await orig<typeof import('../../lib/api')>();
  return { ...real, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), upload: vi.fn() } };
});
import { api } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { TemplateEditor } from './TemplateEditor';
import { TemplateDraftPage } from './TemplateDraftPage';

const mocked = api as unknown as Record<'get' | 'post' | 'put', ReturnType<typeof vi.fn>>;

const savedDraft = (over: Partial<TemplateDto> = {}): TemplateDto =>
  ({
    id: 'd1d1d1d1-0000-4000-8000-000000000001',
    metaTemplateId: null,
    name: 'oferta_otono',
    displayName: 'Oferta otoño',
    language: 'es',
    category: 'UTILITY',
    status: 'LOCAL_DRAFT',
    components: [],
    rejectedReason: null,
    qualityScore: null,
    hasOptOutButton: false,
    variables: ['body.1'],
    headerFormat: 'NONE',
    usableInCampaigns: false,
    lastSyncedAt: null,
    updatedAt: new Date().toISOString(),
    draft: {
      displayName: 'Oferta otoño',
      name: 'oferta_otono',
      category: 'UTILITY',
      language: 'es',
      header: { format: 'NONE' },
      body: 'Hola {{1}}, ya llegó el otoño a Gelado',
      bodyExamples: ['Juan'],
      footer: 'Gelado',
      buttons: [{ type: 'QUICK_REPLY', text: 'Me interesa' }],
      addOptOutButton: false,
    },
    ...over,
  }) as TemplateDto;

beforeEach(() => {
  Object.values(mocked).forEach((f) => f.mockReset());
});

const renderEditor = () => render(<MemoryRouter><TemplateEditor /></MemoryRouter>);
const renderReopen = (id = 'd1d1d1d1-0000-4000-8000-000000000001') =>
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/plantillas/borrador/${id}`]}>
        <Routes>
          <Route path="/plantillas/borrador/:id" element={<TemplateDraftPage />} />
          <Route path="/plantillas" element={<div>Listado</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('Guardar borrador', () => {
  it('hay un botón «Guardar borrador» junto a «Enviar a revisión de Meta»', () => {
    renderEditor();
    expect(screen.getByRole('button', { name: 'Guardar borrador' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Enviar a revisión de Meta' })).toBeEnabled();
  });

  it('sin nombre no guarda y avisa en español; no llama a la API', async () => {
    renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/nombre/i);
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it('guarda con solo nombre e idioma (resto incompleto) y los siguientes guardados actualizan el mismo registro', async () => {
    mocked.post.mockResolvedValue(savedDraft({ name: 'solo_nombre' }));
    mocked.put.mockResolvedValue(savedDraft({ name: 'solo_nombre' }));
    renderEditor();
    fireEvent.change(screen.getByLabelText('Nombre de la plantilla'), { target: { value: 'Solo nombre' } });
    fireEvent.change(screen.getByLabelText('Mensaje'), { target: { value: 'Hola {{1}}' } }); // variable sin ejemplo: incompleto
    fireEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledTimes(1));
    expect(mocked.post.mock.calls[0]![0]).toBe('/api/templates/draft');
    expect(mocked.post.mock.calls[0]![1]).toMatchObject({ name: 'solo_nombre', language: 'es', body: 'Hola {{1}}' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar borrador' })).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Mensaje'), { target: { value: 'Hola {{1}}, más texto' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    await waitFor(() => expect(mocked.put).toHaveBeenCalledTimes(1));
    expect(mocked.put.mock.calls[0]![0]).toBe('/api/templates/d1d1d1d1-0000-4000-8000-000000000001/draft');
    expect(mocked.put.mock.calls[0]![1]).toMatchObject({ body: 'Hola {{1}}, más texto' });
    expect(mocked.post).toHaveBeenCalledTimes(1);
  });

  it('muestra el error del servidor (nombre repetido) y no pierde lo escrito', async () => {
    mocked.post.mockRejectedValue(Object.assign(new Error('Ya hay un borrador con ese nombre en ese idioma. Cambia el nombre o ábrelo desde el listado.'), { status: 409 }));
    renderEditor();
    fireEvent.change(screen.getByLabelText('Nombre de la plantilla'), { target: { value: 'Repetida' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Ya hay un borrador/);
    expect(screen.getByLabelText('Nombre de la plantilla')).toHaveValue('Repetida');
  });

  it('un borrador que viene de «Duplicar» (location.state) también se puede guardar', async () => {
    mocked.post.mockResolvedValue(savedDraft());
    render(
      <MemoryRouter initialEntries={[{ pathname: '/plantillas/nueva', state: { sourceTemplateId: 'x', notes: [], draft: savedDraft().draft } }]}>
        <TemplateEditor />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText('Nombre de la plantilla')).toHaveValue('Oferta otoño');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/api/templates/draft', expect.objectContaining({ name: 'oferta_otono' })));
  });
});

describe('Reabrir un borrador', () => {
  it('carga el contenido guardado en el editor', async () => {
    mocked.get.mockResolvedValue(savedDraft());
    renderReopen();
    expect(await screen.findByLabelText('Nombre de la plantilla')).toHaveValue('Oferta otoño');
    expect(screen.getByLabelText('Nombre en Meta')).toHaveValue('oferta_otono');
    expect(screen.getByLabelText('Categoría')).toHaveValue('UTILITY');
    expect(screen.getByLabelText('Mensaje')).toHaveValue('Hola {{1}}, ya llegó el otoño a Gelado');
    expect(screen.getByLabelText('Ejemplo de la variable 1')).toHaveValue('Juan');
    expect(screen.getByLabelText('Texto del botón 1')).toHaveValue('Me interesa');
    expect(screen.getByLabelText('Pie de página (opcional)')).toHaveValue('Gelado');
    expect(mocked.get).toHaveBeenCalledWith('/api/templates/d1d1d1d1-0000-4000-8000-000000000001');
  });

  it('guardar de nuevo actualiza el mismo registro (PUT) y enviar a revisión usa /submit con la validación completa', async () => {
    const id = 'd1d1d1d1-0000-4000-8000-000000000001';
    mocked.get.mockResolvedValue(savedDraft());
    mocked.put.mockResolvedValue(savedDraft());
    mocked.post.mockResolvedValue({ ...savedDraft(), status: 'PENDING', draft: null });
    renderReopen();
    await screen.findByLabelText('Nombre de la plantilla');
    fireEvent.change(screen.getByLabelText('Pie de página (opcional)'), { target: { value: 'Gelado Exclusivas' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    await waitFor(() => expect(mocked.put).toHaveBeenCalledWith(`/api/templates/${id}/draft`, expect.objectContaining({ footer: 'Gelado Exclusivas' })));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar a revisión de Meta' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledTimes(1));
    expect(mocked.post.mock.calls[0]![0]).toBe(`/api/templates/${id}/submit`);
    expect(mocked.post.mock.calls[0]![1]).toMatchObject({ name: 'oferta_otono', body: 'Hola {{1}}, ya llegó el otoño a Gelado', bodyExamples: ['Juan'] });
    expect(await screen.findByText('Listado')).toBeInTheDocument();
  });

  it('enviar un borrador incompleto no llama a la API y lista los fallos; si Meta falla se muestra el error y sigue siendo borrador', async () => {
    mocked.get.mockResolvedValue(savedDraft());
    renderReopen();
    await screen.findByLabelText('Nombre de la plantilla');
    fireEvent.change(screen.getByLabelText('Ejemplo de la variable 1'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar a revisión de Meta' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Falta el ejemplo de la variable/);
    expect(mocked.post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Ejemplo de la variable 1'), { target: { value: 'Juan' } });
    mocked.post.mockRejectedValue(new Error('Meta no ha aceptado la plantilla: formato no válido'));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar a revisión de Meta' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Meta no ha aceptado la plantilla/);
    expect(screen.getByLabelText('Nombre de la plantilla')).toBeInTheDocument(); // sigue en el editor
  });

  it('si la plantilla ya no es un borrador no abre el editor', async () => {
    mocked.get.mockResolvedValue(savedDraft({ status: 'PENDING', draft: null }));
    renderReopen();
    expect(await screen.findByText(/ya no es un borrador/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Nombre de la plantilla')).not.toBeInTheDocument();
  });
});
