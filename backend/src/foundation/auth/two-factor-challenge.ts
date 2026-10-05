import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  SECURE_COOKIE_PREFIX,
  TWO_FACTOR_ATTEMPTS_PER_CHALLENGE,
  TWO_FACTOR_ATTEMPTS_PREFIX,
  TWO_FACTOR_CHALLENGE_PREFIX,
  TWO_FACTOR_COOKIE_NAME,
  TWO_FACTOR_MAX_FAILURES_PER_USER,
} from './better-auth.contract';

/**
 * Reading — and clearing — Better Auth's sign-in MFA challenge (ACC-120 slice 9b).
 *
 * Better Auth keeps the challenge as two AuthVerification rows and a signed
 * cookie (see better-auth.contract.ts), and exposes none of it through its API.
 * This module is the only place that reaches into that state, so the coupling
 * has one address and one contract spec.
 *
 * The cookie's SIGNATURE IS VERIFIED before an identifier is trusted. A
 * challenge is therefore only ever read or cleared on behalf of a caller
 * holding a cookie Better Auth itself issued: knowing someone else's
 * identifier is not enough to cancel their challenge or read its count.
 *
 * These are Better Auth's tables, not tenant data — they carry no
 * organizationId, and the identifier is the whole key.
 */

export interface TwoFactorChallenge {
  identifier: string;
  /** The AuthUser this challenge would sign in. */
  authUserId: string;
  expiresAt: Date;
  /** Codes tried against THIS challenge so far. */
  attemptsUsed: number;
}

const CHALLENGE_COOKIE_NAMES = new Set([
  TWO_FACTOR_COOKIE_NAME,
  `${SECURE_COOKIE_PREFIX}${TWO_FACTOR_COOKIE_NAME}`,
]);

/** The challenge cookie's value in a `Cookie` header (or one `name=value` pair). */
function cookieValueFromHeader(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (CHALLENGE_COOKIE_NAMES.has(part.slice(0, eq).trim())) {
      return part.slice(eq + 1).trim();
    }
  }
  return null;
}

/**
 * The challenge identifier inside a signed cookie value, or null when the value
 * is malformed, is not a challenge, or does not carry Better Auth's signature.
 */
export function verifiedChallengeIdentifier(
  signedValue: string | null,
  secret: string | undefined = process.env['BETTER_AUTH_SECRET'],
): string | null {
  if (!signedValue || !secret) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(signedValue);
  } catch {
    return null;
  }
  const dot = decoded.lastIndexOf('.');
  if (dot <= 0) return null;
  const identifier = decoded.slice(0, dot);
  const signature = decoded.slice(dot + 1);
  if (!identifier.startsWith(TWO_FACTOR_CHALLENGE_PREFIX)) return null;
  if (identifier.startsWith(TWO_FACTOR_ATTEMPTS_PREFIX)) return null;

  const expected = Buffer.from(createHmac('sha256', secret).update(identifier).digest('base64'));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return identifier;
}

/** The challenge identifier from a request's `Cookie` header. */
export function challengeIdentifierFromRequest(cookieHeader: string | undefined): string | null {
  return verifiedChallengeIdentifier(cookieValueFromHeader(cookieHeader));
}

/** The challenge identifier from the `Set-Cookie` headers Better Auth produced. */
export function challengeIdentifierFromSetCookies(setCookies: readonly string[]): string | null {
  for (const header of setCookies) {
    const identifier = verifiedChallengeIdentifier(cookieValueFromHeader(header.split(';')[0]));
    if (identifier) return identifier;
  }
  return null;
}

/** The live challenge, or null when it no longer exists or has expired. */
export async function loadChallenge(
  prisma: PrismaService,
  identifier: string,
): Promise<TwoFactorChallenge | null> {
  const [challenge, attempts] = await Promise.all([
    prisma.authVerification.findFirst({
      where: { identifier },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.authVerification.findFirst({
      where: { identifier: `${TWO_FACTOR_ATTEMPTS_PREFIX}${identifier}` },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  if (!challenge || challenge.expiresAt.getTime() <= Date.now()) return null;
  const used = Number(attempts?.value);
  return {
    identifier,
    authUserId: challenge.value,
    expiresAt: challenge.expiresAt,
    attemptsUsed: Number.isInteger(used) && used >= 0 ? used : 0,
  };
}

/**
 * Codes the person may still try before they must sign in again: the smaller
 * of what is left on THIS challenge and what is left before their MFA locks.
 */
export async function attemptsRemaining(
  prisma: PrismaService,
  challenge: TwoFactorChallenge,
): Promise<number> {
  const twoFactor = await prisma.authTwoFactor.findUnique({
    where: { userId: challenge.authUserId },
    select: { failedVerificationCount: true },
  });
  const onChallenge = TWO_FACTOR_ATTEMPTS_PER_CHALLENGE - challenge.attemptsUsed;
  const beforeLock = TWO_FACTOR_MAX_FAILURES_PER_USER - (twoFactor?.failedVerificationCount ?? 0);
  return Math.max(0, Math.min(onChallenge, beforeLock));
}

/** When the user's MFA lock lifts, or null when it is not locked. */
export async function twoFactorLockedUntil(
  prisma: PrismaService,
  authUserId: string,
): Promise<Date | null> {
  const twoFactor = await prisma.authTwoFactor.findUnique({
    where: { userId: authUserId },
    select: { lockedUntil: true },
  });
  return twoFactor?.lockedUntil ?? null;
}
