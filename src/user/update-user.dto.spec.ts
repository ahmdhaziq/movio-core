import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ValidationPipe } from '@nestjs/common';
import { UpdateUserDto } from './dto/update-user.dto.js';

describe('UpdateUserDto', () => {
  it.each([
    { name: 'Ada' },
    { name: 'a'.repeat(100) },
    { email: 'ada@example.com' },
    { name: 'Ada', email: 'ada@example.com' },
  ])('accepts partial input %j', async (input) => {
    expect(await validate(plainToInstance(UpdateUserDto, input))).toHaveLength(
      0,
    );
  });
  it.each([
    {},
    { name: undefined },
    { name: null },
    { email: null },
    { name: 'a'.repeat(101) },
    { name: 42 },
    { email: 'invalid' },
    { name: 'Ada', email: null },
  ])('rejects invalid input %j', async (input) => {
    expect(
      (await validate(plainToInstance(UpdateUserDto, input))).length,
    ).toBeGreaterThan(0);
  });
  it('retains validation and rejects unknown fields through the Nest pipe', async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    const metadata = { type: 'body' as const, metatype: UpdateUserDto };
    expect(await pipe.transform({ name: 'Ada' }, metadata)).toMatchObject({
      name: 'Ada',
    });
    await expect(pipe.transform({}, metadata)).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      pipe.transform({ name: 'Ada', id: 7 }, metadata),
    ).rejects.toMatchObject({ status: 400 });
  });
});
