import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants.js';
import { RequestMethod } from '@nestjs/common';
import { UserController } from './user.controller.js';
import { UserService } from './user.service.js';
import { ListUsersQueryDto } from './dto/list-users-query.dto.js';

describe('UserController', () => {
  const service = { getUsers: vi.fn(), getUserById: vi.fn() };
  const controller = new UserController(service as unknown as UserService);
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const parse = (value: object) =>
    pipe.transform(value, { type: 'query', metatype: ListUsersQueryDto });
  it('declares only public GET list and profile routes', () => {
    expect(Reflect.getMetadata(PATH_METADATA, UserController)).toBe('user');
    // Route metadata belongs to the unbound method, not a bound copy.
    for (const [method, path] of [
      // oxlint-disable-next-line typescript/unbound-method
      [controller.getUsers, 'list'],
      // oxlint-disable-next-line typescript/unbound-method
      [controller.getUserById, ':id'],
    ] as const) {
      expect(Reflect.getMetadata(PATH_METADATA, method)).toBe(path);
      expect(Reflect.getMetadata(METHOD_METADATA, method)).toBe(
        RequestMethod.GET,
      );
    }
  });
  it('transforms/defaults pagination and forwards service responses', async () => {
    service.getUsers.mockResolvedValue([{ id: 1, name: 'Ada' }]);
    expect(await controller.getUsers(await parse({}))).toEqual([
      { id: 1, name: 'Ada' },
    ]);
    expect(service.getUsers).toHaveBeenLastCalledWith(1, 10);
    await controller.getUsers(await parse({ page: '2', perPage: '50' }));
    expect(service.getUsers).toHaveBeenLastCalledWith(2, 50);
    await controller.getUserById({ id: 7 });
    expect(service.getUserById).toHaveBeenCalledWith(7);
  });
  it.each([
    { page: '0' },
    { page: '-1' },
    { page: '1.5' },
    { page: 'abc' },
    { perPage: '51' },
    { perPage: '0' },
    { filter: 'Ada' },
    { page: ['1', '2'] },
  ])('rejects invalid query %j', async (query) => {
    await expect(parse(query)).rejects.toMatchObject({ status: 400 });
  });
});
