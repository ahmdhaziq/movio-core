import type { Request } from 'express';
export interface AuthPrincipal {
  userId: number;
  authIdentityId: number;
  refreshFamilyId: string;
}
export interface AuthenticatedRequest extends Request {
  user?: AuthPrincipal;
}
