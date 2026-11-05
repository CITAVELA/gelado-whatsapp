import { Route, Routes } from 'react-router-dom';
import { ContactDetailPage } from './ContactDetailPage';
import { ContactListPage } from './ContactListPage';
import { ImportWizard } from './ImportWizard';
import './contacts.css';

/** /contactos/* : listado, importador (/importar) y ficha (/:id). */
export function ContactsPage() {
  return (
    <div className="contacts-page" style={{ display: 'contents' }}>
      <Routes>
        <Route index element={<ContactListPage />} />
        <Route path="importar" element={<ImportWizard />} />
        <Route path=":id" element={<main className="main"><ContactDetailPage /></main>} />
      </Routes>
    </div>
  );
}
