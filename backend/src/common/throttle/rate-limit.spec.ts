import { Controller, Get, INestApplication, Logger } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createHmac, randomBytes } from 'crypto';
import type { Server } from 'http';
import request from 'supertest';
import { AuthController } from '../../foundation/auth/auth.controller';
import { AuthService } from '../../foundation/auth/auth.service';
import { UserService } from '../../foundation/user/user.service';
import { WorkingCalendarService } from '../../foundation/working-calendar/working-calendar.service';
import { HealthController } from '../health/health.controller';
import { HealthService } from '../health/health.service';
import { TenantGuard } from '../guards/tenant.guard';
import { HttpExceptionFilter } from '../filters/http-exception.filter';
import { configureHttp } from '../config/http.config';
import { AccreditMeThrottlerGuard } from './accreditme-throttler.guard';
import { throttlerOptions } from './throttle.config';
import { RATE_LIMITS } from './rate-limits';

// AuthController's module graph imports better-auth, which is ESM-only.
jest.mock('../../providers/auth/better-auth.config', () => ({
  createBetterAuthInstance: jest.fn(() => ({ api: {} })),
}));
jest.mock('better-auth/api', () => ({ isAPIError: () => false }));

const SECRET = 'rate-limit-spec-secret';

/** An ordinary route under the default limit. */
@Controller('probe')
class ProbeController {
  @Get()
  ok(): { ok: true } {
    return { ok: true };
  }
}

/** A session token signed exactly as TenantGuard verifies one (HS256). */
function sessionFor(sub: string, secret = SECRET): string {
  const b64 = (o: object) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({
    sub,
    organizationId: 'org-a',
    tokenVersion: 0,
    exp: Math.floor(Date.now() / 1000) + 600,
  });
  const sig = createHmac('sha256', secret)
    .update(`${head}.${body}`)
    .digest('base64url');
  return `${head}.${body}.${sig}`;
}

/**
 * ACC-129 — the rate limiter, through a real Nest app: the real throttler
 * config, the real global guard, the real error filter and the real
 * configureHttp() (trust proxy + cookies). Only the services behind the routes
 * are stand-ins. Every limit is exercised at its REAL number.
 *
 * supertest connects over loopback, which is a trusted proxy, so the
 * X-Forwarded-For a test sends decides the client address — exactly as
 * Railway's does in production.
 */
