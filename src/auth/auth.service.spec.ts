import {
  BadRequestException,
  ConflictException,
  HttpException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomUUID, createHmac } from 'node:crypto';
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';
import { AuthTokenService } from './auth-token.service.js';
import { AuthTokenConfig } from './auth-token.config.js';
import { UserService } from '../user/user.service.js';
import { LocalStrategy } from './strategies/local.strategies.js';
import { AuthProvider } from './enums/auth-provider.enum.js';
import { AuthError } from './exceptions/auth-errors.js';
import {
  authTestEnvironment,
  TestAuthClock,
} from './testing/auth-test-config.js';

vi.mock('argon2', () => ({ hash: vi.fn(), argon2id: 2 }));
describe('AuthService', () => {
  const dto = {
    provider: AuthProvider.Local as const,
    name: 'Ada',
    email: 'ada@example.com',
    password: 'ExamplePass9!',
  };
  const user = { id: 1, name: dto.name, email: dto.email };

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

describe('Login orchestration', () => {
  const user = { id: 42, name: 'Ada', email: 'ada@example.com' };

  const tx = {} as Prisma.TransactionClient;
  const repository = {
    withTransaction: vi.fn(),
    findActiveOwner: vi.fn(),
    createRefreshToken: vi.fn(),
  };
  const local = { authenticate: vi.fn() };
  const tokens = {
    signAccessToken: vi.fn(),
    signRefreshToken: vi.fn(),
    hashRefreshToken: vi.fn(),
  };
  let service: AuthService;
  beforeEach(() => {
    vi.resetAllMocks();
    local.authenticate.mockResolvedValue({ user, authIdentityId: 7 });
    repository.withTransaction.mockImplementation(async (work) => work(tx));
    repository.findActiveOwner.mockResolvedValue({ id: 7, user });
    tokens.signAccessToken.mockResolvedValue('access');
    tokens.signRefreshToken.mockResolvedValue('refresh');
    tokens.hashRefreshToken.mockReturnValue('a'.repeat(64));
    service = new AuthService(
      repository as unknown as AuthRepository,
      {} as UserService,
      local as unknown as LocalStrategy,
      tokens as unknown as AuthTokenService,
      new TestAuthClock(1800000000),
    );
  });
  it('dispatches only credentials and stores only the refresh digest after ownership recheck', async () => {
    const dto = { email: user.email, password: ' exact ' };
    const result = await service.login(AuthProvider.Local, dto);
    expect(local.authenticate).toHaveBeenCalledWith(dto);
    expect(repository.findActiveOwner).toHaveBeenCalledWith(42, 7, tx);
    expect(repository.createRefreshToken).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 42,
        auth_identity_id: 7,
        token_hash: 'a'.repeat(64),
      }),
      tx,
    );
    expect(result).toMatchObject({
      user,
      token_type: 'Bearer',
      access_token: 'access',
      refresh_token: 'refresh',
      access_expires_at: new Date(1800003600 * 1000).toISOString(),
      refresh_expires_at: new Date(1802592000 * 1000).toISOString(),
    });
  });
  it('waits for commit before disclosing tokens', async () => {
    let commit!: () => void;
    repository.withTransaction.mockImplementation(async (work) => {
      const result = await work(tx);
      await new Promise<void>((r) => {
        commit = r;
      });
      return result;
    });
    let settled = false;
    const login = service
      .login(AuthProvider.Local, { email: user.email, password: 'x' })
      .then((r) => {
        settled = true;
        return r;
      });
    await vi.waitFor(() => expect(commit).toBeTypeOf('function'));
    expect(settled).toBe(false);
    commit();
    await login;
  });
  it('denies ownership becoming inactive before commit', async () => {
    repository.findActiveOwner.mockResolvedValue(null);
    await expect(
      service.login(AuthProvider.Local, { email: user.email, password: 'x' }),
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' });
    expect(repository.createRefreshToken).not.toHaveBeenCalled();
  });
  it.each([
    ['P1001', 'AUTH_TEMPORARILY_UNAVAILABLE'],
    ['P2002', 'INTERNAL_ERROR'],
  ])('classifies storage %s safely', async (code, expected) => {
    repository.withTransaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('secret diagnostic', {
        code,
        clientVersion: '6',
      }),
    );
    await expect(
      service.login(AuthProvider.Local, { email: user.email, password: 'x' }),
    ).rejects.toMatchObject({ code: expected });
  });
  it('discloses no pair when signing fails', async () => {
    tokens.signRefreshToken.mockRejectedValueOnce(new Error('private'));
    await expect(
      service.login(AuthProvider.Local, { email: user.email, password: 'x' }),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(repository.createRefreshToken).not.toHaveBeenCalled();
  });
});

