/**
 * Names no tenant may take as its slug — ACC-139.
 *
 * A tenant's slug is its address: `{slug}.accreditme.app`. So a slug that is
 * also a name we need for ourselves (`www`, `api`, `mail`, `status`) would
 * either collide with infrastructure or let a tenant sit at an address that
 * reads as ours. Both lists are checked when a tenant is created
 * (`CreateTenantDto`).
 *
 * TWO LISTS, because they answer two different questions:
 *
 * - `INFRASTRUCTURE_LABELS` — never a tenant AND never a sign-in host. The
 *   frontend's tenant-host rule refuses these too, so `www.accreditme.app`
 *   shows the "open your organisation's address" note instead of a form. The
 *   frontend keeps a COPY (`frontend/src/app/core/tenant/reserved-labels.ts`),
 *   and `npm run check:reserved-slugs` fails CI when the two differ. Change
 *   both in the same commit.
 * - `PLATFORM_SIGN_IN_LABELS` — not creatable as a tenant, but a VALID sign-in
 *   host: `platform` is the platform organisation's own slug, so
 *   `platform.accreditme.app` is where a platform administrator signs in.
 *
 * Lower case, because a slug is lower case by the DTO's own pattern.
 */
export const INFRASTRUCTURE_LABELS: readonly string[] = [
  'www',
  'api',
  'app',
  'admin',
  'mail',
  'webmail',
  'smtp',
  'email',
  'static',
  'assets',
  'cdn',
  'files',
  'media',
  'img',
  'images',
  'status',
  'docs',
  'help',
  'support',
  'blog',
  'billing',
  'auth',
  'login',
  'signin',
  'account',
  'accounts',
  'dashboard',
  'portal',
  'console',
  'internal',
  'root',
  'system',
  'dev',
  'staging',
  'test',
  'demo',
  'sandbox',
  'localhost',
  'ns1',
  'ns2',
  'ftp',
  'accreditme',
];

export const PLATFORM_SIGN_IN_LABELS: readonly string[] = ['platform'];

/** Every slug `CreateTenantDto` refuses by name. */
export const RESERVED_SLUGS: readonly string[] = [
  ...INFRASTRUCTURE_LABELS,
  ...PLATFORM_SIGN_IN_LABELS,
];

/**
 * A DNS label, which is what a slug becomes: lower-case letters, digits and
 * hyphens, 1–63 characters, starting and ending with a letter or digit, and not
 * an `xn--` punycode label (an internationalised name that would render as
 * something other than what was typed).
 */
export const DNS_LABEL = /^(?!xn--)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
