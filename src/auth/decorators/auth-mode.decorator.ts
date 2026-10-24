import { SetMetadata } from '@nestjs/common';
export const AUTH_MODE = 'movio:auth-mode';
export type AuthModeValue = 'public' | 'refresh' | 'logout';
export const AuthMode = (mode: AuthModeValue) => SetMetadata(AUTH_MODE, mode);
