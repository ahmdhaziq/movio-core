import { Prisma } from '@prisma/client';

export type AuthErrorCode =
  | 'AUTHENTICATION_FAILED'
  | 'AUTHENTICATION_REQUIRED'
  | 'AUTH_RATE_LIMITED'
  | 'AUTH_TEMPORARILY_UNAVAILABLE'
  | 'INTERNAL_ERROR';
export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode) {
    super(code);
    this.name = 'AuthError';
  }
}

export function classifyAuthError(error: unknown): AuthError {
  if (error instanceof AuthError) return error;
  let temporary = false;
  if (
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientInitializationError
  ) {
    const code =
      error instanceof Prisma.PrismaClientKnownRequestError
        ? error.code
        : error.errorCode;
    temporary = ['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2034'].includes(
      code ?? '',
    );
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      code === 'P2028'
    ) {
      const detail =
        typeof error.meta?.error === 'string' ? error.meta.error : '';
      temporary = [
        'Unable to start a transaction in the given time',
        'A query cannot be executed on an expired transaction',
      ].some((s) => detail.includes(s) || error.message.includes(s));
    }
  }
  if (
    error instanceof Error &&
    'code' in error &&
    ['ENOMEM', 'EAGAIN'].includes(String(error.code))
  )
    temporary = true;
  return new AuthError(
    temporary ? 'AUTH_TEMPORARILY_UNAVAILABLE' : 'INTERNAL_ERROR',
  );
}
