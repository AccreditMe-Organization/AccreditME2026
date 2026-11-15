import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * ACC-164 — Better Auth's two-step state is written in ONE place.
 *
 * `two-factor-reset.ts` makes the administrator reset's writes (the flag and
 * the secret row), pinned against Better Auth's own `disableTwoFactor` by the
 * contract spec. Anything else that wrote them could leave a person whose flag
 * and secret row disagree: either never asked for a code, or unable to sign in
 * at all (`TOTP_NOT_ENABLED`). Better Auth's own calls make every other write.
 *
 * Fails on any non-test source under src/ or prisma/ that writes the
 * `AuthTwoFactor` table, or sets `twoFactorEnabled` (a `select` reads it and is
 * fine), outside that file.
 */
const BACKEND = join(__dirname, '..', '..', '..');
const ALLOWED = new Set(['src/foundation/auth/two-factor-reset.ts']);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'generated' || name === 'migrations' ? [] : sources(path);
    // Specs and db-specs are tests: they build rows on purpose.
    return name.endsWith('.ts') && !/[.-]spec\.ts$/.test(name) ? [path] : [];
  });
}

const TABLE_WRITE = /\bauthTwoFactor\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/;
// A literal value, or any value inside a `data:` object on the same line.
const FLAG_WRITE = /\btwoFactorEnabled\s*:\s*(true|false)\b|\bdata\s*:\s*\{[^}]*\btwoFactorEnabled\b/;

export function twoFactorWriteSites(files: readonly string[]): string[] {
  const hits: string[] = [];
  for (const file of files) {
    const rel = relative(BACKEND, file).split(sep).join('/');
    if (ALLOWED.has(rel)) continue;
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, '');
        if (TABLE_WRITE.test(code) || (FLAG_WRITE.test(code) && !/\bselect\b/.test(code))) {
          hits.push(`${rel}:${i + 1}`);
        }
      });
  }
  return hits;
}

describe('two-step state is written only by two-factor-reset.ts (ACC-164)', () => {
  const files = [...sources(join(BACKEND, 'src')), ...sources(join(BACKEND, 'prisma'))];

  it('scans a real tree', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.endsWith('two-factor-reset.ts'))).toBe(true);
  });

  it('finds no write anywhere else', () => {
    expect(twoFactorWriteSites(files)).toEqual([]);
  });

  it('would find one (the scan is not vacuous)', () => {
    const reset = files.find((f) => f.endsWith('two-factor-reset.ts'))!;
    ALLOWED.delete('src/foundation/auth/two-factor-reset.ts');
    try {
      expect(twoFactorWriteSites([reset]).length).toBeGreaterThanOrEqual(2);
    } finally {
      ALLOWED.add('src/foundation/auth/two-factor-reset.ts');
    }
  });
});
