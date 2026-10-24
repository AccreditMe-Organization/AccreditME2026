import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * ACC-255 PR 2 — no backend code decides by a COMMITTEE stage key any more.
 *
 * What a committee's stage allows, and whether it is dissolving or in force,
 * is the stage's own configuration (WorkflowStageRecordAction rows and
 * WorkflowStage.flags), read through StageRulesService. A key read again in
 * code is a second rule beside the configuration: it would keep deciding when
 * a tenant renames, re-keys or reconfigures the stage, and nothing would say so.
 *
 * So this reads every non-spec source under backend/src and fails on a
 * committee stage key written as a string literal. Allowed, by file:
 *   - workflow.seed.ts — the seed writes the keys;
 *   - workflow-stage-keys.ts — the list of them (for the seed's specs and the
 *     backfills);
 *   - transition-preconditions.ts — the quorum check out of Formation, a rule
 *     about a TRANSITION, which stays keyed until conditions are configurable
 *     (plan §4.6, D10).
 * The backfills live in backend/prisma, outside the scanned root, and may name
 * keys: that is what keys are for. The change-request template's own keys are
 * not committee keys and stay (D7: that template is protected).
 *
 * 'active' and 'suspended' are ordinary words elsewhere (a tenant's status is
 * 'suspended'), so those two are matched only under foundation/committees and
 * foundation/workflow, where they could only mean a committee stage. The other
 * four are distinctive and matched everywhere.
 *
 * NON-VACUITY: the scan reads a real number of files, and its patterns find
 * all six keys in the seed, which must name them.
 *
 * The frontend still reads keys in committee-stage.ts until ACC-255 PR 3;
 * extend ROOTS to frontend/src there.
 */

const BACKEND_SRC = join(__dirname, '..', '..');
const DISTINCTIVE = /(['"`])(formation|terms_review|dissolution_pending|dissolved)\1/g;
const GENERIC = /(['"`])(active|suspended)\1/g;
const GENERIC_SCOPE = /foundation[\\/](committees|workflow)[\\/]/;
const ALLOWED = /foundation[\\/]workflow[\\/](workflow\.seed|workflow-stage-keys|transition-preconditions)\.ts$/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'generated' || name === 'dist') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.ts$/.test(name) && !/\.(db-)?spec\.ts$/.test(name)) out.push(path);
  }
  return out;
}

function findings(path: string, text: string): string[] {
  return [...(text.match(DISTINCTIVE) ?? []), ...(GENERIC_SCOPE.test(path) ? (text.match(GENERIC) ?? []) : [])];
}

describe('ACC-255 PR 2 — no code decides by a committee stage key', () => {
  const files = sourceFiles(BACKEND_SRC);

  it('reads a real number of files (non-vacuity)', () => {
    expect(files.length).toBeGreaterThan(300);
  });

  it('finds all six keys in the seed, which must name them (non-vacuity)', () => {
    const seed = files.find((f) => /workflow[\\/]workflow\.seed\.ts$/.test(f))!;
    const found = new Set(findings(seed, readFileSync(seed, 'utf8')).map((f) => f.slice(1, -1)));
    expect([...found].sort()).toEqual(['active', 'dissolution_pending', 'dissolved', 'formation', 'suspended', 'terms_review']);
    // A mention in prose is not a reading; a generic word outside the scope is not one either.
    expect(findings('foundation/committees/x.ts', '// a dissolved committee')).toEqual([]);
    expect(findings('platform/tenant/x.ts', "status === 'suspended'")).toEqual([]);
    expect(findings('foundation/committees/x.ts', "key === 'active'")).toEqual(["'active'"]);
  });

  it('no other backend source names a committee stage key', () => {
    const hits: string[] = [];
    for (const path of files) {
      if (ALLOWED.test(path)) continue;
      for (const hit of findings(path, readFileSync(path, 'utf8'))) hits.push(`${relative(BACKEND_SRC, path)}: ${hit}`);
    }
    expect(hits).toEqual([]);
  });
});
