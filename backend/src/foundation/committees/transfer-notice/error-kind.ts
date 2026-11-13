/**
 * ACC-297 — what kind of error it was, for a log line: its name and, when it has
 * one, its code ("Error / ECONNREFUSED", "TimeoutError"). NEVER its message: a
 * Redis connection error's message can contain the server's address.
 */
export function errorKind(err: unknown): string {
  if (!(err instanceof Error)) return 'unknown';
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' || typeof code === 'number' ? `${err.name} / ${String(code)}` : err.name;
}
