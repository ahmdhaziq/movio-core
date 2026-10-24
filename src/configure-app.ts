import { LogoutDto } from './auth/dto/logout.dto.js';
import { RefreshTokenDto } from './auth/dto/refresh-token.dto.js';
import { randomUUID } from 'node:crypto';
import { authRequestContext } from './auth/auth-audit.js';
import { RegisterLocalDto } from './auth/dto/register-local.dto.js';
import {
  registrationValidationException,
  authValidationException,
  logoutValidationException,
} from './auth/auth-validation.js';
import { INestApplication, ValidationPipe } from '@nestjs/common';

export function configureApp(app: INestApplication): void {
  app.use(
    (
      req: { path: string },
      res: { setHeader(name: string, value: string): void },
      next: () => void,
    ) => {
      const correlationId = randomUUID();
      res.setHeader('X-Request-Id', correlationId);
      if (req.path.startsWith('/auth/'))
        res.setHeader('Cache-Control', 'no-store');
      authRequestContext.run(
        { correlationId, started: performance.now() },
        next,
      );
    },
  );
  const defaultExceptionFactory = new ValidationPipe().createExceptionFactory();
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      exceptionFactory: (errors) =>
        errors.some((error) => error.target instanceof RegisterLocalDto)
          ? registrationValidationException(errors)
          : errors.some((error) => error.target instanceof LogoutDto)
            ? logoutValidationException(errors)
            : errors.some((error) => error.target instanceof RefreshTokenDto)
              ? authValidationException(errors)
              : defaultExceptionFactory(errors),
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
}
