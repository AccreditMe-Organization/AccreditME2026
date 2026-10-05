import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { registeredNullsLastColumns } from './sort-whitelist';

jest.mock('better-auth/api', () => ({ isAPIError: () => false }));

// ACC-160 — A COLUMN SORTED NULLS LAST MUST BE OPTIONAL ON ITS MODEL.
//
// Prisma accepts `{ sort, nulls: 'last' }` only on a nullable field, and on a
// required one it refuses AT RUNTIME ("Expected SortOrder, provided Object" —
// measured against the dev database). SortWhitelist.resolve() returns a loose
// Record, so the compiler never sees the mistake: a required column listed in
// `nullsLast` would ship green and fail on the first request that sorted by it.
// This spec is the check the compiler cannot make.
//
// READS schema.prisma, not Prisma.dmmf. The request was the DMMF, and Prisma
// 7.8's TypeScript-output client does not export it: there is no `dmmf` in
// generated/, and its runtime data model carries name, kind and type only — no
// isRequired. The full DMMF needs @prisma/internals, which is not a dependency.
// schema.prisma is the single source of truth the DMMF is built from, so the
// spec reads it directly, and guards its own parser in both directions below.
//
// DISCOVERS rather than lists. Every non-spec file under src/ that constructs a
// SortWhitelist is loaded, so its whitelists register; a whitelist added
// tomorrow is checked the moment it exists, with nobody editing this file.

const SRC = join(__dirname, '..', '..');
const SCHEMA = join(SRC, '..', 'prisma', 'schema.prisma');

/** model -> field -> isOptional, for scalar and enum fields. */
function readSchema(): Map<string, Map<string, boolean>> {
  const models = new Map<string, Map<string, boolean>>();
  const text = readFileSync(SCHEMA, 'utf8').replace(/\r\n/g, '\n');
  for (const block of text.matchAll(/^model (\w+) \{\n([\s\S]*?)^\}/gm)) {
    const fields = new Map<string, boolean>();
    for (const line of block[2]!.split('\n')) {
      // `  name  Type`, `  name  Type?`, `  name  Type[]` — attributes, block
      // attributes (@@) and comments are not fields.
      const m = /^\s+(\w+)\s+(\w+)(\?|\[\])?(\s|$)/.exec(line);
      if (!m || line.trim().startsWith('//') || line.trim().startsWith('@@')) continue;
      fields.set(m[1]!, m[3] === '?');
    }
    models.set(block[1]!, fields);
  }
  return models;
}

function filesConstructingAWhitelist(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...filesConstructingAWhitelist(path));
    } else if (path.endsWith('.ts') && !path.endsWith('.spec.ts')) {
      if (readFileSync(path, 'utf8').includes('new SortWhitelist(')) found.push(path);
    }
  }
  return found;
}

describe('SortWhitelist nullsLast columns are optional on their model (ACC-160)', () => {
  const schema = readSchema();
  const files = filesConstructingAWhitelist(SRC);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  for (const file of files) require(file);
  const registered = registeredNullsLastColumns();

  // ── NON-VACUITY GUARDS, first. ────────────────────────────────────────────
  // An empty discovery, an empty registry or a parser that reads every field
  // the same way would each make the real assertion pass while checking
  // nothing — and look identical to one that checks everything.
  it('discovers the files that construct whitelists', () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it('finds at least one nullsLast column to check', () => {
    expect(registered).toContainEqual({ model: 'Role', column: 'nameAr' });
  });

  it('reads optionality from the schema in BOTH directions', () => {
    expect(schema.get('Role')?.get('nameAr')).toBe(true);
    expect(schema.get('Role')?.get('nameEn')).toBe(false);
  });

  // ── THE RULE. ─────────────────────────────────────────────────────────────
  it('lists only columns that exist and are optional', () => {
    const wrong = registered
      .map(({ model, column }) => {
        const optional = schema.get(model)?.get(column);
        if (optional === undefined) return `${model}.${column} — no such field in schema.prisma`;
        if (!optional) return `${model}.${column} — REQUIRED; Prisma refuses nulls: 'last' on it at runtime`;
        return null;
      })
      .filter((x): x is string => x !== null);

    expect(wrong).toEqual([]);
  });
});
