export interface CreateRefreshTokenDto {
  id: string;
  user_id: number;
  auth_identity_id: number;
  root_token_id: string;
  token_hash: string;
  expired_at: Date;
  created_at: Date;
}
