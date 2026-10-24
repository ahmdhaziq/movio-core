import {
  IsDefined,
  IsString,
  IsNotEmpty,
  MaxLength,
  Matches,
} from 'class-validator';
export class RefreshTokenDto {
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  @Matches(/^[\x21-\x7e]+$/)
  refresh_token!: string;
}
