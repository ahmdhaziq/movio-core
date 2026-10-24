import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from '../auth.service.js';
import {
  AUTH_MODE,
  type AuthModeValue,
} from '../decorators/auth-mode.decorator.js';
import { extractBearerToken } from '../helpers/extract-bearer-token.js';
import { classifyAuthError } from '../exceptions/auth-errors.js';
import type { AuthenticatedRequest } from '../types/authenticated-request.js';
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly service: AuthService,
    private readonly reflector: Reflector,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const mode = this.reflector.getAllAndOverride<AuthModeValue>(AUTH_MODE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (mode === 'public' || mode === 'refresh' || mode === 'logout')
      return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    try {
      const raw = extractBearerToken(request);
      request.user = await this.service.validateAccessToken(raw);
      return true;
    } catch (error) {
      throw classifyAuthError(error);
    }
  }
}
