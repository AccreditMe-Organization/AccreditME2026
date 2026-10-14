import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import * as PermissionConstants from './permissions';
import { PERMISSIONS_NOT_YET_CHECKED } from './permissions';
import { ALL_PERMISSIONS } from '../../foundation/roles/permission.seed';

/**
 * ACC-120 slice 5 (CC-91, R2) — PERMISSIONS_NOT_YET_CHECKED against the
 * catalogue AND against the code.
 *
 * The list is hand-written, so it can go stale in two directions, and both are
 * defects: a module ships and starts checking a key the list still calls unused
 * (the key can no longer be granted to anyone who needs it), or a check is
 * deleted and an in-use key goes dead (the matrix offers a box nothing reads).
 * So this reads the source, both packages, and fails either way.
 *
 * "Checked" means referenced outside the files that only DECLARE keys:
 * permissions.ts, the two role seeds, specs, and the permission matrix's
 * placement table (frontend permission-columns.ts, PR B). That table says
 * which COLUMN a key is drawn in, for every catalogue key, so the layout is
 * settled before a module ships; it decides nothing about who may act, so it
 * neither puts a key in use nor keeps one alive. The workflow seed is a real
 * check for a record type that exists (Committee) and a forward reference for
 * the rest — which is exactly why it may mention an unused key, and why an
 * in-use key may rest on it (committees:manage and committees:approve do).
 */

const REPO = join(__dirname, '..', '..', '..', '..');
const ROOTS = [join(REPO, 'backend', 'src'), join(REPO, 'frontend', 'src', 'app')];

const DECLARES_ONLY = [
  /common[\\/]constants[\\/]permissions\.ts$/,
  /foundation[\\/]roles[\\/]role\.seed\.ts$/,
  /foundation[\\/]roles[\\/]permission\.seed\.ts$/,
  // The matrix's column table names every catalogue key; it places, it does not check.
  /foundation[\\/]roles[\\/]permission-matrix[\\/]permission-columns\.ts$/,
  /\.spec\.ts$/,
  /\.db-spec\.ts$/,
];
const WORKFLOW_SEED = /foundation[\\/]workflow[\\/]workflow\.seed\.ts$/;

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (path.endsWith('.ts') && !DECLARES_ONLY.some((re) => re.test(path))) out.push(path);
  }
  return out;
}

// groupName -> NAME -> key, so a reference by constant counts as well as the literal.
const GROUPS: [string, Record<string, string>][] = Object.entries(PermissionConstants)
  .filter(([name]) => name.endsWith('_PERMISSIONS'))
  .map(([name, group]) => [name, group as Record<string, string>]);

function referencesTo(key: string, files: [string, string][]): string[] {
  const literal = new RegExp(`['"\`]${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`);
  const names = GROUPS.flatMap(([group, entries]) =>
    Object.entries(entries)
      .filter(([, value]) => value === key)
      .map(([name]) => new RegExp(`\\b${group}\\.${name}\\b`)),
  );
  return files.filter(([, text]) => literal.test(text) || names.some((re) => re.test(text))).map(([f]) => f);
}

describe('PERMISSIONS_NOT_YET_CHECKED (ACC-120 slice 5, R2)', () => {
  const catalogue = ALL_PERMISSIONS.map((p) => `${p.module}:${p.action}`);
  const notYet = new Set(PERMISSIONS_NOT_YET_CHECKED);

  it('the catalogue is seeded once per key — the list is not flattened into it', () => {
    expect(new Set(catalogue).size).toBe(catalogue.length);
    expect(catalogue).toHaveLength(74);
  });

  it('names only catalogue keys, each once', () => {
    expect(PERMISSIONS_NOT_YET_CHECKED.filter((k) => !catalogue.includes(k))).toEqual([]);
    expect(notYet.size).toBe(PERMISSIONS_NOT_YET_CHECKED.length);
  });

  it('the list plus the in-use keys are the catalogue, exactly', () => {
    const inUse = catalogue.filter((k) => !notYet.has(k));
    expect([...inUse, ...PERMISSIONS_NOT_YET_CHECKED].sort()).toEqual([...catalogue].sort());
    expect(inUse).toHaveLength(36);
    expect(PERMISSIONS_NOT_YET_CHECKED).toHaveLength(38);
  });

  describe('against the code', () => {
    // Fails, never skips, if a package is missing: a scan that quietly finds no
    // files would pass every assertion below (ACC-120's vacuous-pass rule).
    const files: [string, string][] = ROOTS.flatMap((root) => {
      if (!existsSync(root)) throw new Error(`permissions-in-use: ${root} is missing`);
      return sources(root).map((f) => [f, readFileSync(f, 'utf8')] as [string, string]);
    });

    it('reads both packages (non-vacuity guard)', () => {
      const where = new Set(files.map(([f]) => relative(REPO, f).split(/[\\/]/)[0]));
      expect(where).toEqual(new Set(['backend', 'frontend']));
      expect(files.length).toBeGreaterThan(200);
    });

    it('no key on the list is checked anywhere but the workflow seed', () => {
      const checked = PERMISSIONS_NOT_YET_CHECKED.map(
        (k): [string, string[]] => [k, referencesTo(k, files).filter((f) => !WORKFLOW_SEED.test(f))],
      ).filter(([, refs]) => refs.length > 0);
      // A key here has started being checked: remove it from the list.
      expect(checked).toEqual([]);
    });

    it('every key NOT on the list is referenced by some code', () => {
      const dead = catalogue.filter((k) => !notYet.has(k)).filter((k) => referencesTo(k, files).length === 0);
      // A key here is checked by nothing: add it to the list (or delete it).
      expect(dead).toEqual([]);
    });
  });
});
