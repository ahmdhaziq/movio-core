import { Logger } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { configureApp } from '../configure-app.js';
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
    service.register
      .mockReset()
      .mockResolvedValue({
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
