import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { testDatabase } from '../src/prisma/testing/test-database.js';
import { configureApp } from '../src/configure-app.js';

describe('Public users (e2e)', () => {
  const db = testDatabase();
  let app: INestApplication<App>;
  beforeAll(async () => {
    await db.setup();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(db.prisma)
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  }, 30000);
  afterAll(async () => {
    if (app) await app.close();
    await db.cleanup();
  });
  beforeEach(() => db.prisma.user.deleteMany());

  it('returns only public active fields, default ten rows, and the next page', async () => {
    const users = [];
    for (let i = 0; i < 12; i++)
      users.push(
        await db.prisma.user.create({
          data: { name: `User ${i}`, email: `user${i}@example.com` },
        }),
      );
    const deleted = await db.prisma.user.create({
      data: {
        name: 'Deleted',
        email: 'deleted@example.com',
        deleted_at: new Date(),
      },
    });
    const response = await request(app.getHttpServer())
      .get('/user/list')
      .expect(200);
    expect(response.body).toHaveLength(10);
    for (const user of response.body)
      expect(Object.keys(user).sort()).toEqual(['created_at', 'id', 'name']);
    const next = await request(app.getHttpServer())
      .get('/user/list?page=2&perPage=10')
      .expect(200);
    expect(next.body.map((user: { id: number }) => user.id)).toEqual(
      users.slice(10).map((user) => user.id),
    );
    const profile = await request(app.getHttpServer())
      .get(`/user/${users[0].id}`)
      .expect(200);
    expect(profile.body).toEqual({
      id: users[0].id,
      name: users[0].name,
      created_at: users[0].created_at.toISOString(),
    });
    await request(app.getHttpServer()).get(`/user/${deleted.id}`).expect(404);
    const max = await request(app.getHttpServer())
      .get('/user/list?perPage=50')
      .expect(200);
    expect(max.body).toHaveLength(12);
    await request(app.getHttpServer()).get('/user/list?page=3').expect(404);
  });
  it('returns 404 for empty lists and missing profiles', async () => {
    await request(app.getHttpServer()).get('/user/list').expect(404);
    await request(app.getHttpServer()).get('/user/2147483647').expect(404);
  });
  it.each([
    '/user/list?perPage=51',
    '/user/list?page=0',
    '/user/list?page=1.5',
    '/user/list?perPage=no',
    '/user/list?filter=x',
    '/user/list?page=999999999999999999999999',
    '/user/no',
    '/user/0',
    '/user/-1',
    '/user/1.5',
    '/user/2147483648',
  ])('returns 400 for %s', async (path) => {
    await request(app.getHttpServer()).get(path).expect(400);
  });
  it('has no creation, update, or delete routes', async () => {
    await request(app.getHttpServer())
      .post('/user/create')
      .send({ name: 'Ada', email: 'ada@example.com' })
      .expect(404);
    await request(app.getHttpServer())
      .patch('/user/1')
      .send({ name: 'Ada' })
      .expect(404);
    await request(app.getHttpServer()).delete('/user/1').expect(404);
  });
});
