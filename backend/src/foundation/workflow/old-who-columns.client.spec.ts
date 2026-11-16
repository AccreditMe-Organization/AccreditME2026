import { readFileSync } from 'fs';
import { join } from 'path';
// The browser namespace: the same generated field lists as plain constants. The
// client itself is mapped to a stub in unit tests (package.json moduleNameMapper).
import * as Prisma from '../../../generated/prisma/internal/prismaNamespaceBrowser';

/**
 * ACC-278 — the old "who" columns.
 *
 * PR A took them out of the generated client (@ignore, no migration). That is
 * what made PR B's drop safe while PR A's container served: a client that knows
 * a column names it in every findMany, findFirst and returning write, and fails
 * with P2022 once it is gone (plan §2).
 *
 * PR B (migration 20261116130000_acc278_drop_old_who_columns) dropped them from
 * the schema and the database, with their two relations, the two back-relations
 * and their four enum types, and made `whoMode` and `mover` NOT NULL. Declaring
 * one again turns these tests red, naming it.
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
const OLD_TRANSITION_COLUMNS = [
  'requiredPermission',
  'triggerCondition',
  'triggerUserId',
  'triggerRoleId',
] as const;
const OLD_RELATIONS = [
  ['WorkflowStage', 'assigneePosition'],
  ['WorkflowStage', 'assigneeOrgUnit'],
  ['OrgPosition', 'workflowStages'],
  ['OrgUnit', 'assigneeForWorkflowStages'],
] as const;
const OLD_ENUMS = [
  'WorkflowApprovalMode',
  'WorkflowParallelThreshold',
  'WorkflowAssigneeStrategy',
  'WorkflowTriggerCondition',
] as const;

const schema = readFileSync(
  join(__dirname, '..', '..', '..', 'prisma', 'schema.prisma'),
  'utf8',
);

/** The body of one model block in schema.prisma. */
function modelBody(name: string): string {
  const match = new RegExp(`^model ${name} \\{([\\s\\S]*?)^\\}`, 'm').exec(
    schema,
  );
  if (!match) throw new Error(`model ${name} not found`);
  return match[1]!;
}

/** Whether a model block declares a field of that name (any type, any attributes). */
const declares = (body: string, field: string): boolean =>
  new RegExp(`^\\s+${field}\\s+\\S+`, 'm').test(body);

describe('ACC-278 — the old who columns', () => {
  it('reads the generated field lists, which name the columns that stay (non-vacuity)', () => {
    expect(Object.keys(Prisma.WorkflowStageScalarFieldEnum)).toEqual(
      expect.arrayContaining(['id', 'whoMode', 'flags']),
    );
    expect(Object.keys(Prisma.WorkflowTransitionScalarFieldEnum)).toEqual(
      expect.arrayContaining(['id', 'mover', 'kind']),
    );
  });

  it('are not in the generated client', () => {
    const stage = Object.keys(Prisma.WorkflowStageScalarFieldEnum);
    const transition = Object.keys(Prisma.WorkflowTransitionScalarFieldEnum);
    expect(OLD_STAGE_COLUMNS.filter((c) => stage.includes(c))).toEqual([]);
    expect(
      OLD_TRANSITION_COLUMNS.filter((c) => transition.includes(c)),
    ).toEqual([]);
  });

  it('are gone from the schema (PR B), with their relations, back-relations and enum types', () => {
    // Non-vacuity: the same check finds the fields that stay.
    expect(declares(modelBody('WorkflowStage'), 'whoMode')).toBe(true);
    expect(declares(modelBody('WorkflowTransition'), 'mover')).toBe(true);

    expect(
      OLD_STAGE_COLUMNS.filter((c) => declares(modelBody('WorkflowStage'), c)),
    ).toEqual([]);
    expect(
      OLD_TRANSITION_COLUMNS.filter((c) =>
        declares(modelBody('WorkflowTransition'), c),
      ),
    ).toEqual([]);
    expect(
      OLD_RELATIONS.filter(([model, field]) =>
        declares(modelBody(model), field),
      ),
    ).toEqual([]);
    expect(
      OLD_ENUMS.filter((type) =>
        new RegExp(`^enum ${type} \\{`, 'm').test(schema),
      ),
    ).toEqual([]);
  });

  it('leave whoMode and mover required (PR B: NOT NULL)', () => {
    expect(modelBody('WorkflowStage')).toMatch(
      /^\s+whoMode\s+StageWhoMode\s*$/m,
    );
    expect(modelBody('WorkflowTransition')).toMatch(
      /^\s+mover\s+TransitionMover\s*$/m,
    );
  });
});
