import { hash } from 'argon2';
import { testDatabase } from '../prisma/testing/test-database.js';
import { UserRepository } from '../user/user.repository.js';
import { AuthRepository } from './auth.repository.js';
import { AuthProvider } from './enums/auth-provider.enum.js';
describe('AuthRepository (PostgreSQL)', () => {
  const db = testDatabase();
  const repository = new AuthRepository(db.prisma);
  const users = new UserRepository(db.prisma);
  let passwordHash: string;
  beforeAll(async () => {
    await db.setup();
    passwordHash = await hash('SyntheticPass9!');
  }, 30000);
  afterAll(() => db.cleanup());
  beforeEach(async () => {
    await db.prisma.authIdentity.deleteMany();
    await db.prisma.user.deleteMany();
  });
  it('commits user and identity and projects only identity metadata', async () => {
    const identity = await repository.withTransaction(async (tx) => {
      const user = await users.create(
        { name: 'Ada', email: 'ada@example.com' },
        tx,
      );
      return repository.createIdentity(
        {
          user_id: user.id,
          identity_id: String(user.id),
          provider: AuthProvider.Local,
          password_hash: passwordHash,
        },
        tx,
      );
    });
    expect(identity).not.toHaveProperty('password_hash');
    expect(await db.prisma.authIdentity.count()).toBe(1);
    expect(await db.prisma.user.count()).toBe(1);
    expect(await repository.getIdentityByUserId(identity.user_id)).toEqual([
      identity,
    ]);
    expect(
      await repository.getIdentityByUserId(identity.user_id, 'google'),
    ).toEqual([]);
    await db.prisma.authIdentity.update({
      where: { id: identity.id },
      data: { deleted_at: new Date() },
    });
    expect(
      await repository.getIdentityByUserId(identity.user_id, 'local'),
    ).toMatchObject([{ deleted_at: expect.any(Date) }]);
  });
  it('rolls back the new user when identity creation violates its constraints', async () => {
    await expect(
      repository.withTransaction(async (tx) => {
        const user = await users.create(
          { name: 'Rollback', email: 'rollback@example.com' },
          tx,
        );
        await repository.createIdentity(
          {
            user_id: user.id,
            identity_id: 'forged',
            provider: AuthProvider.Local,
            password_hash: passwordHash,
          },
          tx,
        );
      }),
    ).rejects.toThrow();
    expect(await db.prisma.user.count()).toBe(0);
    expect(await db.prisma.authIdentity.count()).toBe(0);
  });
  it('enforces subject and per-user provider reservation even after soft deletion', async () => {
    const one = await users.create({ name: 'One', email: 'one@example.com' });
    const two = await users.create({ name: 'Two', email: 'two@example.com' });
    await db.prisma.authIdentity.create({
      data: {
        user_id: one.id,
        provider: 'google',
        identity_id: 'verified-subject',
        deleted_at: new Date(),
      },
    });
    await expect(
      db.prisma.authIdentity.create({
        data: {
          user_id: two.id,
          provider: 'google',
          identity_id: 'verified-subject',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      db.prisma.authIdentity.create({
        data: {
          user_id: one.id,
          provider: 'google',
          identity_id: 'other-subject',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(await db.prisma.authIdentity.count()).toBe(1);
  });
  it('enforces FK and provider credential CHECKs', async () => {
    const user = await users.create({ name: 'One', email: 'one@example.com' });
    for (const data of [
      { user_id: 2147483647, provider: 'google', identity_id: 'subject' },
      { user_id: user.id, provider: '', identity_id: 'subject' },
      { user_id: user.id, provider: 'google', identity_id: ' ' },
      {
        user_id: user.id,
        provider: 'google',
        identity_id: 'subject',
        password_hash: passwordHash,
      },
      {
        user_id: user.id,
        provider: 'local',
        identity_id: String(user.id),
        password_hash: null,
      },
      {
        user_id: user.id,
        provider: 'local',
        identity_id: String(user.id),
        password_hash: 'plaintext',
      },
    ])
      await expect(db.prisma.authIdentity.create({ data })).rejects.toThrow();
    expect(await db.prisma.authIdentity.count()).toBe(0);
  });
});
