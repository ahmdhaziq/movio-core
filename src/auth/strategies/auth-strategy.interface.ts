import type { Prisma } from '@prisma/client';
import type { IdentityMetadata } from '../dto/create-auth-identity.dto.js';
import { AuthProvider } from '../enums/auth-provider.enum.js';
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
  register(context: AuthRegistrationContext<P>): Promise<IdentityMetadata>;
}
