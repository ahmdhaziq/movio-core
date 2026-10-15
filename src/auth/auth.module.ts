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
    UserModule,
    PrismaModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10, blockDuration: 0 }]),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthRepository, LocalStrategy],
})
export class AuthModule {}
