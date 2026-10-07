import cookieParser from 'cookie-parser';
import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * How many proxies stand between a visitor and this app on Railway — ACC-129.
 *
 * Without `trust proxy`, Express reports the nearest proxy as `req.ip` for
 * every user, so the rate limiter counted all anonymous traffic as one address,
 * and the sign-in records and the new-IP email recorded the proxy.
 *
 * A HOP COUNT, not a subnet, because of what Railway actually sends. Measured on
 * 7 Oct with `LOG_CLIENT_ADDRESS=true`, three requests from one visitor:
 *
 *   socket=::ffff:100.64.0.2  xff=188.236.50.136, 152.233.68.97
 *   socket=::ffff:100.64.0.3  xff=188.236.50.136, 152.233.15.123
 *   socket=::ffff:100.64.0.4  xff=188.236.50.136, 152.233.15.123
 *
 *   hop 1 — the socket: Railway's internal router (::ffff:100.64.0.x).
 *   hop 2 — the right-most X-Forwarded-For entry: Railway's edge, which appends
 *           its own public address, and a DIFFERENT one from request to request
 *           (152.233.x.x).
 *   then  — the visitor (188.236.50.136, which is Railway's own srcIp for them).
 *
 * Trusting the 100.64 router by subnet stopped at the edge address, so one
 * visitor was counted under several edge addresses and never reached a limit —
 * 31 lookups, all 400. Trusting the edge by subnet would mean tracking Railway's
 * public ranges, which they do not publish as a contract. Two hops is the shape
 * itself.
 *
 * Express takes the address two in from the right, so anything a visitor writes
 * into X-Forwarded-For lands further LEFT and is never reached. With no
 * X-Forwarded-For (local development, the tests) `req.ip` is the socket.
 *
 * IF A CDN IS PUT IN FRONT (Cloudflare, say), THIS MUST BECOME 3: it adds one
 * more hop, and at 2 every visitor behind a CDN node would share that node's
 * bucket. Prove it with `LOG_CLIENT_ADDRESS=true` after the change.
 */
export const RAILWAY_PROXY_HOPS = 2;

/** Request handling shared by main.ts and every test that exercises it. */
export function configureHttp(app: NestExpressApplication): void {
  app.set('trust proxy', RAILWAY_PROXY_HOPS);
  // Populates req.cookies — required for TenantGuard (and the rate limiter) to
  // read the access_token httpOnly cookie (Step 9, Section 12 Discussion 4).
  app.use(cookieParser());
}
