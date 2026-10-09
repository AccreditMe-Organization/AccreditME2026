/**
 * The API's own origin — ACC-148.
 *
 * ## What it is for
 *
 * Better Auth's `baseURL`: where Better Auth itself lives. Without one it logs
 * "Base URL is not set … the origin is derived from the incoming request" at
 * every boot, and builds the one link it makes (the password-reset URL) as a
 * relative path. With one, there is nothing to derive.
 *
 * ## Why one static value, and not per tenant
 *
 * Tenants live at `{slug}.accreditme.app` (ACC-139), but the API is ONE host for
 * all of them, and that host is what Better Auth's base URL means. Every link a
 * tenant clicks is built by `buildTenantUrl()` (`app-url.config.ts`) from
 * configuration, never by Better Auth. A dynamic `allowedHosts` base URL would
 * bring back request-derived resolution for nothing.
 *
 * ## The rule, following resolveFrontendOrigin()
 *
 * REQUIRED, and the API refuses to start without it: a missing value must stop
 * the boot, never fall back to a guess — a guess is what the warning was about.
 * It must be exactly an ORIGIN (scheme, host, optional port; no path), over
 * https — or http for `localhost` only, which is development.
 *
 * `https://accreditme2026-production.up.railway.app` today on Railway;
 * `https://api.accreditme.app` once ACC-130 moves the API there;
 * `http://localhost:3000` locally.
 */

/** The message a boot failure carries. Asserted by spec, so it is a constant. */
export const API_ORIGIN_MISSING =
  "API_ORIGIN is not set. The API refuses to start without it: it is the API's " +
  'own address, which Better Auth needs as its base URL, and there is no safe ' +
  'default. Set it to e.g. http://localhost:3000 in development or ' +
  'https://api.accreditme.app in production.';

export const API_ORIGIN_NOT_AN_ORIGIN =
  'API_ORIGIN must be an origin — https://host[:port], with no path — or ' +
  'http://localhost[:port] in development, e.g. https://api.accreditme.app.';

/**
 * The API's origin, or a thrown error.
 *
 * Trimmed, because a variable set to whitespace in a dashboard is the same
 * mistake as one not set at all. A trailing slash is accepted and dropped.
 */
export function resolveApiOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env['API_ORIGIN']?.trim();
  if (!raw) throw new Error(API_ORIGIN_MISSING);
  const value = raw.replace(/\/$/, '');

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(API_ORIGIN_NOT_AN_ORIGIN);
  }
  // An ORIGIN: nothing after the port. `new URL()` normalises an empty path to
  // '/', so compare against what was actually written.
  if (url.origin !== value) throw new Error(API_ORIGIN_NOT_AN_ORIGIN);
  const httpLocal = url.protocol === 'http:' && url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !httpLocal) {
    throw new Error(API_ORIGIN_NOT_AN_ORIGIN);
  }
  return value;
}
