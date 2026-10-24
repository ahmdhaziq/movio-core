import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { configureApp } from '../configure-app.js';
import { AuthError } from './exceptions/auth-errors.js';
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
