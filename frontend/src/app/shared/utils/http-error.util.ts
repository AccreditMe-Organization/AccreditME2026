// NestJS's default ValidationPipe returns `message` as a string array (one
// entry per failed class-validator constraint); other HttpExceptions return
// a plain string. Passing the array straight into a template-bound signal
// renders as "[object Object]" once ngx-translate's array-key handling
// (TranslateService.getParsedResultForArray) turns it into a translations
// object instead of a string (see ACC-26).
export function extractErrorMessage(err: unknown, fallback: string): string {
  const message = (err as { error?: { message?: unknown } })?.error?.message;
  if (Array.isArray(message) && message.length > 0) return message.join(', ');
  if (typeof message === 'string' && message.length > 0) return message;
  return fallback;
}
