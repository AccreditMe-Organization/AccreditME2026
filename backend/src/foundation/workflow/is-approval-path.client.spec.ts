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
 * P2022 once it is gone (ACC-278's two-deploy shape). The column stays in the
 * database until PR B, so the code before PR A keeps working against it.
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

  it('is still in the schema, @ignore, so the database keeps it until PR B (PR A: no migration)', () => {
    expect(modelBody('WorkflowTransition')).toMatch(/^\s+isApprovalPath\s+Boolean\s+@default\(false\)\s+@ignore\s*$/m);
  });
});
