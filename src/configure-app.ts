import { RegisterLocalDto } from './auth/dto/register-local.dto.js';
import { registrationValidationException } from './auth/auth.controller.js';
import { INestApplication, ValidationPipe } from '@nestjs/common';

export function configureApp(app: INestApplication): void {
  const defaultExceptionFactory = new ValidationPipe().createExceptionFactory();
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      exceptionFactory: (errors) =>
        errors.some((error) => error.target instanceof RegisterLocalDto)
          ? registrationValidationException(errors)
          : defaultExceptionFactory(errors),
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
}
