import { JwtService } from '@nestjs/jwt';
import { randomUUID, createHmac } from 'node:crypto';
import { AuthTokenService } from './auth-token.service.js';
import { AuthTokenConfig } from './auth-token.config.js';
import {
  authTestEnvironment,
  TestAuthClock,
} from './testing/auth-test-config.js';

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
