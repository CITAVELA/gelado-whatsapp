import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { TemplateDraftPage } from './TemplateDraftPage';
import { TemplateEditor } from './TemplateEditor';
import { TemplatesList } from './TemplatesList';

/** /plantillas (listado, P5), /plantillas/nueva (editor) y /plantillas/borrador/:id (reabrir un borrador); editor solo para administradoras. */
export function TemplatesPage() {
  const { isAdmin } = useAuth();
  return (
    <main className="main">
      <Routes>
        <Route index element={<TemplatesList />} />
        <Route path="nueva" element={isAdmin ? <TemplateEditor /> : <Navigate to="/plantillas" replace />} />
        <Route path="borrador/:id" element={isAdmin ? <TemplateDraftPage /> : <Navigate to="/plantillas" replace />} />
        <Route path="*" element={<Navigate to="/plantillas" replace />} />
      </Routes>
    </main>
  );
}
