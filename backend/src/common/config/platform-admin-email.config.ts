/**
 * The platform administrator's email, for `npm run seed:demo` — ACC-130.
 *
 * `prisma/demo-seed.ts` creates the platform organisation's PLATFORM_ADMIN user
 * with this address. It used to fall back to `admin@accreditme.com` — a mailbox
 * on a domain that is not ours and is listed for sale. Anyone who bought it
 * would receive that account's mail, including the support-initiated password
 * reset ACC-99 plans for platform accounts. So there is no fallback: the seed
 * refuses to run, naming the variable, and the address is always one somebody
 * chose and owns (Ahmad's decision 8, CC-68).
 *
 * Lives under src/ so Jest finds its spec (Jest's rootDir is src); the seed
 * imports it from here, as it already imports the role seed.
 */

/** The refusal. Asserted by spec, so it is a constant. */
export const PLATFORM_ADMIN_EMAIL_MISSING =
  'PLATFORM_ADMIN_EMAIL is not set. The demo seed creates the platform ' +
  'administrator with this address and will not guess one: set it to a ' +
  'mailbox you own.';

/** The address, trimmed, or a thrown error. */
export function resolvePlatformAdminEmail(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const value = env['PLATFORM_ADMIN_EMAIL']?.trim();
  if (!value) throw new Error(PLATFORM_ADMIN_EMAIL_MISSING);
  return value;
}
