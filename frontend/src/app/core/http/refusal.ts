import { HttpErrorResponse } from '@angular/common/http';

/**
 * Reading an AccreditMe refusal off an HTTP error — ACC-120 slice 9d.
 *
 * Every refusal the API sends on purpose carries a stable `code` in its body
 * (sign-in: `auth-refusal.ts`; rate limits: `rate-limited.exception.ts`;
 * invitations: slice 9c). A screen maps the CODE to its own words, never the
 * English `message`, which is written for a log.
 *
 * Moved here from Accept invitation, which had it file-local, so Sign in reads
 * refusals the same way rather than with a second copy.
 */

/** The body of an error response, when it is a JSON object. */
export function refusalBody(err: unknown): Record<string, unknown> | null {
  if (!(err instanceof HttpErrorResponse)) return null;
  const body: unknown = err.error;
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

/** The stable `code` an AccreditMe refusal carries in its body, if any. */
export function refusalCode(err: unknown): string | null {
  const code = refusalBody(err)?.['code'];
  return typeof code === 'string' ? code : null;
}
