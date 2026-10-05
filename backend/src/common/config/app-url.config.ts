/**
 * Absolute links into a tenant's own address — ACC-158.
 *
 * ## Why this exists
 *
 * The invitation email carried `/accept-invitation?token=…`: a path with no
 * host. A relative link in an email has nothing to be relative TO, so no
 * recipient could ever open it. Every link the backend writes into text that
 * leaves the product (email first, password reset next) is built here, so the
 * shape is decided once.
 *
 * ## The shape
 *
 * `https://{slug}.{APP_BASE_DOMAIN}{path}` — the tenant's own subdomain. Those
 * hosts do not resolve until the frontend is deployed (ACC-130); that is
 * expected, and the link is still the correct one to write.
 *
 * ## Two variables
 *
 * - `APP_BASE_DOMAIN` — REQUIRED everywhere, a bare host (`accreditme.app`).
 *   The API refuses to start without it, following `resolveFrontendOrigin()`:
 *   a missing value must stop the boot, never degrade to a relative path,
 *   because a relative path is exactly the defect this file closes.
 * - `APP_LINK_ORIGIN` — OPTIONAL, development only. When set, links are
 *   `{APP_LINK_ORIGIN}{path}` with no slug, so a local invitation opens the
 *   local frontend. It must be a LOOPBACK origin; anything else refuses the
 *   boot.
 *
 * ## Why the override is loopback-only, and not keyed off NODE_ENV
 *
 * Railway runs with `NODE_ENV=development` (measured 2026-10-05), so "is this
 * development?" cannot be answered from the environment. The guard keys off
 * the VALUE instead: a stray `APP_LINK_ORIGIN` on a deployed service can only
 * ever point at localhost — visibly broken — never redirect every tenant's
 * invitation to an arbitrary host.
 *
 * ## Why not `http://{slug}.localhost:4200`
 *
 * Chrome resolves it, but CORS allows exactly `FRONTEND_URL`
 * (`http://localhost:4200`), so the page would load and every API call from it
 * would fail. Multi-origin CORS is ACC-139; until then the override drops the
 * slug.
 */

/** The message a boot failure carries. Asserted by spec, so it is a constant. */
export const APP_BASE_DOMAIN_MISSING =
  'APP_BASE_DOMAIN is not set. The API refuses to start without it: every link ' +
  'written into an email is https://{slug}.{APP_BASE_DOMAIN}/…, and without it ' +
  'the only link that could be written is a relative path no recipient can open. ' +
  'Set it to the bare host, e.g. accreditme.app.';

export const APP_BASE_DOMAIN_NOT_A_HOST =
  'APP_BASE_DOMAIN must be a bare host such as accreditme.app — no scheme, no ' +
  'path, no port. Links are built as https://{slug}.{APP_BASE_DOMAIN}/….';

export const APP_LINK_ORIGIN_NOT_LOOPBACK =
  'APP_LINK_ORIGIN must be a loopback origin such as http://localhost:4200 — it ' +
  'exists only so local invitations open the local frontend. Leave it unset on ' +
  'any deployed service.';

export interface AppLinkConfig {
  /** `accreditme.app` — the bare host tenant subdomains sit under. */
  baseDomain: string;
  /** `http://localhost:4200` in development, otherwise null. */
  devOrigin: string | null;
}

// Lower-case labels of letters, digits and hyphens, dot-separated, at least two
// labels. Rejects a scheme, a path, a port and whitespace by construction.
const BARE_HOST =
  /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

// The same rule CreateTenantDto applies to a slug when a tenant is created.
const SLUG = /^[a-z0-9-]+$/;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function isLoopbackOrigin(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  // An ORIGIN: nothing after the port. `new URL()` normalises an empty path to
  // '/', so compare against what was actually written.
  if (value.replace(/\/$/, '') !== url.origin) return false;
  return (
    LOOPBACK_HOSTS.has(url.hostname) || url.hostname.endsWith('.localhost')
  );
}

/**
 * The link configuration, or a thrown error.
 *
 * Both values are trimmed, because a variable set to whitespace in a dashboard
 * is the same mistake as one not set at all.
 */
export function resolveAppLinkConfig(
  env: NodeJS.ProcessEnv = process.env,
): AppLinkConfig {
  const baseDomain = env['APP_BASE_DOMAIN']?.trim();
  if (!baseDomain) throw new Error(APP_BASE_DOMAIN_MISSING);
  if (!BARE_HOST.test(baseDomain)) throw new Error(APP_BASE_DOMAIN_NOT_A_HOST);

  const rawOrigin = env['APP_LINK_ORIGIN']?.trim();
  if (!rawOrigin) return { baseDomain, devOrigin: null };
  if (!isLoopbackOrigin(rawOrigin))
    throw new Error(APP_LINK_ORIGIN_NOT_LOOPBACK);
  return { baseDomain, devOrigin: rawOrigin.replace(/\/$/, '') };
}

/**
 * An absolute URL to `path` on the tenant's own host:
 * `https://{slug}.{APP_BASE_DOMAIN}{path}`, or `{APP_LINK_ORIGIN}{path}` when
 * the development override is set.
 *
 * Refuses rather than build a malformed address: `path` must start with `/`,
 * and `slug` must be a slug.
 */
export function buildTenantUrl(
  slug: string,
  path: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (!path.startsWith('/'))
    throw new Error(`buildTenantUrl: path must start with "/", got "${path}"`);
  // typeof first: RegExp.test() coerces its argument, and the string
  // "undefined" is itself a valid slug — so a missing slug would otherwise
  // build https://undefined.{APP_BASE_DOMAIN}/… without a word.
  if (typeof slug !== 'string' || !SLUG.test(slug)) {
    throw new Error(`buildTenantUrl: "${String(slug)}" is not a tenant slug`);
  }

  const { baseDomain, devOrigin } = resolveAppLinkConfig(env);
  if (devOrigin) return `${devOrigin}${path}`;
  return `https://${slug}.${baseDomain}${path}`;
}
