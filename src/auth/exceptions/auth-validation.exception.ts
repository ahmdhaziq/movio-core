import { AuthError } from './auth-errors.js';
import { BadRequestException } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
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

export function authValidationException(errors: ValidationError[]) {
  return new BadRequestException({
    code: 'VALIDATION_ERROR',
    message: 'Authentication details are invalid',
    errors: errors.flatMap((error) =>
      Object.keys(error.constraints ?? {}).map((rule) => ({
        field: error.property,
        code:
          rule === 'whitelistValidation'
            ? 'FIELD_UNSUPPORTED'
            : rule === 'isDefined'
              ? 'FIELD_REQUIRED'
              : 'FIELD_INVALID',
        message:
          rule === 'whitelistValidation'
            ? 'Field is unsupported'
            : rule === 'isDefined'
              ? 'Field is required'
              : 'Field is invalid',
      })),
    ),
  });
}

export function logoutValidationException(errors: ValidationError[]) {
  if (
    errors.some(
      (e) =>
        e.property === 'token' &&
        (e.constraints?.isDefined || e.constraints?.isNotEmpty),
    )
  )
    throw new AuthError('AUTHENTICATION_REQUIRED');
  return authValidationException(errors);
}
