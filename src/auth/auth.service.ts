import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
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
  private readonly logger = new Logger(AuthService.name);
  constructor(
    private readonly repository: AuthRepository,
    private readonly users: UserService,
    private readonly local: LocalStrategy,
  ) {}

  async register(dto: RegisterLocalDto): Promise<RegistrationResultDto> {
    const started = performance.now();
    const correlationId = randomUUID();
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
      this.logger.log({
        provider: 'local',
        outcome: 'SUCCESS',
        durationMs: Math.round(performance.now() - started),
        correlationId,
      });
      return result;
    } catch (error) {
      const failure = this.classifyFailure(error, hashing);
      const response = failure.getResponse() as { code: string };
      this.logger.log({
        provider: dto.provider === AuthProvider.Local ? 'local' : 'unsupported',
        outcome: response.code,
        durationMs: Math.round(performance.now() - started),
        correlationId,
      });
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
