/**
 * См. примечание в auth.e2e-spec.ts об условиях запуска (нужен prisma generate).
 */
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Итерация 2: специализированные типы (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;
  let familySpaceId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const email = `iteration2-test-${Date.now()}@example.com`;
    const res = await request(app.getHttpServer()).post('/auth/register').send({
      email,
      password: 'super-secret-password-123',
      fullName: 'Владелец',
      familySpaceName: 'Семья для теста Итерации 2',
    });
    accessToken = res.body.accessToken;
    familySpaceId = res.body.familySpace.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('отклоняет создание паспорта РФ без обязательных полей', async () => {
    const res = await request(app.getHttpServer())
      .post('/documents/passport-rf')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Family-Space-Id', familySpaceId)
      .send({ attributes: { series: '45 00' } });
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(expect.arrayContaining([expect.stringContaining('ФИО')]));
  });

  let passportId: string;

  it('создаёт паспорт РФ с валидными полями', async () => {
    const res = await request(app.getHttpServer())
      .post('/documents/passport-rf')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Family-Space-Id', familySpaceId)
      .send({
        attributes: {
          series: '45 00',
          number: '123456',
          fullName: 'Тестов Тест Тестович',
          birthDate: '1990-01-01',
          issueDate: '2015-05-20',
          issuingAuthority: 'ОВД Тестового района',
        },
      });
    expect(res.status).toBe(201);
    expect(res.body.entityType).toBe('passport_rf');
    passportId = res.body.id;
  });

  it('добавляет вложенную запись о регистрации к паспорту', async () => {
    const res = await request(app.getHttpServer())
      .post(`/documents/passport-rf/${passportId}/child-records`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Family-Space-Id', familySpaceId)
      .send({
        childType: 'passport_registration',
        attributes: { address: 'г. Москва, ул. Тестовая, д. 1', registrationDate: '2020-01-01' },
      });
    expect(res.status).toBe(201);

    const children = await request(app.getHttpServer())
      .get(`/documents/passport-rf/${passportId}/child-records`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Family-Space-Id', familySpaceId);
    expect(children.body.length).toBe(1);
    expect(children.body[0].entityType).toBe('passport_registration');
  });

  it('отклоняет недопустимый childType для паспорта', async () => {
    const res = await request(app.getHttpServer())
      .post(`/documents/passport-rf/${passportId}/child-records`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Family-Space-Id', familySpaceId)
      .send({ childType: 'medication', attributes: { name: 'test' } });
    expect(res.status).toBe(400);
  });

  it('строит иерархию локаций через parentEntityId', async () => {
    const country = await request(app.getHttpServer())
      .post('/entities')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Family-Space-Id', familySpaceId)
      .send({ entityType: 'location', title: 'Россия', attributes: { locationType: 'COUNTRY' } });
    expect(country.status).toBe(201);

    const city = await request(app.getHttpServer())
      .post('/entities')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Family-Space-Id', familySpaceId)
      .send({
        entityType: 'location',
        title: 'Москва',
        attributes: { locationType: 'CITY' },
        parentEntityId: country.body.id,
      });
    expect(city.status).toBe(201);

    const children = await request(app.getHttpServer())
      .get(`/entities/${country.body.id}/children`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Family-Space-Id', familySpaceId);
    expect(children.body.length).toBe(1);
    expect(children.body[0].title).toBe('Москва');

    const roots = await request(app.getHttpServer())
      .get('/entities?entityType=location&rootOnly=true')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Family-Space-Id', familySpaceId);
    expect(roots.body.some((e: any) => e.title === 'Россия')).toBe(true);
    expect(roots.body.some((e: any) => e.title === 'Москва')).toBe(false);
  });

  it('реестр типов доступен через API и содержит паспорт РФ', async () => {
    const res = await request(app.getHttpServer())
      .get('/entity-types')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Family-Space-Id', familySpaceId);
    expect(res.status).toBe(200);
    expect(res.body.some((s: any) => s.entityType === 'passport_rf')).toBe(true);
  });

  it('отклоняет поле, похожее на пароль, в цифровом аккаунте', async () => {
    const res = await request(app.getHttpServer())
      .post('/entities')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Family-Space-Id', familySpaceId)
      .send({
        entityType: 'digital_account',
        title: 'Тестовый аккаунт',
        attributes: { service: 'Google', password: 'qwerty123' },
      });
    expect(res.status).toBe(400);
  });
});
