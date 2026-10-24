import { Injectable } from '@nestjs/common';

@Injectable()
export class AuthClock {
  now(): number {
    return Math.floor(Date.now() / 1000);
  }
}
