import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.use(
    helmet({
      contentSecurityPolicy: true,
      hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
      frameguard: { action: 'deny' },
      noSniff: true,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );

  // Populates req.cookies — required for TenantGuard to read the
  // access_token httpOnly cookie (Step 9, Section 12 Discussion 4).
  app.use(cookieParser());

  // FRONTEND_URL replaces the old CORS_ORIGIN/localhost fallback — an exact,
  // required origin. httpOnly cookies require credentials: true, and browsers
  // reject a wildcard origin whenever credentials: true is set, so a silently
  // wrong/missing origin must fail loudly rather than fall back to a guess.
  app.enableCors({
    origin: process.env['FRONTEND_URL'],
    credentials: true,
  });

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  const port = process.env['PORT'] ?? 3000;
  await app.listen(port);
}

void bootstrap();
