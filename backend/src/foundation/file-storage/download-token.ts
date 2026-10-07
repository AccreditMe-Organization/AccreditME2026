import { createHmac, hkdfSync, timingSafeEqual } from 'crypto';
import { getEncryptionKey } from '../../common/utils/tenant-config-crypto';

// ACC-177 — the local-folder equivalent of a pre-signed URL (Ahmad, 7 Oct).
//
// A local folder has no signed URLs, so after the permission check the API
// mints a token naming ONE file in ONE organisation with an expiry, and
// GET /files/stream/:token streams it. The token is the whole entitlement for
// fifteen minutes, exactly like an S3 pre-signed URL, so the stream route
// needs no session — which is what lets a browser simply open it.
//
// The key is derived from ENCRYPTION_KEY with HKDF under its own label, so a
// token can never be confused with any other use of that key.

export const DOWNLOAD_TTL_SECONDS = 15 * 60;

interface ITokenPayload {
  f: string; // StoredFile id
  o: string; // organizationId
  e: number; // expiry, epoch seconds
}

function signingKey(): Buffer {
  return Buffer.from(hkdfSync('sha256', getEncryptionKey(), Buffer.alloc(0), 'accreditme:file-download-token:v1', 32));
}

function sign(body: string): string {
  return createHmac('sha256', signingKey()).update(body).digest('base64url');
}

export function issueDownloadToken(
  fileId: string,
  organizationId: string,
  now: Date = new Date(),
): { token: string; expiresAt: Date } {
  const expiresAt = new Date(now.getTime() + DOWNLOAD_TTL_SECONDS * 1000);
  const payload: ITokenPayload = { f: fileId, o: organizationId, e: Math.floor(expiresAt.getTime() / 1000) };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return { token: `${body}.${sign(body)}`, expiresAt };
}

/** The file and organisation a valid, unexpired token names; null for anything else. */
export function readDownloadToken(
  token: string,
  now: Date = new Date(),
): { fileId: string; organizationId: string } | null {
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<ITokenPayload>;
    if (typeof payload.f !== 'string' || typeof payload.o !== 'string' || typeof payload.e !== 'number') return null;
    if (payload.e * 1000 <= now.getTime()) return null;
    return { fileId: payload.f, organizationId: payload.o };
  } catch {
    return null;
  }
}
