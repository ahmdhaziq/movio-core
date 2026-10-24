import { LogoutDto } from './dto/logout.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { AuthMode } from './decorators/auth-mode.decorator.js';
import { LoginValidationPipe } from './pipes/login-validation.pipe.js';
import type { LoginDto } from './dto/login.dto.js';
import { AuthExceptionFilter } from './exceptions/auth-exception.filter.js';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import {
  Body,
  Controller,
  Header,
  HttpCode,
  Post,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { RegisterLocalDto } from './dto/register-local.dto.js';
@Controller('auth')
@UseFilters(AuthExceptionFilter)
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(private readonly service: AuthService) {}
  @SkipThrottle()
  @AuthMode('logout')
  @Post('logout')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  logout(@Body() dto: LogoutDto) {
    return this.service.logout(dto);
  }
  @AuthMode('refresh')
  @Post('refresh')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.service.refresh(dto);
  }
  @AuthMode('public')
  @Post('login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  login(@Body(LoginValidationPipe) dto: LoginDto) {
    const { provider, ...input } = dto;
    return this.service.login(provider, input);
  }
  @AuthMode('public')
  @Post('register')
  @Header('Cache-Control', 'no-store')
  register(@Body() dto: RegisterLocalDto) {
    return this.service.register(dto);
  }
}
