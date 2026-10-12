import { labelFromOrigin } from '../config/cors.config';
import { resolveAppLinkConfig } from '../config/app-url.config';

/**
 * Whether a browser session is being used at its own organisation's address —
 * ACC-204.
 *
 * Every organisation's app calls ONE API host, and the session cookies are
 * host-only on it, so one browser holds one session for every address. Before
 * ACC-204 nothing compared the two: signed in at `al-nakheel.accreditme.app`,
 * the same browser opened `platform.accreditme.app` and the app showed the
 * al-nakheel user there. Data stayed scoped to the token's organisation; the
 * session simply showed at the wrong address.
 *
 * The address is the request's `Origin`, read by labelFromOrigin() — the same
 * parsing CORS uses. A browser sends it on every CORS request, which is every
 * call the app makes to the API in production (a different origin). Locally the
 * dev server proxies `/api`, so the app and API share an origin and a browser
 * sends no `Origin` on a GET; the dev proxy adds a faithful one
 * (frontend/proxy.conf.js), so this rule is the same everywhere.
 *
 * NOT A SECURITY BOUNDARY: a non-browser client holding the cookie can send any
 * Origin it likes. What this stops is a BROWSER using one organisation's session
 * at another organisation's address. Data isolation is still organizationId
 * scoping on every query.
 */

/**
 * The platform organisation's slug, and so the label of its address,
 * `platform.accreditme.app` (`platform.localhost:4200` locally). Read on the
 * shared dev database, 12 Oct 2026: the only organisation with
 * `isPlatformOrg = true` has this slug.
 */
export const PLATFORM_ORGANIZATION_SLUG = 'platform';

/**
 * True when `origin` is the address of the organisation whose slug is
 * `expectedSlug`. A missing Origin, one that names no organisation, or one that
 * names another is false.
 */
export function isAtOwnAddress(
  origin: string | string[] | undefined,
  expectedSlug: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (typeof origin !== 'string' || origin === '') return false;
  const { baseDomain, devOrigin } = resolveAppLinkConfig(env);
  return labelFromOrigin(origin, baseDomain, devOrigin) === expectedSlug;
}
