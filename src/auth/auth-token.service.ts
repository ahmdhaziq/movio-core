import { AuthError } from './exceptions/auth-errors.js';
import type { AuthPrincipal } from './types/authenticated-request.js';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import { AuthTokenConfig } from './auth-token.config.js';
import { AuthClock } from './auth-clock.js';

export interface TokenIssuance {
  userId: number;
  authIdentityId: number;
  refreshFamilyId: string;
  issuedAt: number;
  renewalExpiresAt: number;
  jti: string;
}
export interface VerifiedTokenClaims {
  sub: string;
  auth_identity_id: number;
  fid: string;
  jti: string;
  iat: number;
  exp: number;
  renewal_exp: number;
  token_use: 'access' | 'refresh';
}
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
@Injectable()
export class AuthTokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AuthTokenConfig,
    private readonly clock: AuthClock,
  ) {}
  signAccessToken(input: TokenIssuance): Promise<string> {
    return this.sign(input, 'access');
  }
  signRefreshToken(input: TokenIssuance): Promise<string> {
    return this.sign(input, 'refresh');
  }
  hashRefreshToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }
  async verifyAccessToken(raw: string): Promise<AuthPrincipal> {
    const claims = await this.verify(raw, 'access');
    return {
      userId: Number(claims.sub),
      authIdentityId: claims.auth_identity_id,
      refreshFamilyId: claims.fid,
    };
  }
  verifyRefreshToken(raw: string): Promise<VerifiedTokenClaims> {
    return this.verify(raw, 'refresh');
  }
  private async verify(
    raw: string,
    purpose: 'access' | 'refresh',
  ): Promise<VerifiedTokenClaims> {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > 4096)
      throw new AuthError('AUTHENTICATION_REQUIRED');
    const now = this.clock.now();
    let claims: unknown;
    try {
      claims = await this.jwt.verifyAsync(raw, {
        secret:
          purpose === 'access'
            ? this.config.accessSecret
            : this.config.refreshSecret,
        algorithms: [this.config.algorithm],
        issuer: this.config.issuer,
        audience:
          purpose === 'access'
            ? this.config.accessAudience
            : this.config.refreshAudience,
        ignoreExpiration: false,
        clockTolerance: 0,
        clockTimestamp: now,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        ['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError'].includes(
          error.name,
        )
      )
        throw new AuthError('AUTHENTICATION_REQUIRED');
      throw error;
    }
    if (!this.validClaims(claims, purpose, now))
      throw new AuthError('AUTHENTICATION_REQUIRED');
    return claims;
  }
  private validClaims(
    value: unknown,
    purpose: 'access' | 'refresh',
    now: number,
  ): value is VerifiedTokenClaims {
    if (!value || typeof value !== 'object') return false;
    const c = value as Record<string, unknown>;
    if (
      typeof c.sub !== 'string' ||
      !/^[1-9][0-9]*$/.test(c.sub) ||
      !Number.isSafeInteger(Number(c.sub)) ||
      Number(c.sub) > 2147483647
    )
      return false;
    if (
      typeof c.auth_identity_id !== 'number' ||
      !Number.isInteger(c.auth_identity_id) ||
      c.auth_identity_id < 1 ||
      c.auth_identity_id > 2147483647
    )
      return false;
    if (
      typeof c.fid !== 'string' ||
      !UUID.test(c.fid) ||
      typeof c.jti !== 'string' ||
      !UUID.test(c.jti)
    )
      return false;
    if (
      typeof c.iat !== 'number' ||
      typeof c.exp !== 'number' ||
      typeof c.renewal_exp !== 'number' ||
      ![c.iat, c.exp, c.renewal_exp].every(Number.isSafeInteger)
    )
      return false;
    if (
      c.iat < 0 ||
      c.iat > now ||
      c.exp <= c.iat ||
      now >= c.exp ||
      c.exp > c.renewal_exp ||
      c.renewal_exp - c.iat > this.config.renewalLifetime ||
      c.token_use !== purpose
    )
      return false;
    return purpose === 'access'
      ? c.exp - c.iat <= this.config.accessLifetime
      : c.exp === c.renewal_exp;
  }
  private sign(
    input: TokenIssuance,
    purpose: 'access' | 'refresh',
  ): Promise<string> {
    return this.jwt.signAsync(
      {
        sub: String(input.userId),
        auth_identity_id: input.authIdentityId,
        fid: input.refreshFamilyId,
        jti: input.jti,
        iat: input.issuedAt,
        exp:
          purpose === 'access'
            ? Math.min(
                input.issuedAt + this.config.accessLifetime,
                input.renewalExpiresAt,
              )
            : input.renewalExpiresAt,
        renewal_exp: input.renewalExpiresAt,
        token_use: purpose,
      },
      {
        secret:
          purpose === 'access'
            ? this.config.accessSecret
            : this.config.refreshSecret,
        algorithm: this.config.algorithm,
        issuer: this.config.issuer,
        audience:
          purpose === 'access'
            ? this.config.accessAudience
            : this.config.refreshAudience,
      },
    );
  }
}
