'use client';

const TOKEN_KEY = 'familyos.accessToken';
const REFRESH_KEY = 'familyos.refreshToken';
const SPACE_KEY = 'familyos.currentFamilySpaceId';

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setTokens(accessToken: string, refreshToken: string) {
  window.localStorage.setItem(TOKEN_KEY, accessToken);
  window.localStorage.setItem(REFRESH_KEY, refreshToken);
}

// Итерация 4.2: токен «запомненного устройства» — отдельно для каждого email
// и НЕ удаляется при выходе (иначе после выхода снова спросит код 2FA).
const DEVICE_PREFIX = 'familyos.device.';

export function getDeviceToken(email: string): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage.getItem(DEVICE_PREFIX + email.trim().toLowerCase()) ?? undefined;
  } catch {
    return undefined;
  }
}

export function setDeviceToken(email: string, token: string | null) {
  try {
    const key = DEVICE_PREFIX + email.trim().toLowerCase();
    if (token) window.localStorage.setItem(key, token);
    else window.localStorage.removeItem(key);
  } catch {
    /* приватный режим — просто не запоминаем */
  }
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(REFRESH_KEY);
}

export function clearTokens() {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_KEY);
  window.localStorage.removeItem(SPACE_KEY);
}

export function getCurrentFamilySpaceId(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(SPACE_KEY);
}

export function setCurrentFamilySpaceId(id: string) {
  window.localStorage.setItem(SPACE_KEY, id);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
  }
}

async function refreshTokens(): Promise<boolean> {
  const refreshToken = window.localStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return false;
  const res = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) return false;
  const data = await res.json();
  setTokens(data.accessToken, data.refreshToken);
  return true;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  familySpaceId?: string | null;
  isForm?: boolean;
  skipAuth?: boolean;
}

export async function apiFetch<T = any>(path: string, options: RequestOptions = {}): Promise<T> {
  const doFetch = async (): Promise<Response> => {
    const headers: Record<string, string> = {};
    const token = getAccessToken();
    if (token && !options.skipAuth) headers['Authorization'] = `Bearer ${token}`;
    const spaceId = options.familySpaceId ?? getCurrentFamilySpaceId();
    if (spaceId) headers['X-Family-Space-Id'] = spaceId;

    let body: BodyInit | undefined;
    if (options.body !== undefined) {
      if (options.isForm) {
        body = options.body as FormData;
      } else {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(options.body);
      }
    }

    return fetch(`/api${path}`, { method: options.method ?? 'GET', headers, body });
  };

  let res = await doFetch();
  if (res.status === 401 && !options.skipAuth) {
    const refreshed = await refreshTokens();
    if (refreshed) {
      res = await doFetch();
    }
  }

  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      /* noop */
    }
    const message = (body as any)?.message ?? `Ошибка запроса (${res.status})`;
    // Итерация 4.2: «Данные не прошли проверку» теперь с перечнем полей —
    // раньше было непонятно, что именно не так (например, не выбрана валюта).
    const details = Array.isArray((body as any)?.errors) ? (body as any).errors.join('; ') : '';
    const text = Array.isArray(message) ? message.join(', ') : String(message);
    throw new ApiError(res.status, details ? `${text}: ${details}` : text, body);
  }

  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return res.json();
  }
  return undefined as T;
}
