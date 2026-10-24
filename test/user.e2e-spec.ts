import { useAuthTestEnvironment } from '../src/auth/testing/auth-test-config.js';
useAuthTestEnvironment();
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { testDatabase } from '../src/prisma/testing/test-database.js';
import { configureApp } from '../src/configure-app.js';

describe('Authenticated users (e2e)', () => {
  const db = testDatabase();
  let app: INestApplication<App>;
  let access: string;
  let client = 0;
  beforeAll(async () => {
    await db.setup();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(db.prisma)
      .compile();
    app = module.createNestApplication();
    app.use((req: object, _res: unknown, next: () => void) => {
      Object.defineProperty(req, 'ip', {
        value: `198.51.100.${client}`,
        configurable: true,
      });
      next();
    });
    configureApp(app);
    await app.init();
  }, 30000);
  afterAll(async () => {
    if (app) await app.close();
    await db.cleanup();
  });
  beforeEach(async () => {
    client++;
    await db.prisma.refreshToken.deleteMany({
      where: {
        NOT: { id: { equals: db.prisma.refreshToken.fields.root_token_id } },
      },
    });
    await db.prisma.refreshToken.deleteMany();
    await db.prisma.authIdentity.deleteMany();
    await db.prisma.user.deleteMany();
    const body = {
      provider: 'local',
      name: 'Caller',
      email: 'caller@example.com',
      password: 'SyntheticPass9!',
    };
    const user = await request(app.getHttpServer())
      .post('/auth/register')
      .send(body)
      .expect(201);
    access = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          provider: body.provider,
          email: body.email,
          password: body.password,
        })
        .expect(200)
    ).body.access_token;
    await db.prisma.user.update({
      where: { id: user.body.user.id },
      data: { deleted_at: new Date() },
    });
  });

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
      .set('Authorization', `Bearer ${access}`)
      .expect(200);
    expect(response.body).toHaveLength(10);
    for (const user of response.body)
      expect(Object.keys(user).sort()).toEqual(['created_at', 'id', 'name']);
    const next = await request(app.getHttpServer())
      .get('/user/list?page=2&perPage=10')
      .set('Authorization', `Bearer ${access}`)
      .expect(200);
    expect(next.body.map((user: { id: number }) => user.id)).toEqual(
      users.slice(10).map((user) => user.id),
    );
    const profile = await request(app.getHttpServer())
      .get(`/user/${users[0].id}`)
      .set('Authorization', `Bearer ${access}`)
      .expect(200);
    expect(profile.body).toEqual({
      id: users[0].id,
      name: users[0].name,
      created_at: users[0].created_at.toISOString(),
    });
    await request(app.getHttpServer())
      .get(`/user/${deleted.id}`)
      .expect(404)
      .set('Authorization', `Bearer ${access}`);
    const max = await request(app.getHttpServer())
      .get('/user/list?perPage=50')
      .set('Authorization', `Bearer ${access}`)
      .expect(200);
    expect(max.body).toHaveLength(12);
    await request(app.getHttpServer())
      .get('/user/list?page=3')
      .expect(404)
      .set('Authorization', `Bearer ${access}`);
  });
  it('returns 404 for empty lists and missing profiles', async () => {
    await request(app.getHttpServer())
      .get('/user/list')
      .expect(404)
      .set('Authorization', `Bearer ${access}`);
    await request(app.getHttpServer())
      .get('/user/2147483647')
      .expect(404)
      .set('Authorization', `Bearer ${access}`);
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
    await request(app.getHttpServer())
      .get(path)
      .expect(400)
      .set('Authorization', `Bearer ${access}`);
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
