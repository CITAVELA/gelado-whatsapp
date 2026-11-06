import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../lib/auth';

/** Solo rutas internas de la app («/bandeja…»); nunca «//host» ni «/\host» (redirección abierta). */
export function safeFrom(from: unknown): string {
  if (typeof from !== 'string' || !from.startsWith('/') || from.startsWith('//') || from.includes('\\') || /^\/[^/]*:/.test(from)) return '/bandeja';
  return from;
}

export function LoginPage() {
  const { user, login } = useAuth();
  const loc = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to={safeFrom((loc.state as any)?.from)} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
    } catch (err: any) {
      setError(err?.message ?? 'No se pudo entrar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div>
          <label className="label" htmlFor="correo">Correo</label>
          <input id="correo" className="field" style={{ height: 42 }} type="email" autoComplete="username" placeholder="tu@correo.es" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="clave">Contraseña</label>
          <input id="clave" className="field" style={{ height: 42 }} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && <div className="err" role="alert">{error}</div>}
        <button className="btn primary" style={{ height: 44, justifyContent: 'center' }} disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
        <div className="hint" style={{ textAlign: 'center' }}>¿Olvidaste tu contraseña? Pídele un enlace nuevo a la administradora.</div>
      </form>
    </AuthShell>
  );
}

export function AuthShell({ children, subtitle = 'WhatsApp del equipo' }: { children: React.ReactNode; subtitle?: string }) {
  return (
    <div style={{ width: '100%', minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#121417', position: 'relative' }}>
      <div style={{ width: 400, maxWidth: '92%', background: '#fff', borderRadius: 16, padding: 32, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img className="logo" src="/favicon.png" alt="Gelado" width={48} height={48} style={{ margin: 0, width: 48, height: 48 }} />
          <div><div style={{ fontWeight: 800, fontSize: 18 }}>Exclusivas Gelado</div><div className="hint">{subtitle}</div></div>
        </div>
        {children}
      </div>
      <a href="/privacidad" className="hint" style={{ position: 'absolute', bottom: 16, color: '#8A919A' }}>Privacidad</a>
    </div>
  );
}
