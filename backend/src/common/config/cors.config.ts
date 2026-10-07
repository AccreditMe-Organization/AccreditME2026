import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { DNS_LABEL } from '../tenant/reserved-slugs';

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
 * (ACC-128's reasoning, kept as the record. The origin is a function since
 * ACC-139 — see the last section — but what it says about refusals still holds.)
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
 * ## ACC-139 — every tenant's own origin, which SUPERSEDES "one exact origin"
 *
 * Until ACC-139 this was one exact string. Every tenant now signs in at its
 * own address, `https://{slug}.{APP_BASE_DOMAIN}`, and that set grows with
 * every new organisation, so one string can no longer express it. The origin
 * is now a FUNCTION (`isAllowedOrigin()` below) that allows exactly:
 *
 * - `FRONTEND_URL`, compared exactly, as before; and
 * - `https://{label}.{APP_BASE_DOMAIN}` — https, ONE DNS label, no port.
 *
 * It REFLECTS such an origin, because `credentials: true` forbids a wildcard.
 * **That is not the reflection ACC-128 refused.** ACC-128 refused reflecting
 * ANY origin — the requester choosing what is echoed. Here only a host under a
 * registrable domain WE OWN is echoed, and nobody else can create one. That is
 * also why `*.vercel.app` stays unsafe (§15.10): it is a public namespace,
 * where anyone can create a host.
 *
 * Anything else gets `callback(null, false)`: no `Access-Control-Allow-Origin`
 * header at all, and the request itself still answered 200 — the browser is
 * what blocks, exactly as the section above argues. Not a 403, for the reason
 * that section gives.
 *
 * No tenant lookup: refusing `notatenant.accreditme.app` would be tidiness, not
 * security, and would cost a query on every preflight.
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
 * Whether a browser origin may make credentialed requests: exactly
 * `frontendOrigin`, or `https://{one DNS label}.{baseDomain}` with no port.
 */
export function isAllowedOrigin(
  origin: string,
  frontendOrigin: string,
  baseDomain: string,
): boolean {
  if (origin === frontendOrigin) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  // An Origin header is scheme://host[:port] and nothing else; anything with
  // more in it is not one.
  if (url.origin !== origin) return false;
  if (url.protocol !== 'https:' || url.port !== '') return false;
  const suffix = `.${baseDomain}`;
  if (!url.hostname.endsWith(suffix)) return false;
  // DNS_LABEL has no dot in it, so a.b.{baseDomain} is refused here.
  return DNS_LABEL.test(url.hostname.slice(0, -suffix.length));
}

/**
 * `CorsOptions` allowing `frontendOrigin` and every tenant's own origin.
 *
 * `credentials: true` is what forbids a wildcard: browsers reject `*` whenever
 * credentials are set, which is why an allowed origin is reflected rather than
 * answered with `*`.
 */
export function buildCorsOptions(
  frontendOrigin: string,
  baseDomain: string,
): CorsOptions {
  return {
    origin: (origin, callback) =>
      callback(
        null,
        origin !== undefined &&
          isAllowedOrigin(origin, frontendOrigin, baseDomain),
      ),
    credentials: true,
  };
}
