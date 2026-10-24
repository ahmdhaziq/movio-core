import { AuthMode } from './auth/decorators/auth-mode.decorator.js';
import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @AuthMode('public')
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
