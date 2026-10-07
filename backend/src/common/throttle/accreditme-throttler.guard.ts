import {
  ExecutionContext,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';
import type { Request, Response } from 'express';
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
  private readonly addressLogger = new Logger('ClientAddress');

  /**
   * DIAGNOSTIC, OFF BY DEFAULT (ACC-129 follow-up): with LOG_CLIENT_ADDRESS set
   * to 'true', one line per request to a public auth route showing what the
   * limiter sees — `req.ip`, the socket's own address and the raw
   * X-Forwarded-For. It exists to prove on Railway that the counted address is
   * the visitor's. It never logs a body, a token, a cookie or an email; the
   * header is truncated. Unset, nothing is read or computed.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (process.env['LOG_CLIENT_ADDRESS'] === 'true') {
      this.logClientAddress(context);
    }
    return super.canActivate(context);
  }

  private logClientAddress(context: ExecutionContext): void {
    if (
      this.reflector.get<boolean>(PUBLIC_AUTH_ROUTE, context.getHandler()) !==
      true
    ) {
      return;
    }
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers['x-forwarded-for'];
    const xff = (
      Array.isArray(header) ? header.join(', ') : (header ?? '')
    ).slice(0, 200);
    const path = (req.originalUrl ?? req.url).split('?')[0];
    this.addressLogger.log(
      `${req.method} ${path} ip=${req.ip ?? ''} socket=${req.socket?.remoteAddress ?? ''} xff=${xff}`,
    );
  }

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

/** Marks the public auth routes — set by perAddress() in throttle.config.ts. */
export const PUBLIC_AUTH_ROUTE = 'accreditme:public-auth-route';

/** Marks the one route the per-email password-reset limit applies to. */
export const RESET_EMAIL_LIMITED = 'accreditme:reset-email-limited';
export const LimitResetsPerEmail = (): MethodDecorator =>
  SetMetadata(RESET_EMAIL_LIMITED, true);
