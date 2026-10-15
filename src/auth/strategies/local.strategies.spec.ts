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
