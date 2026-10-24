import { hash } from 'argon2';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '../prisma/testing/test-database.js';
import { AuthRepository } from './auth.repository.js';
describe('Login repository (PostgreSQL)', () => {
  const db = testDatabase();
  const repo = new AuthRepository(db.prisma);
  beforeAll(() => db.setup(), 30000);
  afterAll(() => db.cleanup());
  it('selects only local credentials, inserts self-root digests and rolls back failure', async () => {
    const user = await db.prisma.user.create({
      data: { name: 'Ada', email: 'ada@example.com' },
    });
    await db.prisma.authIdentity.create({
      data: { user_id: user.id, provider: 'google', identity_id: 'subject' },
    });
    expect(await repo.findLocalCredentialsByEmail(user.email)).toBeNull();
    const identity = await db.prisma.authIdentity.create({
      data: {
        user_id: user.id,
        provider: 'local',
        identity_id: String(user.id),
        password_hash: await hash('SyntheticPass9!'),
      },
    });
    expect(await repo.findLocalCredentialsByEmail(user.email)).toMatchObject({
      id: identity.id,
      password_hash: identity.password_hash,
    });
    const id = randomUUID();
    const now = new Date(1800000000000);
    const dto = {
      id,
      root_token_id: id,
      user_id: user.id,
      auth_identity_id: identity.id,
      token_hash: 'a'.repeat(64),
      expired_at: new Date(now.getTime() + 2592000000),
      created_at: now,
    };
    await expect(
      repo.withTransaction(async (tx) => {
        await repo.createRefreshToken(dto, tx);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await db.prisma.refreshToken.count()).toBe(0);
    await repo.withTransaction((tx) => repo.createRefreshToken(dto, tx));
    const stored = await db.prisma.refreshToken.findUniqueOrThrow({
      where: { id },
    });
    expect(stored.token_hash).toBe(dto.token_hash);
    expect(stored).not.toHaveProperty('access_token');
    expect(stored).not.toHaveProperty('refresh_token');
  });
});
