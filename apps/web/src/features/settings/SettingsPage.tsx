import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AuditSection } from './AuditSection';
import { HoursSection } from './HoursSection';
import { LabelsSection } from './LabelsSection';
import { LibrarySection } from './LibrarySection';
import { PrivacySection } from './PrivacySection';
import { TeamSection } from './TeamSection';
import { WhatsAppSection } from './WhatsAppSection';
import './settings.css';

export const SETTINGS_SECTIONS = [
  { path: 'equipo', name: 'Equipo', el: <TeamSection /> },
  { path: 'etiquetas', name: 'Etiquetas', el: <LabelsSection /> },
  { path: 'biblioteca', name: 'Biblioteca', el: <LibrarySection /> },
  { path: 'horario', name: 'Horario y respuestas automáticas', el: <HoursSection /> },
  { path: 'whatsapp', name: 'WhatsApp y tarifas', el: <WhatsAppSection /> },
  { path: 'privacidad', name: 'Privacidad', el: <PrivacySection /> },
  { path: 'actividad', name: 'Registro de actividad', el: <AuditSection /> },
];

/** /ajustes/* (P7, solo administradoras): menú lateral y una sección por ruta. */
export function SettingsPage() {
  const nav = useNavigate();
  const loc = useLocation();
  const current = SETTINGS_SECTIONS.find((s) => loc.pathname.startsWith(`/ajustes/${s.path}`))?.path ?? 'equipo';
  return (
    <>
      <aside className="views" aria-label="Ajustes">
        <h2>Configuración</h2>
        {SETTINGS_SECTIONS.map((s) => (
          <NavLink key={s.path} to={`/ajustes/${s.path}`} className={({ isActive }) => `view set-link${isActive ? ' on' : ''}`}>{s.name}</NavLink>
        ))}
      </aside>
      <main className="main">
        <select className="set-nav-m" aria-label="Sección de ajustes" value={current} onChange={(e) => nav(`/ajustes/${e.target.value}`)}>
          {SETTINGS_SECTIONS.map((s) => <option key={s.path} value={s.path}>{s.name}</option>)}
        </select>
        <Routes>
          <Route index element={<Navigate to="equipo" replace />} />
          {SETTINGS_SECTIONS.map((s) => <Route key={s.path} path={`${s.path}/*`} element={s.el} />)}
          <Route path="*" element={<Navigate to="/ajustes/equipo" replace />} />
        </Routes>
      </main>
    </>
  );
}
