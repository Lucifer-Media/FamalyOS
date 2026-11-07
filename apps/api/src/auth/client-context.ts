import { Request } from 'express';
import { normalizeIp } from './device-trust';

export interface AuthContext {
  ipAddress?: string;
  userAgent?: string;
}

/**
 * IP клиента. Web (Next.js) проксирует /api в API и с Итерации 4.2 сам
 * выставляет X-Forwarded-For по реальному адресу сокета (apps/web/server.js),
 * ПЕРЕЗАПИСЫВАЯ то, что прислал клиент, — подделать заголовок через браузер
 * нельзя. API слушает только 127.0.0.1/внутреннюю сеть Docker, поэтому
 * X-Forwarded-For доверяем, только если запрос пришёл из частной сети.
 */
export function clientContext(req: Request): AuthContext {
  const socketIp = normalizeIp(req.socket?.remoteAddress);
  const fromPrivate = !socketIp || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(socketIp);
  const xff = req.headers['x-forwarded-for'];
  const forwarded = fromPrivate && xff ? normalizeIp(Array.isArray(xff) ? xff[0] : xff) : null;
  return { ipAddress: forwarded ?? socketIp ?? undefined, userAgent: (req.headers['user-agent'] as string | undefined)?.slice(0, 400) };
}
