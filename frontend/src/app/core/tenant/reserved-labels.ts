/**
 * Labels that are never an organisation's address — ACC-139.
 *
 * A COPY of `INFRASTRUCTURE_LABELS` in
 * `backend/src/common/tenant/reserved-slugs.ts`, which is the authority: the
 * backend refuses to create a tenant with any of these slugs, and this copy
 * makes `www.accreditme.app` (say) show the "open your organisation's address"
 * note instead of a sign-in form. `npm run check:reserved-slugs` fails CI when
 * the two lists differ, so change both in the same commit.
 *
 * `platform` is deliberately NOT here: it is the platform organisation's own
 * sign-in host.
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
