import { Injectable, PipeTransform } from '@nestjs/common';
import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { validate } from 'class-validator';
import { authValidationException } from '../exceptions/auth-validation.exception.js';
import { LoginLocalDto } from '../dto/login-local.dto.js';
import { AuthProvider } from '../enums/auth-provider.enum.js';

export async function validateProviderRequest<T extends object>(
  value: unknown,
  registry: ReadonlyMap<string, ClassConstructor<T>>,
): Promise<T> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw authValidationException([
      { property: 'provider', constraints: { isDefined: '' } },
    ]);
  for (const key of ['__proto__', 'constructor', 'prototype'])
    if (Object.hasOwn(value, key))
      throw authValidationException([
        { property: key, constraints: { whitelistValidation: '' } },
      ]);
  const provider: unknown = Object.hasOwn(value, 'provider')
    ? Reflect.get(value, 'provider')
    : undefined;
  const dtoType =
    typeof provider === 'string' ? registry.get(provider) : undefined;
  if (!dtoType)
    throw authValidationException([
      {
        property: 'provider',
        constraints: { [provider === undefined ? 'isDefined' : 'isIn']: '' },
      },
    ]);
  const dto = plainToInstance(dtoType, value, {
    enableImplicitConversion: false,
  });
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
    validationError: { target: false, value: false },
  });
  if (errors.length) throw authValidationException(errors);
  return dto;
}
@Injectable()
export class LoginValidationPipe implements PipeTransform<
  unknown,
  Promise<LoginLocalDto>
> {
  transform(value: unknown): Promise<LoginLocalDto> {
    return validateProviderRequest(
      value,
      new Map([[AuthProvider.Local, LoginLocalDto]]),
    );
  }
}
