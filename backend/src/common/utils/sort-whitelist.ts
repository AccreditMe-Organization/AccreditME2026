import { BadRequestException } from '@nestjs/common';

// ACC-78 — resolves a caller-supplied sort into a Prisma `orderBy`, but ONLY
// from a fixed set the endpoint declares.
//
// WHY A WHITELIST AND NOT A PASSTHROUGH. `sortBy` arrives from a query string.
// Handing it to `orderBy: { [sortBy]: dir }` means the caller chooses which
// column the database sorts by — and Prisma will accept any scalar on the
// model, including ones the endpoint never meant to expose. On User that
// reaches `passwordHash`-adjacent columns and every timestamp; ordering by a
// column is a weak but real oracle over values the response does not return.
// It also breaks loudly on a relation field, turning a typo into a 500.
//
// So each endpoint declares its sortable columns and nothing else is reachable.
// This is the same "explicit allowlist" shape the HttpExceptionFilter uses for
// safe third-party errors (ACC-27) rather than a deny-list of known-bad names.
export class SortWhitelist<TColumn extends string> {
  constructor(
    private readonly columns: readonly TColumn[],
    private readonly fallback: { column: TColumn; dir: 'asc' | 'desc' },
  ) {}

  // Returns a Prisma orderBy object. An UNKNOWN column is rejected with a 400
  // rather than silently falling back to the default: a caller sorting by a
  // column that does not exist has a bug, and quietly returning a differently
  // ordered page hides it. Absent is not the same as unknown — no sortBy at
  // all is the ordinary case and takes the fallback.
  resolve(sortBy?: string, sortDir?: 'asc' | 'desc'): Record<string, 'asc' | 'desc'> {
    if (sortBy === undefined) {
      return { [this.fallback.column]: sortDir ?? this.fallback.dir };
    }
    if (!this.columns.includes(sortBy as TColumn)) {
      throw new BadRequestException(
        `Cannot sort by "${sortBy}". Sortable columns: ${this.columns.join(', ')}.`,
      );
    }
    return { [sortBy]: sortDir ?? this.fallback.dir };
  }

  // Exposed so an endpoint can advertise its own sortable set — a frontend
  // sort menu should be built from this rather than hardcoding column names
  // that can drift from what the backend accepts.
  get sortable(): readonly TColumn[] {
    return this.columns;
  }
}

// Page/pageSize normalisation, in one place so no service re-derives skip/take
// and gets an off-by-one on page 1.
export function toSkipTake(
  page: number | undefined,
  pageSize: number | undefined,
  defaultPageSize = 25,
): { skip: number; take: number; page: number; pageSize: number } {
  const resolvedPage = page ?? 1;
  const resolvedSize = pageSize ?? defaultPageSize;
  return {
    skip: (resolvedPage - 1) * resolvedSize,
    take: resolvedSize,
    page: resolvedPage,
    pageSize: resolvedSize,
  };
}
