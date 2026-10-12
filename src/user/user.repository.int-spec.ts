import { testDatabase } from '../prisma/testing/test-database.js';
import { UserRepository } from './user.repository.js';

describe('UserRepository (PostgreSQL)', () => {
  const db = testDatabase();
  const repository = new UserRepository(db.prisma);
  beforeAll(() => db.setup(), 30000);
  afterAll(() => db.cleanup());
  beforeEach(() => db.prisma.user.deleteMany());

  it('soft deletes once, retains the row/email, and removes active access', async () => {
    const user = await repository.create({
      name: 'Ada',
      email: 'ada@example.com',
    });
    const deleted = await repository.softDelete(user.id);
    expect(deleted.deleted_at).toBeInstanceOf(Date);
    expect(await repository.getUser({ id: user.id })).toEqual(deleted);
    expect(
      await repository.getUser({ id: user.id, deleted_at: null }),
    ).toBeNull();
    expect(await repository.getUserById(user.id)).toBeNull();
    expect(await repository.getUsers(0, 10)).toEqual([]);
    await expect(repository.softDelete(user.id)).rejects.toMatchObject({
      code: 'P2025',
    });
    await expect(repository.softDelete(2147483647)).rejects.toMatchObject({
      code: 'P2025',
    });
    await expect(
      repository.update(user.id, { name: 'No' }),
    ).rejects.toMatchObject({ code: 'P2025' });
    await expect(
      repository.create({ name: 'No', email: user.email }),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(await repository.getUser({ id: user.id })).toEqual(deleted);
  });

  it('updates only supplied fields and preserves data on email conflicts', async () => {
    const user = await repository.create({
      name: 'Ada',
      email: 'ada@example.com',
    });
    await repository.create({ name: 'Other', email: 'other@example.com' });
    const updated = await repository.update(user.id, { name: 'Ada Updated' });
    expect(updated).toMatchObject({
      name: 'Ada Updated',
      email: user.email,
      created_at: user.created_at,
    });
    expect(updated.updated_at.getTime()).toBeGreaterThanOrEqual(
      user.updated_at.getTime(),
    );
    const emailUpdated = await repository.update(user.id, {
      email: 'new@example.com',
    });
    expect(emailUpdated.name).toBe('Ada Updated');
    await expect(
      repository.update(user.id, {
        name: 'Unstored',
        email: 'other@example.com',
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(await repository.getUser({ id: user.id })).toEqual(emailUpdated);
  });
  it('rejects updates to missing and deleted users', async () => {
    await expect(
      repository.update(2147483647, { name: 'No' }),
    ).rejects.toMatchObject({ code: 'P2025' });
    const deleted = await db.prisma.user.create({
      data: {
        name: 'Deleted',
        email: 'deleted@example.com',
        deleted_at: new Date(),
      },
    });
    await expect(
      repository.update(deleted.id, { name: 'No' }),
    ).rejects.toMatchObject({ code: 'P2025' });
    expect(await repository.getUser({ id: deleted.id })).toEqual(deleted);
  });

  it('paginates active profiles in ID order with public fields only', async () => {
    const a = await repository.create({ name: 'A', email: 'a@example.com' });
    const deleted = await repository.create({
      name: 'Deleted',
      email: 'deleted@example.com',
    });
    const b = await repository.create({ name: 'B', email: 'b@example.com' });
    await db.prisma.user.update({
      where: { id: deleted.id },
      data: { deleted_at: new Date() },
    });
    expect(await repository.getUsers(1, 1)).toEqual([
      { id: b.id, name: b.name, created_at: b.created_at },
    ]);
    expect(await repository.getUserById(a.id)).toEqual({
      id: a.id,
      name: a.name,
      created_at: a.created_at,
    });
    expect(await repository.getUserById(deleted.id)).toBeNull();
    expect(await repository.getUserById(2147483647)).toBeNull();
    expect(await repository.getUsers(2, 10)).toEqual([]);
  });

  it('creates generated fields and looks up email, including deleted rows', async () => {
    const user = await repository.create({
      name: 'Ada',
      email: 'ada@example.com',
    });
    expect(user).toMatchObject({
      id: expect.any(Number),
      created_at: expect.any(Date),
      updated_at: expect.any(Date),
      deleted_at: null,
    });
    expect(await repository.getUser({ email: user.email })).toEqual(user);
    await db.prisma.user.update({
      where: { id: user.id },
      data: { deleted_at: new Date() },
    });
    expect(await repository.getUser({ email: user.email })).not.toBeNull();
    expect(
      await repository.getUser({ email: 'missing@example.com' }),
    ).toBeNull();
  });

  it('enforces uniqueness under concurrent creates', async () => {
    const results = await Promise.allSettled([
      repository.create({ name: 'A', email: 'race@example.com' }),
      repository.create({ name: 'B', email: 'race@example.com' }),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === 'rejected'),
    ).toMatchObject({ reason: { code: 'P2002' } });
    expect(await db.prisma.user.count()).toBe(1);
  });
});
