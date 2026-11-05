import { Navigate, Route, Routes } from 'react-router-dom';
import { CampaignReport } from './CampaignReport';
import { CampaignWizard } from './CampaignWizard';
import { CampaignsList } from './CampaignsList';
import './campaigns.css';

/** /campanas (listado, P4), /campanas/nueva y /campanas/:id/editar (asistente), /campanas/:id (informe). */
export function CampaignsPage() {
  return (
    <main className="main">
      <Routes>
        <Route index element={<CampaignsList />} />
        <Route path="nueva" element={<CampaignWizard />} />
        <Route path=":id/editar" element={<CampaignWizard key="edit" />} />
        <Route path=":id" element={<CampaignReport />} />
        <Route path="*" element={<Navigate to="/campanas" replace />} />
      </Routes>
    </main>
  );
}
