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
