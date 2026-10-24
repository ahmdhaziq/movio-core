import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthError } from './auth-errors.js';
import { auditAuthOutcome } from '../auth-audit.js';

const authDefaults: Record<number, { code: string; message: string }> = {
  400: {
    code: 'VALIDATION_ERROR',
    message: 'Authentication details are invalid',
  },
  401: {
    code: 'AUTHENTICATION_REQUIRED',
    message: 'Authentication is required',
  },
  429: {
    code: 'AUTH_RATE_LIMITED',
    message: 'Too many authentication attempts',
  },
  503: {
    code: 'AUTH_TEMPORARILY_UNAVAILABLE',
    message: 'Authentication is temporarily unavailable',
  },
  500: {
    code: 'INTERNAL_ERROR',
    message: 'Authentication could not be completed',
  },
};
const registrationDefaults: Record<number, { code: string; message: string }> =
  {
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
const statuses = {
  AUTHENTICATION_FAILED: 401,
  AUTHENTICATION_REQUIRED: 401,
  AUTH_RATE_LIMITED: 429,
  AUTH_TEMPORARILY_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

@Catch()
export class AuthExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    const registration = request.path === '/auth/register';
    const defaults = registration ? registrationDefaults : authDefaults;
    const candidate =
      error instanceof AuthError
        ? statuses[error.code]
        : error instanceof HttpException
          ? error.getStatus()
          : 500;
    const status = defaults[candidate] ? candidate : 500;
    const body = error instanceof HttpException ? error.getResponse() : null;
    let result = { ...defaults[status] };
    if (error instanceof AuthError && error.code === 'AUTHENTICATION_FAILED')
      result = { code: error.code, message: 'Email or password is incorrect' };
    if (
      registration &&
      status === 409 &&
      typeof body === 'object' &&
      body !== null &&
      'code' in body &&
      body.code === 'IDENTITY_UNAVAILABLE'
    )
      result = {
        code: 'IDENTITY_UNAVAILABLE',
        message: 'Identity is unavailable',
      };
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
    auditAuthOutcome(
      registration
        ? 'register'
        : request.path === '/auth/login'
          ? 'login'
          : request.path === '/auth/refresh'
            ? 'refresh'
            : request.path === '/auth/logout'
              ? 'logout'
              : 'access',
      result.code,
    );
    response.setHeader('Cache-Control', 'no-store');
    response
      .status(status)
      .json({
        statusCode: status,
        ...result,
        ...(fields ? { errors: fields } : {}),
      });
  }
}

// Nest applies this filter only to domain auth errors, leaving other domains alone.
@Catch(AuthError)
export class GuardAuthExceptionFilter extends AuthExceptionFilter {
  override catch(error: unknown, host: ArgumentsHost): void {
    if (!(error instanceof AuthError)) throw error;
    super.catch(error, host);
  }
}
