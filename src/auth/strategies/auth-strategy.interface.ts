import type { AuthenticateLocalDto } from '../dto/authenticate-local.dto.js';
import type { LoginLocalDto } from '../dto/login-local.dto.js';
import type { AuthenticatedUserDto } from '../dto/authenticated-user.dto.js';
import type { Prisma } from '@prisma/client';
import type { IdentityMetadata } from '../dto/create-auth-identity.dto.js';
import { AuthProvider } from '../enums/auth-provider.enum.js';
export interface LoginRequestMap {
  [AuthProvider.Local]: LoginLocalDto;
}
export interface AuthenticationPayloadMap {
  [AuthProvider.Local]: AuthenticateLocalDto;
}
export type LoginArguments = {
  [P in keyof AuthenticationPayloadMap]: [
    provider: P,
    input: AuthenticationPayloadMap[P],
  ];
}[keyof AuthenticationPayloadMap];
export interface RegistrationPayloadMap {
  [AuthProvider.Local]: { passwordHash: string };
}
export interface AuthRegistrationContext<
  P extends keyof RegistrationPayloadMap,
> {
  userId: number;
  payload: RegistrationPayloadMap[P];
  tx: Prisma.TransactionClient;
}
export interface AuthStrategy<P extends keyof RegistrationPayloadMap> {
  readonly provider: P;
  authenticate(
    input: AuthenticationPayloadMap[P],
  ): Promise<AuthenticatedUserDto>;
  register(context: AuthRegistrationContext<P>): Promise<IdentityMetadata>;
}
