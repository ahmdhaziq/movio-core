export interface AuthenticatedUserDto {
  user: { id: number; name: string; email: string };
  authIdentityId: number;
}
