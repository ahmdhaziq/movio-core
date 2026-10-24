import { randomUUID } from 'node:crypto';
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';
import { AuthTokenService } from './auth-token.service.js';
import { UserService } from '../user/user.service.js';
import { LocalStrategy } from './strategies/local.strategies.js';
import { TestAuthClock } from './testing/auth-test-config.js';
import type { Prisma } from '@prisma/client';

describe('Refresh orchestration', () => {
  const root = randomUUID();
  const clock = new TestAuthClock(1800000000);
  const tx = {} as Prisma.TransactionClient;
  const user = { id: 42, name: 'Ada', email: 'ada@example.com' };
  const claims = {
    sub: '42',
    auth_identity_id: 7,
    fid: root,
    jti: root,
    iat: 1800000000,
    exp: 1802592000,
    renewal_exp: 1802592000,
    token_use: 'refresh',
  };
  const repo = {
    withTransaction: vi.fn(),
    findRefreshTokenById: vi.fn(),
    lockRefreshRoot: vi.fn(),
    findActiveOwner: vi.fn(),
    consumeRefreshToken: vi.fn(),
    createRefreshToken: vi.fn(),
    revokeRefreshFamily: vi.fn(),
  };
  const tokens = {
    verifyRefreshToken: vi.fn(),
    hashRefreshToken: vi.fn(),
    signAccessToken: vi.fn(),
    signRefreshToken: vi.fn(),
  };
  let service: AuthService;
  beforeEach(() => {
    vi.resetAllMocks();
    clock.seconds = 1800000000;
    const row = {
      id: root,
      root_token_id: root,
      user_id: 42,
      auth_identity_id: 7,
      token_hash: 'a'.repeat(64),
      expired_at: new Date(claims.exp * 1000),
      consumed_at: null,
      revoked_at: null,
    };
    repo.withTransaction.mockImplementation(async (work) => work(tx));
    repo.findRefreshTokenById.mockResolvedValue(row);
    repo.lockRefreshRoot.mockResolvedValue(row);
    repo.findActiveOwner.mockResolvedValue({ id: 7, user });
    repo.consumeRefreshToken.mockResolvedValue(1);
    tokens.verifyRefreshToken.mockResolvedValue(claims);
    tokens.hashRefreshToken.mockReturnValue('a'.repeat(64));
    tokens.signAccessToken.mockResolvedValue('access');
    tokens.signRefreshToken.mockResolvedValue('replacement');
    service = new AuthService(
      repo as unknown as AuthRepository,
      {} as UserService,
      {} as LocalStrategy,
      tokens as unknown as AuthTokenService,
      clock,
    );
  });
  it('consumes before replacing, returns safe user and preserves fixed deadline', async () => {
    const result = await service.refresh({ refresh_token: 'current' });
    expect(result).toMatchObject({
      user,
      access_token: 'access',
      refresh_token: 'replacement',
      refresh_expires_at: new Date(claims.exp * 1000).toISOString(),
    });
    expect(repo.consumeRefreshToken.mock.invocationCallOrder[0]).toBeLessThan(
      repo.createRefreshToken.mock.invocationCallOrder[0],
    );
    expect(repo.createRefreshToken).toHaveBeenCalledWith(
      expect.objectContaining({
        root_token_id: root,
        expired_at: new Date(claims.exp * 1000),
      }),
      tx,
    );
  });
  it('caps near-deadline access and never restarts 30 days', async () => {
    clock.seconds = claims.exp - 1;
    const result = await service.refresh({ refresh_token: 'current' });
    expect(result.access_expires_at).toBe(result.refresh_expires_at);
  });
  it.each(['missing', 'revoked', 'deleted', 'bad-digest'])(
    'rejects %s without issuing tokens',
    async (kind) => {
      if (kind === 'missing') repo.findRefreshTokenById.mockResolvedValue(null);
      if (kind === 'revoked')
        repo.findRefreshTokenById.mockResolvedValue({
          id: root,
          revoked_at: new Date(),
        });
      if (kind === 'deleted') repo.findActiveOwner.mockResolvedValue(null);
      if (kind === 'bad-digest')
        tokens.hashRefreshToken.mockReturnValue('b'.repeat(64));
      await expect(
        service.refresh({ refresh_token: 'invalid' }),
      ).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
      expect(tokens.signAccessToken).not.toHaveBeenCalled();
      expect(repo.revokeRefreshFamily).not.toHaveBeenCalled();
    },
  );
  it('commits consumed-token revocation before throwing 401', async () => {
    const row = await repo.findRefreshTokenById();
    repo.findRefreshTokenById.mockResolvedValue({
      ...row,
      consumed_at: new Date(),
    });
    repo.lockRefreshRoot.mockResolvedValue({ ...row, consumed_at: new Date() });
    let committed = false;
    repo.withTransaction.mockImplementation(async (work) => {
      const value = await work(tx);
      committed = true;
      return value;
    });
    await expect(
      service.refresh({ refresh_token: 'consumed' }),
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
    expect(committed).toBe(true);
    expect(repo.revokeRefreshFamily).toHaveBeenCalledWith(
      root,
      expect.any(Date),
      tx,
    );
    expect(tokens.signAccessToken).not.toHaveBeenCalled();
  });
  it('allows a current descendant even when its root was consumed', async () => {
    const row = await repo.findRefreshTokenById();
    const child = randomUUID();
    tokens.verifyRefreshToken.mockResolvedValue({ ...claims, jti: child });
    repo.findRefreshTokenById.mockImplementation(async (id) =>
      id === root ? { ...row, consumed_at: new Date() } : { ...row, id: child },
    );
    repo.lockRefreshRoot.mockResolvedValue({ ...row, consumed_at: new Date() });
    expect(
      (await service.refresh({ refresh_token: 'child' })).refresh_token,
    ).toBe('replacement');
  });
});
