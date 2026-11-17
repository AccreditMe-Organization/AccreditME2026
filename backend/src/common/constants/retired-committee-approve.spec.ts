import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { ALL_PERMISSIONS } from '../../foundation/roles/permission.seed';
import { COMMITTEES_PERMISSIONS } from './permissions';

/**
 * ACC-283 PR 4 — committees:approve is retired, and nothing may read it again.
 *
 * Since PR 2 the chain of authority decides committee change requests
 * (change-request-chain.ts): the Reports-to committee's deciding seat, then the
 * heads of the owning unit and the units above it. No key decides. A key that
 * comes back is a second rule beside the chain, and nothing else would say so:
 * the key is no longer in the catalogue, so no role can hold it, so a check on it
 * would quietly refuse everyone (or, written as an OR, quietly admit).
 *
 * So this reads the source of BOTH packages and fails on:
 *   - the key written as a string literal ('committees:approve', "…", `…`), and
 *   - the constant it used to be, COMMITTEES_PERMISSIONS.APPROVE.
 * A mention in prose (a comment saying what the key USED to do) is fine and is
 * not matched: the pattern needs the quotes.
 *
 * Out of scope, by path: backend/prisma, where the retire backfill names it
 * (outside both roots below), and specs, which use it as an arbitrary "some other
 * key" fixture or to prove it grants nothing. A spec cannot open a path.
 *
 * NON-VACUITY: the scan must read a real number of files from each root, and the
 * patterns must match the key in every quoting a source could use, or the green
 * below means nothing. retired-task-keys.spec.ts is the same shape (ACC-244).
 */

const REPO = join(__dirname, '..', '..', '..', '..');
const ROOTS = [join(REPO, 'backend', 'src'), join(REPO, 'frontend', 'src')];
const THIS_FILE = /common[\\/]constants[\\/]retired-committee-approve\.spec\.ts$/;

const RETIRED = 'committees:approve';
const LITERAL = /(['"`])committees:approve\1/g;
const CONSTANT = /\bCOMMITTEES_PERMISSIONS\.APPROVE\b/g;

/** A source naming the key in each quoting, and the constant: what the scan must catch. */
const NAMES_THE_KEY = [
  `hasPermission('${RETIRED}')`,
  `hasPermission("${RETIRED}")`,
  'hasPermission(`' + RETIRED + '`)',
  'requires(COMMITTEES_PERMISSIONS.APPROVE);',
].join('\n');

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

describe('ACC-283 PR 4 — committees:approve is retired', () => {
  const files = ROOTS.map((root) => ({ root, files: sourceFiles(root) }));

  it('reads a real number of files from each package (non-vacuity)', () => {
    for (const { root, files: list } of files) {
      expect({ root: relative(REPO, root), many: list.length > 200 }).toEqual({
        root: relative(REPO, root),
        many: true,
      });
    }
  });

  it('matches the key in every quoting, and the constant (non-vacuity)', () => {
    const found = findings(NAMES_THE_KEY);
    for (const quote of ["'", '"', '`']) expect(found).toContain(`${quote}${RETIRED}${quote}`);
    expect(found).toContain('COMMITTEES_PERMISSIONS.APPROVE');
    expect(found).toHaveLength(4);
    // A mention in prose is not a reading, and nor is a different key.
    expect(findings('// committees:approve used to decide change requests')).toEqual([]);
    expect(findings("hasPermission('committees:approved_by')")).toEqual([]);
    expect(findings('DOCUMENTS_PERMISSIONS.APPROVE')).toEqual([]);
  });

  it('no source in either package names committees:approve or COMMITTEES_PERMISSIONS.APPROVE', () => {
    const hits: string[] = [];
    for (const { files: list } of files) {
      for (const path of list) {
        for (const hit of findings(readFileSync(path, 'utf8'))) hits.push(`${relative(REPO, path)}: ${hit}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('the catalogue and the committees group no longer have it', () => {
    const catalogue = new Set(ALL_PERMISSIONS.map((p) => `${p.module}:${p.action}`));
    expect(catalogue.has(RETIRED)).toBe(false);
    expect(Object.values(COMMITTEES_PERMISSIONS)).not.toContain(RETIRED);
  });
});
