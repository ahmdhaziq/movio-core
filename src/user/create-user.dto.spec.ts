import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateUserDto } from './dto/create-user.dto.js';

describe('CreateUserDto', () => {
  it('accepts a name of 100 characters and valid email', async () => {
    expect(
      await validate(
        plainToInstance(CreateUserDto, {
          name: 'a'.repeat(100),
          email: 'ada@example.com',
        }),
      ),
    ).toHaveLength(0);
  });
  it.each([
    {},
    { name: 'Ada' },
    { email: 'ada@example.com' },
    { name: 1, email: 'ada@example.com' },
    { name: 'a'.repeat(101), email: 'ada@example.com' },
    { name: 'Ada', email: 'invalid' },
    { name: null, email: null },
  ])('rejects invalid input %j', async (input) => {
    expect(
      (await validate(plainToInstance(CreateUserDto, input))).length,
    ).toBeGreaterThan(0);
  });
});
