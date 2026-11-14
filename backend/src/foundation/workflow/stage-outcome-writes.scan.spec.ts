import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * ACC-202, PR 1 of 2 — NOTHING WRITES `RETURNED` OR `EXITED` YET.
 *
 * The acc202 migration adds the two stage outcomes, and stage history reads
 * them (`arrivedBy`). They are written only by PR 2, after PR 1 is live:
 * Prisma 7's client THROWS on an enum value it was not generated with (proved
 * on 13 Nov: the dev backend's getStageHistory() failed with "Value
 * 'RETURNED' not found in enum"). So if this PR wrote one and were rolled
 * back, or during the deploy overlap, every record sent back since would 500
 * on its stage history. This spec is that rollback guarantee.
 *
 * It reads every non-spec source under backend/src and backend/prisma and
 * fails on:
 *   1. a `'RETURNED'` or `'EXITED'` literal that is neither an approval
 *      DECISION (WorkflowApprovalDecision has its own RETURNED, unrelated) nor
 *      the stage-history READ (`arrivedBy`). Allowed lines name `decision` or
 *      `arrivedBy`, or sit in the decision DTO's value list;
 *   2. the enum members by name (`WorkflowInstanceStageOutcome.RETURNED` /
 *      `.EXITED`);
 *   3. PR 2's writer (`stageExitOutcome`, `STAGE_EXIT_OUTCOME`);
 *   4. an `outcome` type that admits either value: performTransition()'s
 *      parameter and triggerSystemTransition()'s option are the engine's only
 *      outcome writers, and their unions must stay APPROVED | REJECTED | SKIPPED.
 *
 * PR 2 deletes this spec, in the same change that wires stageExitOutcome().
 *
 * NON-VACUITY: the scan reads a real number of files, and finds the allowed
 * reader and decision lines it is written to tolerate.
 */

const BACKEND = join(__dirname, '..', '..', '..');
const ROOTS = [join(BACKEND, 'src'), join(BACKEND, 'prisma')];
const LITERAL = /(['"`])(RETURNED|EXITED)\1/;
const ENUM_MEMBER = /WorkflowInstanceStageOutcome\.(RETURNED|EXITED)\b/;
const PR2_WRITER = /\b(stageExitOutcome|STAGE_EXIT_OUTCOME)\b/;
// `outcome: 'A' | 'B'` or `outcome?: 'A' | 'B'` — a type annotation listing outcomes.
const OUTCOME_UNION = /\boutcome\??:\s*((?:'[A-Z_]+'\s*\|\s*)*'[A-Z_]+')/g;
// The same, without /g, for .test(): a global regex keeps its lastIndex between calls.
const HAS_OUTCOME_UNION = new RegExp(OUTCOME_UNION.source);
const DECISION_DTO = /foundation[\\/]workflow[\\/]dto[\\/]submit-approval\.dto\.ts$/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'generated' || name === 'dist' || name === 'migrations') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.ts$/.test(name) && !/\.(db-)?spec\.ts$/.test(name)) out.push(path);
  }
  return out;
}

describe('ACC-202 PR 1 — no code path writes the RETURNED or EXITED stage outcome', () => {
  const files = ROOTS.flatMap((root) => sourceFiles(root));
  const lines = files.flatMap((path) =>
    readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .map((text, i) => ({ where: `${relative(BACKEND, path)}:${i + 1}`, path, text })),
  );

  it('reads a real number of files, and finds the reader and decision lines it tolerates (non-vacuity)', () => {
    expect(files.length).toBeGreaterThan(200);
    const literalLines = lines.filter((l) => LITERAL.test(l.text));
    expect(literalLines.some((l) => /arrivedBy/.test(l.text))).toBe(true);
    expect(literalLines.some((l) => /decision/.test(l.text))).toBe(true);
    expect(lines.some((l) => HAS_OUTCOME_UNION.test(l.text))).toBe(true);
  });

  it('every RETURNED / EXITED literal is an approval decision or the stage-history read', () => {
    const offending = lines
      .filter((l) => LITERAL.test(l.text))
      .filter((l) => !/\bdecision\b|arrivedBy/.test(l.text) && !DECISION_DTO.test(l.path))
      .map((l) => `${l.where}: ${l.text.trim()}`);
    expect(offending).toEqual([]);
  });

  it('nothing names the new enum members, or PR 2 writer', () => {
    const offending = lines.filter((l) => ENUM_MEMBER.test(l.text) || PR2_WRITER.test(l.text)).map((l) => `${l.where}: ${l.text.trim()}`);
    expect(offending).toEqual([]);
  });

  it("every outcome a writer may be given is still APPROVED, REJECTED or SKIPPED (performTransition, triggerSystemTransition)", () => {
    const offending = lines.flatMap((l) =>
      [...l.text.matchAll(OUTCOME_UNION)].filter((m) => /RETURNED|EXITED/.test(m[1]!)).map(() => `${l.where}: ${l.text.trim()}`),
    );
    expect(offending).toEqual([]);
    const engine = readFileSync(join(BACKEND, 'src', 'foundation', 'workflow', 'workflow.service.ts'), 'utf8');
    expect(engine).toMatch(/outcome: 'APPROVED' \| 'REJECTED' \| 'SKIPPED',/);
    expect(engine).toMatch(/outcome\?: 'APPROVED' \| 'REJECTED' \| 'SKIPPED';/);
  });
});
