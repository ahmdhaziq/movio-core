import { Transform } from 'class-transformer';
import {
  IsDefined,
  IsEmail,
  IsString,
  IsNotEmpty,
  MaxLength,
} from 'class-validator';
export class AuthenticateLocalDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsDefined()
  @IsEmail()
  email!: string;
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;
}
