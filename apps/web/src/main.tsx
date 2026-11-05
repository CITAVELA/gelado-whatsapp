import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/gelado-app.css';
import './styles/app.css';
import { App } from './App';
import { installAudioUnlock } from './features/inbox/notify';

// El sonido de aviso necesita un gesto previo del usuario (Safari/iOS): se desbloquea con el primer toque, también el del login.
installAudioUnlock();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
