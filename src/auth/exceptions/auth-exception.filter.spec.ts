import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AuthExceptionFilter,
  GuardAuthExceptionFilter,
} from './auth-exception.filter.js';
import { AuthError } from './auth-errors.js';

function context(path: string) {
  const response = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
  };
  const request = { path, headers: {}, method: 'POST' };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as ArgumentsHost;
  return { response, request, host };
}
describe('Safe auth exception mapping', () => {
  it.each([
    ['AUTHENTICATION_FAILED', 401],
    ['AUTHENTICATION_REQUIRED', 401],
    ['AUTH_TEMPORARILY_UNAVAILABLE', 503],
    ['INTERNAL_ERROR', 500],
  ] as const)('preserves %s without private diagnostics', (code, status) => {
    const { response, host } = context('/auth/login');
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    try {
      new AuthExceptionFilter().catch(new AuthError(code), host);
      expect(response.status).toHaveBeenCalledWith(status);
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({ code }),
      );
      expect(JSON.stringify(log.mock.calls)).not.toContain('password');
    } finally {
      log.mockRestore();
    }
  });
  it.each([
    [409, 'EMAIL_UNAVAILABLE', 'Email is unavailable'],
    [429, 'REGISTRATION_RATE_LIMITED', 'Too many registration attempts'],
    [
      503,
      'REGISTRATION_TEMPORARILY_UNAVAILABLE',
      'Registration is temporarily unavailable',
    ],
    [500, 'INTERNAL_ERROR', 'Registration could not be completed'],
  ])('preserves registration %s', (status, code, message) => {
    const { response, host } = context('/auth/register');
    new AuthExceptionFilter().catch(
      new HttpException('private submitted-secret', status as number),
      host,
    );
    expect(response.json).toHaveBeenCalledWith({
      statusCode: status,
      code,
      message,
    });
  });
  it('retains safe validation fields, no-store and an existing Retry-After', () => {
    const { response, host } = context('/auth/login');
    new AuthExceptionFilter().catch(
      new BadRequestException({
        code: 'VALIDATION_ERROR',
        errors: [
          {
            field: 'email',
            code: 'FIELD_INVALID',
            message: 'Field is invalid',
          },
        ],
      }),
      host,
    );
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        errors: [
          {
            field: 'email',
            code: 'FIELD_INVALID',
            message: 'Field is invalid',
          },
        ],
      }),
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'no-store',
    );
    expect(response.setHeader).not.toHaveBeenCalledWith(
      'Retry-After',
      expect.anything(),
    );
  });
  it('limits global guard filtering to auth domain errors', () => {
    const filter = new GuardAuthExceptionFilter();
    const { response, host } = context('/user/list');
    filter.catch(new AuthError('AUTHENTICATION_REQUIRED'), host);
    expect(response.status).toHaveBeenCalledWith(401);
    expect(() => filter.catch(new NotFoundException(), host)).toThrow(
      NotFoundException,
    );
  });
});
