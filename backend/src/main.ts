import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { buildCorsOptions, resolveFrontendOrigin } from './common/config/cors.config';

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

  // FRONTEND_URL is an exact, required origin, and the API refuses to start
  // without it (ACC-128). httpOnly cookies require credentials: true, and
  // browsers reject a wildcard origin whenever credentials is set — so there is
  // no safe default to fall back to, and a missing value must stop the boot
  // rather than be guessed at.
  //
  // This comment made that promise before the code kept it: the origin was
  // `process.env['FRONTEND_URL']` with no check, and that variable is unset on
  // Railway. See cors.config.ts for what the middleware measurably does with
  // `undefined` — it is not what the defect report assumed.
  app.enableCors(buildCorsOptions(resolveFrontendOrigin()));

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // ACC-27 — one consistent JSON error shape across the entire API.
  app.useGlobalFilters(new HttpExceptionFilter());

  const port = process.env['PORT'] ?? 3000;
  await app.listen(port);
}

void bootstrap();
