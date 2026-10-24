/**
 * ACC-255 — the parity check: do the stage rules give TODAY's answer, for every
 * committee in every organisation? Plan: backend/Plans/step-255-workflow-stage-rules.md
 * §5.4. PR 2 switches the code to the rules only once this reports 0.
 *
 *   npm run parity:acc255-stage-rules
 *
 * READ ONLY: every query runs inside one READ ONLY transaction, so Postgres
 * itself refuses a write. It prints organisation slugs, committee ids and
 * stage keys — no names, no people. Exit 1 on any difference.
 *
 * NOT a `check:*` script, deliberately: CI and the PR gate run every `check:*`
 * they discover, CI with no database and the gate with backend/.env's — the
 * shared one. This one is run by hand, after the backfill, against the
 * database it is meant to check.
 *
 * For each committee it compares, old → new:
 *   - Edit offered:   the screens' COMMITTEE_HEADER_POLICY (Formation only)
 *                     → the stage allows edit_details;
 *   - each member action: never limited by stage today → the stage allows it;
 *   - raise a change request: COMMITTEE_STAGE_POLICY.raise → request_change;
 *   - the six request moves: COMMITTEE_STAGE_POLICY.actions → the §4.2
 *     derivation (submit, approve, return when IN_FORCE; edit unless
 *     DISSOLVING; withdraw and reject always);
 *   - dissolving: isDissolvingStageKey → the DISSOLVING flag.
 * And for each change request template: approve's target, 'approved' → the one
 * stage flagged APPLIES_APPROVED_CHANGE.
 *
 * Deleted with the old maps, in PR 2's follow-up.
 */
import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { StageRules, StageRulesService } from '../src/foundation/workflow/stage-rules.service';
import { COMMITTEE_ACTIONS, STAGE_FLAG } from '../src/foundation/workflow/record-registry';
import { isDissolvingStageKey } from '../src/foundation/workflow/workflow-stage-keys';
import {
  ACTION_TARGET_STAGE,
  CHANGE_REQUEST_ACTIONS,
  ChangeRequestAction,
  committeeStagePolicy,
} from '../src/foundation/committees/change-requests/change-request-policy';

const READ_TX = { maxWait: 10_000, timeout: 120_000 } as const;

/** The screens' header rule today (frontend committee-stage.ts COMMITTEE_HEADER_POLICY): Edit in Formation only. */
const EDIT_OFFERED_IN = 'formation';

export interface Difference {
  slug: string;
  /** A committee id, or a change request template id. */
  objectId: string;
  stageKey: string | null;
  what: string;
  old: unknown;
  new: unknown;
}

export interface ParityResult {
  organisations: { slug: string; committees: number; requestTemplates: number }[];
  differences: Difference[];
}

/** The §4.2 derivation: what an open change request may do while its committee's stage has these flags. */
export function requestMoveAllowed(action: ChangeRequestAction, flags: readonly string[]): boolean {
  switch (action) {
    case 'submit':
    case 'approve':
    case 'return':
      return flags.includes(STAGE_FLAG.IN_FORCE);
    case 'edit':
      return !flags.includes(STAGE_FLAG.DISSOLVING);
    case 'withdraw':
    case 'reject':
      return true;
  }
}

/** Old answer → new answer for one committee, as `what → [old, new]`. */
export function committeeComparison(stageKey: string | null, rules: StageRules): Record<string, [boolean, boolean]> {
  const policy = committeeStagePolicy(stageKey);
  const rows: Record<string, [boolean, boolean]> = {
    [COMMITTEE_ACTIONS.EDIT_DETAILS]: [stageKey === EDIT_OFFERED_IN, rules.actions[COMMITTEE_ACTIONS.EDIT_DETAILS] === true],
    [COMMITTEE_ACTIONS.ADD_MEMBER]: [true, rules.actions[COMMITTEE_ACTIONS.ADD_MEMBER] === true],
    [COMMITTEE_ACTIONS.REMOVE_MEMBER]: [true, rules.actions[COMMITTEE_ACTIONS.REMOVE_MEMBER] === true],
    [COMMITTEE_ACTIONS.CHANGE_MEMBER_ROLE]: [true, rules.actions[COMMITTEE_ACTIONS.CHANGE_MEMBER_ROLE] === true],
    [`${COMMITTEE_ACTIONS.REQUEST_CHANGE} (raise)`]: [policy.raise, rules.actions[COMMITTEE_ACTIONS.REQUEST_CHANGE] === true],
    dissolving: [isDissolvingStageKey(stageKey), rules.flags.includes(STAGE_FLAG.DISSOLVING)],
  };
  for (const action of CHANGE_REQUEST_ACTIONS) {
    rows[`request ${action}`] = [policy.actions.has(action), requestMoveAllowed(action, rules.flags)];
  }
  return rows;
}