describe('rate limiting (ACC-129)', () => {
  // The high-volume tests send up to 602 requests through a real app.
  jest.setTimeout(30_000);

  let app: INestApplication;
  let warn: jest.SpyInstance<void, [message: unknown, ...rest: unknown[]]>;

  beforeEach(async () => {
    process.env['JWT_SECRET'] = SECRET;
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot(throttlerOptions())],
      controllers: [AuthController, HealthController, ProbeController],
      providers: [
        { provide: APP_GUARD, useClass: AccreditMeThrottlerGuard },
        {
          provide: AuthService,
          useValue: {
            lookupInvitation: jest
              .fn()
              .mockResolvedValue({ name: 'Acme', nameAr: null }),
            forgotPassword: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: UserService, useValue: {} },
        { provide: WorkingCalendarService, useValue: {} },
        {
          provide: HealthService,
          useValue: { getHealth: () => ({ status: 'ok' }) },
        },
      ],
    })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .compile();

    const nest = moduleRef.createNestApplication<NestExpressApplication>();
    configureHttp(nest);
    nest.setGlobalPrefix('api/v1');
    nest.useGlobalFilters(new HttpExceptionFilter());
    // Listening once, before any request: supertest otherwise calls listen(0)
    // per request, and the concurrent batches below then race to bind the same
    // server — Linux answers that with ECONNRESET (CI did; Windows did not).
    await nest.listen(0);
    app = nest;
  });

  afterEach(async () => {
    await app.close();
    warn.mockRestore();
    delete process.env['JWT_SECRET'];
  });

  const server = (): Server => app.getHttpServer() as Server;
  const warnings = (): string[] => warn.mock.calls.map((c) => String(c[0]));
  const retryAfterOf = (res: request.Response): number =>
    (res.body as { retryAfterSeconds: number }).retryAfterSeconds;
  const lookup = (forwardedFor = '198.51.100.7') =>
    request(server())
      .post('/api/v1/auth/invitations/lookup')
      .set('X-Forwarded-For', forwardedFor)
      .send({ token: 'f'.repeat(48) });

  /**
   * n requests, in batches of 20 at a time, all finished before it returns —
   * so a test's next request is always the (n+1)th the guard has counted.
   * Batched rather than one at a time: the high-volume tests send 300 to 600
   * requests, which one by one outran Jest's default timeout in a full run.
   */
  async function times(
    n: number,
    send: (i: number) => request.Test,
  ): Promise<number[]> {
    const statuses: number[] = [];
    for (let start = 0; start < n; start += 20) {
      const batch = Array.from({ length: Math.min(20, n - start) }, (_, k) =>
        send(start + k),
      );
      statuses.push(...(await Promise.all(batch)).map((r) => r.status));
    }
    return statuses;
  }

  it('refuses the request past the limit with 429, the API error shape and a standard Retry-After', async () => {
    const limit = RATE_LIMITS.invitationLookup.limit;
    const allowed = await times(limit, () => lookup());
    // Non-vacuity guard: the route really answers below the limit.
    expect(allowed.every((s) => s === 200)).toBe(true);

    const refused = await lookup();
    expect(refused.status).toBe(429);
    const { retryAfterSeconds: seconds, ...shape } = refused.body as Record<
      string,
      unknown
    >;
    expect(shape).toEqual({
      statusCode: 429,
      message: 'Too many requests. Try again later.',
      error: 'Too Many Requests',
      code: 'RATE_LIMITED',
    });
    expect(typeof seconds).toBe('number');
    expect(seconds as number).toBeGreaterThan(0);
    expect(seconds as number).toBeLessThanOrEqual(
      RATE_LIMITS.invitationLookup.ttl / 1000,
    );
    expect(refused.headers['retry-after']).toBe(String(seconds));

    // One warning naming the counted address — and never the request body.
    const lines = warnings();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('ip:198.51.100.7');
    expect(lines[0]).not.toContain('f'.repeat(48));
  });

  it('never throttles /health, even at twice the anonymous limit', async () => {
    const statuses = await times(2 * RATE_LIMITS.default.anonymous, () =>
      request(server())
        .get('/api/v1/health')
        .set('X-Forwarded-For', '198.51.100.7'),
    );
    expect(statuses).toHaveLength(600);
    expect(statuses.every((s) => s === 200)).toBe(true);
  });

  it('counts two signed-in users behind one address separately', async () => {
    const userA = `access_token=${sessionFor('user-a')}`;
    const userB = `access_token=${sessionFor('user-b')}`;
    const probe = (cookie: string) =>
      request(server())
        .get('/api/v1/probe')
        .set('X-Forwarded-For', '203.0.113.50')
        .set('Cookie', cookie);

    const a = await times(RATE_LIMITS.default.signedIn, () => probe(userA));
    // Above the anonymous limit already, so A was counted as a USER.
    expect(a.every((s) => s === 200)).toBe(true);
    expect((await probe(userA)).status).toBe(429);

    // Same address, different user: untouched.
    expect((await probe(userB)).status).toBe(200);
    expect(warnings().join('\n')).toContain('user:user-a');
  });

  it('counts a forged session by address, so an invented token buys no fresh bucket', async () => {
    const forged = () =>
      `access_token=${sessionFor(randomBytes(8).toString('hex'), 'not-the-secret')}`;
    const statuses = await times(RATE_LIMITS.default.anonymous, () =>
      request(server())
        .get('/api/v1/probe')
        .set('X-Forwarded-For', '203.0.113.60')
        .set('Cookie', forged()),
    );
    expect(statuses.every((s) => s === 200)).toBe(true);
    const next = await request(server())
      .get('/api/v1/probe')
      .set('X-Forwarded-For', '203.0.113.60');
    expect(next.status).toBe(429);
  });

  it('counts the client X-Forwarded-For names, not the proxy: two clients, two buckets', async () => {
    await times(RATE_LIMITS.invitationLookup.limit, () =>
      lookup('198.51.100.7'),
    );
    expect((await lookup('198.51.100.7')).status).toBe(429);
    expect((await lookup('198.51.100.8')).status).toBe(200);
  });

  it('ignores an address the client put on the left of X-Forwarded-For', async () => {
    const statuses = await times(RATE_LIMITS.invitationLookup.limit, (i) =>
      lookup(`10.0.0.${i}, 198.51.100.9`),
    );
    expect(statuses.every((s) => s === 200)).toBe(true);
    // A new spoofed value cannot escape the real client's bucket.
    expect((await lookup('8.8.8.8, 198.51.100.9')).status).toBe(429);
  });

  describe('password reset', () => {
    const forgot = (email: string, address: string) =>
      request(server())
        .post('/api/v1/auth/forgot-password')
        .set('X-Forwarded-For', address)
        .send({ organizationSlug: 'al-nakheel', email });

    it('is limited per organisation + email, whichever address asks', async () => {
      const limit = RATE_LIMITS.forgotPasswordPerEmail.limit;
      const statuses = await times(limit, (i) =>
        forgot('nurse@example.test', `192.0.2.${i + 1}`),
      );
      expect(statuses.every((s) => s === 200)).toBe(true);

      // A new address, and a different spelling of the same email: still refused.
      const refused = await forgot('  Nurse@Example.TEST ', '192.0.2.200');
      expect(refused.status).toBe(429);
      expect(refused.headers['retry-after']).toBe(
        String(retryAfterOf(refused)),
      );
      // The email never reaches the log, only its hash.
      const line = warnings().join('\n');
      expect(line).toMatch(/email:[0-9a-f]{16}/);
      expect(line.toLowerCase()).not.toContain('nurse@example.test');

      // Another email from the same address is unaffected.
      expect((await forgot('doctor@example.test', '192.0.2.200')).status).toBe(
        200,
      );
    });

    it('is also limited per address, across different emails', async () => {
      const limit = RATE_LIMITS.forgotPassword.limit;
      const statuses = await times(limit, (i) =>
        forgot(`person${i}@example.test`, '192.0.2.77'),
      );
      expect(statuses.every((s) => s === 200)).toBe(true);
      expect((await forgot('one-more@example.test', '192.0.2.77')).status).toBe(
        429,
      );
    });
  });

  // ACC-129 follow-up — the diagnostic that proves on Railway which address is
  // counted. Off unless LOG_CLIENT_ADDRESS is exactly 'true'.
  describe('the client-address diagnostic', () => {
    const COOKIE_VALUE = 'cookie-secret-value-1234';
    const BEARER = 'bearer-secret-value-5678';
    const BODY_TOKEN = 'b'.repeat(48);
    let info: jest.SpyInstance<void, [message: unknown, ...rest: unknown[]]>;

    beforeEach(() => {
      info = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);
    });
    afterEach(() => {
      info.mockRestore();
      delete process.env['LOG_CLIENT_ADDRESS'];
    });

    const addressLines = (): string[] =>
      info.mock.calls
        .map((c) => String(c[0]))
        .filter((m) => m.includes(' ip='));

    const lookupWithSecrets = (forwardedFor = '198.51.100.7') =>
      request(server())
        .post('/api/v1/auth/invitations/lookup?debug=1')
        .set('X-Forwarded-For', forwardedFor)
        .set('Cookie', `access_token=${COOKIE_VALUE}`)
        .set('Authorization', `Bearer ${BEARER}`)
        .send({ token: BODY_TOKEN });

    it('logs one line per public auth request when set, with no secrets', async () => {
      process.env['LOG_CLIENT_ADDRESS'] = 'true';
      await lookupWithSecrets();

      const lines = addressLines();
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(
        /^POST \/api\/v1\/auth\/invitations\/lookup ip=198\.51\.100\.7 socket=\S+ xff=198\.51\.100\.7$/,
      );
      for (const secret of [COOKIE_VALUE, BEARER, BODY_TOKEN, 'debug=1']) {
        expect(lines[0]).not.toContain(secret);
      }
    });

    it('truncates X-Forwarded-For to 200 characters', async () => {
      process.env['LOG_CLIENT_ADDRESS'] = 'true';
      const long = `${'10.0.0.1, '.repeat(40)}198.51.100.7`;
      await lookupWithSecrets(long);
      const xff = addressLines()[0]?.split(' xff=')[1] ?? '';
      expect(xff).toHaveLength(200);
    });

    it('logs nothing for a route that is not a public auth route', async () => {
      process.env['LOG_CLIENT_ADDRESS'] = 'true';
      await request(server())
        .get('/api/v1/probe')
        .set('X-Forwarded-For', '198.51.100.7');
      await request(server()).get('/api/v1/health');
      expect(addressLines()).toEqual([]);
    });

    it.each([undefined, 'false', '1', 'TRUE'])(
      'logs nothing when LOG_CLIENT_ADDRESS is %p',
      async (value) => {
        if (value !== undefined) process.env['LOG_CLIENT_ADDRESS'] = value;
        await lookupWithSecrets();
        expect(addressLines()).toEqual([]);
      },
    );
  });
});
