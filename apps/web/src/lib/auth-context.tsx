'use client';

import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  apiFetch,
  clearTokens,
  getAccessToken,
  getCurrentFamilySpaceId,
  getDeviceToken,
  getRefreshToken,
  setDeviceToken,
  setCurrentFamilySpaceId,
  setTokens,
} from './api';

export interface FamilySpaceSummary {
  id: string;
  name: string;
  role: string;
  baseCurrency?: string;
}

interface AuthContextValue {
  isAuthenticated: boolean;
  loading: boolean;
  familySpaces: FamilySpaceSummary[];
  currentFamilySpaceId: string | null;
  currentRole: string | null;
  setCurrentFamilySpace: (id: string) => void;
  login: (email: string, password: string, twoFactorCode?: string, rememberDevice?: boolean) => Promise<any>;
  register: (data: {
    email: string;
    password: string;
    fullName: string;
    familySpaceName: string;
  }) => Promise<any>;
  logout: () => void;
  reloadFamilySpaces: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [familySpaces, setFamilySpaces] = useState<FamilySpaceSummary[]>([]);
  const [currentFamilySpaceId, setCurrentId] = useState<string | null>(null);

  const reloadFamilySpaces = useCallback(async () => {
    const spaces = await apiFetch<FamilySpaceSummary[]>('/family-spaces');
    setFamilySpaces(spaces);
    const stored = getCurrentFamilySpaceId();
    const valid = spaces.find((s) => s.id === stored);
    const chosen = valid ? valid.id : spaces[0]?.id ?? null;
    if (chosen) {
      setCurrentFamilySpaceId(chosen);
      setCurrentId(chosen);
    }
  }, []);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      setLoading(false);
      return;
    }
    setIsAuthenticated(true);
    reloadFamilySpaces()
      .catch(() => {
        clearTokens();
        setIsAuthenticated(false);
      })
      .finally(() => setLoading(false));
  }, [reloadFamilySpaces]);

  const login = useCallback(
    async (email: string, password: string, twoFactorCode?: string, rememberDevice?: boolean) => {
      const res = await apiFetch('/auth/login', {
        method: 'POST',
        body: { email, password, twoFactorCode, deviceToken: getDeviceToken(email), rememberDevice: rememberDevice || undefined },
        skipAuth: true,
      });
      if (res.deviceToken) setDeviceToken(email, res.deviceToken);
      setTokens(res.accessToken, res.refreshToken);
      setIsAuthenticated(true);
      await reloadFamilySpaces();
      return res;
    },
    [reloadFamilySpaces],
  );

  const register = useCallback(
    async (data: { email: string; password: string; fullName: string; familySpaceName: string }) => {
      const res = await apiFetch('/auth/register', { method: 'POST', body: data, skipAuth: true });
      setTokens(res.accessToken, res.refreshToken);
      setIsAuthenticated(true);
      setCurrentFamilySpaceId(res.familySpace.id);
      setCurrentId(res.familySpace.id);
      setFamilySpaces([{ id: res.familySpace.id, name: res.familySpace.name, role: 'OWNER' }]);
      return res;
    },
    [],
  );

  const logout = useCallback(() => {
    // Отзываем сессию на сервере (раньше токен просто удалялся из браузера).
    const refreshToken = getRefreshToken();
    if (refreshToken) apiFetch('/auth/logout', { method: 'POST', body: { refreshToken }, skipAuth: true }).catch(() => undefined);
    clearTokens();
    setIsAuthenticated(false);
    setFamilySpaces([]);
    setCurrentId(null);
    router.push('/login');
  }, [router]);

  const setCurrentFamilySpace = useCallback((id: string) => {
    setCurrentFamilySpaceId(id);
    setCurrentId(id);
  }, []);

  const currentRole = familySpaces.find((s) => s.id === currentFamilySpaceId)?.role ?? null;

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        loading,
        familySpaces,
        currentFamilySpaceId,
        currentRole,
        setCurrentFamilySpace,
        login,
        register,
        logout,
        reloadFamilySpaces,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth должен использоваться внутри <AuthProvider>');
  return ctx;
}
