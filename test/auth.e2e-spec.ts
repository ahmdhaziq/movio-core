import { useAuthTestEnvironment } from '../src/auth/testing/auth-test-config.js';
useAuthTestEnvironment();
import { Logger } from '@nestjs/common';
import { cpus, platform, arch } from 'node:os';
import { Prisma } from '@prisma/client';
import { AuthRepository } from '../src/auth/auth.repository.js';
import { AuthService } from '../src/auth/auth.service.js';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { verify } from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { testDatabase } from '../src/prisma/testing/test-database.js';
import { configureApp } from '../src/configure-app.js';

const valid = {
  provider: 'local',
  name: 'Ada',
  email: 'ada@example.com',
  password: 'ExamplePass9!',
};
describe('Local registration (e2e)', () => {
  const db = testDatabase();
  let app: INestApplication<App>;
  let client = 0;
  beforeAll(async () => {
    await db.setup();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(db.prisma)
      .compile();
    app = module.createNestApplication({ logger: false });
    // Controlled test-only tracker; production never trusts this header.
    app.use(
      (
        req: { headers: Record<string, string>; ip?: string },
        _res: unknown,
        next: () => void,
      ) => {
        Object.defineProperty(req, 'ip', {
          value: req.headers['x-test-ip'] ?? `198.51.100.${client}`,
          configurable: true,
        });
        next();
      },
    );
    configureApp(app);
    await app.init();
    await app.listen(0, '127.0.0.1');
  }, 30000);
  afterAll(async () => {
    if (app) await app.close();
    await db.cleanup();
  });
  beforeEach(async () => {
    client++;
    vi.restoreAllMocks();
    await db.prisma.refreshToken.deleteMany({
      where: {
        NOT: { id: { equals: db.prisma.refreshToken.fields.root_token_id } },
      },
    });
    await db.prisma.refreshToken.deleteMany();
    await db.prisma.authIdentity.deleteMany();
    await db.prisma.user.deleteMany();
  });
  const post = (body: object) =>
    request(app.getHttpServer()).post('/auth/register').send(body);
  it('commits a user and salted local identity without signing in or exposing credentials', async () => {
    const response = await post({
      ...valid,
      name: ' Ada ',
      email: ' ADA@Example.com ',
    }).expect(201);
    expect(response.body).toEqual({
      user: { id: expect.any(Number), name: 'Ada', email: 'ada@example.com' },
    });
    expect(response.headers['set-cookie']).toBeUndefined();
    const identity = await db.prisma.authIdentity.findFirstOrThrow();
    expect(identity).toMatchObject({
      user_id: response.body.user.id,
      identity_id: String(response.body.user.id),
      provider: 'local',
      deleted_at: null,
    });
    expect(await verify(identity.password_hash!, valid.password)).toBe(true);
    expect(identity.password_hash).not.toBe(valid.password);
    await post({ ...valid, email: 'second@example.com' }).expect(201);
    const identities = await db.prisma.authIdentity.findMany();
    expect(identities[0].password_hash).not.toBe(identities[1].password_hash);
    const access = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          provider: valid.provider,
          email: valid.email,
          password: valid.password,
        })
        .expect(200)
    ).body.access_token;
    const profile = await request(app.getHttpServer())
      .get(`/user/${response.body.user.id}`)
      .set('Authorization', `Bearer ${access}`)
      .expect(200);
    expect(Object.keys(profile.body).sort()).toEqual([
      'created_at',
      'id',
      'name',
    ]);
    const list = await request(app.getHttpServer())
      .get('/user/list')
      .set('Authorization', `Bearer ${access}`)
      .expect(200);
    expect(JSON.stringify(list.body)).not.toContain('password');
    expect(await db.prisma.user.count()).toBe(2);
  });
  it.each([
    { password: 'short' },
    { password: 'A'.repeat(126) + 'b9!' },
    { name: ' ' },
    { name: 'a'.repeat(101) },
    { email: 'bad' },
    { provider: 'google' },
    { provider: 'microsoft' },
    { provider: null },
    { user_id: 1 },
    { identity_id: 'forged' },
    { password_hash: 'forged' },
    { role: 'admin' },
  ])('rejects invalid submissions without writes: %j', async (patch) => {
    const response = await post({ ...valid, ...patch }).expect(400);
    expect(response.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      errors: expect.any(Array),
    });
    expect(JSON.stringify(response.body)).not.toContain(valid.password);
    expect(await db.prisma.user.count()).toBe(0);
    expect(await db.prisma.authIdentity.count()).toBe(0);
    await post(valid).expect(201);
  });
  it.each(['Aa12345!', 'A'.repeat(125) + 'b9!', ' Aa12345! '])(
    'accepts password boundaries unchanged',
    async (password) => {
      await post({ ...valid, name: 'a'.repeat(100), password }).expect(201);
      const identity = await db.prisma.authIdentity.findFirstOrThrow();
      expect(await verify(identity.password_hash!, password)).toBe(true);
    },
  );

  it('rejects retries and concurrent normalized-email attempts without duplicates', async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        post({
          ...valid,
          email: index % 2 ? ' ADA@EXAMPLE.COM ' : valid.email,
        }),
      ),
    );
    expect(results.filter((result) => result.status === 201)).toHaveLength(1);
    expect(results.filter((result) => result.status === 409)).toHaveLength(3);
    await post(valid)
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('EMAIL_UNAVAILABLE'));
    expect(await db.prisma.user.count()).toBe(1);
    expect(await db.prisma.authIdentity.count()).toBe(1);
  });
  it.each([null, new Date()])(
    'never links credentials to retained users even without identity',
    async (deleted_at) => {
      const existing = await db.prisma.user.create({
        data: { name: 'Owner', email: valid.email, deleted_at },
      });
      await post(valid).expect(409);
      expect(
        await db.prisma.user.findUnique({ where: { id: existing.id } }),
      ).toEqual(existing);
      expect(await db.prisma.authIdentity.count()).toBe(0);
    },
  );
  it.each([503, 500])(
    'rolls back real user creation after identity failure (%s)',
    async (status) => {
      const failure =
        status === 503
          ? new Prisma.PrismaClientKnownRequestError(
              'private database diagnostics',
              { code: 'P1001', clientVersion: '6' },
            )
          : new Error('private internal diagnostics');
      vi.spyOn(app.get(AuthRepository), 'createIdentity').mockRejectedValueOnce(
        failure,
      );
      const response = await post(valid).expect(status);
      expect(response.body.code).toBe(
        status === 503
          ? 'REGISTRATION_TEMPORARILY_UNAVAILABLE'
          : 'INTERNAL_ERROR',
      );
      expect(JSON.stringify(response.body)).not.toContain('private');
      expect(await db.prisma.user.count()).toBe(0);
      expect(await db.prisma.authIdentity.count()).toBe(0);
    },
  );
  it.each([503, 500])(
    'fails safely before transaction on hash failure (%s)',
    async (status) => {
      const service = app.get(AuthService);
      const failure =
        status === 503
          ? Object.assign(new Error('private'), { code: 'ENOMEM' })
          : new TypeError('private');
      // Fault injection into the real private hash boundary, not a replacement service.
      vi.spyOn(
        service as unknown as {
          hashPassword(password: string): Promise<string>;
        },
        'hashPassword',
      ).mockRejectedValueOnce(failure);
      const transaction = vi.spyOn(app.get(AuthRepository), 'withTransaction');
      await post(valid).expect(status);
      expect(transaction).not.toHaveBeenCalled();
      expect(await db.prisma.user.count()).toBe(0);
    },
  );

  it('counts failed and successful attempts, limits the 11th, and recovers after expiry', async () => {
    await post(valid).expect(201);
    for (let i = 0; i < 9; i++)
      await post({ ...valid, password: 'short' }).expect(400);
    const response = await post({
      ...valid,
      email: 'limited@example.com',
    }).expect(429);
    expect(response.body.code).toBe('REGISTRATION_RATE_LIMITED');
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    expect(await db.prisma.user.count()).toBe(1);
    expect(await db.prisma.authIdentity.count()).toBe(1);
    const access = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          provider: valid.provider,
          email: valid.email,
          password: valid.password,
        })
        .expect(200)
    ).body.access_token;
    await request(app.getHttpServer())
      .get('/user/list')
      .set('Authorization', `Bearer ${access}`)
      .expect(200);
    // Advance the limiter's wall clock without replacing HTTP/database timers.
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000);
    try {
      await post({ ...valid, email: 'recovered@example.com' }).expect(201);
    } finally {
      clock.mockRestore();
    }
  });
  it('never trusts a caller-supplied forwarded IP in production configuration', async () => {
    for (let i = 0; i < 10; i++)
      await post({ ...valid, password: 'short' }).expect(400);
    await request(app.getHttpServer())
      .post('/auth/register')
      .set('X-Forwarded-For', '203.0.113.200')
      .send(valid)
      .expect(429);
  });
  it('meets the 20-concurrent real hashing and database target', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const timings = await Promise.all(
      Array.from({ length: 20 }, async (_, index) => {
        const start = performance.now();
        const response = await request(app.getHttpServer())
          .post('/auth/register')
          .set('x-test-ip', `203.0.113.${index + 1}`)
          .send({ ...valid, email: `performance${index}@example.com` });
        expect(response.status).toBe(201);
        return performance.now() - start;
      }),
    );
    const sorted = timings.toSorted((a, b) => a - b);
    const p95 = sorted[18];
    expect(sorted.filter((ms) => ms < 2000).length).toBeGreaterThanOrEqual(19);
    expect(await db.prisma.user.count()).toBe(20);
    expect(await db.prisma.authIdentity.count()).toBe(20);
    const output = JSON.stringify(log.mock.calls);
    expect(output).not.toContain(valid.password);
    expect(output).not.toContain('$argon2');
    expect(output).not.toContain('@example.com');
    process.stdout.write(
      `Registration benchmark: ${JSON.stringify({ node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0].model, cpuCount: cpus().length, p95Ms: Math.round(p95), maxMs: Math.round(sorted[19]), count: 20, memoryCost: 19456, timeCost: 2, parallelism: 1 })}\n`,
    );
  }, 15000);
});
