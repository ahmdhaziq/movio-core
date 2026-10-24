import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { AuthService } from './auth.service.js';
import { AuthTokenService } from './auth-token.service.js';
import { AuthTokenConfig } from './auth-token.config.js';
import { AuthRepository } from './auth.repository.js';
import { UserService } from '../user/user.service.js';
import { LocalStrategy } from './strategies/local.strategies.js';
import {
  authTestEnvironment,
  TestAuthClock,
} from './testing/auth-test-config.js';
describe('Stateless AuthService access', () => {
  it('authenticates with unavailable persistence and performs no database calls', async () => {
    const repository = {
      withTransaction: vi.fn(() => {
        throw new Error('unavailable');
      }),
    };
    const users = {
      getUserByEmail: vi.fn(() => {
        throw new Error('unavailable');
      }),
    };
    const clock = new TestAuthClock(1800000000);
    const tokens = new AuthTokenService(
      new JwtService(),
      new AuthTokenConfig(authTestEnvironment),
      clock,
    );
    const service = new AuthService(
      repository as unknown as AuthRepository,
      users as unknown as UserService,
      {} as LocalStrategy,
      tokens,
      clock,
    );
    const root = randomUUID();
    const raw = await tokens.signAccessToken({
      userId: 42,
      authIdentityId: 7,
      refreshFamilyId: root,
      jti: randomUUID(),
      issuedAt: clock.now(),
      renewalExpiresAt: clock.now() + 2592000,
    });
    expect(await service.validateAccessToken(raw)).toEqual({
      userId: 42,
      authIdentityId: 7,
      refreshFamilyId: root,
    });
    expect(repository.withTransaction).not.toHaveBeenCalled();
    expect(users.getUserByEmail).not.toHaveBeenCalled();
  });
});
