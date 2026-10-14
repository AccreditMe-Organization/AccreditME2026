// ACC-229 — the SQL template helpers are the REAL ones, from the same runtime
// module the generated client re-exports them from, so a spec can rebuild the
// exact statement a service sends (text and bound values) rather than a copy.
import { sqltag, raw, join, empty, Sql } from '@prisma/client/runtime/client';

export class PrismaClient {
  constructor(_options?: unknown) {}
  $extends(_extension: unknown) {
    return this;
  }
}

export const Prisma = {
  DbNull:    'DbNull'    as const,
  JsonNull:  'JsonNull'  as const,
  AnyNull:   'AnyNull'   as const,
  sql: sqltag,
  raw,
  join,
  empty,
  Sql,
};
