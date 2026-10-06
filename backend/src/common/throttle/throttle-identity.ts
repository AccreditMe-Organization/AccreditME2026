import { createHash } from 'crypto';
import type { TransformFnParams } from 'class-transformer';
import { readSessionToken, verifyJwt } from '../guards/tenant.guard';
import { normaliseEmail } from '../utils/normalise-email.transform';

/**
 * Who a request is counted against — ACC-129.
 *
 * Trackers are labels, never secrets: `user:<id>`, `ip:<address>` or
 * `email:<hash>`. They appear in the 429 log line, so a token or an email
 * address must never be one.
 */
interface ThrottledRequest {
  ip?: string;
  cookies?: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

const identities = new WeakMap<object, string>();

/** The address Express resolved, which honours `trust proxy` (http.config.ts). */
export function byAddress(req: ThrottledRequest): string {
  return `ip:${req.ip ?? 'unknown'}`;
}

/**
 * A signed-in user by id, verified exactly as TenantGuard verifies them;
 * anything else by address. A forged, expired or missing token is the address:
 * an invented token must not buy a fresh bucket. Cached per request, because
 * the limit and the tracker both ask.
 *
 * Signature only — no tokenVersion or permission lookup. This decides whose
 * counter a request goes on; TenantGuard still decides whether it may proceed.
 */
export function bySessionOrAddress(req: ThrottledRequest): string {
  const cached = identities.get(req);
  if (cached) return cached;

  let identity = byAddress(req);
  const token = readSessionToken(req);
  const secret = process.env['JWT_SECRET'];
  if (token && secret) {
    try {
      const { sub } = verifyJwt(token, secret);
      if (sub) identity = `user:${sub}`;
    } catch {
      // Not a valid session: counted by address.
    }
  }
  identities.set(req, identity);
  return identity;
}

export function isSignedInIdentity(identity: string): boolean {
  return identity.startsWith('user:');
}

/**
 * A password-reset request, by organisation and email — hashed, so the counter
 * key and the log line never carry the address. Normalised the way the DTO and
 * the lockout normalise it (normalise-email.transform.ts), so capitalisation
 * cannot buy extra attempts.
 */
export function byOrganisationAndEmail(req: ThrottledRequest): string {
  const body = (req.body ?? {}) as {
    organizationSlug?: unknown;
    email?: unknown;
  };
  const slug =
    typeof body.organizationSlug === 'string'
      ? body.organizationSlug.trim().toLowerCase()
      : '';
  const email = normaliseEmail({ value: body.email } as TransformFnParams);
  const digest = createHash('sha256')
    .update(`${slug}\n${typeof email === 'string' ? email : ''}`)
    .digest('hex')
    .slice(0, 16);
  return `email:${digest}`;
}
