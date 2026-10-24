import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';

export const authRequestContext = new AsyncLocalStorage<{
  correlationId: string;
  started: number;
}>();
const logger = new Logger('AuthAudit');
export function auditAuthOutcome(operation: string, outcome: string): void {
  const context = authRequestContext.getStore();
  logger.log({
    time: new Date().toISOString(),
    operation,
    ...(operation === 'register' ? { provider: 'local' } : {}),
    outcome,
    durationMs: context
      ? Math.max(0, Math.round(performance.now() - context.started))
      : 0,
    correlationId: context?.correlationId ?? randomUUID(),
  });
}
