import { AuthTokenService } from './auth-token.service.js';
import { TestAuthClock } from './testing/auth-test-config.js';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';
import { UserService } from '../user/user.service.js';
import { LocalStrategy } from './strategies/local.strategies.js';
import { AuthProvider } from './enums/auth-provider.enum.js';
vi.mock('argon2', () => ({ hash: vi.fn(), argon2id: 2 }));
const dto = {
  provider: AuthProvider.Local as const,
  name: 'Ada',
  email: 'ada@example.com',
  password: 'ExamplePass9!',
};
const user = { id: 1, name: dto.name, email: dto.email };
describe('AuthService', () => {
  const tx = {} as Prisma.TransactionClient;
  const repository = { withTransaction: vi.fn(), getIdentityByUserId: vi.fn() };
  const users = { getUserByEmail: vi.fn(), create: vi.fn() };
  const local = { provider: AuthProvider.Local as const, register: vi.fn() };
  let service: AuthService;
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    vi.mocked(argon2.hash).mockResolvedValue('encoded-hash');
    users.getUserByEmail.mockResolvedValue(null);
    users.create.mockResolvedValue(user);
    local.register.mockResolvedValue({ id: 1 });
    repository.withTransaction.mockImplementation(async (work) => work(tx));
    service = new AuthService(
      repository as unknown as AuthRepository,
      users as unknown as UserService,
      local as unknown as LocalStrategy,
      {} as AuthTokenService,
      new TestAuthClock(),
    );
  });
  afterEach(() => vi.restoreAllMocks());
  it('prepares credentials before atomically creating a user and identity', async () => {
    expect(await service.register(dto)).toEqual({ user });
    expect(argon2.hash).toHaveBeenCalledWith(
      dto.password,
      expect.objectContaining({
        type: 2,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      }),
    );
    expect(users.create).toHaveBeenCalledWith(
      { name: dto.name, email: dto.email },
      tx,
    );
    expect(local.register).toHaveBeenCalledWith({
      userId: 1,
      payload: { passwordHash: 'encoded-hash' },
      tx,
    });
    expect(vi.mocked(argon2.hash).mock.invocationCallOrder[0]).toBeLessThan(
      repository.withTransaction.mock.invocationCallOrder[0],
    );
    expect(users.create.mock.invocationCallOrder[0]).toBeLessThan(
      local.register.mock.invocationCallOrder[0],
    );
  });
  it('does not report success until commit has resolved', async () => {
    let commit!: () => void;
    repository.withTransaction.mockImplementation(async (work) => {
      const result = await work(tx);
      await new Promise<void>((resolve) => {
        commit = resolve;
      });
      return result;
    });
    let settled = false;
    const registration = service.register(dto).then((result) => {
      settled = true;
      return result;
    });
    await vi.waitFor(() => expect(commit).toBeTypeOf('function'));
    expect(settled).toBe(false);
    commit();
    expect(await registration).toEqual({ user });
  });
  it.each([null, new Date()])(
    'rejects retained users even without a local identity',
    async (deleted_at) => {
      users.getUserByEmail.mockResolvedValue({ ...user, deleted_at });
      repository.getIdentityByUserId.mockResolvedValue([]);
      await expect(service.register(dto)).rejects.toMatchObject({
        status: 409,
        response: { code: 'EMAIL_UNAVAILABLE' },
      });
      expect(repository.getIdentityByUserId).toHaveBeenCalledWith(
        user.id,
        'local',
      );
      expect(argon2.hash).not.toHaveBeenCalled();
      expect(repository.withTransaction).not.toHaveBeenCalled();
    },
  );
  it('rejects an email claimed between the precheck and transaction', async () => {
    users.getUserByEmail
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(user);
    await expect(service.register(dto)).rejects.toMatchObject({ status: 409 });
    expect(users.create).not.toHaveBeenCalled();
  });
  it.each(['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2034'])(
    'maps availability %s to 503',
    async (code) => {
      repository.withTransaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('private diagnostics', {
          code,
          clientVersion: '6',
        }),
      );
      await expect(service.register(dto)).rejects.toMatchObject({
        status: 503,
        response: { code: 'REGISTRATION_TEMPORARILY_UNAVAILABLE' },
      });
    },
  );
  it.each([
    'Unable to start a transaction in the given time',
    'A query cannot be executed on an expired transaction',
  ])('recognizes positive P2028 timeout evidence', async (error) => {
    repository.withTransaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('private diagnostics', {
        code: 'P2028',
        clientVersion: '6',
        meta: { error },
      }),
    );
    await expect(service.register(dto)).rejects.toMatchObject({ status: 503 });
  });
  it.each(['P1000', 'P1003', 'P1010', 'P1012', 'P1013', 'P1014', 'P1015'])(
    'maps initialization/configuration %s to 500',
    async (code) => {
      users.getUserByEmail.mockRejectedValue(
        new Prisma.PrismaClientInitializationError(
          'private diagnostics',
          '6',
          code,
        ),
      );
      await expect(service.register(dto)).rejects.toMatchObject({
        status: 500,
        response: { code: 'INTERNAL_ERROR' },
      });
    },
  );
  it('recognizes unavailable initialization errorCode', async () => {
    users.getUserByEmail.mockRejectedValue(
      new Prisma.PrismaClientInitializationError('private', '6', 'P1001'),
    );
    await expect(service.register(dto)).rejects.toMatchObject({ status: 503 });
  });
  it.each([
    ['P2002', { target: ['email'] }, 409, 'EMAIL_UNAVAILABLE'],
    [
      'P2002',
      { target: 'User_email_normalized_key' },
      409,
      'EMAIL_UNAVAILABLE',
    ],
    [
      'P2002',
      { target: ['provider', 'identity_id'] },
      409,
      'IDENTITY_UNAVAILABLE',
    ],
    ['P2002', { target: ['user_id', 'provider'] }, 409, 'IDENTITY_UNAVAILABLE'],
    [
      'P2002',
      { target: 'auth_identity_provider_identity_id_key' },
      409,
      'IDENTITY_UNAVAILABLE',
    ],
    ['P2002', { target: ['unrecognized'] }, 500, 'INTERNAL_ERROR'],
    [
      'P2028',
      { error: 'Transaction was already committed' },
      500,
      'INTERNAL_ERROR',
    ],
    ['P2003', {}, 500, 'INTERNAL_ERROR'],
    ['P2004', {}, 500, 'INTERNAL_ERROR'],
  ])(
    'classifies %s and its constraint/cause',
    async (code, meta, status, outcome) => {
      repository.withTransaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('private diagnostics', {
          code: String(code),
          meta,
          clientVersion: '6',
        }),
      );
      await expect(service.register(dto)).rejects.toMatchObject({
        status,
        response: { code: outcome },
      });
    },
  );
  it.each([
    [Object.assign(new Error('private'), { code: 'ENOMEM' }), 503],
    [Object.assign(new Error('private'), { code: 'EAGAIN' }), 503],
    [new Error('private'), 500],
    [new TypeError('private'), 500],
    [{ code: 'P1001' }, 500],
  ])('classifies hashing failures before any write', async (error, status) => {
    vi.mocked(argon2.hash).mockRejectedValue(error);
    await expect(service.register(dto)).rejects.toMatchObject({ status });
    expect(repository.withTransaction).not.toHaveBeenCalled();
    expect(users.create).not.toHaveBeenCalled();
  });
  it('does not treat arbitrary storage objects or resource errors as hashing failures', async () => {
    repository.withTransaction.mockRejectedValue(
      Object.assign(new Error('private'), { code: 'ENOMEM' }),
    );
    await expect(service.register(dto)).rejects.toMatchObject({ status: 500 });
  });
  it('does not expose diagnostics in unexpected failures', async () => {
    repository.withTransaction.mockRejectedValue(new TypeError(dto.password));
    const error = await service.register(dto).catch((error) => error);
    expect(error.getResponse()).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(error.getResponse())).not.toContain(dto.password);
  });

  it('logs safe outcome metadata on success and failures without credentials', async () => {
    await service.register(dto);
    repository.withTransaction.mockRejectedValue(
      new Error(dto.password + dto.email),
    );
    await expect(service.register(dto)).rejects.toMatchObject({ status: 500 });
    const log = vi.spyOn(Logger.prototype, 'log');
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'SUCCESS',
        provider: 'local',
        correlationId: expect.any(String),
        durationMs: expect.any(Number),
      }),
    );
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'INTERNAL_ERROR' }),
    );
    const output = JSON.stringify(log.mock.calls);
    expect(output).not.toContain(dto.password);
    expect(output).not.toContain(dto.email);
    expect(output).not.toContain('encoded-hash');
  });
  it.each([
    new BadRequestException('private'),
    new ConflictException('private'),
    new HttpException('private', 429),
  ])(
    'preserves recognized dependency outcomes without exposing diagnostics',
    async (original) => {
      users.getUserByEmail.mockRejectedValue(original);
      const failure = await service.register(dto).catch((error) => error);
      expect(failure.getStatus()).toBe(original.getStatus());
      expect(JSON.stringify(failure.getResponse())).not.toContain('private');
    },
  );
  it('rejects an unconfigured strategy before hashing or touching persistence', async () => {
    await expect(
      service.register({
        ...dto,
        provider: AuthProvider.Google as AuthProvider.Local,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(users.getUserByEmail).not.toHaveBeenCalled();
    expect(argon2.hash).not.toHaveBeenCalled();
  });
  it('never trusts a plain object carrying a Prisma error code', async () => {
    repository.withTransaction.mockRejectedValue({ code: 'P1001' });
    await expect(service.register(dto)).rejects.toMatchObject({ status: 500 });
  });
});
