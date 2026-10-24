import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { configureApp } from '../configure-app.js';
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
