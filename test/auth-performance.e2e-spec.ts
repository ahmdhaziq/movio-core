import { Test } from '@nestjs/testing';
import { INestApplication, Logger } from '@nestjs/common';
import { cpus, platform, arch } from 'node:os';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { testDatabase } from '../src/prisma/testing/test-database.js';
import { useAuthTestEnvironment } from '../src/auth/testing/auth-test-config.js';
import { configureApp } from '../src/configure-app.js';
useAuthTestEnvironment();
describe('Authentication performance (real Argon2/JWT/PostgreSQL)', () => {
  const db = testDatabase();
  let app: INestApplication<App>;
  beforeAll(async () => {
    await db.setup();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(db.prisma)
      .compile();
    app = module.createNestApplication({ logger: false });
    // Test-only trusted tracker; production does not trust arbitrary forwarded IPs.
    app.use(
      (
        req: { headers: Record<string, string> },
        _res: unknown,
        next: () => void,
      ) => {
        Object.defineProperty(req, 'ip', {
          value: req.headers['x-test-ip'] ?? '198.51.100.250',
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
  it('completes at least 95% of 20 logins and 20 refreshes within two seconds per operation', async () => {
    const account = {
      provider: 'local',
      name: 'Benchmark',
      email: 'benchmark@example.com',
      password: 'SyntheticPass9!',
    };
    await request(app.getHttpServer())
      .post('/auth/register')
      .send(account)
      .expect(201);
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    try {
      const logins = await Promise.all(
        Array.from({ length: 20 }, async (_, i) => {
          const start = performance.now();
          const result = await request(app.getHttpServer())
            .post('/auth/login')
            .set('x-test-ip', `203.0.113.${i + 1}`)
            .send({
              provider: account.provider,
              email: account.email,
              password: account.password,
            })
            .expect(200);
          return { ms: performance.now() - start, pair: result.body };
        }),
      );
      const refreshes = await Promise.all(
        logins.map(async (item, i) => {
          const start = performance.now();
          await request(app.getHttpServer())
            .post('/auth/refresh')
            .set('x-test-ip', `203.0.113.${i + 1}`)
            .send({ refresh_token: item.pair.refresh_token })
            .expect(200);
          return performance.now() - start;
        }),
      );
      for (const [operation, values] of [
        ['login', logins.map((x) => x.ms)],
        ['refresh', refreshes],
      ] as const) {
        const sorted = values.toSorted((a, b) => a - b);
        expect(sorted.filter((ms) => ms < 2000).length).toBeGreaterThanOrEqual(
          19,
        );
        process.stdout.write(
          `Authentication benchmark: ${JSON.stringify({ operation, count: 20, p95Ms: Math.round(sorted[18]), maxMs: Math.round(sorted[19]), node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0].model, cpuCount: cpus().length })}\n`,
        );
      }
      expect(await db.prisma.refreshToken.count()).toBe(40);
      const output = JSON.stringify(log.mock.calls);
      for (const secret of [
        account.password,
        account.email,
        ...logins.flatMap((x) => [x.pair.access_token, x.pair.refresh_token]),
      ])
        expect(output).not.toContain(secret);
    } finally {
      log.mockRestore();
    }
  }, 15000);
});
