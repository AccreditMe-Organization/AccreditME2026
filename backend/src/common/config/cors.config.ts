import { ForbiddenException } from '@nestjs/common';
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
 * ## Why the origin is a FUNCTION and not the string
 *
 * A string origin never refuses. The table above is measured: with
 * `origin: 'https://accreditme.app'` and a request from `https://evil.example`,
 * `cors` emits `Access-Control-Allow-Origin: https://accreditme.app` and calls
 * `next()` — no error, status 200. Only the BROWSER refuses, by comparing that
 * header with its own origin.
 *
 * That is adequate protection in a browser and untestable server-side, and
 * ACC-128 asks for a test proving an unlisted origin is refused. A function
 * origin that calls back with an error makes the refusal real, observable and
 * assertable — so the behaviour the old comment claimed is now the behaviour the
 * code has.
 *
 * ## One exact origin, no list and no pattern
 *
 * Deliberately not a comma-separated list and not a wildcard pattern. See
 * `SYSTEM-REFERENCE.md`'s deployment notes for the preview-deployment decision
 * and why `*.vercel.app` in particular is unsafe.
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

/** What a refused origin is told. */
export const ORIGIN_NOT_ALLOWED = 'This origin is not allowed to call this API.';

/**
 * `CorsOptions` allowing exactly `allowedOrigin`, and refusing anything else
 * with a 403 rather than a 500 — a disallowed origin is a policy decision, not
 * an internal fault, and ACC-27's error shape should describe it as one.
 */
export function buildCorsOptions(allowedOrigin: string): CorsOptions {
  return {
    origin: (requestOrigin, callback) => {
      // NO Origin HEADER IS NOT A CROSS-ORIGIN REQUEST, and must be allowed.
      // curl, server-to-server calls, Railway's own health check and same-origin
      // navigations all arrive without one. Refusing them would take the API
      // down for everything that is not a browser, which is most of what calls
      // it today.
      if (!requestOrigin) return callback(null, true);

      if (requestOrigin === allowedOrigin) return callback(null, true);

      return callback(new ForbiddenException(ORIGIN_NOT_ALLOWED), false);
    },
    credentials: true,
  };
}
