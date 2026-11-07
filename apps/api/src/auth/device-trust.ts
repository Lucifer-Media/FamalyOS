/**
 * Доверенные устройства (Итерация 4.2) — чистая логика без Prisma.
 *
 * Как работает «Запомнить это устройство»:
 *  - после входа с кодом 2FA и галочкой браузер получает случайный токен
 *    устройства (32 байта), сервер хранит только его sha256;
 *  - при следующем входе браузер передаёт токен вместе с паролем — если
 *    токен действителен, не отозван, не истёк и (по политике) IP уже
 *    известен этому устройству — код 2FA не спрашивается;
 *  - пароль обязателен всегда;
 *  - MAC-адрес не используется: браузер его не передаёт, через Tailscale и
 *    Docker он до сервера не доходит. IP в Tailscale (100.x) закреплён за
 *    устройством ключом WireGuard — поэтому это надёжный второй признак.
 */

export type IpPolicy = 'strict' | 'off';

export interface DeviceRecord {
  userId: string;
  knownIps: string[];
  expiresAt: Date;
  revokedAt: Date | null;
}

export type TrustDecision =
  | { trusted: true }
  | { trusted: false; reason: 'no_device' | 'other_user' | 'revoked' | 'expired' | 'new_ip' };

export function normalizeIp(raw?: string | null): string | null {
  if (!raw) return null;
  let ip = String(raw).split(',')[0].trim();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '::1') ip = '127.0.0.1';
  return ip || null;
}

export function ipPolicyFromEnv(raw = process.env.TRUSTED_DEVICE_IP_POLICY): IpPolicy {
  return raw === 'off' ? 'off' : 'strict';
}

export function decideDeviceTrust(device: DeviceRecord | null, userId: string, ip: string | null, now: Date, policy: IpPolicy): TrustDecision {
  if (!device) return { trusted: false, reason: 'no_device' };
  if (device.userId !== userId) return { trusted: false, reason: 'other_user' };
  if (device.revokedAt) return { trusted: false, reason: 'revoked' };
  if (device.expiresAt <= now) return { trusted: false, reason: 'expired' };
  if (policy === 'strict' && (!ip || !device.knownIps.includes(ip))) return { trusted: false, reason: 'new_ip' };
  return { trusted: true };
}

/** После успешного 2FA с этим устройством — запоминаем IP (не больше 10 последних). */
export function addKnownIp(list: string[], ip: string | null, max = 10): string[] {
  if (!ip) return list;
  const next = [ip, ...list.filter((x) => x !== ip)];
  return next.slice(0, max);
}

/** Человекочитаемое имя устройства по User-Agent: «Chrome · macOS», «Safari · iPhone». */
export function deviceLabel(ua?: string | null): string {
  if (!ua) return 'Неизвестное устройство';
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'Другая ОС';
  const browser = /YaBrowser/.test(ua)
    ? 'Яндекс Браузер'
    : /Edg\//.test(ua)
      ? 'Edge'
      : /OPR\/|Opera/.test(ua)
        ? 'Opera'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Chrome\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : /curl|node|python/i.test(ua)
                ? 'Скрипт'
                : 'Браузер';
  return `${browser} · ${os}`;
}

export function trustedDeviceDays(raw = process.env.TRUSTED_DEVICE_DAYS): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 && n <= 365 ? Math.round(n) : 30;
}

/** Минимальные требования к паролю — те же, что при регистрации (10+ символов). */
export function passwordProblems(password: string, email?: string): string[] {
  const p: string[] = [];
  if (!password || password.length < 10) p.push('Пароль должен быть не короче 10 символов');
  if (password && password.length > 200) p.push('Пароль слишком длинный');
  if (email && password && password.toLowerCase().includes(email.split('@')[0].toLowerCase()) && email.split('@')[0].length >= 4) p.push('Пароль не должен содержать имя из email');
  return p;
}
