/**
 * Absolute links into a tenant's own address — ACC-158, ACC-139.
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
 * `https://{slug}.{APP_BASE_DOMAIN}{path}` — the tenant's own subdomain. Since
 * ACC-139 the subdomain IS how the frontend knows the organisation: the sign-in
 * screen reads it from the address and no longer asks. Those hosts do not
 * resolve until the frontend is deployed (ACC-130); that is expected, and the
 * link is still the correct one to write.
 *
 * ## Two variables
 *
 * - `APP_BASE_DOMAIN` — REQUIRED everywhere, a bare host (`accreditme.app`).
 *   The API refuses to start without it, following `resolveFrontendOrigin()`:
 *   a missing value must stop the boot, never degrade to a relative path,
 *   because a relative path is exactly the defect this file closes.
 * - `APP_LINK_ORIGIN` — OPTIONAL, development only, exactly
 *   `http(s)://localhost[:port]`. When set, links are
 *   `{scheme}://{slug}.localhost[:port]{path}`: the tenant's own LOCAL host, so
 *   a local invitation opens the local frontend on the right organisation.
 *   Browsers resolve every `*.localhost` to loopback, and the dev server's
 *   proxy (frontend `proxy.conf.js`) makes each one same-origin with the API.
 *
 * `127.0.0.1` and `[::1]` are refused at boot: `{slug}.127.0.0.1` is not a
 * host, so the only link they could produce is one with no organisation in it.
 * A value already carrying a subdomain (`http://acme.localhost:4200`) is
 * refused for the same reason in reverse — the slug comes from the tenant,
 * never from the variable.
 *
 * ## Why the override is localhost-only, and not keyed off NODE_ENV
 *
 * Railway runs with `NODE_ENV=development` (measured 2026-10-05), so "is this
 * development?" cannot be answered from the environment. The guard keys off
 * the VALUE instead: a stray `APP_LINK_ORIGIN` on a deployed service can only
 * ever point at localhost — visibly broken — never redirect every tenant's
 * invitation to an arbitrary host.
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
  'APP_LINK_ORIGIN must be exactly http://localhost or https://localhost, with an ' +
  'optional port, such as http://localhost:4200 — local links are then built as ' +
  'http://{slug}.localhost:4200/…. 127.0.0.1 and [::1] cannot carry a tenant ' +
  'subdomain. Leave it unset on any deployed service.';

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

// A slug as a URL label. CreateTenantDto applies the tighter DNS_LABEL rule
// when a tenant is created; this only refuses what cannot be part of a host.
const SLUG = /^[a-z0-9-]+$/;

function isLocalhostOrigin(value: string): boolean {
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
  return url.hostname === 'localhost';
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
  if (!isLocalhostOrigin(rawOrigin))
    throw new Error(APP_LINK_ORIGIN_NOT_LOOPBACK);
  return { baseDomain, devOrigin: rawOrigin.replace(/\/$/, '') };
}

/**
 * An absolute URL to `path` on the tenant's own host:
 * `https://{slug}.{APP_BASE_DOMAIN}{path}`, or
 * `{scheme}://{slug}.localhost[:port]{path}` when the development override is
 * set.
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
  if (devOrigin) {
    const { protocol, port } = new URL(devOrigin);
    return `${protocol}//${slug}.localhost${port ? `:${port}` : ''}${path}`;
  }
  return `https://${slug}.${baseDomain}${path}`;
}
