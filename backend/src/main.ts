import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { buildCorsOptions } from './common/config/cors.config';
import { validateBootConfig } from './common/config/boot.config';
import { configureHttp } from './common/config/http.config';

async function bootstrap(): Promise<void> {
  // Every required value is checked BEFORE the app is created — before the
  // database connects and before the in-process workers register — so a
  // missing one stops the process before it can serve a request or consume a
  // job. validateBootConfig() is the whole list, and its spec is the proof
  // (ACC-158).
  const config = validateBootConfig();
  const logger = new Logger('Bootstrap');
  if (config.appLinks.devOrigin) {
    logger.warn(
      `APP_LINK_ORIGIN is set: emailed links point at ${config.appLinks.devOrigin}, ` +
        'not at tenant subdomains. Development only — never set it on a deployed service.',
    );
  } else {
    logger.log(
      `Emailed links point at https://{slug}.${config.appLinks.baseDomain}`,
    );
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.use(
    helmet({
      contentSecurityPolicy: true,
      hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
      frameguard: { action: 'deny' },
      noSniff: true,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );

  // Trusted proxies (so req.ip is the client, not Railway's proxy) and cookie
  // parsing — shared with the rate-limit tests, so they exercise the same
  // request handling (ACC-129).
  configureHttp(app);

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
  app.enableCors(buildCorsOptions(config.frontendOrigin));

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
