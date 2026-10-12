import { IsDefined, IsEmail, IsString, MaxLength } from 'class-validator';

export class CreateUserDto {
  @IsDefined()
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsDefined()
  @IsEmail()
  email!: string;
}
