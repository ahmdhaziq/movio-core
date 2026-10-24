import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';
import { AuthTokenService } from './auth-token.service.js';
import { UserService } from '../user/user.service.js';
import { LocalStrategy } from './strategies/local.strategies.js';
import { TestAuthClock } from './testing/auth-test-config.js';
import { AuthError } from './exceptions/auth-errors.js';
describe('Logout orchestration', () => {
  const root = randomUUID();
  const clock = new TestAuthClock(1800000000);
  const tx = {} as Prisma.TransactionClient;
  const repo = {
    withTransaction: vi.fn(),
    lockRefreshRoot: vi.fn(),
    findRefreshTokenById: vi.fn(),
    revokeRefreshFamily: vi.fn(),
  };
  const tokens = {
    verifyAccessToken: vi.fn(),
    verifyRefreshToken: vi.fn(),
    hashRefreshToken: vi.fn(),
  };
  let service: AuthService;
  beforeEach(() => {
    vi.resetAllMocks();
    const row = {
      id: root,
      root_token_id: root,
      user_id: 42,
      auth_identity_id: 7,
      token_hash: 'a'.repeat(64),
      expired_at: new Date(1802592000000),
      consumed_at: null,
      revoked_at: null,
    };
    repo.withTransaction.mockImplementation(async (work) => work(tx));
    repo.lockRefreshRoot.mockResolvedValue(row);
    repo.findRefreshTokenById.mockResolvedValue(row);
    tokens.verifyAccessToken.mockResolvedValue({
      userId: 42,
      authIdentityId: 7,
      refreshFamilyId: root,
    });
    tokens.verifyRefreshToken.mockResolvedValue({
      sub: '42',
      auth_identity_id: 7,
      fid: root,
      jti: root,
      iat: 1800000000,
      exp: 1802592000,
      renewal_exp: 1802592000,
      token_use: 'refresh',
    });
    tokens.hashRefreshToken.mockReturnValue('a'.repeat(64));
    service = new AuthService(
      repo as unknown as AuthRepository,
      {} as UserService,
      {} as LocalStrategy,
      tokens as unknown as AuthTokenService,
      clock,
    );
  });
  it.each(['access', 'refresh'] as const)(
    'revokes only the verified %s family before success',
    async (token_type) => {
      expect(await service.logout({ token_type, token: 'synthetic' })).toEqual({
        message: 'Signed out',
      });
      expect(repo.revokeRefreshFamily).toHaveBeenCalledWith(
        root,
        new Date(clock.now() * 1000),
        tx,
      );
    },
  );
  it('allows consumed refresh for logout identification only', async () => {
    const row = await repo.findRefreshTokenById();
    repo.findRefreshTokenById.mockResolvedValue({
      ...row,
      consumed_at: new Date(),
    });
    await service.logout({ token_type: 'refresh', token: 'consumed' });
    expect(repo.revokeRefreshFamily).toHaveBeenCalledTimes(1);
  });
  it.each([
    'malformed',
    'expired',
    'unknown',
    'revoked',
    'owner-mismatch',
    'bad-digest',
  ])(
    'returns generic confirmation for %s without unrelated changes',
    async (kind) => {
      if (kind === 'malformed' || kind === 'expired')
        tokens.verifyRefreshToken.mockRejectedValueOnce(
          new AuthError('AUTHENTICATION_REQUIRED'),
        );
      if (kind === 'unknown') repo.lockRefreshRoot.mockResolvedValue(null);
      if (kind === 'revoked') {
        const row = await repo.lockRefreshRoot();
        repo.lockRefreshRoot.mockResolvedValue({
          ...row,
          revoked_at: new Date(),
        });
      }
      if (kind === 'owner-mismatch') {
        const row = await repo.lockRefreshRoot();
        repo.lockRefreshRoot.mockResolvedValue({ ...row, user_id: 43 });
      }
      if (kind === 'bad-digest')
        tokens.hashRefreshToken.mockReturnValue('b'.repeat(64));
      expect(
        await service.logout({ token_type: 'refresh', token: 'synthetic' }),
      ).toEqual({ message: 'Signed out' });
      expect(repo.revokeRefreshFamily).not.toHaveBeenCalled();
    },
  );
  it('rejects missing credentials', async () => {
    await expect(
      service.logout({ token_type: 'access', token: '' }),
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
  });
  it('never claims success on required persistence failure', async () => {
    repo.withTransaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('private', {
        code: 'P1001',
        clientVersion: '6',
      }),
    );
    await expect(
      service.logout({ token_type: 'access', token: 'synthetic' }),
    ).rejects.toMatchObject({ code: 'AUTH_TEMPORARILY_UNAVAILABLE' });
  });
});
