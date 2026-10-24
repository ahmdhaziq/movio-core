import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { AccessTokenGuard } from './access-token.guard.js';
import { AuthService } from '../auth.service.js';
import { AuthError } from '../exceptions/auth-errors.js';
describe('Access guard', () => {
  const service = { validateAccessToken: vi.fn() };
  const reflector = { getAllAndOverride: vi.fn() };
  const guard = new AccessTokenGuard(
    service as unknown as AuthService,
    reflector as unknown as Reflector,
  );
  const req: {
    headers: { authorization: string };
    rawHeaders: string[];
    user?: unknown;
  } = { headers: { authorization: 'Bearer synthetic' }, rawHeaders: [] };
  const context = {
    getHandler: () => () => {},
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  beforeEach(() => {
    vi.resetAllMocks();
    delete req.user;
  });
  it('verifies once before attaching identity', async () => {
    const principal = {
      userId: 42,
      authIdentityId: 7,
      refreshFamilyId: 'synthetic',
    };
    service.validateAccessToken.mockImplementation(async () => {
      expect(req.user).toBeUndefined();
      return principal;
    });
    expect(await guard.canActivate(context)).toBe(true);
    expect(req.user).toEqual(principal);
    expect(service.validateAccessToken).toHaveBeenCalledExactlyOnceWith(
      'synthetic',
    );
  });
  it('throws safe auth failure and never attaches rejected claims', async () => {
    service.validateAccessToken.mockRejectedValueOnce(
      new AuthError('AUTHENTICATION_REQUIRED'),
    );
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
    });
    expect(req.user).toBeUndefined();
  });
  it.each(['public', 'refresh', 'logout'])(
    'recognizes explicit %s mode',
    async (mode) => {
      reflector.getAllAndOverride.mockReturnValue(mode);
      expect(await guard.canActivate(context)).toBe(true);
      expect(service.validateAccessToken).not.toHaveBeenCalled();
    },
  );
});
