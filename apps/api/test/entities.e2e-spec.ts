/**
 * См. примечание в auth.e2e-spec.ts об условиях запуска (нужен prisma generate).
 */
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Entities versioning (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;
  let familySpaceId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const email = `entities-test-${Date.now()}@example.com`;
    const res = await request(app.getHttpServer()).post('/auth/register').send({
      email,
      password: 'super-secret-password-123',
      fullName: 'Владелец',
      familySpaceName: 'Семья для теста версий',
    });
    accessToken = res.body.accessToken;
    familySpaceId = res.body.familySpace.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('создаёт статью базы знаний как Entity версии 1', async () => {
    const res = await request(app.getHttpServer())
      .post('/knowledge-base/articles')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Family-Space-Id', familySpaceId)
      .send({ title: 'Настройка сервера', content: '# Заметка\nПервая версия' });
    expect(res.status).toBe(201);
    expect(res.body.currentVersion).toBe(1);
  });

  it('изменение статьи создаёт версию 2, не удаляя версию 1', async () => {
    const list = await request(app.getHttpServer())
      .get('/knowledge-base/articles')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Family-Space-Id', familySpaceId);
    const articleId = list.body[0].id;

    await request(app.getHttpServer())
      .patch(`/knowledge-base/articles/${articleId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Family-Space-Id', familySpaceId)
      .send({ content: '# Заметка\nВторая версия' });

    const versions = await request(app.getHttpServer())
      .get(`/knowledge-base/articles/${articleId}/versions`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Family-Space-Id', familySpaceId);

    expect(versions.body.length).toBe(2);
    expect(versions.body.map((v: any) => v.versionNumber).sort()).toEqual([1, 2]);
  });

  it('откат к версии 1 создаёт версию 3 с состоянием версии 1 (история не теряется)', async () => {
    const list = await request(app.getHttpServer())
      .get('/knowledge-base/articles')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Family-Space-Id', familySpaceId);
    const articleId = list.body[0].id;

    const revert = await request(app.getHttpServer())
      .post(`/knowledge-base/articles/${articleId}/revert`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Family-Space-Id', familySpaceId)
      .send({ versionNumber: 1 });

    expect(revert.status).toBe(201);
    expect(revert.body.currentVersion).toBe(3);
    expect(revert.body.attributes.content).toContain('Первая версия');

    const versions = await request(app.getHttpServer())
      .get(`/knowledge-base/articles/${articleId}/versions`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Family-Space-Id', familySpaceId);
    expect(versions.body.length).toBe(3); // ничего не удалено
  });
});