describe('AuthTokenService', () => {
  const config = new AuthTokenConfig(authTestEnvironment);
  const clock = new TestAuthClock(1800000000);
  const jwt = new JwtService();
  const service = new AuthTokenService(jwt, config, clock);
  const context = {
    userId: 42,
    authIdentityId: 7,
    refreshFamilyId: randomUUID(),
    issuedAt: clock.now(),
    renewalExpiresAt: clock.now() + 2592000,
    jti: randomUUID(),
  };
  describe('Purpose-specific signing', () => {
    it('signs exact access and refresh profiles with separate keys/audiences', async () => {
      const access = await service.signAccessToken(context);
      const refresh = await service.signRefreshToken({
        ...context,
        jti: context.refreshFamilyId,
      });
      const claims = await jwt.verifyAsync(access, {
        secret: config.accessSecret,
        algorithms: ['HS256'],
        audience: 'movio-api',
        issuer: 'movio-core',
        clockTimestamp: clock.now(),
      });
      expect(claims).toEqual({
        sub: '42',
        auth_identity_id: 7,
        fid: context.refreshFamilyId,
        jti: context.jti,
        iat: context.issuedAt,
        exp: context.issuedAt + 3600,
        renewal_exp: context.renewalExpiresAt,
        iss: 'movio-core',
        aud: 'movio-api',
        token_use: 'access',
      });
      const refreshClaims = await jwt.verifyAsync(refresh, {
        secret: config.refreshSecret,
        algorithms: ['HS256'],
        audience: 'movio-refresh',
        clockTimestamp: clock.now(),
      });
      expect(refreshClaims).toMatchObject({
        exp: context.renewalExpiresAt,
        fid: context.refreshFamilyId,
        jti: context.refreshFamilyId,
        token_use: 'refresh',
      });
      expect(refreshClaims.jti).not.toBe(claims.jti);
      await expect(
        jwt.verifyAsync(refresh, { secret: config.accessSecret }),
      ).rejects.toThrow();
      expect(service.hashRefreshToken(refresh)).toMatch(/^[0-9a-f]{64}$/);
    });
    it('caps access at the fixed original renewal deadline', async () => {
      const token = await service.signAccessToken({
        ...context,
        renewalExpiresAt: clock.now() + 5,
      });
      expect(jwt.decode(token)?.exp).toBe(clock.now() + 5);
    });
    it('propagates signing failure without a usable result', async () => {
      const sign = vi
        .spyOn(jwt, 'signAsync')
        .mockRejectedValueOnce(new Error('private'));
      try {
        await expect(service.signAccessToken(context)).rejects.toThrow();
      } finally {
        sign.mockRestore();
      }
    });
  });

  describe('Stateless access verification', () => {
    beforeEach(() => {
      clock.seconds = 1800000000;
    });
    const base = {
      sub: '42',
      auth_identity_id: 7,
      fid: context.refreshFamilyId,
      jti: context.jti,
      iat: 1800000000,
      exp: 1800003600,
      renewal_exp: 1802592000,
      token_use: 'access',
    };
    const sign = (claims: object, options: object = {}) =>
      jwt.signAsync(claims, {
        secret: config.accessSecret,
        algorithm: 'HS256',
        issuer: config.issuer,
        audience: config.accessAudience,
        ...options,
      });
    it('performs exactly one signature verification and returns only verified principal', async () => {
      const token = await service.signAccessToken(context);
      const verify = vi.spyOn(jwt, 'verifyAsync');
      try {
        expect(await service.verifyAccessToken(token)).toEqual({
          userId: 42,
          authIdentityId: 7,
          refreshFamilyId: context.refreshFamilyId,
        });
        expect(verify).toHaveBeenCalledTimes(1);
      } finally {
        verify.mockRestore();
      }
    });
    const malformedSigned = (claims: object) => {
      const header = Buffer.from(
        JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
      ).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({
          ...claims,
          iss: config.issuer,
          aud: config.accessAudience,
        }),
      ).toString('base64url');
      const input = `${header}.${payload}`;
      return `${input}.${createHmac('sha256', config.accessSecret).update(input).digest('base64url')}`;
    };
    it.each([
      { sub: '042' },
      { sub: 42 },
      { sub: '-1' },
      { auth_identity_id: 0 },
      { auth_identity_id: '7' },
      { fid: 'bad' },
      { jti: null },
      { exp: undefined },
      { exp: 1800000000 },
      { iat: 1800000001 },
      { iat: '1800000000' },
      { token_use: 'refresh' },
      { renewal_exp: 1800000001 },
      { exp: 1800003601 },
    ])('rejects invalid runtime claims %j', async (patch) => {
      await expect(
        service.verifyAccessToken(malformedSigned({ ...base, ...patch })),
      ).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
    });
    it.each([
      { secret: config.refreshSecret },
      { algorithm: 'HS384' },
      { issuer: 'other' },
      { audience: 'movio-refresh' },
    ])('rejects wrong cryptographic profile %j', async (options) => {
      await expect(
        service.verifyAccessToken(await sign(base, options)),
      ).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
    });
    it('uses current clock on every verification, rejecting exactly at expiry', async () => {
      const token = await service.signAccessToken(context);
      clock.advance(3599);
      await service.verifyAccessToken(token);
      clock.advance(1);
      await expect(service.verifyAccessToken(token)).rejects.toMatchObject({
        code: 'AUTHENTICATION_REQUIRED',
      });
    });
    it('rejects refresh-purpose tokens as access', async () => {
      await expect(
        service.verifyAccessToken(await service.signRefreshToken(context)),
      ).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
    });
  });

  describe('Refresh cryptographic profile', () => {
    beforeEach(() => {
      clock.seconds = 1800000000;
    });
    it('rejects access credentials at the refresh verifier', async () => {
      await expect(
        service.verifyRefreshToken(await service.signAccessToken(context)),
      ).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
    });
    it.each([
      { token_use: 'access' },
      { exp: 1802591999 },
      { renewal_exp: 1802591999 },
      { iat: 1800000001 },
      { sub: '0' },
      { fid: 'bad' },
      { auth_identity_id: '7' },
      { exp: undefined },
    ])('rejects invalid refresh claims %j', async (patch) => {
      const claims = {
        sub: '42',
        auth_identity_id: 7,
        fid: context.refreshFamilyId,
        jti: context.jti,
        iat: 1800000000,
        exp: 1802592000,
        renewal_exp: 1802592000,
        token_use: 'refresh',
        iss: config.issuer,
        aud: config.refreshAudience,
        ...patch,
      };
      const header = Buffer.from(
        JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
      ).toString('base64url');
      const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
      const input = `${header}.${payload}`;
      const raw = `${input}.${createHmac('sha256', config.refreshSecret).update(input).digest('base64url')}`;
      await expect(service.verifyRefreshToken(raw)).rejects.toMatchObject({
        code: 'AUTHENTICATION_REQUIRED',
      });
    });
    it('accepts immediately before and rejects exactly at the renewal deadline', async () => {
      const raw = await service.signRefreshToken(context);
      clock.seconds = context.renewalExpiresAt - 1;
      await service.verifyRefreshToken(raw);
      clock.advance(1);
      await expect(service.verifyRefreshToken(raw)).rejects.toMatchObject({
        code: 'AUTHENTICATION_REQUIRED',
      });
    });
    it('preserves unexpected verifier failures instead of classifying them as invalid credentials', async () => {
      const verify = vi
        .spyOn(jwt, 'verifyAsync')
        .mockRejectedValueOnce(new Error('unexpected internal failure'));
      try {
        await expect(service.verifyAccessToken('synthetic')).rejects.toThrow(
          'unexpected internal failure',
        );
      } finally {
        verify.mockRestore();
      }
    });
  });
});

