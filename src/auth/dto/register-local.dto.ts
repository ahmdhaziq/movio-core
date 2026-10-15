import { Transform } from 'class-transformer';
import {
  IsDefined,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';
import { PasswordPolicy } from '../validation/password-policy.validator.js';
import { AuthProvider } from '../enums/auth-provider.enum.js';
export class RegisterLocalDto {
  @IsDefined()
  @IsIn([AuthProvider.Local])
  provider!: AuthProvider.Local;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsDefined()
  @IsEmail()
  email!: string;
  @IsDefined()
  @IsString()
  @PasswordPolicy()
  password!: string;
}
