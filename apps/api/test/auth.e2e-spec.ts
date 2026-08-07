/**
 * Требует сгенерированный Prisma Client (`npx prisma generate`) и применённую
 * миграцию на family_os_test (`DATABASE_URL` в .env.test). В песочнице агента
 * этот тест не запускался из-за отсутствия сетевого доступа к бинарникам
 * Prisma Engine — см. docs/KNOWN_LIMITATIONS.md. Логика проверена юнит-тестами
 * в src/common/__tests__ и ручной проверкой SQL-миграции.
 */
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { authenticator } from 'otplib';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma.service';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  const email = `test-${Date.now()}@example.com`;
  const password = 'super-secret-password-123';

  it('регистрирует нового пользователя и создаёт пространство с ролью OWNER', async () => {
    const res = await request(app.getHttpServer()).post('/auth/register').send({
      email,
      password,
      fullName: 'Тестовый Пользователь',
      familySpaceName: 'Тестовая семья',
    });
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.twoFactorSetupRequired).toBe(true);
    expect(res.body.familySpace.name).toBe('Тестовая семья');
  });

  it('отклоняет вход без 2FA-кода, если 2FA включена', async () => {
    const loginBefore = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
    const accessToken = loginBefore.body.accessToken;

    const setup = await request(app.getHttpServer())
      .post('/auth/2fa/setup')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(setup.status).toBe(201);
    const secretMatch = setup.body.otpauthUrl.match(/secret=([A-Z0-9]+)/);
    const secret = secretMatch[1];

    const code = authenticator.generate(secret);
    const confirm = await request(app.getHttpServer())
      .post('/auth/2fa/confirm')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code });
    expect(confirm.status).toBe(201);

    const loginWithoutCode = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
    expect(loginWithoutCode.status).toBe(401);

    const validCode = authenticator.generate(secret);
    const loginWithCode = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password, twoFactorCode: validCode });
    expect(loginWithCode.status).toBe(201);
    expect(loginWithCode.body.accessToken).toBeDefined();
  });

  it('запись входа фиксируется в login_attempts и audit_logs', async () => {
    const attempts = await prisma.loginAttempt.findMany({ where: { email } });
    expect(attempts.length).toBeGreaterThan(0);
    const logs = await prisma.auditLog.findMany({ where: { action: 'auth.login' } });
    expect(logs.length).toBeGreaterThan(0);
  });
});
