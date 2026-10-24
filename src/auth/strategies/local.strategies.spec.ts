import type { Prisma } from '@prisma/client';
import { AuthRepository } from '../auth.repository.js';
import { AuthProvider } from '../enums/auth-provider.enum.js';
import { LocalStrategy } from './local.strategies.js';
describe('LocalStrategy', () => {
  const tx = {} as Prisma.TransactionClient;
  const repository = { createIdentity: vi.fn() };
  const strategy = new LocalStrategy(repository as unknown as AuthRepository);
  const context = { userId: 42, payload: { passwordHash: 'encoded' }, tx };
  beforeEach(() => vi.resetAllMocks());
  it('derives identity identifiers and forwards prepared credentials/transaction', async () => {
    repository.createIdentity.mockResolvedValue({
      id: 1,
      user_id: 42,
      provider: 'local',
    });
    const result = await strategy.register(context);
    expect(repository.createIdentity).toHaveBeenCalledWith(
      {
        identity_id: '42',
        user_id: 42,
        provider: AuthProvider.Local,
        password_hash: 'encoded',
      },
      tx,
    );
    expect(result).not.toHaveProperty('password_hash');
  });
  it('propagates persistence failures for rollback', async () => {
    const failure = new Error('synthetic');
    repository.createIdentity.mockRejectedValue(failure);
    await expect(strategy.register(context)).rejects.toBe(failure);
  });
});

describe('LocalStrategy authentication', () => {
  const repository = { findLocalCredentialsByEmail: vi.fn() };
  const strategy = new LocalStrategy(repository as unknown as AuthRepository);
  let record: Record<string, unknown>;
  beforeAll(async () => {
    const { hash } = await import('argon2');
    record = {
      id: 7,
      user_id: 42,
      deleted_at: null,
      password_hash: await hash(' exact password ', {
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      }),
      user: { id: 42, name: 'Ada', email: 'ada@example.com', deleted_at: null },
    };
  });
  beforeEach(() =>
    repository.findLocalCredentialsByEmail.mockResolvedValue(record),
  );
  it('verifies exact password and returns only safe profile and identity id', async () => {
    expect(
      await strategy.authenticate({
        email: 'ada@example.com',
        password: ' exact password ',
      }),
    ).toEqual({
      user: { id: 42, name: 'Ada', email: 'ada@example.com' },
      authIdentityId: 7,
    });
  });
  it.each([
    'unknown',
    'deleted-user',
    'deleted-identity',
    'missing-hash',
    'wrong-password',
  ])('returns the same domain failure for %s', async (kind) => {
    repository.findLocalCredentialsByEmail.mockResolvedValue(
      kind === 'unknown'
        ? null
        : {
            ...record,
            ...(kind === 'deleted-user'
              ? { user: { ...(record.user as object), deleted_at: new Date() } }
              : {}),
            ...(kind === 'deleted-identity' ? { deleted_at: new Date() } : {}),
            ...(kind === 'missing-hash' ? { password_hash: null } : {}),
          },
    );
    await expect(
      strategy.authenticate({
        email: 'ada@example.com',
        password: kind === 'wrong-password' ? 'wrong' : ' exact password ',
      }),
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' });
  });
  it('distinguishes corrupt stored hashes from mismatches', async () => {
    repository.findLocalCredentialsByEmail.mockResolvedValue({
      ...record,
      password_hash: 'corrupt',
    });
    await expect(
      strategy.authenticate({ email: 'ada@example.com', password: 'x' }),
    ).rejects.not.toMatchObject({ code: 'AUTHENTICATION_FAILED' });
  });
});
