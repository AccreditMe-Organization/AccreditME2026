/**
 * ACC-277 — a transition action's secrets are WRITE-ONCE. Every webhook header
 * value is a secret (an Authorization value is only the obvious case), and so is
 * a signing secret. No read returns one or any part of it; a save that sends one
 * empty keeps what is stored; no audit row records one. The webhook sender reads
 * the stored config directly and is unaffected.
 *
 * The masked shape keeps the field types today's Actions dialog reads: `headers`
 * stays a name → string map (every value ""), with `headersValueSet` beside it
 * saying which names hold a value. So the dialog shows the names with blank
 * values, and saving it untouched sends them back empty — which keeps them.
 *
 * Pure: no database. Applied to every action, whatever its type, because a
 * header map is a secret wherever it sits.
 */

type Config = Record<string, unknown>;

/** The read-only markers the masked read adds; a save never stores them. */
const READ_ONLY_MARKERS = ['headersValueSet', 'signingSecretSet'] as const;

const isPlainObject = (value: unknown): value is Config =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A stored value counts as set when it is a non-empty string (or anything else non-null). */
const isSet = (value: unknown): boolean => (typeof value === 'string' ? value !== '' : value !== null && value !== undefined);

/** "Not sent" for a secret field on a save: null, undefined or an empty string. */
const isEmpty = (value: unknown): boolean => value === null || value === undefined || (typeof value === 'string' && value.trim() === '');

/**
 * The config as a reader may see it: each header by name with value "" and
 * whether a value is set, and a signing secret as "" with whether it is set.
 * Never mutates the stored config.
 */
export function maskActionConfig(config: Config | null): Config | null {
  if (!isPlainObject(config)) return config;
  const masked: Config = { ...config };
  for (const marker of READ_ONLY_MARKERS) delete masked[marker];
  if ('headers' in config) {
    const headers = isPlainObject(config['headers']) ? config['headers'] : {};
    masked['headers'] = Object.fromEntries(Object.keys(headers).map((name) => [name, '']));
    masked['headersValueSet'] = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, isSet(value)]));
  }
  if ('signingSecret' in config) {
    masked['signingSecret'] = '';
    masked['signingSecretSet'] = isSet(config['signingSecret']);
  }
  return masked;
}

/**
 * The config to store when a save sends `sent` over `stored`:
 * - a header sent with an empty value keeps its stored value (or stays empty if
 *   it had none); a non-empty value replaces it; a header left out is removed,
 *   and no header list at all removes them all;
 * - the signing secret likewise: empty keeps, a value replaces, absent removes;
 * - the read-only markers are never stored.
 * Server-side code that copies a config uses the stored object directly, never
 * a masked read passed through here.
 */
export function mergeActionConfig(stored: Config | null, sent: Config): Config {
  const before = isPlainObject(stored) ? stored : {};
  const next: Config = { ...sent };
  for (const marker of READ_ONLY_MARKERS) delete next[marker];

  if ('headers' in sent) {
    const sentHeaders = isPlainObject(sent['headers']) ? sent['headers'] : {};
    const storedHeaders = isPlainObject(before['headers']) ? before['headers'] : {};
    next['headers'] = Object.fromEntries(
      Object.entries(sentHeaders).map(([name, value]) => [
        name,
        isEmpty(value) ? (Object.hasOwn(storedHeaders, name) ? storedHeaders[name] : '') : value,
      ]),
    );
  }
  if ('signingSecret' in sent && isEmpty(sent['signingSecret'])) {
    if (Object.hasOwn(before, 'signingSecret')) next['signingSecret'] = before['signingSecret'];
    else delete next['signingSecret'];
  }
  return next;
}

/** What an audit row may say about a config's secrets: header names and whether a signing secret is set. */
export function auditSecretsOf(config: Config | null): { headers?: string[]; signingSecret?: 'set' | 'not set' } {
  if (!isPlainObject(config)) return {};
  const out: { headers?: string[]; signingSecret?: 'set' | 'not set' } = {};
  if (isPlainObject(config['headers'])) out.headers = Object.keys(config['headers']);
  if ('signingSecret' in config) out.signingSecret = isSet(config['signingSecret']) ? 'set' : 'not set';
  return out;
}

/**
 * A text the webhook sender writes to its log (an error message, a response
 * summary) with every stored secret replaced by "[redacted]". A fetch that
 * rejects a malformed header quotes the value in its error, and an endpoint can
 * echo a header back in its response; neither may reach the action log.
 */
export function redactSecrets(text: string, config: Config | null): string {
  if (!isPlainObject(config)) return text;
  const headers = isPlainObject(config['headers']) ? Object.values(config['headers']) : [];
  const secrets = [...headers, config['signingSecret']]
    .filter((v): v is string => typeof v === 'string' && v !== '')
    // Longest first, so a secret containing another is replaced whole.
    .sort((a, b) => b.length - a.length);
  return secrets.reduce((out, secret) => out.split(secret).join('[redacted]'), text);
}

/** Which headers a save added, removed or changed, by name only — never a value. */
export function headerChanges(before: Config | null, after: Config | null): Record<string, 'added' | 'removed' | 'changed'> {
  const b = isPlainObject(before) && isPlainObject(before['headers']) ? before['headers'] : {};
  const a = isPlainObject(after) && isPlainObject(after['headers']) ? after['headers'] : {};
  const changes: Record<string, 'added' | 'removed' | 'changed'> = {};
  for (const name of Object.keys(a)) {
    if (!Object.hasOwn(b, name)) changes[name] = 'added';
    else if (b[name] !== a[name]) changes[name] = 'changed';
  }
  for (const name of Object.keys(b)) if (!Object.hasOwn(a, name)) changes[name] = 'removed';
  return changes;
}
