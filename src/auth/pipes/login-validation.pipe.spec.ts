import { IsDefined, IsString } from 'class-validator';
import {
  LoginValidationPipe,
  validateProviderRequest,
} from './login-validation.pipe.js';
import { LoginLocalDto } from '../dto/login-local.dto.js';
const valid = {
  provider: 'local',
  email: ' ADA@Example.com ',
  password: ' x ',
};
describe('Provider-selected login validation', () => {
  const pipe = new LoginValidationPipe();
  it('selects the local DTO, normalizes email and preserves short exact passwords', async () => {
    const dto = await pipe.transform(valid);
    expect(dto).toBeInstanceOf(LoginLocalDto);
    expect(dto).toEqual({
      provider: 'local',
      email: 'ada@example.com',
      password: ' x ',
    });
  });
  it.each([
    null,
    [],
    1,
    {},
    { ...valid, provider: 'google' },
    { ...valid, provider: 'constructor' },
    { ...valid, email: 1 },
    { ...valid, password: null },
    { ...valid, password: '' },
    { ...valid, password: 'a'.repeat(129) },
    { ...valid, role: 'admin' },
    JSON.parse(
      '{"provider":"local","email":"a@b.com","password":"x","__proto__":{}}',
    ),
    { ...valid, constructor: {} },
    { ...valid, prototype: {} },
  ])('rejects malformed or unsupported input %j', async (value) => {
    const error = await pipe.transform(value).catch((e) => e);
    expect(error.getStatus()).toBe(400);
    expect(JSON.stringify(error.getResponse())).not.toContain(valid.password);
    expect(error.getResponse()).not.toHaveProperty('target');
  });
  it('allows a separately registered test DTO without local credentials', async () => {
    class Alternate {
      @IsDefined() @IsString() provider!: string;
      @IsDefined() @IsString() assertion!: string;
    }
    const dto = await validateProviderRequest(
      { provider: 'test-only', assertion: 'synthetic' },
      new Map([['test-only', Alternate]]),
    );
    expect(dto).toEqual({ provider: 'test-only', assertion: 'synthetic' });
    await expect(
      pipe.transform({ provider: 'test-only', assertion: 'synthetic' }),
    ).rejects.toThrow();
  });
});
