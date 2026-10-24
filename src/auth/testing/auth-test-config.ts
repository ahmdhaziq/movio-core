// Public, deterministic fixtures for tests only. Never use these keys in production.
export const authTestEnvironment = {
  AUTH_ACCESS_SECRET: Buffer.alloc(32, 0x41).toString('base64'),
  AUTH_REFRESH_SECRET: Buffer.alloc(32, 0x52).toString('base64'),
};

export class TestAuthClock {
  constructor(public seconds = Math.floor(Date.now() / 1000)) {}
  now(): number {
    return this.seconds;
  }
  advance(seconds: number): void {
    this.seconds += seconds;
  }
}

export function useAuthTestEnvironment(): void {
  beforeAll(() => {
    vi.stubEnv('AUTH_ACCESS_SECRET', authTestEnvironment.AUTH_ACCESS_SECRET);
    vi.stubEnv('AUTH_REFRESH_SECRET', authTestEnvironment.AUTH_REFRESH_SECRET);
  });
  afterAll(() => vi.unstubAllEnvs());
}
