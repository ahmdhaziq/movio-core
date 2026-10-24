import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../app.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { testDatabase } from '../prisma/testing/test-database.js';
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';
import { AuthTokenService } from './auth-token.service.js';
import { AuthClock } from './auth-clock.js';
import { AuthProvider } from './enums/auth-provider.enum.js';
import {
  TestAuthClock,
  useAuthTestEnvironment,
} from './testing/auth-test-config.js';
useAuthTestEnvironment();
describe('Refresh transactions and races (PostgreSQL)', () => {
  const db = testDatabase();
  const clock = new TestAuthClock(1800000000);
  let module: Awaited<
    ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>
  >;
  let service: AuthService;
  let repo: AuthRepository;
  let tokens: AuthTokenService;
  const account = {
    provider: AuthProvider.Local as const,
    name: 'Ada',
    email: 'ada@example.com',
    password: 'SyntheticPass9!',
  };
  beforeAll(async () => {
    await db.setup();
    module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(db.prisma)
      .overrideProvider(AuthClock)
      .useValue(clock)
      .compile();
    service = module.get(AuthService);
    repo = module.get(AuthRepository);
    tokens = module.get(AuthTokenService);
  }, 30000);
  afterAll(async () => {
    if (module) await module.close();
    await db.cleanup();
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    clock.seconds = 1800000000;
    await db.prisma.refreshToken.deleteMany({
      where: {
        NOT: { id: { equals: db.prisma.refreshToken.fields.root_token_id } },
      },
    });
    await db.prisma.refreshToken.deleteMany();
    await db.prisma.authIdentity.deleteMany();
    await db.prisma.user.deleteMany();
    await service.register(account);
  });
  const login = () =>
    service.login(AuthProvider.Local, {
      email: account.email,
      password: account.password,
    });
  it('serializes concurrent consumption and commits replay revocation despite public failure', async () => {
    const pair = await login();
    const results = await Promise.allSettled([
      service.refresh({ refresh_token: pair.refresh_token }),
      service.refresh({ refresh_token: pair.refresh_token }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const winner = results.find((r) => r.status === 'fulfilled');
    if (winner?.status !== 'fulfilled') throw new Error('Expected winner');
    const rows = await db.prisma.refreshToken.findMany();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.revoked_at !== null)).toBe(true);
    await expect(
      service.refresh({ refresh_token: winner.value.refresh_token }),
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
    await expect(
      service.validateAccessToken(winner.value.access_token),
    ).resolves.toMatchObject({ userId: pair.user.id });
  });
  it('rolls back consumption if inserting replacement fails and exposes no pair', async () => {
    const pair = await login();
    vi.spyOn(repo, 'createRefreshToken').mockRejectedValueOnce(
      new Error('insert failure'),
    );
    await expect(
      service.refresh({ refresh_token: pair.refresh_token }),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    const row = await db.prisma.refreshToken.findFirstOrThrow();
    expect(row.consumed_at).toBeNull();
    expect(await db.prisma.refreshToken.count()).toBe(1);
    await expect(
      service.refresh({ refresh_token: pair.refresh_token }),
    ).resolves.toHaveProperty('access_token');
  });
  it('does not revoke unrelated families for signed-but-mismatched digest, owner or root', async () => {
    const pair = await login();
    const other = await login();
    const claims = await tokens.verifyRefreshToken(pair.refresh_token);
    for (const patch of [
      { issuedAt: clock.now() - 1 },
      { jti: randomUUID() },
      { refreshFamilyId: randomUUID() },
      { userId: pair.user.id + 1 },
    ]) {
      const forged = await tokens.signRefreshToken({
        userId: pair.user.id,
        authIdentityId: claims.auth_identity_id,
        refreshFamilyId: claims.fid,
        jti: claims.jti,
        issuedAt: clock.now(),
        renewalExpiresAt: claims.renewal_exp,
        ...patch,
      });
      await expect(
        service.refresh({ refresh_token: forged }),
      ).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
    }
    expect(
      await db.prisma.refreshToken.count({
        where: { revoked_at: { not: null } },
      }),
    ).toBe(0);
    await service.refresh({ refresh_token: other.refresh_token });
  });
  it('serializes logout against refresh with the same root lock and preserves independent login', async () => {
    const pair = await login();
    const other = await login();
    const results = await Promise.allSettled([
      service.refresh({ refresh_token: pair.refresh_token }),
      service.logout({ token_type: 'access', token: pair.access_token }),
    ]);
    expect(results[1].status).toBe('fulfilled');
    await expect(
      service.refresh({ refresh_token: pair.refresh_token }),
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
    const refreshed = results[0];
    if (refreshed.status === 'fulfilled')
      await expect(
        service.refresh({ refresh_token: refreshed.value.refresh_token }),
      ).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
    await expect(
      service.refresh({ refresh_token: other.refresh_token }),
    ).resolves.toHaveProperty('access_token');
    await expect(
      service.validateAccessToken(pair.access_token),
    ).resolves.toMatchObject({ userId: pair.user.id });
  });
  it('rolls back revocation on transaction failure and does not claim logout success', async () => {
    const pair = await login();
    const real = repo.revokeRefreshFamily.bind(repo);
    vi.spyOn(repo, 'revokeRefreshFamily').mockImplementationOnce(
      async (...args) => {
        await real(...args);
        throw new Error('rollback after write');
      },
    );
    await expect(
      service.logout({ token_type: 'refresh', token: pair.refresh_token }),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(
      (await db.prisma.refreshToken.findFirstOrThrow()).revoked_at,
    ).toBeNull();
    await expect(
      service.refresh({ refresh_token: pair.refresh_token }),
    ).resolves.toHaveProperty('access_token');
  });
});
