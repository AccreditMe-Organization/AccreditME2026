import cookieParser from 'cookie-parser';
import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * The proxies whose X-Forwarded-For entries Express may trust — ACC-129.
 *
 * On Railway every request arrives from Railway's proxy. Without this, Express
 * reports the proxy as `req.ip` for every user — measured: the one deployed
 * sign-in recorded `::ffff:100.64.0.1`, while Railway's own HTTP log showed the
 * real client. So the rate limiter would have counted all anonymous traffic as
 * one address, and the sign-in records and the new-IP email recorded the proxy.
 *
 * A SUBNET, not a hop count. Express walks X-Forwarded-For from the right,
 * skipping addresses it trusts, and takes the first one it does not: the
 * client. Railway has described its edge both as appending to a client-sent
 * X-Forwarded-For and as stripping it; this is right under either, and a value
 * a client put on the left cannot be chosen, because the walk stops at the real
 * client before reaching it.
 *
 * `loopback` covers local development and the tests (supertest connects over
 * loopback). Railway's proxies are in 100.64.0.0/10. A CDN in front (Cloudflare)
 * would add its own ranges here — revisit this then.
 */
export const TRUSTED_PROXIES: readonly string[] = ['loopback', '100.64.0.0/10'];

/** Request handling shared by main.ts and every test that exercises it. */
export function configureHttp(app: NestExpressApplication): void {
  app.set('trust proxy', [...TRUSTED_PROXIES]);
  // Populates req.cookies — required for TenantGuard (and the rate limiter) to
  // read the access_token httpOnly cookie (Step 9, Section 12 Discussion 4).
  app.use(cookieParser());
}
