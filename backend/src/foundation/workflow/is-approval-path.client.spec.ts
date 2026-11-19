import { readFileSync } from 'fs';
import { join } from 'path';
// The browser namespace: the same generated field lists as plain constants. The
// client itself is mapped to a stub in unit tests (package.json moduleNameMapper).
import * as Prisma from '../../../generated/prisma/internal/prismaNamespaceBrowser';

/**
 * ACC-294 — WorkflowTransition.isApprovalPath, unread since ACC-284 (a move's kind
 * decides what a press on a group stage is).
 *
 * PR A takes it out of the generated client (@ignore, no migration). That is what
 * makes PR B's drop safe while PR A's container serves: a client that knows a
 * column names it in every findMany, findFirst and returning write, and fails with
 * P2022 once it is gone (ACC-278's two-deploy shape).
 *
 * PR B (migration 20261119094215_acc294_drop_is_approval_path) drops it from the
 * schema and the database. Declaring it again turns these tests red.
 */

const schema = readFileSync(join(__dirname, '..', '..', '..', 'prisma', 'schema.prisma'), 'utf8');

/** The body of one model block in schema.prisma. */
function modelBody(name: string): string {
  const match = new RegExp(`^model ${name} \\{([\\s\\S]*?)^\\}`, 'm').exec(schema);
  if (!match) throw new Error(`model ${name} not found`);
  return match[1]!;
}

describe('ACC-294 — isApprovalPath', () => {
  it('reads the generated field list, which names the columns that stay (non-vacuity)', () => {
    expect(Object.keys(Prisma.WorkflowTransitionScalarFieldEnum)).toEqual(expect.arrayContaining(['id', 'kind', 'mover']));
  });

  it('is not in the generated client', () => {
    expect(Object.keys(Prisma.WorkflowTransitionScalarFieldEnum)).not.toContain('isApprovalPath');
  });

  it('is gone from the schema (PR B)', () => {
    // Non-vacuity: the same check finds a field that stays.
    expect(modelBody('WorkflowTransition')).toMatch(/^\s+kind\s+\S+/m);
    expect(modelBody('WorkflowTransition')).not.toMatch(/^\s+isApprovalPath\s+\S+/m);
  });
});
