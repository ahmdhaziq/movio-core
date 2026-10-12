import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UserService } from './user.service.js';
import { UserRepository } from './user.repository.js';

const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('test', {
    code,
    clientVersion: '6',
  });
describe('UserService', () => {
  const repository = {
    getUser: vi.fn(),
    create: vi.fn(),
    getUserById: vi.fn(),
    getUsers: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
  };
  const service = new UserService(repository as unknown as UserRepository);
  const input = { name: 'Ada', email: 'ada@example.com' };
  beforeEach(() => vi.resetAllMocks());
  it('checks active existence before soft deleting', async () => {
    repository.getUser.mockResolvedValue({ id: 1 });
    repository.softDelete.mockResolvedValue({ id: 1, deleted_at: new Date() });
    expect(await service.delete(1)).toMatchObject({
      id: 1,
      deleted_at: expect.any(Date),
    });
    expect(repository.getUser).toHaveBeenCalledWith({
      id: 1,
      deleted_at: null,
    });
    expect(repository.softDelete).toHaveBeenCalledWith(1);
    expect(repository.getUser.mock.invocationCallOrder[0]).toBeLessThan(
      repository.softDelete.mock.invocationCallOrder[0],
    );
  });
  it('rejects absent/deleted users before delete', async () => {
    repository.getUser.mockResolvedValue(null);
    await expect(service.delete(1)).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.softDelete).not.toHaveBeenCalled();
  });
  it('handles a concurrent deletion after the existence check', async () => {
    repository.getUser.mockResolvedValue({ id: 1 });
    repository.softDelete.mockRejectedValue(prismaError('P2025'));
    await expect(service.delete(1)).rejects.toBeInstanceOf(NotFoundException);
  });
  it('rejects an empty delete result', async () => {
    repository.getUser.mockResolvedValue({ id: 1 });
    repository.softDelete.mockResolvedValue(null);
    await expect(service.delete(1)).rejects.toBeInstanceOf(NotFoundException);
  });
  it('validates internal create/update inputs before touching persistence', async () => {
    await expect(
      service.create({ name: 'a'.repeat(101), email: 'bad' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.update(1, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.update(1, { email: 'bad' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repository.getUser).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
  });
  it('forwards partial updates without an existence lookup', async () => {
    repository.update.mockResolvedValue({ id: 1, ...input });
    expect(await service.update(1, { name: 'Ada' })).toMatchObject({ id: 1 });
    expect(repository.update).toHaveBeenCalledWith(1, { name: 'Ada' });
    expect(repository.getUser).not.toHaveBeenCalled();
  });
  it.each([
    ['P2002', ConflictException],
    ['P2025', NotFoundException],
  ] as const)('translates update %s', async (code, exception) => {
    repository.update.mockRejectedValue(prismaError(code));
    await expect(service.update(1, { name: 'Ada' })).rejects.toBeInstanceOf(
      exception,
    );
  });
  it('rejects empty update results and preserves repository not-found errors', async () => {
    repository.update.mockResolvedValue(null);
    await expect(service.update(1, { name: 'Ada' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const error = new NotFoundException();
    repository.update.mockRejectedValue(error);
    await expect(service.update(1, { name: 'Ada' })).rejects.toBe(error);
  });
  it('uses pagination defaults and computes skip', async () => {
    repository.getUsers.mockResolvedValue([{ id: 1 }]);
    await service.getUsers();
    expect(repository.getUsers).toHaveBeenLastCalledWith(0, 10);
    await service.getUsers(3, 50);
    expect(repository.getUsers).toHaveBeenLastCalledWith(100, 50);
  });
  it.each([
    [1, 51],
    [0, 10],
    [1, 0],
    [1.5, 10],
    [1, 1.5],
    [NaN, 10],
    [Number.MAX_SAFE_INTEGER, 50],
  ])('rejects invalid pagination %s %s', async (page, perPage) => {
    await expect(service.getUsers(page, perPage)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repository.getUsers).not.toHaveBeenCalled();
  });
  it('returns profiles and rejects missing profiles or empty pages', async () => {
    repository.getUserById.mockResolvedValue({ id: 1 });
    expect(await service.getUserById(1)).toEqual({ id: 1 });
    repository.getUserById.mockResolvedValue(null);
    await expect(service.getUserById(2)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    repository.getUsers.mockResolvedValue([]);
    await expect(service.getUsers()).rejects.toBeInstanceOf(NotFoundException);
  });
  it('checks getUser before creating', async () => {
    repository.getUser.mockResolvedValue(null);
    repository.create.mockResolvedValue({ id: 1, ...input });
    const lookup = vi.spyOn(service, 'getUser');
    expect(await service.create(input)).toMatchObject(input);
    expect(lookup).toHaveBeenCalledWith({ email: input.email });
    expect(repository.create).toHaveBeenCalledWith(input);
    expect(repository.getUser.mock.invocationCallOrder[0]).toBeLessThan(
      repository.create.mock.invocationCallOrder[0],
    );
    lookup.mockRestore();
  });
  it('rejects an existing email without insertion', async () => {
    repository.getUser.mockResolvedValue({ id: 1 });
    await expect(service.create(input)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repository.create).not.toHaveBeenCalled();
  });
  it('translates a concurrent unique failure', async () => {
    repository.create.mockRejectedValue(prismaError('P2002'));
    await expect(service.create(input)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
  it('preserves unexpected errors', async () => {
    const error = new Error('offline');
    repository.create.mockRejectedValue(error);
    await expect(service.create(input)).rejects.toBe(error);
  });
});
