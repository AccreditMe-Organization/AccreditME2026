import { APP_GUARD } from '@nestjs/core';
import { AuthController } from '../../foundation/auth/auth.controller';
import { HealthController } from '../health/health.controller';
import { AppModule } from '../../app.module';
import {
  AccreditMeThrottlerGuard,
  RESET_EMAIL_LIMITED,
} from './accreditme-throttler.guard';
import { RATE_LIMITS, RESET_EMAIL_THROTTLER } from './rate-limits';
import { throttlerOptions } from './throttle.config';

jest.mock('../../providers/auth/better-auth.config', () => ({
  createBetterAuthInstance: jest.fn(() => ({ api: {} })),
}));
jest.mock('better-auth/api', () => ({ isAPIError: () => false }));

const MINUTE = 60_000;
const HOUR = 3_600_000;

/**
 * ACC-129 — every number the API enforces, pinned. A change here is a change
 * to what CLAUDE.md "Rate Limiting" promises, and must be made in both.
 */
describe('rate limits (ACC-129)', () => {
  it('are exactly the agreed table', () => {
    expect(RATE_LIMITS).toEqual({
      default: { ttl: MINUTE, signedIn: 600, anonymous: 300 },
      login: { limit: 60, ttl: MINUTE },
      mfaVerify: { limit: 60, ttl: MINUTE },
      refresh: { limit: 300, ttl: MINUTE },
      invitationLookup: { limit: 30, ttl: MINUTE },
      acceptInvitation: { limit: 20, ttl: MINUTE },
      forgotPassword: { limit: 20, ttl: HOUR },
      forgotPasswordPerEmail: { limit: 3, ttl: HOUR },
      resetPassword: { limit: 20, ttl: HOUR },
    });
  });

  const routeLimit = (handler: keyof AuthController) => {
    const fn = AuthController.prototype[handler] as unknown as object;
    return {
      limit: Reflect.getMetadata('THROTTLER:LIMITdefault', fn) as unknown,
      ttl: Reflect.getMetadata('THROTTLER:TTLdefault', fn) as unknown,
    };
  };

  it.each([
    ['login', RATE_LIMITS.login],
    ['verifyMfa', RATE_LIMITS.mfaVerify],
    ['refresh', RATE_LIMITS.refresh],
    ['lookupInvitation', RATE_LIMITS.invitationLookup],
    ['acceptInvitation', RATE_LIMITS.acceptInvitation],
    ['forgotPassword', RATE_LIMITS.forgotPassword],
    ['resetPassword', RATE_LIMITS.resetPassword],
  ] as const)('%s carries its own limit', (handler, expected) => {
    expect(routeLimit(handler)).toEqual({
      limit: expected.limit,
      ttl: expected.ttl,
    });
  });

  it('only the password-reset request is limited per email', () => {
    const marked = Object.getOwnPropertyNames(AuthController.prototype).filter(
      (name) =>
        Reflect.getMetadata(
          RESET_EMAIL_LIMITED,
          (AuthController.prototype as unknown as Record<string, object>)[
            name
          ] ?? {},
        ) === true,
    );
    expect(marked).toEqual(['forgotPassword']);
  });

  it('every other auth route falls under the default limit', () => {
    for (const handler of [
      'getMe',
      'logout',
      'cancelMfa',
      'setupMfa',
      'verifySetupMfa',
      'disableMfa',
      'getMfaStatus',
    ] as const) {
      expect(routeLimit(handler)).toEqual({ limit: undefined, ttl: undefined });
    }
  });

  it('exempts /health, and nothing else', () => {
    expect(Reflect.getMetadata('THROTTLER:SKIPdefault', HealthController)).toBe(
      true,
    );
    expect(
      Reflect.getMetadata('THROTTLER:SKIPdefault', AuthController),
    ).toBeUndefined();
  });

  it('defines the two named throttlers', () => {
    const options = throttlerOptions();
    const names =
      'throttlers' in options ? options.throttlers.map((t) => t.name) : [];
    expect(names).toEqual(['default', RESET_EMAIL_THROTTLER]);
  });

  it('is registered GLOBALLY, so a new endpoint is limited the day it is written', () => {
    const providers = Reflect.getMetadata('providers', AppModule) as Array<{
      provide?: unknown;
      useClass?: unknown;
    }>;
    expect(providers).toContainEqual({
      provide: APP_GUARD,
      useClass: AccreditMeThrottlerGuard,
    });
  });
});
