import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { configureApp } from '../configure-app.js';
import { AuthError } from './exceptions/auth-errors.js';
import { useAuthTestEnvironment } from './testing/auth-test-config.js';
useAuthTestEnvironment();
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
