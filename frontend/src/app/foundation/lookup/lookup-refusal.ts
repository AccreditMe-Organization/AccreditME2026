import { refusalCode } from '../../core/http/refusal';

/**
 * ACC-309 — what the Lookups screens say when the server refuses.
 *
 * NEVER the server's `message`. It is English, written for a log, and a refused
 * Hide said "Internal server error" in an Arabic session. A refusal is mapped
 * from its CODE (read with the shared `refusalCode()`, never by parsing the
 * message) to a translation key; anything without a known code gets the
 * action's own translated sentence ("The value could not be hidden.").
 *
 * The lookup routes send almost no codes: their refusals (not found, a system
 * value that cannot be edited or deleted, a key already in use) are plain
 * exceptions with English text. The codes they can send are below. A new coded
 * refusal on these routes gets its line here, and its sentence in both
 * translation files.
 *
 * Same shape as `manage-roles-refusal.ts`.
 */
const KNOWN: Readonly<Record<string, string>> = {
  // PATCH /lookups/values/:id/attributes (ACC-286).
  LOOKUP_ATTRIBUTE_INVALID: 'lookup.refusal.attributeInvalid',
  // Any route, from the global rate limit (ACC-129).
  RATE_LIMITED: 'lookup.refusal.rateLimited',
};

/** The translation key to show for a refused lookup action: its code's sentence, else the action's own. */
export function lookupRefusalKey(err: unknown, actionKey: string): string {
  const code = refusalCode(err);
  return (code && KNOWN[code]) || actionKey;
}
