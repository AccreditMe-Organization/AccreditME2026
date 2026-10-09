/**
 * The platform's sender address — ACC-130.
 *
 * Every email AccreditMe sends goes out from `RESEND_FROM_EMAIL`, the address on
 * the domain Resend has verified: `noreply@accreditme.app` on Railway.
 *
 * ## No fallback, deliberately
 *
 * The email processor used to fall back to `noreply@accreditme.com`. That domain
 * is not ours — it is listed for sale (its nameservers are
 * `ns1.domain-is-4-sale-at-domainmarket.com`, checked 8 Oct) — so the fallback
 * was a sender nobody chose, on a domain someone else can buy, which Resend
 * would refuse anyway. A missing value is now null, and the caller says so:
 * the email job fails with PLATFORM_SENDER_MISSING, sends nothing and leaves
 * `sentAt` null, so BullMQ shows the failure (Ahmad's decision 7, CC-68).
 *
 * The API does NOT refuse to boot without it: local development without email
 * keys must still start, and a missing sender breaks only mail.
 *
 * ACC-181 reads this too, for the email settings screen's sentence about
 * AccreditMe's default delivery: with null it shows the sentence without an
 * address, never a guessed one.
 */

/** Why an email job failed with no sender. Asserted by spec, so it is a constant. */
export const PLATFORM_SENDER_MISSING =
  'RESEND_FROM_EMAIL is not set, so AccreditMe has no address to send email ' +
  'from. Nothing was sent. Set it to the sender on the domain Resend has ' +
  'verified, e.g. noreply@accreditme.app.';

/**
 * The sender address, or null when there is none.
 *
 * Trimmed, because a variable set to whitespace in a dashboard is the same
 * mistake as one not set at all.
 */
export function resolvePlatformSender(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env['RESEND_FROM_EMAIL']?.trim();
  return value ? value : null;
}
