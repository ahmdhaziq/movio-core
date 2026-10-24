export class AuthTokenConfig {
  readonly algorithm = 'HS256' as const;
  readonly issuer = 'movio-core';
  readonly accessAudience = 'movio-api';
  readonly refreshAudience = 'movio-refresh';
  readonly accessLifetime = 3600;
  readonly renewalLifetime = 2592000;
  readonly accessSecret: Buffer;
  readonly refreshSecret: Buffer;

  constructor(
    env: {
      AUTH_ACCESS_SECRET?: string;
      AUTH_REFRESH_SECRET?: string;
    } = process.env,
  ) {
    this.accessSecret = this.readSecret(env.AUTH_ACCESS_SECRET);
    this.refreshSecret = this.readSecret(env.AUTH_REFRESH_SECRET);
    if (this.accessSecret.equals(this.refreshSecret))
      throw new Error('Authentication signing keys must be distinct');
  }
  private readSecret(value: string | undefined): Buffer {
    if (
      !value ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        value,
      )
    )
      throw new Error('Authentication signing key must be base64');
    const bytes = Buffer.from(value, 'base64');
    if (bytes.length < 32 || bytes.toString('base64') !== value)
      throw new Error(
        'Authentication signing key must contain at least 32 bytes',
      );
    return bytes;
  }
}
