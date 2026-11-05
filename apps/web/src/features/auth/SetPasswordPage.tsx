import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PASSWORD_MIN, type TokenInfoDto } from '@gelado/shared';
import { api } from '../../lib/api';
import { AuthShell } from './LoginPage';
import { Spinner } from '../../components/ui';

/** «Crear contraseña» desde un enlace de invitación o de nueva contraseña (RF-1.2, RF-1.3). */
export function SetPasswordPage() {
  const { token = '' } = useParams();
  const [info, setInfo] = useState<TokenInfoDto | null>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<TokenInfoDto>(`/api/auth/token/${encodeURIComponent(token)}`).then(setInfo).catch(() => setInfo({ valid: false }));
  }, [token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (pw.length < PASSWORD_MIN) return setError(`La contraseña debe tener al menos ${PASSWORD_MIN} caracteres`);
    if (pw !== pw2) return setError('Las contraseñas no coinciden');
    setBusy(true);
    try {
      await api.post('/api/auth/set-password', { token, password: pw });
      setDone(true);
    } catch (err: any) {
      setError(err?.message ?? 'No se pudo guardar');
    } finally {
      setBusy(false);
    }
  }

  if (!info) return <AuthShell><Spinner /></AuthShell>;
  if (!info.valid)
    return (
      <AuthShell subtitle="Enlace no válido">
        <p>El enlace no es válido o ha caducado. Pide uno nuevo a la administradora.</p>
        <Link to="/login" className="btn" style={{ justifyContent: 'center' }}>Ir al inicio de sesión</Link>
      </AuthShell>
    );
  if (done)
    return (
      <AuthShell subtitle="Contraseña guardada">
        <p>Listo. Ya puedes entrar con <strong>{info.email}</strong> y tu nueva contraseña.</p>
        <Link to="/login" className="btn primary" style={{ justifyContent: 'center', height: 44 }}>Entrar</Link>
      </AuthShell>
    );
  return (
    <AuthShell subtitle={info.purpose === 'INVITE' ? `Te damos la bienvenida, ${info.name}` : 'Nueva contraseña'}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="hint">Crea la contraseña para <strong>{info.email}</strong> (mínimo {PASSWORD_MIN} caracteres).</div>
        <div>
          <label className="label" htmlFor="pw">Contraseña</label>
          <input id="pw" className="field" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="pw2">Repite la contraseña</label>
          <input id="pw2" className="field" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </div>
        {error && <div className="err" role="alert">{error}</div>}
        <button className="btn primary" style={{ height: 44, justifyContent: 'center' }} disabled={busy}>Crear contraseña</button>
      </form>
    </AuthShell>
  );
}
