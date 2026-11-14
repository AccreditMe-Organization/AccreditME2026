import { readFileSync } from 'fs';
import { join } from 'path';
// The browser namespace: the same generated field lists as plain constants. The
// client itself is mapped to a stub in unit tests (package.json moduleNameMapper).
import * as Prisma from '../../../generated/prisma/internal/prismaNamespaceBrowser';

/**
 * ACC-278 PR A — the old "who" columns are out of the generated client and still
 * in the schema (and so in the database: @ignore makes no migration).
 *
 * Out of the client is what makes PR B's drop safe while PR A's container
 * serves: a client that knows a column names it in every findMany, findFirst
 * and returning write, and fails with P2022 once it is gone (plan §2). Still in
 * the schema is what keeps PR A free of a migration. Removing one @ignore turns
 * the first test red, naming the field.
 */

const OLD_STAGE_COLUMNS = [
  'approvalMode',
  'parallelThreshold',
  'committeeId',
  'assigneeStrategy',
  'assigneeUserId',
  'assigneeRoleId',
  'assigneeCommitteeRoleValueId',
  'assigneePositionId',
  'assigneeOrgUnitId',
] as const;
const OLD_TRANSITION_COLUMNS = ['requiredPermission', 'triggerCondition', 'triggerUserId', 'triggerRoleId'] as const;

const schema = readFileSync(join(__dirname, '..', '..', '..', 'prisma', 'schema.prisma'), 'utf8');

/** The body of one model block in schema.prisma. */
function modelBody(name: string): string {
  const match = new RegExp(`^model ${name} \\{([\\s\\S]*?)^\\}`, 'm').exec(schema);
  if (!match) throw new Error(`model ${name} not found`);
  return match[1]!;
}

describe('ACC-278 — the old who columns', () => {
  it('reads the generated field lists, which name the columns that stay (non-vacuity)', () => {
    expect(Object.keys(Prisma.WorkflowStageScalarFieldEnum)).toEqual(expect.arrayContaining(['id', 'whoMode', 'flags']));
    expect(Object.keys(Prisma.WorkflowTransitionScalarFieldEnum)).toEqual(expect.arrayContaining(['id', 'mover', 'kind']));
  });

  it('are not in the generated client', () => {
    const stage = Object.keys(Prisma.WorkflowStageScalarFieldEnum);
    const transition = Object.keys(Prisma.WorkflowTransitionScalarFieldEnum);
    expect(OLD_STAGE_COLUMNS.filter((c) => stage.includes(c))).toEqual([]);
    expect(OLD_TRANSITION_COLUMNS.filter((c) => transition.includes(c))).toEqual([]);
  });

  it('are still declared in the schema, each @ignore, so PR A makes no migration', () => {
    const declared = (body: string, column: string) => new RegExp(`^\\s+${column}\\s+\\S+.*@ignore`, 'm').test(body);
    const stage = modelBody('WorkflowStage');
    const transition = modelBody('WorkflowTransition');
    expect(OLD_STAGE_COLUMNS.filter((c) => !declared(stage, c))).toEqual([]);
    expect(OLD_TRANSITION_COLUMNS.filter((c) => !declared(transition, c))).toEqual([]);
    // The relations over the two foreign keys, and their back-relations, are ignored with them.
    for (const [model, field] of [
      ['WorkflowStage', 'assigneePosition'],
      ['WorkflowStage', 'assigneeOrgUnit'],
      ['OrgPosition', 'workflowStages'],
      ['OrgUnit', 'assigneeForWorkflowStages'],
    ] as const) {
      expect([model, field, declared(modelBody(model), field)]).toEqual([model, field, true]);
    }
  });
});
