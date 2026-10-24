import {
  IsDefined,
  IsIn,
  IsString,
  IsNotEmpty,
  MaxLength,
  Matches,
} from 'class-validator';
export class LogoutDto {
  @IsDefined()
  @IsIn(['access', 'refresh'])
  token_type!: 'access' | 'refresh';
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  @Matches(/^[\x21-\x7e]+$/)
  token!: string;
}
