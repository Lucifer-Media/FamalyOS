import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import { AuthService } from '../auth.service';
import { AccountAdminService } from '../account-admin.service';
import { decideDeviceTrust, deviceLabel, normalizeIp, addKnownIp, passwordProblems } from '../device-trust';
import { clientContext } from '../client-context';
import { encryptSecret, hashToken } from '../../common/crypto.util';

process.env.TWO_FACTOR_ENC_KEY = 'a'.repeat(64);
const SECRET = authenticator.generateSecret();

async function setup(opts: { twoFactor?: boolean } = {}) {
  const user: any = {
    id: 'u1',
    email: 'max@example.com',
    passwordHash: await argon2.hash('CorrectHorse42!'),
    status: 'ACTIVE',
    twoFactorEnabled: opts.twoFactor ?? true,
    twoFactorSecret: encryptSecret(SECRET),
    twoFactorRecoveryCodes: null,
  };
  const devices: any[] = [];
  const sessions: any[] = [];
  const attempts: any[] = [];
  const prisma: any = {
    user: {
      findUnique: jest.fn(async ({ where }: any) => (where.email === user.email || where.id === user.id ? user : null)),
      findUniqueOrThrow: jest.fn(async () => user),
      update: jest.fn(async ({ data }: any) => Object.assign(user, data)),
    },
    loginAttempt: { create: jest.fn(async ({ data }: any) => attempts.push(data)) },
    membership: { findMany: jest.fn(async () => []) },
    session: {
      create: jest.fn(async ({ data }: any) => {
        const s = { id: `s${sessions.length + 1}`, revokedAt: null, createdAt: new Date(), ...data };
        sessions.push(s);
        return s;
      }),
      updateMany: jest.fn(async ({ where }: any) => {
        const hit = sessions.filter((s) => s.userId === where.userId && !s.revokedAt && (!where.id?.not || s.id !== where.id.not));
        hit.forEach((s) => (s.revokedAt = new Date()));
        return { count: hit.length };
      }),
      findMany: jest.fn(async () => sessions.filter((s) => !s.revokedAt)),
    },
    trustedDevice: {
      findUnique: jest.fn(async ({ where }: any) => devices.find((d) => d.tokenHash === where.tokenHash) ?? null),
      create: jest.fn(async ({ data }: any) => {
        const d = { id: `d${devices.length + 1}`, revokedAt: null, createdAt: new Date(), ...data };
        devices.push(d);
        return d;
      }),
      update: jest.fn(async ({ where, data }: any) => Object.assign(devices.find((d) => d.id === where.id), data)),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const hit = devices.filter((d) => d.userId === where.userId && !d.revokedAt && (!where.id || d.id === where.id));
        hit.forEach((d) => Object.assign(d, data));
        return { count: hit.length };
      }),
      findMany: jest.fn(async () => devices),
    },
  };
  const jwt = { signAsync: jest.fn(async (p: any) => `jwt-${p.sid}`) };
  const config = { get: () => undefined };
  const audit = { log: jest.fn(async () => undefined) };
  const svc = new AuthService(prisma, jwt as any, config as any, audit as any);
  return { svc, user, devices, sessions, attempts, audit };
}

