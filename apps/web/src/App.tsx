import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { AuthProvider, useAuth } from './lib/auth';
import { queryClient } from './lib/query';
import { ToastProvider, Spinner } from './components/ui';
import { AppLayout } from './layout/AppLayout';
import { LoginPage } from './features/auth/LoginPage';
import { SetPasswordPage } from './features/auth/SetPasswordPage';
import { InboxPage } from './features/inbox/InboxPage';
import { ContactsPage } from './features/contacts/ContactsPage';
import { CampaignsPage } from './features/campaigns/CampaignsPage';
import { TemplatesPage } from './features/templates/TemplatesPage';
import { QualityPage } from './features/quality/QualityPage';
import { SettingsPage } from './features/settings/SettingsPage';

function RequireAuth({ children, admin }: { children: ReactNode; admin?: boolean }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="empty"><Spinner /></div>;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  if (admin && user.role !== 'ADMIN') return <Navigate to="/bandeja" replace />;
  return <>{children}</>;
}

/**
 * Rutas. Cada módulo gestiona sus subrutas con «/*»:
 *   /bandeja/* (S4/S5) · /contactos/* (S2) · /campanas/* (S6) · /plantillas/* (S3) · /calidad (S7) · /ajustes/* (S7)
 */
export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/crear-contrasena/:token" element={<SetPasswordPage />} />
              <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
                <Route path="/" element={<Navigate to="/bandeja" replace />} />
                <Route path="/bandeja/*" element={<InboxPage />} />
                <Route path="/contactos/*" element={<ContactsPage />} />
                <Route path="/campanas/*" element={<CampaignsPage />} />
                <Route path="/plantillas/*" element={<TemplatesPage />} />
                <Route path="/calidad" element={<QualityPage />} />
                <Route path="/ajustes/*" element={<RequireAuth admin><SettingsPage /></RequireAuth>} />
                <Route path="*" element={<Navigate to="/bandeja" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
