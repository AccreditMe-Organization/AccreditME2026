/**
 * Settings that hold write-only secrets — one rule for every settings screen
 * (ACC-181 D4; storage, ACC-177, was the first).
 *
 * A secret is written once and never read back: GET answers "set" or null, so
 * a screen never has the value to send back. A save therefore cannot mean
 * "replace the stored settings with what was sent". It means "lay what was
 * sent on top of what is stored":
 *
 * - a key not sent (`undefined`) keeps its stored value;
 * - an empty string (`''`) keeps its stored value too, for a SECRET — an empty
 *   write-only field is "leave it as it is", never "set it to nothing";
 * - anything else replaces it.
 *
 * Which keys are secrets: every key, unless `secretKeys` names them. Storage
 * passes none, because every one of its settings keeps on `''` (its behaviour
 * since ACC-177, pinned by its own specs). The email settings name their
 * secrets, so an ordinary optional field such as the sender name can be
 * cleared with `''`.
 */
export function mergeKeepingSecrets<S extends object, U extends object>(
  stored: S | undefined,
  sent: U | undefined,
  secretKeys?: readonly string[],
): Partial<S & U> {
  const merged: Record<string, unknown> = { ...(stored ?? {}) };
  for (const [key, value] of Object.entries(sent ?? {})) {
    if (value === undefined) continue;
    if (value === '') {
      const isSecret = secretKeys === undefined || secretKeys.includes(key);
      if (isSecret) continue;
      delete merged[key];
      continue;
    }
    merged[key] = value;
  }
  return merged as Partial<S & U>;
}

/**
 * The names of the fields whose values differ — for an audit row, which
 * records WHAT changed and never a value, secrets included BY NAME only.
 * `prefix` names the block (`'minio.'`, `'smtp.'`).
 */
export function changedFieldNames(before: object | undefined, after: object | undefined, prefix = ''): string[] {
  const a = (before ?? {}) as Record<string, unknown>;
  const b = (after ?? {}) as Record<string, unknown>;
  const names: string[] = [];
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (a[key] !== b[key]) names.push(`${prefix}${key}`);
  }
  return names;
}