const MAC = { ipAddress: '100.86.22.10', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36' };

describe('Запомненные устройства', () => {
  it('без 2FA-кода и без устройства — требуется код', async () => {
    const { svc } = await setup();
    await expect(svc.login({ email: 'max@example.com', password: 'CorrectHorse42!' }, MAC)).rejects.toThrow('Требуется код');
  });

  it('вход с кодом + «запомнить» → токен устройства; следующий вход без кода с того же IP', async () => {
    const { svc, devices, audit } = await setup();
    const first = await svc.login({ email: 'max@example.com', password: 'CorrectHorse42!', twoFactorCode: authenticator.generate(SECRET), rememberDevice: true }, MAC);
    expect(first.deviceToken).toHaveLength(64);
    expect(devices[0]).toMatchObject({ label: 'Chrome · macOS', knownIps: ['100.86.22.10'], tokenHash: hashToken(first.deviceToken!) });

    const second = await svc.login({ email: 'max@example.com', password: 'CorrectHorse42!', deviceToken: first.deviceToken }, MAC);
    expect(second.trustedDevice).toBe(true);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.login.trusted_device' }));
  });

  it('пароль обязателен всегда, даже с доверенным устройством', async () => {
    const { svc } = await setup();
    const first = await svc.login({ email: 'max@example.com', password: 'CorrectHorse42!', twoFactorCode: authenticator.generate(SECRET), rememberDevice: true }, MAC);
    await expect(svc.login({ email: 'max@example.com', password: 'wrong-password!!', deviceToken: first.deviceToken }, MAC)).rejects.toThrow('Неверный email или пароль');
  });

  it('новый IP → снова код; после кода IP запоминается и дальше вход без кода', async () => {
    const { svc, devices } = await setup();
    const { deviceToken } = await svc.login({ email: 'max@example.com', password: 'CorrectHorse42!', twoFactorCode: authenticator.generate(SECRET), rememberDevice: true }, MAC);
    const lan = { ...MAC, ipAddress: '192.168.1.23' };
    await expect(svc.login({ email: 'max@example.com', password: 'CorrectHorse42!', deviceToken }, lan)).rejects.toThrow('нового IP');
    await svc.login({ email: 'max@example.com', password: 'CorrectHorse42!', deviceToken, twoFactorCode: authenticator.generate(SECRET) }, lan);
    expect(devices[0].knownIps).toEqual(['192.168.1.23', '100.86.22.10']);
    expect((await svc.login({ email: 'max@example.com', password: 'CorrectHorse42!', deviceToken }, lan)).trustedDevice).toBe(true);
  });

  it('отозванное устройство и смена пароля — снова нужен код', async () => {
    const { svc, devices, sessions } = await setup();
    const { deviceToken } = await svc.login({ email: 'max@example.com', password: 'CorrectHorse42!', twoFactorCode: authenticator.generate(SECRET), rememberDevice: true }, MAC);
    await svc.changePassword('u1', 'CorrectHorse42!', 'NewStrongPass99', 's1');
    expect(devices[0].revokedAt).toBeTruthy();
    expect(sessions[0].revokedAt).toBeNull(); // текущая сессия остаётся
    await expect(svc.login({ email: 'max@example.com', password: 'NewStrongPass99', deviceToken }, MAC)).rejects.toThrow('Требуется код');
  });

  it('смена пароля: нужен текущий пароль и 10+ символов', async () => {
    const { svc } = await setup();
    await expect(svc.changePassword('u1', 'bad', 'NewStrongPass99')).rejects.toThrow('Текущий пароль неверный');
    await expect(svc.changePassword('u1', 'CorrectHorse42!', 'short')).rejects.toThrow('не короче 10');
  });

  it('РЕГРЕССИЯ: setup 2FA при включённой 2FA не выключает её', async () => {
    const { svc, user } = await setup();
    await expect(svc.setupTwoFactor('u1')).rejects.toThrow('уже включена');
    expect(user.twoFactorEnabled).toBe(true);
  });

  it('политика семьи: без обязательной 2FA на настройку не отправляем', async () => {
    const off = await setup({ twoFactor: false });
    (off.svc as any).prisma.membership.findMany = jest.fn(async () => [{ role: 'OWNER', familySpace: { id: 'fs', name: 'Семья', requireTwoFactor: false } }]);
    expect((await off.svc.login({ email: 'max@example.com', password: 'CorrectHorse42!' }, MAC)).twoFactorSetupRequired).toBe(false);
    const on = await setup({ twoFactor: false });
    (on.svc as any).prisma.membership.findMany = jest.fn(async () => [{ role: 'OWNER', familySpace: { id: 'fs', name: 'Семья', requireTwoFactor: true } }]);
    expect((await on.svc.login({ email: 'max@example.com', password: 'CorrectHorse42!' }, MAC)).twoFactorSetupRequired).toBe(true);
  });

  it('сессия хранит устройство и IP', async () => {
    const { svc, sessions } = await setup({ twoFactor: false });
    await svc.login({ email: 'max@example.com', password: 'CorrectHorse42!' }, MAC);
    expect(sessions[0]).toMatchObject({ ipAddress: '100.86.22.10', userAgent: MAC.userAgent });
  });
});

describe('Логика доверия устройству', () => {
  const now = new Date('2026-11-07T12:00:00Z');
  const dev = { userId: 'u1', knownIps: ['100.1.1.1'], expiresAt: new Date('2026-12-01'), revokedAt: null };
  it.each([
    [null, 'u1', '100.1.1.1', 'no_device'],
    [dev, 'u2', '100.1.1.1', 'other_user'],
    [{ ...dev, revokedAt: now }, 'u1', '100.1.1.1', 'revoked'],
    [{ ...dev, expiresAt: new Date('2026-11-01') }, 'u1', '100.1.1.1', 'expired'],
    [dev, 'u1', '100.9.9.9', 'new_ip'],
  ])('%#', (d, user, ip, reason) => {
    expect(decideDeviceTrust(d as any, user, ip, now, 'strict')).toEqual({ trusted: false, reason });
  });
  it('политика off — IP не проверяется', () => {
    expect(decideDeviceTrust(dev, 'u1', '8.8.8.8', now, 'off')).toEqual({ trusted: true });
  });
  it('утилиты', () => {
    expect(normalizeIp('::ffff:100.1.2.3')).toBe('100.1.2.3');
    expect(addKnownIp(['a', 'b'], 'b')).toEqual(['b', 'a']);
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1')).toBe('Safari · iPhone');
    expect(passwordProblems('maxim12345678', 'maxim@x.ru')).toContain('Пароль не должен содержать имя из email');
  });
  it('X-Forwarded-For принимается только из частной сети (web), не от внешнего клиента', () => {
    expect(clientContext({ socket: { remoteAddress: '::ffff:172.18.0.5' }, headers: { 'x-forwarded-for': '100.86.22.10' } } as any).ipAddress).toBe('100.86.22.10');
    expect(clientContext({ socket: { remoteAddress: '8.8.8.8' }, headers: { 'x-forwarded-for': '1.1.1.1' } } as any).ipAddress).toBe('8.8.8.8');
  });
});

describe('Управление учётными записями владельцем', () => {
  function admin(actorRole: string, target: any) {
    const prisma: any = {
      membership: { findUnique: jest.fn(async () => target) },
      user: { update: jest.fn(async () => ({})), findUnique: jest.fn(async () => null), findUniqueOrThrow: jest.fn(async () => target.user) },
      person: { update: jest.fn(async () => ({})) },
      loginAttempt: { findMany: jest.fn(async () => []) },
    };
    const permissions = { getMembership: jest.fn(async () => ({ role: actorRole, userId: 'owner' })), assertCan: jest.fn(async () => undefined) };
    const auth = { revokeAllSessions: jest.fn(async () => 2), revokeAllDevices: jest.fn(async () => 1), listSessions: jest.fn(async () => []), listDevices: jest.fn(async () => []), revokeDevice: jest.fn() };
    const audit = { log: jest.fn(async () => undefined) };
    return { svc: new AccountAdminService(prisma, permissions as any, audit as any, auth as any), prisma, auth, audit };
  }
  const arina = { id: 'm2', familySpaceId: 'fs', userId: 'arina', role: 'PARTNER', personId: 'p2', person: { fullName: 'Арина' }, user: { id: 'arina', email: 'arina@x.ru', twoFactorEnabled: true } };

  it('только владелец', async () => {
    const { svc } = admin('PARTNER', arina);
    await expect(svc.resetPassword('partner', 'fs', 'm2', 'NewStrongPass99')).rejects.toThrow('только владелец');
  });

  it('сброс пароля отзывает сессии и устройства, пишет журнал', async () => {
    const { svc, auth, audit } = admin('OWNER', arina);
    expect(await svc.resetPassword('owner', 'fs', 'm2', 'NewStrongPass99')).toMatchObject({ revokedSessions: 2, revokedDevices: 1 });
    expect(auth.revokeAllSessions).toHaveBeenCalledWith('arina');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'account.password_reset' }));
  });

  it('свой пароль/2FA через админку менять нельзя — только через профиль; ФИО можно', async () => {
    const self = { ...arina, userId: 'owner', role: 'OWNER' };
    const { svc } = admin('OWNER', self);
    await expect(svc.disableTwoFactor('owner', 'fs', 'm2')).rejects.toThrow('Мой профиль');
    await expect(svc.updateProfile('owner', 'fs', 'm2', { fullName: 'Тихомиров Максим' })).resolves.toMatchObject({ changed: ['fullName'] });
  });

  it('смена email: проверка формата и занятости', async () => {
    const { svc, prisma } = admin('OWNER', arina);
    await expect(svc.updateProfile('owner', 'fs', 'm2', { email: 'not-an-email' })).rejects.toThrow('Некорректный email');
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'other' });
    await expect(svc.updateProfile('owner', 'fs', 'm2', { email: 'taken@x.ru' })).rejects.toThrow('занят');
    await svc.updateProfile('owner', 'fs', 'm2', { email: ' Arina.New@X.ru ' });
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'arina' }, data: { email: 'arina.new@x.ru' } });
  });
});

describe('Политика 2FA пространства', () => {
  const { FamilySpacesService } = require('../../family-spaces/family-spaces.service');
  function make(role: string) {
    const prisma: any = { familySpace: { findUniqueOrThrow: jest.fn(async () => ({ requireTwoFactor: true })), update: jest.fn(async ({ data }: any) => data) } };
    const audit = { log: jest.fn(async () => undefined) };
    return { svc: new FamilySpacesService(prisma, { getMembership: async () => ({ role }) } as any, audit as any), audit };
  }
  it('выключить требование может только владелец, с записью в журнал', async () => {
    await expect(make('PARTNER').svc.updateSecurity('u', 'fs', false)).rejects.toThrow('только владелец');
    const { svc, audit } = make('OWNER');
    expect(await svc.updateSecurity('u', 'fs', false)).toEqual({ requireTwoFactor: false });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'security.2fa_optional' }));
  });
});
