import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import type { TemplateDto } from '@gelado/shared';
import { api } from '../../lib/api';
import { Empty, Spinner } from '../../components/ui';
import { TemplateEditor } from './TemplateEditor';

/** /plantillas/borrador/:id: carga el borrador local y abre el editor con su contenido. */
export function TemplateDraftPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  // siempre fresco: lo que se guardó hace un momento tiene que verse al reabrir
  const { data, isLoading, error } = useQuery({
    queryKey: ['template-draft', id], // fuera de ['templates']: guardar o enviar no la refresca mientras está abierta
    queryFn: () => api.get<TemplateDto>(`/api/templates/${id}`),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });

  if (isLoading) return <div style={{ padding: 24 }}><Spinner /></div>;
  const back = <button className="btn" onClick={() => nav('/plantillas')}>Volver al listado</button>;
  if (error) {
    return (
      <Empty>
        <p>No se pudo abrir el borrador: {(error as Error).message}</p>
        {back}
      </Empty>
    );
  }
  if (!data || data.status !== 'LOCAL_DRAFT' || !data.draft) {
    return (
      <Empty>
        <p>Esta plantilla ya no es un borrador (se envió a Meta), así que no se puede editar aquí.</p>
        {back}
      </Empty>
    );
  }
  return <TemplateEditor key={data.id} initial={{ sourceTemplateId: data.id, draft: data.draft, notes: [] }} draftId={data.id} />;
}
