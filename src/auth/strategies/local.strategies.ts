import { verify } from 'argon2';
import type { AuthenticateLocalDto } from '../dto/authenticate-local.dto.js';
import type { AuthenticatedUserDto } from '../dto/authenticated-user.dto.js';
import { AuthError } from '../exceptions/auth-errors.js';
import { Injectable } from '@nestjs/common';
import type {
  AuthRegistrationContext,
  AuthStrategy,
} from './auth-strategy.interface.js';
import { AuthProvider } from '../enums/auth-provider.enum.js';
import { AuthRepository } from '../auth.repository.js';
@Injectable()
export class LocalStrategy implements AuthStrategy<AuthProvider.Local> {
  readonly provider = AuthProvider.Local;
  constructor(private readonly repository: AuthRepository) {}
  async authenticate(
    input: AuthenticateLocalDto,
  ): Promise<AuthenticatedUserDto> {
    const record = await this.repository.findLocalCredentialsByEmail(
      input.email,
    );
    const eligible =
      record &&
      !record.deleted_at &&
      !record.user.deleted_at &&
      record.password_hash;
    const matched = await verify(
      eligible ? record.password_hash! : DUMMY_HASH,
      input.password,
    );
    if (!eligible || !matched) throw new AuthError('AUTHENTICATION_FAILED');
    return {
      user: {
        id: record.user.id,
        name: record.user.name,
        email: record.user.email,
      },
      authIdentityId: record.id,
    };
  }
  register(context: AuthRegistrationContext<AuthProvider.Local>) {
    return this.repository.createIdentity(
      {
        identity_id: String(context.userId),
        user_id: context.userId,
        provider: this.provider,
        password_hash: context.payload.passwordHash,
      },
      context.tx,
    );
  }
}

// Public dummy credential: equal-cost verification for absent/ineligible accounts.
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,p=1,t=2$AtA7n2GWb4uaP8f13rsKlg$j9bxf8lUe30MKIWOxV8n7FiKAElDO3a2NzYN15ewnIY';
