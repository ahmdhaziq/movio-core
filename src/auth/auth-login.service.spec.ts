import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';
import { UserService } from '../user/user.service.js';
import { LocalStrategy } from './strategies/local.strategies.js';
import { AuthTokenService } from './auth-token.service.js';
import { TestAuthClock } from './testing/auth-test-config.js';
import { AuthProvider } from './enums/auth-provider.enum.js';
import { Prisma } from '@prisma/client';
const user = { id: 42, name: 'Ada', email: 'ada@example.com' };
describe('Login orchestration', () => {
  const tx = {} as Prisma.TransactionClient;
  const repository = {
    withTransaction: vi.fn(),
    findActiveOwner: vi.fn(),
    createRefreshToken: vi.fn(),
  };
  const local = { authenticate: vi.fn() };
  const tokens = {
    signAccessToken: vi.fn(),
    signRefreshToken: vi.fn(),
    hashRefreshToken: vi.fn(),
  };
  let service: AuthService;
  beforeEach(() => {
    vi.resetAllMocks();
    local.authenticate.mockResolvedValue({ user, authIdentityId: 7 });
    repository.withTransaction.mockImplementation(async (work) => work(tx));
    repository.findActiveOwner.mockResolvedValue({ id: 7, user });
    tokens.signAccessToken.mockResolvedValue('access');
    tokens.signRefreshToken.mockResolvedValue('refresh');
    tokens.hashRefreshToken.mockReturnValue('a'.repeat(64));
    service = new AuthService(
      repository as unknown as AuthRepository,
      {} as UserService,
      local as unknown as LocalStrategy,
      tokens as unknown as AuthTokenService,
      new TestAuthClock(1800000000),
    );
  });
  it('dispatches only credentials and stores only the refresh digest after ownership recheck', async () => {
    const dto = { email: user.email, password: ' exact ' };
    const result = await service.login(AuthProvider.Local, dto);
    expect(local.authenticate).toHaveBeenCalledWith(dto);
    expect(repository.findActiveOwner).toHaveBeenCalledWith(42, 7, tx);
    expect(repository.createRefreshToken).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 42,
        auth_identity_id: 7,
        token_hash: 'a'.repeat(64),
      }),
      tx,
    );
    expect(result).toMatchObject({
      user,
      token_type: 'Bearer',
      access_token: 'access',
      refresh_token: 'refresh',
      access_expires_at: new Date(1800003600 * 1000).toISOString(),
      refresh_expires_at: new Date(1802592000 * 1000).toISOString(),
    });
  });
  it('waits for commit before disclosing tokens', async () => {
    let commit!: () => void;
    repository.withTransaction.mockImplementation(async (work) => {
      const result = await work(tx);
      await new Promise<void>((r) => {
        commit = r;
      });
      return result;
    });
    let settled = false;
    const login = service
      .login(AuthProvider.Local, { email: user.email, password: 'x' })
      .then((r) => {
        settled = true;
        return r;
      });
    await vi.waitFor(() => expect(commit).toBeTypeOf('function'));
    expect(settled).toBe(false);
    commit();
    await login;
  });
  it('denies ownership becoming inactive before commit', async () => {
    repository.findActiveOwner.mockResolvedValue(null);
    await expect(
      service.login(AuthProvider.Local, { email: user.email, password: 'x' }),
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' });
    expect(repository.createRefreshToken).not.toHaveBeenCalled();
  });
  it.each([
    ['P1001', 'AUTH_TEMPORARILY_UNAVAILABLE'],
    ['P2002', 'INTERNAL_ERROR'],
  ])('classifies storage %s safely', async (code, expected) => {
    repository.withTransaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('secret diagnostic', {
        code,
        clientVersion: '6',
      }),
    );
    await expect(
      service.login(AuthProvider.Local, { email: user.email, password: 'x' }),
    ).rejects.toMatchObject({ code: expected });
  });
  it('discloses no pair when signing fails', async () => {
    tokens.signRefreshToken.mockRejectedValueOnce(new Error('private'));
    await expect(
      service.login(AuthProvider.Local, { email: user.email, password: 'x' }),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(repository.createRefreshToken).not.toHaveBeenCalled();
  });
});
