import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { TemplateEditor } from './TemplateEditor';
import { TemplatesList } from './TemplatesList';

/** /plantillas (listado, P5) y /plantillas/nueva (editor, solo administradoras). */
export function TemplatesPage() {
  const { isAdmin } = useAuth();
  return (
    <main className="main">
      <Routes>
        <Route index element={<TemplatesList />} />
        <Route path="nueva" element={isAdmin ? <TemplateEditor /> : <Navigate to="/plantillas" replace />} />
        <Route path="*" element={<Navigate to="/plantillas" replace />} />
      </Routes>
    </main>
  );
}
