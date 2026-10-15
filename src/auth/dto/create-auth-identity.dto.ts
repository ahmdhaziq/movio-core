import { AuthProvider } from '../enums/auth-provider.enum.js';
export interface CreateAuthIdentityDto {
  identity_id: string;
  user_id: number;
  provider: AuthProvider.Local;
  password_hash: string;
}
export interface IdentityMetadata {
  id: number;
  identity_id: string;
  user_id: number;
  provider: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}
