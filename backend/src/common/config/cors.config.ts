import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/**
 * CORS, as an exact required origin that fails loudly — ACC-128.
 *
 * ## What was actually wrong, which is not what it looked like
 *
 * `main.ts` passed `origin: process.env['FRONTEND_URL']` with `credentials:
 * true`, and that variable is not set on Railway. The comment beside it promised
 * that "a silently wrong/missing origin must fail loudly rather than fall back
 * to a guess", and the code did not deliver it.
 *
 * The defect was reported as the middleware REFLECTING the requesting origin —
 * a permissive policy. MEASURED AGAINST THE `cors` PACKAGE, that is not what
 * happens, and the difference reverses the severity:
 *
 * | configuration | headers emitted |
 * | -- | -- |
 * | `origin: undefined` + credentials (the deployed state) | NONE AT ALL |
 * | `origin` omitted entirely | `Access-Control-Allow-Origin: *` + credentials |
 * | an exact string, non-matching request origin | the CONFIGURED origin, and `next()` with no error |
 *
 * So the deployed behaviour is **fail-CLOSED, not permissive**: with no
 * `Access-Control-Allow-Origin` header at all, a browser blocks the response. It
 * was never a hole through which a site could read this API — CORS constrains
 * browsers only, and a browser had nothing to go on.
 *
 * The real cost is the opposite one: **a front end would have been unable to
 * call the API at all**, with nothing logged and a successful boot. A
 * configuration error that starts cleanly is the defect, and that half of the
 * report was exactly right.
 *
 * ## The origin is the STRING, and row three is the whole reason
 *
 * ACC-128's second criterion reads: *"A request from an unlisted origin is
 * **refused rather than reflected**."*
 *
 * **Reflected** means the server echoes back the REQUESTER's origin, which is
 * what makes a permissive policy dangerous. Row three is measured: with a string
 * origin and a request from `https://evil.example`, `cors` emits
 * `Access-Control-Allow-Origin: https://accreditme.app` — the CONFIGURED value,
 * never the requester's. So a plain string already satisfies that criterion, and
 * the spec beside this file proves it against the real middleware rather than
 * against a callback of our own.
 *
 * An earlier version of this file used a function origin that called back with a
 * `ForbiddenException`, to make the refusal observable server-side. **That was a
 * behaviour change nobody asked for and it is reverted.** It would have turned
 * 200 into 403 for every non-browser client that happens to send an `Origin`
 * header — health probes, proxies, webhooks, some HTTP clients — while the
 * browser-visible outcome was identical either way, since a browser blocks on
 * the header mismatch regardless.
 *
 * It also bought no security. Session cookies are `sameSite: 'strict'`, so a
 * cross-site request carries no credentials at all; even a "simple" request that
 * a browser sends before discarding the response arrives unauthenticated. **The
 * cookie policy is the defence**, which is the argument ACC-128 itself makes.
 *
 * WHAT THAT GIVES UP, stated rather than glossed: there is no server-side signal
 * that an unlisted origin tried — nothing refused and nothing logged. If that
 * visibility is wanted it is a log line and a deliberate decision, not a status
 * code smuggled in beside a configuration fix.
 *
 * ## One exact origin, no list and no pattern
 *
 * Deliberately not a comma-separated list and not a wildcard pattern. See
 * `SYSTEM-REFERENCE.md` §15.10 for the preview-deployment decision and why
 * `*.vercel.app` in particular is unsafe.
 */

/** The message a boot failure carries. Asserted by spec, so it is a constant. */
export const FRONTEND_URL_MISSING =
  'FRONTEND_URL is not set. The API refuses to start without it: it is the exact ' +
  'browser origin allowed to send credentialed requests, and there is no safe ' +
  'default. Set it to the front end’s origin, e.g. http://localhost:4200 in ' +
  'development or https://accreditme.app in production.';

/**
 * The one allowed browser origin, or a thrown error.
 *
 * Trimmed, because a variable set to whitespace in a dashboard is the same
 * mistake as one not set at all and must not pass as configured.
 */
export function resolveFrontendOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const value = env['FRONTEND_URL']?.trim();
  if (!value) throw new Error(FRONTEND_URL_MISSING);
  return value;
}

/**
 * `CorsOptions` allowing exactly `allowedOrigin`.
 *
 * `credentials: true` is what forbids a wildcard: browsers reject `*` whenever
 * credentials are set, which is why there is no permissive fallback to reach for.
 */
export function buildCorsOptions(allowedOrigin: string): CorsOptions {
  return { origin: allowedOrigin, credentials: true };
}
