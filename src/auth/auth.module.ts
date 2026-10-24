import { AccessTokenGuard } from './guards/access-token.guard.js';
import { AuthTokenService } from './auth-token.service.js';
import { LoginValidationPipe } from './pipes/login-validation.pipe.js';
import { JwtModule } from '@nestjs/jwt';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuthClock } from './auth-clock.js';
import { AuthTokenConfig } from './auth-token.config.js';
import { GuardAuthExceptionFilter } from './exceptions/auth-exception.filter.js';
import { ThrottlerModule } from '@nestjs/throttler';
import { Module } from '@nestjs/common';
import { UserModule } from '../user/user.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';
import { LocalStrategy } from './strategies/local.strategies.js';
@Module({
  imports: [
    JwtModule.register({}),
    UserModule,
    PrismaModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10, blockDuration: 0 }]),
  ],
  controllers: [AuthController],
  providers: [
    { provide: APP_GUARD, useClass: AccessTokenGuard },
    AuthTokenService,
    LoginValidationPipe,
    AuthService,
    AuthRepository,
    LocalStrategy,
    AuthClock,
    { provide: AuthTokenConfig, useFactory: () => new AuthTokenConfig() },
    { provide: APP_FILTER, useClass: GuardAuthExceptionFilter },
  ],
})
export class AuthModule {}
