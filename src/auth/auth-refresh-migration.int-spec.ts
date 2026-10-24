import { randomUUID, createHash } from 'node:crypto';
import { testDatabase } from '../prisma/testing/test-database.js';

const baseline = '20261014000200_normalize_user_email';
describe('Refresh migration (PostgreSQL)', () => {
  it('preserves retained accounts and enforces ownership, roots and one current generation', async () => {
    const db = testDatabase(baseline);
    try {
      await db.setup();
      const users = await Promise.all(
        [null, new Date()].map((deleted_at, i) =>
          db.prisma.user.create({
            data: {
              name: `Retained ${i}`,
              email: `retained${i}@example.com`,
              deleted_at,
            },
          }),
        ),
      );
      const identities = await Promise.all(
        users.map((user) =>
          db.prisma.authIdentity.create({
            data: {
              user_id: user.id,
              provider: 'google',
              identity_id: `subject-${user.id}`,
              deleted_at: user.deleted_at,
            },
          }),
        ),
      );
      db.deploy();
      expect(await db.prisma.user.findMany({ orderBy: { id: 'asc' } })).toEqual(
        users.toSorted((a, b) => a.id - b.id),
      );
      expect(
        await db.prisma.authIdentity.findMany({ orderBy: { id: 'asc' } }),
      ).toEqual(identities.toSorted((a, b) => a.id - b.id));
      const id = randomUUID();
      const now = new Date(Math.floor(Date.now() / 1000) * 1000);
      const root = {
        id,
        root_token_id: id,
        user_id: users[0].id,
        auth_identity_id: identities[0].id,
        token_hash: createHash('sha256').update(id).digest('hex'),
        created_at: now,
        expired_at: new Date(now.getTime() + 2592000000),
      };
      await db.prisma.refreshToken.create({ data: root });
      for (const patch of [
        { id: randomUUID(), token_hash: 'a'.repeat(64) },
        { id: randomUUID(), user_id: users[1].id, token_hash: 'b'.repeat(64) },
        {
          id: randomUUID(),
          auth_identity_id: identities[1].id,
          token_hash: 'c'.repeat(64),
        },
        {
          id: randomUUID(),
          root_token_id: randomUUID(),
          token_hash: 'd'.repeat(64),
        },
      ])
        await expect(
          db.prisma.refreshToken.create({ data: { ...root, ...patch } }),
        ).rejects.toThrow();
      await db.prisma.refreshToken.update({
        where: { id },
        data: { consumed_at: now },
      });
      const child = await db.prisma.refreshToken.create({
        data: { ...root, id: randomUUID(), token_hash: 'e'.repeat(64) },
      });
      await expect(
        db.prisma.refreshToken.delete({ where: { id } }),
      ).rejects.toThrow();
      await db.prisma.refreshToken.delete({ where: { id: child.id } });
      await db.prisma.refreshToken.delete({ where: { id } });
      expect(await db.prisma.refreshToken.count()).toBe(0);
    } finally {
      await db.cleanup();
    }
  }, 30000);
});
