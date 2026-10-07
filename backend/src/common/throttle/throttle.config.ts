import type { ExecutionContext } from '@nestjs/common';
import { Throttle, type ThrottlerModuleOptions } from '@nestjs/throttler';
import { RATE_LIMITS, RESET_EMAIL_THROTTLER } from './rate-limits';
import { RESET_EMAIL_LIMITED } from './accreditme-throttler.guard';
import {
  byAddress,
  byOrganisationAndEmail,
  bySessionOrAddress,
  isSignedInIdentity,
} from './throttle-identity';

type HttpRequest = Parameters<typeof bySessionOrAddress>[0];
const requestOf = (context: ExecutionContext): HttpRequest =>
  context.switchToHttp().getRequest<HttpRequest>();

/**
 * The two named throttlers — ACC-129.
 *
 * `default` applies to every route: 600 a minute per signed-in user, 300 per
 * address otherwise. A route that states its own limit (perAddress() below)
 * replaces it, still under the name `default`, so each route keeps its own
 * counter.
 *
 * `reset-email` applies only where `@LimitResetsPerEmail()` says so — the
 * password-reset request — and counts per organisation + email.
 *
 * Storage is the library's in-memory default: correct while the API runs ONE
 * replica (.railway/railway.ts). See CLAUDE.md "Rate Limiting" for when it is
 * not.
 */
export function throttlerOptions(): ThrottlerModuleOptions {
  return {
    throttlers: [
      {
        name: 'default',
        ttl: RATE_LIMITS.default.ttl,
        limit: (context: ExecutionContext) =>
          isSignedInIdentity(bySessionOrAddress(requestOf(context)))
            ? RATE_LIMITS.default.signedIn
            : RATE_LIMITS.default.anonymous,
        getTracker: (req) => bySessionOrAddress(req as HttpRequest),
      },
      {
        name: RESET_EMAIL_THROTTLER,
        ttl: RATE_LIMITS.forgotPasswordPerEmail.ttl,
        limit: RATE_LIMITS.forgotPasswordPerEmail.limit,
        getTracker: (req) => byOrganisationAndEmail(req as HttpRequest),
        skipIf: (context: ExecutionContext) =>
          Reflect.getMetadata(RESET_EMAIL_LIMITED, context.getHandler()) !==
          true,
      },
    ],
  };
}

/**
 * A public route's own limit, counted per ADDRESS — the auth routes, which a
 * person reaches before they have a session.
 */
export const perAddress = (limit: {
  limit: number;
  ttl: number;
}): MethodDecorator & ClassDecorator =>
  Throttle({
    default: {
      limit: limit.limit,
      ttl: limit.ttl,
      getTracker: (req) => byAddress(req as HttpRequest),
    },
  });