export async function checkParity(prisma: PrismaService, organizationIds?: string[]): Promise<ParityResult> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const engine = new StageRulesService(prisma);
    const result: ParityResult = { organisations: [], differences: [] };

    const orgs = await tx.organization.findMany({
      where: { isPlatformOrg: false, ...(organizationIds && { id: { in: organizationIds } }) },
      select: { id: true, slug: true },
      orderBy: { slug: 'asc' },
    });
    for (const org of orgs) {
      const committees = await tx.committee.findMany({ where: { organizationId: org.id }, select: { id: true }, orderBy: { id: 'asc' } });
      const ids = committees.map((c) => c.id);
      const rulesById = await engine.stageRulesFor(org.id, 'COMMITTEE', ids, tx);
      const stageIds = [...new Set([...rulesById.values()].map((r) => r.stageId).filter((id): id is string => !!id))];
      const keyById = new Map(
        (await tx.workflowStage.findMany({ where: { id: { in: stageIds }, workflowTemplate: { organizationId: org.id } }, select: { id: true, key: true } })).map(
          (s) => [s.id, s.key],
        ),
      );
      for (const id of ids) {
        const rules = rulesById.get(id)!;
        const stageKey = rules.stageId ? (keyById.get(rules.stageId) ?? null) : null;
        for (const [what, [oldAnswer, newAnswer]] of Object.entries(committeeComparison(stageKey, rules))) {
          if (oldAnswer !== newAnswer) {
            result.differences.push({
              slug: org.slug,
              objectId: id,
              stageKey: rules.stageId ? stageKey : '(no live stage)',
              what,
              old: oldAnswer,
              new: newAnswer,
            });
          }
        }
      }

      const requestTemplates = await tx.workflowTemplate.findMany({
        where: { organizationId: org.id, objectType: 'COMMITTEE_CHANGE_REQUEST' },
        select: { id: true, stages: { where: { flags: { has: STAGE_FLAG.APPLIES_APPROVED_CHANGE } }, select: { key: true } } },
      });
      for (const template of requestTemplates) {
        const flagged = template.stages.map((s) => s.key);
        if (flagged.length !== 1 || flagged[0] !== ACTION_TARGET_STAGE.approve) {
          result.differences.push({
            slug: org.slug,
            objectId: template.id,
            stageKey: null,
            what: "approve's target stage",
            old: ACTION_TARGET_STAGE.approve,
            new: flagged,
          });
        }
      }
      result.organisations.push({ slug: org.slug, committees: ids.length, requestTemplates: requestTemplates.length });
    }
    return result;
  }, READ_TX);
}

function report(result: ParityResult): void {
  console.log('\nPARITY — stage rules against the old maps (ACC-255), read only');
  for (const o of result.organisations) {
    const n = result.differences.filter((d) => d.slug === o.slug).length;
    console.log(`  ${o.slug.padEnd(24)} ${String(o.committees).padStart(4)} committee(s), ${o.requestTemplates} request template(s): ${n} difference(s)`);
  }
  for (const d of result.differences) {
    console.log(`  DIFF ${d.slug} ${d.objectId} [${d.stageKey ?? 'no key'}] ${d.what}: ${JSON.stringify(d.old)} → ${JSON.stringify(d.new)}`);
  }
  console.log(`\nTotal: ${result.differences.length} difference(s).\n`);
}

async function main(): Promise<void> {
  const prisma = new PrismaService();
  try {
    const result = await checkParity(prisma);
    report(result);
    if (result.differences.length > 0) process.exitCode = 1;
  } finally {
    await prisma.onModuleDestroy();
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((error: unknown) => {
      console.error('\nParity check failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
