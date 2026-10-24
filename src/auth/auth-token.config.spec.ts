import { AuthClock } from './auth-clock.js';
import { AuthTokenConfig } from './auth-token.config.js';
import { authTestEnvironment } from './testing/auth-test-config.js';

describe('JWT configuration and clock', () => {
  it('accepts distinct base64 secrets and pins the JWT profile', () => {
    const config = new AuthTokenConfig(authTestEnvironment);
    expect(config.accessSecret.length).toBeGreaterThanOrEqual(32);
    expect(config.refreshSecret.equals(config.accessSecret)).toBe(false);
    expect(config.algorithm).toBe('HS256');
    expect(config.issuer).toBe('movio-core');
    expect(config.accessAudience).toBe('movio-api');
    expect(config.refreshAudience).toBe('movio-refresh');
  });
  it.each([undefined, '', 'not!base64', Buffer.alloc(31).toString('base64')])(
    'rejects missing, malformed or short keys (%s)',
    (key) => {
      expect(
        () =>
          new AuthTokenConfig({
            ...authTestEnvironment,
            AUTH_ACCESS_SECRET: key,
          }),
      ).toThrow();
      expect(
        () =>
          new AuthTokenConfig({
            ...authTestEnvironment,
            AUTH_REFRESH_SECRET: key,
          }),
      ).toThrow();
    },
  );
  it('rejects identical decoded keys', () => {
    expect(
      () =>
        new AuthTokenConfig({
          ...authTestEnvironment,
          AUTH_REFRESH_SECRET: authTestEnvironment.AUTH_ACCESS_SECRET,
        }),
    ).toThrow();
  });
  it('reads current whole seconds on every call', () => {
    const clock = new AuthClock();
    const now = vi.spyOn(Date, 'now');
    try {
      now.mockReturnValue(1_800_000_000_999);
      expect(clock.now()).toBe(1_800_000_000);
      now.mockReturnValue(1_800_003_600_000);
      expect(clock.now()).toBe(1_800_003_600);
    } finally {
      now.mockRestore();
    }
  });
});
