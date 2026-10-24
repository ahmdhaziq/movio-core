import type { LoginRequestMap } from '../strategies/auth-strategy.interface.js';
export type LoginDto = LoginRequestMap[keyof LoginRequestMap];
