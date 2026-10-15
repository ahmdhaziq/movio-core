import { ThrottlerGuard } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import type { ValidationError } from 'class-validator';
import {
  ArgumentsHost,
  BadRequestException,
  Body,
  Catch,
  Controller,
  ExceptionFilter,
  HttpException,
  Logger,
  Post,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { RegisterLocalDto } from './dto/register-local.dto.js';
// Scoped to this controller, including guard and validation-pipe failures.
@Catch()
export class AuthExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('AuthController');
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const status =
      error instanceof HttpException &&
      [400, 409, 429, 503].includes(error.getStatus())
        ? error.getStatus()
        : 500;
    const defaults: Record<number, { code: string; message: string }> = {
      400: {
        code: 'VALIDATION_ERROR',
        message: 'Registration details are invalid',
      },
      409: { code: 'EMAIL_UNAVAILABLE', message: 'Email is unavailable' },
      429: {
        code: 'REGISTRATION_RATE_LIMITED',
        message: 'Too many registration attempts',
      },
      503: {
        code: 'REGISTRATION_TEMPORARILY_UNAVAILABLE',
        message: 'Registration is temporarily unavailable',
      },
      500: {
        code: 'INTERNAL_ERROR',
        message: 'Registration could not be completed',
      },
    };
    const body = error instanceof HttpException ? error.getResponse() : null;
    const identityConflict =
      status === 409 &&
      typeof body === 'object' &&
      body !== null &&
      'code' in body &&
      body.code === 'IDENTITY_UNAVAILABLE';
    const publicBody = {
      statusCode: status,
      ...defaults[status],
      ...(identityConflict
        ? { code: 'IDENTITY_UNAVAILABLE', message: 'Identity is unavailable' }
        : {}),
    };
    // Validation fields are emitted by our own sanitized exception factory.
    const fields =
      status === 400 &&
      error instanceof BadRequestException &&
      typeof body === 'object' &&
      body !== null &&
      'code' in body &&
      body.code === 'VALIDATION_ERROR' &&
      'errors' in body
        ? body.errors
        : undefined;
    this.logger.log({
      provider: 'local',
      outcome: publicBody.code,
      durationMs: 0,
      correlationId: randomUUID(),
    });
    response
      .status(status)
      .json({ ...publicBody, ...(fields ? { errors: fields } : {}) });
  }
}
@Controller('auth')
@UseFilters(AuthExceptionFilter)
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(private readonly service: AuthService) {}
  @Post('register')
  register(@Body() dto: RegisterLocalDto) {
    return this.service.register(dto);
  }
}

// Used by the application ValidationPipe before invoking this controller.
export function registrationValidationException(errors: ValidationError[]) {
  const fields = errors.flatMap((error) =>
    Object.entries(error.constraints ?? {}).map(([rule, _message]) => {
      let code: string;
      let message: string;
      if (rule === 'whitelistValidation') {
        code = 'FIELD_UNSUPPORTED';
        message = 'Field is unsupported';
      } else if (rule === 'isDefined') {
        code =
          error.property === 'provider'
            ? 'PROVIDER_REQUIRED'
            : 'FIELD_REQUIRED';
        message = 'Field is required';
      } else if (rule.startsWith('PASSWORD_')) {
        code = rule;
        message = _message;
      } else if (error.property === 'provider') {
        code = 'PROVIDER_UNSUPPORTED';
        message = 'Registration provider is unsupported';
      } else {
        code = 'FIELD_INVALID';
        message = 'Field is invalid';
      }
      return { field: error.property, code, message };
    }),
  );
  return new BadRequestException({
    statusCode: 400,
    code: 'VALIDATION_ERROR',
    message: 'Registration details are invalid',
    errors: fields,
  });
}
