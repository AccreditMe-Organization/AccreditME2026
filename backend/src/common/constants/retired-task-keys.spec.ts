import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { ALL_PERMISSIONS } from '../../foundation/roles/permission.seed';

/**
 * ACC-244 — the flat task keys are retired, and nothing may read them again.
 *
 * tasks:view, tasks:create, tasks:reassign and tasks:manage were replaced by a
 * key PER RECORD TYPE (committees:view_all_tasks, …), read through the one task
 * visibility rule (task-visibility.ts) and the registry beside it. A flat key
 * that comes back is a second rule: it would admit tasks on every record type,
 * past the record check, and nothing else would say so — the retired key is no
 * longer in the catalogue, so no role can hold it, so the check it guards
 * would quietly refuse everyone (or, written as an OR, quietly allow).
 *
 * So this reads the source of BOTH packages and fails on:
 *   - a retired key written as a string literal ('tasks:view', "tasks:create",
 *     `tasks:manage`), and
 *   - the retired TASKS_PERMISSIONS constant.
 * A mention in prose (a comment saying what a key USED to be) is fine and is
 * not matched: the pattern needs the quotes.
 *
 * Out of scope, by path: backend/prisma, where the backfills that grant and
 * retire the keys have to name them (outside both roots below), and specs,
 * which use them as arbitrary "some other key" fixtures, and in the grant
 * script's own spec as the keys it reads. A spec cannot open a path.
 *
 * NON-VACUITY: the scan must read a real number of files from each root, and
 * the patterns must match the one file known to name the keys (the retire
 * backfill), or the green below means nothing.
 */

const REPO = join(__dirname, '..', '..', '..', '..');
const ROOTS = [join(REPO, 'backend', 'src'), join(REPO, 'frontend', 'src')];
const THIS_FILE = /common[\\/]constants[\\/]retired-task-keys\.spec\.ts$/;

const RETIRED = ['tasks:view', 'tasks:create', 'tasks:reassign', 'tasks:manage'] as const;
const LITERAL = /(['"`])tasks:(view|create|reassign|manage)\1/g;
const CONSTANT = /(?<![A-Z_])TASKS_PERMISSIONS\b/g;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'generated' || name === 'dist') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|html|json|mjs)$/.test(name) && !/\.(db-)?spec\.ts$/.test(name) && !THIS_FILE.test(path)) {
      out.push(path);
    }
  }
  return out;
}

function findings(text: string): string[] {
  return [...(text.match(LITERAL) ?? []), ...(text.match(CONSTANT) ?? [])];
}

describe('ACC-244 — the retired flat task keys', () => {
  const files = ROOTS.map((root) => ({ root, files: sourceFiles(root) }));

  it('reads a real number of files from each package (non-vacuity)', () => {
    for (const { root, files: list } of files) {
      expect({ root: relative(REPO, root), many: list.length > 200 }).toEqual({
        root: relative(REPO, root),
        many: true,
      });
    }
  });

  it('matches the retire backfill, which has to name every key (non-vacuity)', () => {
    const backfill = join(REPO, 'backend', 'prisma', 'backfill-acc244-retire-flat-task-keys.ts');
    expect(existsSync(backfill)).toBe(true);
    const found = new Set(findings(readFileSync(backfill, 'utf8')).map((f) => f.slice(1, -1)));
    for (const key of RETIRED) expect(found.has(key)).toBe(true);
    // A mention in prose is not a reading.
    expect(findings('// tasks:view was the flat key')).toEqual([]);
    expect(findings('COMMITTEE_TASKS_PERMISSIONS.MANAGE')).toEqual([]);
    expect(findings("hasPermission('tasks:reassign')")).toEqual(["'tasks:reassign'"]);
  });

  it('no source in either package names a retired key or TASKS_PERMISSIONS', () => {
    const hits: string[] = [];
    for (const { files: list } of files) {
      for (const path of list) {
        for (const hit of findings(readFileSync(path, 'utf8'))) hits.push(`${relative(REPO, path)}: ${hit}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('the catalogue no longer has them', () => {
    const catalogue = new Set(ALL_PERMISSIONS.map((p) => `${p.module}:${p.action}`));
    for (const key of RETIRED) expect(catalogue.has(key)).toBe(false);
  });
});
