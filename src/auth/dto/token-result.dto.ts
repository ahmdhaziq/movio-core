import type { AuthenticatedUserDto } from './authenticated-user.dto.js';
export interface TokenResultDto {
  user: AuthenticatedUserDto['user'];
  token_type: 'Bearer';
  access_token: string;
  refresh_token: string;
  access_expires_at: string;
  refresh_expires_at: string;
}
