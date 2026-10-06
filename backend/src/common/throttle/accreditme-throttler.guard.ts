import {
  ExecutionContext,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';
import type { Response } from 'express';
import { RateLimitedException } from './rate-limited.exception';

/**
 * The rate limiter, registered once as APP_GUARD (app.module.ts) — ACC-129.
 *
 * GLOBAL ON PURPOSE. Applied per controller, an endpoint nobody thought about
 * is unlimited, which is how every endpoint came to be unlimited before this.
 * Global, a new endpoint is limited the day it is written, and an exemption is
 * a visible `@SkipThrottle()` with its reason beside it. There is exactly one:
 * GET /health.
 *
 * It runs BEFORE TenantGuard (global guards run first), so it identifies a
 * signed-in user itself — see throttle-identity.ts.
 */
@Injectable()
export class AccreditMeThrottlerGuard extends ThrottlerGuard {
  private readonly logger = new Logger('RateLimit');

  /**
   * Over a limit: a standard Retry-After header, one warning line naming the
   * counted identity, and the API's own error shape.
   *
   * The library writes `Retry-After-{name}` for every throttler not named
   * `default`, so the password-reset limit would otherwise carry no standard
   * header at all.
   */
  // Not `async`: it only throws, and the library awaits it, so a synchronous
  // throw reaches the caller exactly as a rejected promise would.
  protected throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const retryAfterSeconds = Math.max(1, detail.timeToBlockExpire);
    context
      .switchToHttp()
      .getResponse<Response>()
      .header('Retry-After', String(retryAfterSeconds));
    this.logger.warn(
      `429 ${context.getClass().name}.${context.getHandler().name}: ` +
        `${detail.tracker} over ${detail.limit} per ${Math.round(detail.ttl / 1000)}s ` +
        `(retry in ${retryAfterSeconds}s)`,
    );
    throw new RateLimitedException(retryAfterSeconds);
  }
}

/** Marks the one route the per-email password-reset limit applies to. */
export const RESET_EMAIL_LIMITED = 'accreditme:reset-email-limited';
export const LimitResetsPerEmail = (): MethodDecorator =>
  SetMetadata(RESET_EMAIL_LIMITED, true);