describe('Stateless AuthService access', () => {
  it('authenticates with unavailable persistence and performs no database calls', async () => {
    const repository = {
      withTransaction: vi.fn(() => {
        throw new Error('unavailable');
      }),
    };
    const users = {
      getUserByEmail: vi.fn(() => {
        throw new Error('unavailable');
      }),
    };
    const clock = new TestAuthClock(1800000000);
    const tokens = new AuthTokenService(
      new JwtService(),
      new AuthTokenConfig(authTestEnvironment),
      clock,
    );
    const service = new AuthService(
      repository as unknown as AuthRepository,
      users as unknown as UserService,
      {} as LocalStrategy,
      tokens,
      clock,
    );
    const root = randomUUID();
    const raw = await tokens.signAccessToken({
      userId: 42,
      authIdentityId: 7,
      refreshFamilyId: root,
      jti: randomUUID(),
      issuedAt: clock.now(),
      renewalExpiresAt: clock.now() + 2592000,
    });
    expect(await service.validateAccessToken(raw)).toEqual({
      userId: 42,
      authIdentityId: 7,
      refreshFamilyId: root,
    });
    expect(repository.withTransaction).not.toHaveBeenCalled();
    expect(users.getUserByEmail).not.toHaveBeenCalled();
  });
});

describe('Refresh orchestration', () => {
  const root = randomUUID();
  const clock = new TestAuthClock(1800000000);
  const tx = {} as Prisma.TransactionClient;
  const user = { id: 42, name: 'Ada', email: 'ada@example.com' };
  const claims = {
    sub: '42',
    auth_identity_id: 7,
    fid: root,
    jti: root,
    iat: 1800000000,
    exp: 1802592000,
    renewal_exp: 1802592000,
    token_use: 'refresh',
  };
  const repo = {
    withTransaction: vi.fn(),
    findRefreshTokenById: vi.fn(),
    lockRefreshRoot: vi.fn(),
    findActiveOwner: vi.fn(),
    consumeRefreshToken: vi.fn(),
    createRefreshToken: vi.fn(),
    revokeRefreshFamily: vi.fn(),
  };
  const tokens = {
    verifyRefreshToken: vi.fn(),
    hashRefreshToken: vi.fn(),
    signAccessToken: vi.fn(),
    signRefreshToken: vi.fn(),
  };
  let service: AuthService;
  beforeEach(() => {
    vi.resetAllMocks();
    clock.seconds = 1800000000;
    const row = {
      id: root,
      root_token_id: root,
      user_id: 42,
      auth_identity_id: 7,
      token_hash: 'a'.repeat(64),
      expired_at: new Date(claims.exp * 1000),
      consumed_at: null,
      revoked_at: null,
    };
    repo.withTransaction.mockImplementation(async (work) => work(tx));
    repo.findRefreshTokenById.mockResolvedValue(row);
    repo.lockRefreshRoot.mockResolvedValue(row);
    repo.findActiveOwner.mockResolvedValue({ id: 7, user });
    repo.consumeRefreshToken.mockResolvedValue(1);
    tokens.verifyRefreshToken.mockResolvedValue(claims);
    tokens.hashRefreshToken.mockReturnValue('a'.repeat(64));
    tokens.signAccessToken.mockResolvedValue('access');
    tokens.signRefreshToken.mockResolvedValue('replacement');
    service = new AuthService(
      repo as unknown as AuthRepository,
      {} as UserService,
      {} as LocalStrategy,
      tokens as unknown as AuthTokenService,
      clock,
    );
  });
  it('consumes before replacing, returns safe user and preserves fixed deadline', async () => {
    const result = await service.refresh({ refresh_token: 'current' });
    expect(result).toMatchObject({
      user,
      access_token: 'access',
      refresh_token: 'replacement',
      refresh_expires_at: new Date(claims.exp * 1000).toISOString(),
    });
    expect(repo.consumeRefreshToken.mock.invocationCallOrder[0]).toBeLessThan(
      repo.createRefreshToken.mock.invocationCallOrder[0],
    );
    expect(repo.createRefreshToken).toHaveBeenCalledWith(
      expect.objectContaining({
        root_token_id: root,
        expired_at: new Date(claims.exp * 1000),
      }),
      tx,
    );
  });
  it('caps near-deadline access and never restarts 30 days', async () => {
    clock.seconds = claims.exp - 1;
    const result = await service.refresh({ refresh_token: 'current' });
    expect(result.access_expires_at).toBe(result.refresh_expires_at);
  });
  it.each(['missing', 'revoked', 'deleted', 'bad-digest'])(
    'rejects %s without issuing tokens',
    async (kind) => {
      if (kind === 'missing') repo.findRefreshTokenById.mockResolvedValue(null);
      if (kind === 'revoked')
        repo.findRefreshTokenById.mockResolvedValue({
          id: root,
          revoked_at: new Date(),
        });
      if (kind === 'deleted') repo.findActiveOwner.mockResolvedValue(null);
      if (kind === 'bad-digest')
        tokens.hashRefreshToken.mockReturnValue('b'.repeat(64));
      await expect(
        service.refresh({ refresh_token: 'invalid' }),
      ).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
      expect(tokens.signAccessToken).not.toHaveBeenCalled();
      expect(repo.revokeRefreshFamily).not.toHaveBeenCalled();
    },
  );
  it('commits consumed-token revocation before throwing 401', async () => {
    const row = await repo.findRefreshTokenById();
    repo.findRefreshTokenById.mockResolvedValue({
      ...row,
      consumed_at: new Date(),
    });
    repo.lockRefreshRoot.mockResolvedValue({ ...row, consumed_at: new Date() });
    let committed = false;
    repo.withTransaction.mockImplementation(async (work) => {
      const value = await work(tx);
      committed = true;
      return value;
    });
    await expect(
      service.refresh({ refresh_token: 'consumed' }),
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
    expect(committed).toBe(true);
    expect(repo.revokeRefreshFamily).toHaveBeenCalledWith(
      root,
      expect.any(Date),
      tx,
    );
    expect(tokens.signAccessToken).not.toHaveBeenCalled();
  });
  it('allows a current descendant even when its root was consumed', async () => {
    const row = await repo.findRefreshTokenById();
    const child = randomUUID();
    tokens.verifyRefreshToken.mockResolvedValue({ ...claims, jti: child });
    repo.findRefreshTokenById.mockImplementation(async (id) =>
      id === root ? { ...row, consumed_at: new Date() } : { ...row, id: child },
    );
    repo.lockRefreshRoot.mockResolvedValue({ ...row, consumed_at: new Date() });
    expect(
      (await service.refresh({ refresh_token: 'child' })).refresh_token,
    ).toBe('replacement');
  });
});

describe('Logout orchestration', () => {
  const root = randomUUID();
  const clock = new TestAuthClock(1800000000);
  const tx = {} as Prisma.TransactionClient;
  const repo = {
    withTransaction: vi.fn(),
    lockRefreshRoot: vi.fn(),
    findRefreshTokenById: vi.fn(),
    revokeRefreshFamily: vi.fn(),
  };
  const tokens = {
    verifyAccessToken: vi.fn(),
    verifyRefreshToken: vi.fn(),
    hashRefreshToken: vi.fn(),
  };
  let service: AuthService;
  beforeEach(() => {
    vi.resetAllMocks();
    const row = {
      id: root,
      root_token_id: root,
      user_id: 42,
      auth_identity_id: 7,
      token_hash: 'a'.repeat(64),
      expired_at: new Date(1802592000000),
      consumed_at: null,
      revoked_at: null,
    };
    repo.withTransaction.mockImplementation(async (work) => work(tx));
    repo.lockRefreshRoot.mockResolvedValue(row);
    repo.findRefreshTokenById.mockResolvedValue(row);
    tokens.verifyAccessToken.mockResolvedValue({
      userId: 42,
      authIdentityId: 7,
      refreshFamilyId: root,
    });
    tokens.verifyRefreshToken.mockResolvedValue({
      sub: '42',
      auth_identity_id: 7,
      fid: root,
      jti: root,
      iat: 1800000000,
      exp: 1802592000,
      renewal_exp: 1802592000,
      token_use: 'refresh',
    });
    tokens.hashRefreshToken.mockReturnValue('a'.repeat(64));
    service = new AuthService(
      repo as unknown as AuthRepository,
      {} as UserService,
      {} as LocalStrategy,
      tokens as unknown as AuthTokenService,
      clock,
    );
  });
  it.each(['access', 'refresh'] as const)(
    'revokes only the verified %s family before success',
    async (token_type) => {
      expect(await service.logout({ token_type, token: 'synthetic' })).toEqual({
        message: 'Signed out',
      });
      expect(repo.revokeRefreshFamily).toHaveBeenCalledWith(
        root,
        new Date(clock.now() * 1000),
        tx,
      );
    },
  );
  it('allows consumed refresh for logout identification only', async () => {
    const row = await repo.findRefreshTokenById();
    repo.findRefreshTokenById.mockResolvedValue({
      ...row,
      consumed_at: new Date(),
    });
    await service.logout({ token_type: 'refresh', token: 'consumed' });
    expect(repo.revokeRefreshFamily).toHaveBeenCalledTimes(1);
  });
  it.each([
    'malformed',
    'expired',
    'unknown',
    'revoked',
    'owner-mismatch',
    'bad-digest',
  ])(
    'returns generic confirmation for %s without unrelated changes',
    async (kind) => {
      if (kind === 'malformed' || kind === 'expired')
        tokens.verifyRefreshToken.mockRejectedValueOnce(
          new AuthError('AUTHENTICATION_REQUIRED'),
        );
      if (kind === 'unknown') repo.lockRefreshRoot.mockResolvedValue(null);
      if (kind === 'revoked') {
        const row = await repo.lockRefreshRoot();
        repo.lockRefreshRoot.mockResolvedValue({
          ...row,
          revoked_at: new Date(),
        });
      }
      if (kind === 'owner-mismatch') {
        const row = await repo.lockRefreshRoot();
        repo.lockRefreshRoot.mockResolvedValue({ ...row, user_id: 43 });
      }
      if (kind === 'bad-digest')
        tokens.hashRefreshToken.mockReturnValue('b'.repeat(64));
      expect(
        await service.logout({ token_type: 'refresh', token: 'synthetic' }),
      ).toEqual({ message: 'Signed out' });
      expect(repo.revokeRefreshFamily).not.toHaveBeenCalled();
    },
  );
  it('rejects missing credentials', async () => {
    await expect(
      service.logout({ token_type: 'access', token: '' }),
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
  });
  it('never claims success on required persistence failure', async () => {
    repo.withTransaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('private', {
        code: 'P1001',
        clientVersion: '6',
      }),
    );
    await expect(
      service.logout({ token_type: 'access', token: 'synthetic' }),
    ).rejects.toMatchObject({ code: 'AUTH_TEMPORARILY_UNAVAILABLE' });
  });
});
