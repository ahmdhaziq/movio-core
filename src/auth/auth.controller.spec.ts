import { Logger, INestApplication } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { configureApp } from '../configure-app.js';
import { AuthError } from './exceptions/auth-errors.js';
import { useAuthTestEnvironment } from './testing/auth-test-config.js';

useAuthTestEnvironment();
const valid = {
  provider: 'local',
  name: 'Ada',
  email: 'ada@example.com',
  password: 'ExamplePass9!',
};
describe('Registration controller validation', () => {
  let app: INestApplication<App>;
  const service = { register: vi.fn() };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: service }],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => {
    service.register.mockReset().mockResolvedValue({
      user: { id: 1, name: 'Ada', email: 'ada@example.com' },
    });
  });
  it.each([
    ['name', undefined],
    ['name', null],
    ['name', 5],
    ['name', '  '],
    ['name', 'a'.repeat(101)],
    ['email', undefined],
    ['email', null],
    ['email', 5],
    ['email', 'bad'],
    ['email', []],
    ['password', undefined],
    ['password', null],
    ['password', 5],
    ['password', 'short'],
    ['password', 'abcdefg9!'],
    ['provider', undefined],
    ['provider', null],
    ['provider', 'google'],
    ['provider', 'microsoft'],
    ['provider', 'unknown'],
    ['role', 'admin'],
    ['user_id', 1],
    ['identity_id', 'victim'],
    ['password_hash', 'forged'],
  ])('rejects invalid %s without invoking services', async (field, value) => {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ ...valid, [field as string]: value })
      .expect(400);
    expect(response.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      errors: expect.arrayContaining([expect.objectContaining({ field })]),
    });
    expect(service.register).not.toHaveBeenCalled();
    expect(JSON.stringify(response.body)).not.toContain(valid.password);
    expect(response.body).not.toHaveProperty('target');
  });
  it('normalizes name/email and preserves the exact password', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        ...valid,
        name: ' Ada ',
        email: ' ADA@Example.com ',
        password: ' RawPass9! ',
      })
      .expect(201);
    expect(service.register).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Ada',
        email: 'ada@example.com',
        password: ' RawPass9! ',
      }),
    );
  });
  it('logs validation outcome without submitted credentials or body', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    try {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ ...valid, name: '', password: 'SyntheticSecret9!' })
        .expect(400);
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: 'VALIDATION_ERROR',
          correlationId: expect.any(String),
          durationMs: expect.any(Number),
        }),
      );
      expect(JSON.stringify(log.mock.calls)).not.toContain('SyntheticSecret9!');
      expect(JSON.stringify(log.mock.calls)).not.toContain(valid.email);
    } finally {
      log.mockRestore();
    }
  });
});

describe('Login HTTP contract through real pipes', () => {
  let app: INestApplication<App>;
  const service = { login: vi.fn(), register: vi.fn() };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: service }],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => {
    vi.resetAllMocks();
    service.login.mockResolvedValue({
      user: { id: 1, name: 'Ada', email: 'ada@example.com' },
      token_type: 'Bearer',
      access_token: 'synthetic-access',
      refresh_token: 'synthetic-refresh',
    });
  });
  it('accepts flat local input and preserves the exact password', async () => {
    const result = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ provider: 'local', email: ' ADA@Example.com ', password: ' x ' })
      .expect(200);
    expect(service.login).toHaveBeenCalledWith('local', {
      email: 'ada@example.com',
      password: ' x ',
    });
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body.token_type).toBe('Bearer');
  });
  it.each([
    { provider: 'google' },
    { provider: 'local', password: 9 },
    { provider: 'local', email: 'bad' },
    { provider: 'local', email: 'a@b.com', password: 'x', extra: 'secret' },
  ])('rejects malformed fields before dispatch', async (body) => {
    const result = await request(app.getHttpServer())
      .post('/auth/login')
      .send(body)
      .expect(400);
    expect(service.login).not.toHaveBeenCalled();
    expect(result.body.code).toBe('VALIDATION_ERROR');
  });
  it('returns generic login failure', async () => {
    service.login.mockRejectedValueOnce(new AuthError('AUTHENTICATION_FAILED'));
    const result = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        provider: 'local',
        email: 'a@b.com',
        password: 'private-password',
      })
      .expect(401);
    expect(result.body).toEqual({
      statusCode: 401,
      code: 'AUTHENTICATION_FAILED',
      message: 'Email or password is incorrect',
    });
  });
});

describe('Refresh HTTP contract', () => {
  let app: INestApplication<App>;
  const service = { refresh: vi.fn() };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: service }],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => vi.resetAllMocks());
  it('accepts only body refresh credential, no access header required', async () => {
    service.refresh.mockResolvedValue({
      token_type: 'Bearer',
      refresh_token: 'replacement',
    });
    const result = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refresh_token: 'synthetic' })
      .expect(200);
    expect(service.refresh).toHaveBeenCalledWith(
      expect.objectContaining({ refresh_token: 'synthetic' }),
    );
    expect(result.headers['cache-control']).toBe('no-store');
  });
  it.each([
    {},
    { refresh_token: '' },
    { refresh_token: 1 },
    { refresh_token: 'é' },
    { refresh_token: 'x'.repeat(4097) },
    { refresh_token: 'x', user_id: 42 },
  ])('safely rejects malformed body', async (body) => {
    const result = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Authorization', 'Bearer header-only')
      .send(body)
      .expect(400);
    expect(service.refresh).not.toHaveBeenCalled();
    expect(JSON.stringify(result.body)).not.toContain('header-only');
  });
  it.each([
    ['AUTHENTICATION_REQUIRED', 401],
    ['AUTH_TEMPORARILY_UNAVAILABLE', 503],
  ] as const)('maps %s', async (code, status) => {
    service.refresh.mockRejectedValueOnce(new AuthError(code));
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refresh_token: 'synthetic' })
      .expect(status);
  });
});

describe('Logout HTTP contract', () => {
  let app: INestApplication<App>;
  const service = { logout: vi.fn() };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: service }],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => {
    vi.resetAllMocks();
    service.logout.mockResolvedValue({ message: 'Signed out' });
  });
  it.each(['access', 'refresh'])(
    'accepts explicit %s body credential',
    async (token_type) => {
      const result = await request(app.getHttpServer())
        .post('/auth/logout')
        .send({ token_type, token: 'synthetic' })
        .expect(200);
      expect(result.body).toEqual({ message: 'Signed out' });
      expect(result.headers['cache-control']).toBe('no-store');
    },
  );
  it.each([{}, { token_type: 'access' }, { token_type: 'access', token: '' }])(
    'rejects missing credentials with 401 despite access header',
    async (body) => {
      await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', 'Bearer header-only')
        .send(body)
        .expect(401);
      expect(service.logout).not.toHaveBeenCalled();
    },
  );
  it.each([
    { token_type: 'unknown', token: 'x' },
    { token_type: 'access', token: 9 },
    { token_type: 'access', token: 'é' },
    { token_type: 'access', token: 'x'.repeat(4097) },
    { token_type: 'access', token: 'x', user_id: 42 },
  ])('rejects invalid fields safely with 400', async (body) => {
    await request(app.getHttpServer())
      .post('/auth/logout')
      .send(body)
      .expect(400);
    expect(service.logout).not.toHaveBeenCalled();
  });
});
