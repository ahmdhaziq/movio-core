import type { LogoutDto } from './dto/logout.dto.js';
import type { RefreshToken } from '@prisma/client';
import type { VerifiedTokenClaims } from './auth-token.service.js';
import type { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { AuthTokenService } from './auth-token.service.js';
import { AuthClock } from './auth-clock.js';
import { AuthError, classifyAuthError } from './exceptions/auth-errors.js';
import type { LoginArguments } from './strategies/auth-strategy.interface.js';
import type { TokenResultDto } from './dto/token-result.dto.js';
import { auditAuthOutcome } from './auth-audit.js';
import { Prisma } from '@prisma/client';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { hash, argon2id } from 'argon2';
import { AuthRepository } from './auth.repository.js';
import { UserService } from '../user/user.service.js';
import { LocalStrategy } from './strategies/local.strategies.js';
import { AuthProvider } from './enums/auth-provider.enum.js';
import type { RegisterLocalDto } from './dto/register-local.dto.js';
import type { RegistrationResultDto } from './dto/registration-result.dto.js';
@Injectable()
export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly users: UserService,
    private readonly local: LocalStrategy,
    private readonly tokens: AuthTokenService,
    private readonly clock: AuthClock,
  ) {}

  validateAccessToken(raw: string) {
    return this.tokens.verifyAccessToken(raw);
  }

  async login(...[provider, input]: LoginArguments): Promise<TokenResultDto> {
    try {
      const strategy = this.resolveStrategy(provider);
      const owner = await strategy.authenticate(input);
      const issuedAt = this.clock.now();
      const rootId = randomUUID();
      const renewalExpiresAt = issuedAt + 2592000;
      const context = {
        userId: owner.user.id,
        authIdentityId: owner.authIdentityId,
        refreshFamilyId: rootId,
        issuedAt,
        renewalExpiresAt,
      };
      const access = await this.tokens.signAccessToken({
        ...context,
        jti: randomUUID(),
      });
      const refresh = await this.tokens.signRefreshToken({
        ...context,
        jti: rootId,
      });
      const result = await this.repository.withTransaction(async (tx) => {
        if (
          !(await this.repository.findActiveOwner(
            owner.user.id,
            owner.authIdentityId,
            tx,
          ))
        )
          throw new AuthError('AUTHENTICATION_FAILED');
        await this.repository.createRefreshToken(
          {
            id: rootId,
            root_token_id: rootId,
            user_id: owner.user.id,
            auth_identity_id: owner.authIdentityId,
            token_hash: this.tokens.hashRefreshToken(refresh),
            created_at: new Date(issuedAt * 1000),
            expired_at: new Date(renewalExpiresAt * 1000),
          },
          tx,
        );
        return {
          user: owner.user,
          token_type: 'Bearer' as const,
          access_token: access,
          refresh_token: refresh,
          access_expires_at: new Date((issuedAt + 3600) * 1000).toISOString(),
          refresh_expires_at: new Date(renewalExpiresAt * 1000).toISOString(),
        };
      });
      auditAuthOutcome('login', 'SUCCESS');
      return result;
    } catch (error) {
      throw classifyAuthError(error);
    }
  }

  async validateRefreshToken(raw: string) {
    const claims = await this.tokens.verifyRefreshToken(raw);
    await this.refreshEvidence(claims, raw);
    return claims;
  }

  async refresh(dto: RefreshTokenDto): Promise<TokenResultDto> {
    try {
      const claims = await this.validateRefreshToken(dto.refresh_token);
      const outcome = await this.repository.withTransaction(async (tx) => {
        const root = await this.repository.lockRefreshRoot(claims.fid, tx);
        const { row, owner } = await this.refreshEvidence(
          claims,
          dto.refresh_token,
          tx,
          root,
        );
        const issuedAt = this.clock.now();
        if (row.consumed_at) {
          await this.repository.revokeRefreshFamily(
            claims.fid,
            new Date(issuedAt * 1000),
            tx,
          );
          return { kind: 'reuse' as const };
        }
        if (
          (await this.repository.consumeRefreshToken(
            row.id,
            new Date(issuedAt * 1000),
            tx,
          )) !== 1
        )
          throw new AuthError('AUTHENTICATION_REQUIRED');
        const id = randomUUID();
        const context = {
          userId: Number(claims.sub),
          authIdentityId: claims.auth_identity_id,
          refreshFamilyId: claims.fid,
          issuedAt,
          renewalExpiresAt: claims.renewal_exp,
        };
        const access = await this.tokens.signAccessToken({
          ...context,
          jti: randomUUID(),
        });
        const refresh = await this.tokens.signRefreshToken({
          ...context,
          jti: id,
        });
        await this.repository.createRefreshToken(
          {
            id,
            user_id: context.userId,
            auth_identity_id: context.authIdentityId,
            root_token_id: claims.fid,
            token_hash: this.tokens.hashRefreshToken(refresh),
            expired_at: row.expired_at,
            created_at: new Date(issuedAt * 1000),
          },
          tx,
        );
        return {
          kind: 'issued' as const,
          result: {
            user: owner.user,
            token_type: 'Bearer' as const,
            access_token: access,
            refresh_token: refresh,
            access_expires_at: new Date(
              Math.min(issuedAt + 3600, claims.renewal_exp) * 1000,
            ).toISOString(),
            refresh_expires_at: row.expired_at.toISOString(),
          },
        };
      });
      if (outcome.kind === 'reuse')
        throw new AuthError('AUTHENTICATION_REQUIRED');
      auditAuthOutcome('refresh', 'SUCCESS');
      return outcome.result;
    } catch (error) {
      throw classifyAuthError(error);
    }
  }

  private async refreshEvidence(
    claims: VerifiedTokenClaims,
    raw: string,
    tx?: Prisma.TransactionClient,
    lockedRoot?: RefreshToken | null,
  ) {
    const row = await this.repository.findRefreshTokenById(claims.jti, tx);
    const root =
      lockedRoot === undefined
        ? await this.repository.findRefreshTokenById(claims.fid, tx)
        : lockedRoot;
    const now = this.clock.now();
    if (
      !row ||
      !root ||
      !this.matchesRefresh(row, claims, raw) ||
      root.id !== root.root_token_id ||
      root.id !== claims.fid ||
      root.user_id !== row.user_id ||
      root.auth_identity_id !== row.auth_identity_id ||
      root.expired_at.getTime() !== row.expired_at.getTime() ||
      row.revoked_at ||
      root.revoked_at ||
      now >= claims.exp ||
      now >= claims.renewal_exp
    )
      throw new AuthError('AUTHENTICATION_REQUIRED');
    const owner = await this.repository.findActiveOwner(
      row.user_id,
      row.auth_identity_id,
      tx,
    );
    if (!owner) throw new AuthError('AUTHENTICATION_REQUIRED');
    return { row, root, owner };
  }
  private matchesRefresh(
    row: RefreshToken,
    claims: VerifiedTokenClaims,
    raw: string,
  ): boolean {
    if (
      row.id !== claims.jti ||
      row.root_token_id !== claims.fid ||
      row.user_id !== Number(claims.sub) ||
      row.auth_identity_id !== claims.auth_identity_id ||
      row.expired_at.getTime() !== claims.renewal_exp * 1000 ||
      !/^[a-f0-9]{64}$/.test(row.token_hash)
    )
      return false;
    const candidate = Buffer.from(this.tokens.hashRefreshToken(raw), 'hex');
    const retained = Buffer.from(row.token_hash, 'hex');
    return (
      candidate.length === retained.length &&
      timingSafeEqual(candidate, retained)
    );
  }

  async logout(dto: LogoutDto): Promise<{ message: string }> {
    if (!dto.token) throw new AuthError('AUTHENTICATION_REQUIRED');
    try {
      let refreshClaims: VerifiedTokenClaims | undefined;
      let identity: {
        userId: number;
        authIdentityId: number;
        refreshFamilyId: string;
      };
      try {
        if (dto.token_type === 'refresh') {
          refreshClaims = await this.tokens.verifyRefreshToken(dto.token);
          identity = {
            userId: Number(refreshClaims.sub),
            authIdentityId: refreshClaims.auth_identity_id,
            refreshFamilyId: refreshClaims.fid,
          };
        } else identity = await this.validateAccessToken(dto.token);
      } catch (error) {
        if (!(
          error instanceof AuthError && error.code === 'AUTHENTICATION_REQUIRED'
        ))
          throw error;
        auditAuthOutcome('logout', 'SIGNED_OUT');
        return { message: 'Signed out' };
      }
      await this.repository.withTransaction(async (tx) => {
        const root = await this.repository.lockRefreshRoot(
          identity.refreshFamilyId,
          tx,
        );
        if (
          !root ||
          root.id !== root.root_token_id ||
          root.user_id !== identity.userId ||
          root.auth_identity_id !== identity.authIdentityId ||
          root.revoked_at
        )
          return;
        if (refreshClaims) {
          const row = await this.repository.findRefreshTokenById(
            refreshClaims.jti,
            tx,
          );
          if (
            !row ||
            !this.matchesRefresh(row, refreshClaims, dto.token) ||
            row.expired_at.getTime() !== root.expired_at.getTime()
          )
            return;
        }
        await this.repository.revokeRefreshFamily(
          root.id,
          new Date(this.clock.now() * 1000),
          tx,
        );
      });
      auditAuthOutcome('logout', 'SIGNED_OUT');
      return { message: 'Signed out' };
    } catch (error) {
      throw classifyAuthError(error);
    }
  }

  async register(dto: RegisterLocalDto): Promise<RegistrationResultDto> {
    let hashing = false;
    try {
      const strategy = this.resolveStrategy(dto.provider);
      const existing = await this.users.getUserByEmail(dto.email);
      if (existing) {
        await this.repository.getIdentityByUserId(existing.id, dto.provider);
        throw new ConflictException({
          code: 'EMAIL_UNAVAILABLE',
          message: 'Email is unavailable',
        });
      }
      hashing = true;
      const passwordHash = await this.hashPassword(dto.password);
      hashing = false;

      const result = await this.repository.withTransaction(async (tx) => {
        const existing = await this.users.getUserByEmail(dto.email, tx);
        if (existing)
          throw new ConflictException({
            code: 'EMAIL_UNAVAILABLE',
            message: 'Email is unavailable',
          });
        const user = await this.users.create(
          { name: dto.name, email: dto.email },
          tx,
        );

        await strategy.register({
          userId: user.id,
          payload: { passwordHash },
          tx,
        });
        return { user: { id: user.id, name: user.name, email: user.email } };
      });
      auditAuthOutcome('register', 'SUCCESS');
      return result;
    } catch (error) {
      const failure = this.classifyFailure(error, hashing);
      const response = failure.getResponse() as { code: string };
      auditAuthOutcome('register', response.code);
      throw failure;
    }
  }
  private classifyFailure(error: unknown, hashing: boolean): HttpException {
    const failure = (status: number, code: string, message: string) =>
      new HttpException({ statusCode: status, code, message }, status);
    if (error instanceof HttpException) {
      const status = error.getStatus();
      if (status === 400)
        return failure(
          400,
          'VALIDATION_ERROR',
          'Registration details are invalid',
        );
      if (status === 409) {
        const body = error.getResponse();
        return typeof body === 'object' &&
          'code' in body &&
          body.code === 'IDENTITY_UNAVAILABLE'
          ? failure(409, 'IDENTITY_UNAVAILABLE', 'Identity is unavailable')
          : failure(409, 'EMAIL_UNAVAILABLE', 'Email is unavailable');
      }
      if (status === 429)
        return failure(
          429,
          'REGISTRATION_RATE_LIMITED',
          'Too many registration attempts',
        );
    }
    let temporary = false;
    if (
      error instanceof Prisma.PrismaClientKnownRequestError ||
      error instanceof Prisma.PrismaClientInitializationError
    ) {
      const code =
        error instanceof Prisma.PrismaClientKnownRequestError
          ? error.code
          : error.errorCode;
      temporary = [
        'P1001',
        'P1002',
        'P1008',
        'P1017',
        'P2024',
        'P2034',
      ].includes(code ?? '');
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (code === 'P2002') {
          const target = error.meta?.target;
          const key = Array.isArray(target) ? target.join(',') : target;
          if (
            ['email', 'User_email_key', 'User_email_normalized_key'].includes(
              String(key),
            )
          )
            return failure(409, 'EMAIL_UNAVAILABLE', 'Email is unavailable');
          if (
            [
              'provider,identity_id',
              'user_id,provider',
              'auth_identity_provider_identity_id_key',
              'auth_identity_user_id_provider_key',
            ].includes(String(key))
          )
            return failure(
              409,
              'IDENTITY_UNAVAILABLE',
              'Identity is unavailable',
            );
        }
        if (code === 'P2028') {
          const cause =
            typeof error.meta?.error === 'string' ? error.meta.error : '';
          temporary = [
            'Unable to start a transaction in the given time',
            'A query cannot be executed on an expired transaction',
          ].some(
            (phrase) =>
              cause.includes(phrase) || error.message.includes(phrase),
          );
        }
      }
    }
    if (
      hashing &&
      error instanceof Error &&
      'code' in error &&
      ['ENOMEM', 'EAGAIN'].includes(String(error.code))
    )
      temporary = true;
    return temporary
      ? failure(
          503,
          'REGISTRATION_TEMPORARILY_UNAVAILABLE',
          'Registration is temporarily unavailable',
        )
      : failure(500, 'INTERNAL_ERROR', 'Registration could not be completed');
  }
  private resolveStrategy(provider: AuthProvider) {
    if (provider === AuthProvider.Local) return this.local;
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'Registration provider is unsupported',
    });
  }
  private hashPassword(password: string) {
    return hash(password, {
      type: argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
  }
}
