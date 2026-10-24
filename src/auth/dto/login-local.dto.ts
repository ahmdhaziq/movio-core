import { IsDefined, Equals } from 'class-validator';
import { AuthProvider } from '../enums/auth-provider.enum.js';
import { AuthenticateLocalDto } from './authenticate-local.dto.js';
export class LoginLocalDto extends AuthenticateLocalDto {
  @IsDefined()
  @Equals(AuthProvider.Local)
  provider!: AuthProvider.Local;
}
