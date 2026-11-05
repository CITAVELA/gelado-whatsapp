import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { MeDto } from '@gelado/shared';
import { api, setUnauthorizedHandler } from './api';

interface AuthState {
  user: MeDto | null;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  isAdmin: boolean;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MeDto | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    api
      .get<MeDto>('/api/auth/me')
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const value: AuthState = {
    user,
    loading,
    isAdmin: user?.role === 'ADMIN',
    async login(email, password) {
      const me = await api.post<MeDto>('/api/auth/login', { email, password });
      setUser(me);
    },
    async logout() {
      await api.post('/api/auth/logout').catch(() => undefined);
      setUser(null);
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth fuera de AuthProvider');
  return v;
}
