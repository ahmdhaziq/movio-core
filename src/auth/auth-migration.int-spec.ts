import { testDatabase } from '../prisma/testing/test-database.js';
const baseline = '20261012000000_add_user';
describe('Registration migrations', () => {
  it('upgrades retained users without inventing credentials', async () => {
    const db = testDatabase(baseline);
    try {
      await db.setup();
      const original = await db.prisma.user.create({
        data: {
          name: 'Retained',
          email: ' RETAINED@Example.com ',
          deleted_at: new Date(),
        },
      });
      db.deploy();
      expect(
        await db.prisma.user.findUnique({ where: { id: original.id } }),
      ).toEqual({ ...original, email: 'retained@example.com' });
      expect(await db.prisma.authIdentity.count()).toBe(0);
      await expect(
        db.prisma.user.create({
          data: { name: 'Duplicate', email: 'RETAINED@example.com' },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    } finally {
      await db.cleanup();
    }
  }, 30000);
  it('aborts normalized collisions without partially normalizing retained data', async () => {
    const db = testDatabase(baseline);
    try {
      await db.setup();
      await db.prisma.user.createMany({
        data: [
          { name: 'One', email: ' Duplicate@example.com ' },
          {
            name: 'Two',
            email: 'duplicate@example.com',
            deleted_at: new Date(),
          },
        ],
      });
      const before = await db.prisma.user.findMany({ orderBy: { id: 'asc' } });
      expect(() => db.deploy()).toThrow();
      expect(await db.prisma.user.findMany({ orderBy: { id: 'asc' } })).toEqual(
        before,
      );
      expect(await db.prisma.authIdentity.count()).toBe(0);
    } finally {
      await db.cleanup();
    }
  }, 30000);
});
