import type { AuthenticatedRequest } from '../src/auth/types/authenticated-request.js';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import {
  INestApplication,
  Logger,
  Controller,
  Post,
  Req,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { AuthRepository } from '../src/auth/auth.repository.js';
import { AuthClock } from '../src/auth/auth-clock.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { testDatabase } from '../src/prisma/testing/test-database.js';
import {
  useAuthTestEnvironment,
  TestAuthClock,
} from '../src/auth/testing/auth-test-config.js';
import { configureApp } from '../src/configure-app.js';
useAuthTestEnvironment();
const account = {
  provider: 'local',
  name: 'Ada',
  email: 'ada@example.com',
  password: ' ExactPass9! ',
};
const action = vi.fn();
@Controller('test-auth-action')
class ProtectedActionController {
  @Post()
  run(@Req() req: AuthenticatedRequest) {
    action();
    return req.user;
  }
}
describe('Authentication lifecycle (e2e)', () => {
  const db = testDatabase();
  const clock = new TestAuthClock(1800000000);
  let app: INestApplication<App>;
  let client = 0;
  beforeAll(async () => {
    await db.setup();
    const module = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProtectedActionController],
    })
      .overrideProvider(PrismaService)
      .useValue(db.prisma)
      .overrideProvider(AuthClock)
      .useValue(clock)
      .compile();
    app = module.createNestApplication({ logger: false });
    app.use((req: { ip?: string }, _res: unknown, next: () => void) => {
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
    action.mockReset();
    client++;
    clock.seconds = 1800000000;
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
  const post = (path: string, body: object) =>
    request(app.getHttpServer()).post(`/auth/${path}`).send(body);
  const login = () =>
    post('login', {
      provider: account.provider,
      email: account.email,
      password: account.password,
    });
  const register = () => post('register', account).expect(201);
  it('registers without tokens then logs in with exact deadlines and stores only refresh digests', async () => {
    const registration = await register();
    expect(registration.body).not.toHaveProperty('access_token');
    const result = await post('login', {
      provider: 'local',
      email: ' ADA@Example.com ',
      password: account.password,
    }).expect(200);
    expect(result.body.user).toEqual(registration.body.user);
    expect(result.body.access_expires_at).toBe(
      new Date((clock.now() + 3600) * 1000).toISOString(),
    );
    expect(result.body.refresh_expires_at).toBe(
      new Date((clock.now() + 2592000) * 1000).toISOString(),
    );
    expect(result.headers['cache-control']).toBe('no-store');
    const row = await db.prisma.refreshToken.findFirstOrThrow();
    expect(row.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(row)).not.toContain(result.body.refresh_token);
    expect(JSON.stringify(row)).not.toContain(result.body.access_token);
    await post('login', {
      provider: 'local',
      email: account.email,
      password: account.password.trim(),
    }).expect(401);
    await post('login', {
      provider: 'local',
      email: 'unknown@example.com',
      password: account.password,
    }).expect(401);
    expect(await db.prisma.refreshToken.count()).toBe(1);
  });
  it('returns the same generic failure for deleted accounts and unknown email', async () => {
    await register();
    await db.prisma.user.updateMany({ data: { deleted_at: new Date() } });
    const a = await login().expect(401);
    const b = await post('login', {
      provider: 'local',
      email: 'absent@example.com',
      password: account.password,
    }).expect(401);
    expect(a.body).toEqual(b.body);
    expect(await db.prisma.refreshToken.count()).toBe(0);
  });
  it('discloses no pair after failed persistence and logs no secrets', async () => {
    await register();
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    vi.spyOn(
      app.get(AuthRepository),
      'createRefreshToken',
    ).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('private', {
        code: 'P1001',
        clientVersion: '6',
      }),
    );
    const result = await login().expect(503);
    expect(result.body).toEqual({
      statusCode: 503,
      code: 'AUTH_TEMPORARILY_UNAVAILABLE',
      message: 'Authentication is temporarily unavailable',
    });
    expect(await db.prisma.refreshToken.count()).toBe(0);
    expect(JSON.stringify(log.mock.calls)).not.toContain(account.password);
    expect(JSON.stringify(log.mock.calls)).not.toContain(account.email);
  });
  it('counts validation failures, keeps operation buckets independent, returns retry timing and recovers', async () => {
    await register();
    for (let i = 0; i < 10; i++)
      await post('login', { provider: 'google' }).expect(400);
    const limited = await login().expect(429);
    expect(limited.body.code).toBe('AUTH_RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    await post('register', { ...account, email: 'other@example.com' }).expect(
      201,
    );
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61000);
    try {
      await login().expect(200);
    } finally {
      now.mockRestore();
    }
  });
  it('protects business reads and a new action by default before protected side effects', async () => {
    await register();
    const pair = (await login().expect(200)).body;
    await request(app.getHttpServer()).get('/').expect(200);
    await request(app.getHttpServer()).get('/user/list').expect(401);
    await request(app.getHttpServer()).get('/user/no').expect(401);
    await request(app.getHttpServer())
      .get('/user/list')
      .set('Authorization', `Bearer ${pair.access_token}`)
      .expect(200);
    for (const token of [
      '',
      'wrong',
      pair.refresh_token,
      pair.access_token.slice(0, -4) + 'abcd',
    ]) {
      await request(app.getHttpServer())
        .post('/test-auth-action')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    }
    expect(action).not.toHaveBeenCalled();
    const verify = vi.spyOn(app.get(JwtService), 'verifyAsync');
    const result = await request(app.getHttpServer())
      .post('/test-auth-action')
      .set('Authorization', `Bearer ${pair.access_token}`)
      .expect(201);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(result.body.userId).toBe(pair.user.id);
    expect(action).toHaveBeenCalledTimes(1);
  });
  it('authenticates after account deletion and during auth storage outage until signed expiry', async () => {
    await register();
    const pair = (await login().expect(200)).body;
    await db.prisma.user.updateMany({ data: { deleted_at: new Date() } });
    const repo = app.get(AuthRepository);
    const query = vi
      .spyOn(repo, 'withTransaction')
      .mockRejectedValue(new Error('unavailable'));
    const userLookup = vi
      .spyOn(repo, 'findLocalCredentialsByEmail')
      .mockRejectedValue(new Error('unavailable'));
    clock.advance(3599);
    await request(app.getHttpServer())
      .post('/test-auth-action')
      .set('Authorization', `Bearer ${pair.access_token}`)
      .expect(201);
    expect(query).not.toHaveBeenCalled();
    expect(userLookup).not.toHaveBeenCalled();
    clock.advance(1);
    await request(app.getHttpServer())
      .post('/test-auth-action')
      .set('Authorization', `Bearer ${pair.access_token}`)
      .expect(401);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('renews after access expiry, rotates once and revokes renewal on lost-response replay', async () => {
    await register();
    const first = (await login().expect(200)).body;
    const other = (await login().expect(200)).body;
    clock.advance(3600);
    const second = (
      await post('refresh', { refresh_token: first.refresh_token }).expect(200)
    ).body;
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(second.refresh_expires_at).toBe(first.refresh_expires_at);
    await post('refresh', { refresh_token: first.refresh_token }).expect(401);
    await post('refresh', { refresh_token: second.refresh_token }).expect(401);
    await post('refresh', { refresh_token: other.refresh_token }).expect(200);
    await request(app.getHttpServer())
      .post('/test-auth-action')
      .set('Authorization', `Bearer ${second.access_token}`)
      .expect(201);
    clock.advance(3600);
    await request(app.getHttpServer())
      .post('/test-auth-action')
      .set('Authorization', `Bearer ${second.access_token}`)
      .expect(401);
  });
  it('caps access to one second at the fixed 30-day deadline and rejects both exactly at expiry', async () => {
    await register();
    const first = (await login().expect(200)).body;
    clock.advance(2592000 - 1);
    const last = (
      await post('refresh', { refresh_token: first.refresh_token }).expect(200)
    ).body;
    expect(last.access_expires_at).toBe(first.refresh_expires_at);
    expect(last.refresh_expires_at).toBe(first.refresh_expires_at);
    await request(app.getHttpServer())
      .post('/test-auth-action')
      .set('Authorization', `Bearer ${last.access_token}`)
      .expect(201);
    clock.advance(1);
    await post('refresh', { refresh_token: last.refresh_token }).expect(401);
    await request(app.getHttpServer())
      .post('/test-auth-action')
      .set('Authorization', `Bearer ${last.access_token}`)
      .expect(401);
  });
  it.each(['user', 'identity'])(
    'denies login and renewal after %s deletion',
    async (target) => {
      await register();
      const first = (await login().expect(200)).body;
      if (target === 'user')
        await db.prisma.user.updateMany({ data: { deleted_at: new Date() } });
      else
        await db.prisma.authIdentity.updateMany({
          data: { deleted_at: new Date() },
        });
      await login().expect(401);
      await post('refresh', { refresh_token: first.refresh_token }).expect(401);
      await request(app.getHttpServer())
        .post('/test-auth-action')
        .set('Authorization', `Bearer ${first.access_token}`)
        .expect(201);
    },
  );
  it('limits refresh independently, without requiring access or accepting header fallback', async () => {
    await register();
    for (let i = 0; i < 10; i++)
      await post('refresh', { refresh_token: 'invalid' }).expect(401);
    const limited = await post('refresh', { refresh_token: 'invalid' }).expect(
      429,
    );
    expect(limited.body.code).toBe('AUTH_RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    const pair = (await login().expect(200)).body;
    await request(app.getHttpServer())
      .post('/test-auth-action')
      .set('Authorization', `Bearer ${pair.access_token}`)
      .expect(201);
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61000);
    try {
      await post('refresh', { refresh_token: pair.refresh_token }).expect(200);
    } finally {
      now.mockRestore();
    }
  });

  it.each(['access', 'refresh', 'consumed-refresh'])(
    'logs out using %s, preserving issued access and other logins',
    async (kind) => {
      await register();
      const first = (await login().expect(200)).body;
      const other = (await login().expect(200)).body;
      const current =
        kind === 'consumed-refresh'
          ? (
              await post('refresh', {
                refresh_token: first.refresh_token,
              }).expect(200)
            ).body
          : first;
      const body = {
        token_type: kind === 'access' ? 'access' : 'refresh',
        token: kind === 'access' ? first.access_token : first.refresh_token,
      };
      expect((await post('logout', body).expect(200)).body).toEqual({
        message: 'Signed out',
      });
      await post('logout', body).expect(200);
      await post('refresh', { refresh_token: current.refresh_token }).expect(
        401,
      );
      await post('refresh', { refresh_token: other.refresh_token }).expect(200);
      await request(app.getHttpServer())
        .post('/test-auth-action')
        .set('Authorization', `Bearer ${current.access_token}`)
        .expect(201);
      clock.advance(3600);
      await request(app.getHttpServer())
        .post('/test-auth-action')
        .set('Authorization', `Bearer ${current.access_token}`)
        .expect(401);
    },
  );
  it('gives generic logout for unknown credentials, rejects missing credentials, and stays outside attempt limits', async () => {
    await register();
    const pair = (await login().expect(200)).body;
    for (let i = 0; i < 12; i++)
      await post('logout', { token_type: 'refresh', token: 'unknown' }).expect(
        200,
      );
    await post('logout', {}).expect(401);
    await post('refresh', { refresh_token: pair.refresh_token }).expect(200);
  });
  it.each(['logout', 'refresh'])(
    'sanitizes %s storage/internal failure and shares request correlation in logs',
    async (operation) => {
      await register();
      const pair = (await login().expect(200)).body;
      const body =
        operation === 'logout'
          ? { token_type: 'access', token: pair.access_token }
          : { refresh_token: pair.refresh_token };
      const log = vi
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => {});
      const repo = app.get(AuthRepository);
      vi.spyOn(repo, 'withTransaction').mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('private database password', {
          code: 'P1001',
          clientVersion: '6',
        }),
      );
      const unavailable = await post(operation, body).expect(503);
      expect(unavailable.body.code).toBe('AUTH_TEMPORARILY_UNAVAILABLE');
      expect(JSON.stringify(unavailable.body)).not.toContain('private');
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationId: unavailable.headers['x-request-id'],
        }),
      );
      vi.spyOn(repo, 'withTransaction').mockRejectedValueOnce(
        new Error('private internal diagnostics'),
      );
      const internal = await post(operation, body).expect(500);
      expect(internal.body.code).toBe('INTERNAL_ERROR');
      const logged = JSON.stringify(log.mock.calls);
      for (const secret of [
        account.email,
        account.password,
        pair.access_token,
        pair.refresh_token,
        'private',
        'token_hash',
      ])
        expect(logged).not.toContain(secret);
      await post('refresh', { refresh_token: pair.refresh_token }).expect(200);
    },
  );
  it('sanitizes malformed JSON without echoing submitted secrets', async () => {
    const result = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"password":"PrivateSubmittedSecret" invalid}')
      .expect(400);
    expect(JSON.stringify(result.body)).not.toContain('PrivateSubmittedSecret');
    expect(result.headers['cache-control']).toBe('no-store');
  });
});
