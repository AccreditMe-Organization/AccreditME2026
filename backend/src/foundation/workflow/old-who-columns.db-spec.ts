/**
 * ACC-278 PR B — after migration 20261116130000_acc278_drop_old_who_columns,
 * against a REAL Postgres (npm run test:db). Only a database proves the
 * constraint is there, not just the type:
 *
 *   - the 13 old "who" columns and their 4 enum types are gone;
 *   - a stage without `whoMode`, or a move without `mover`, is refused by the
 *     database itself (NOT NULL), whatever the client sends.
 *
 * Each refusal is shown against a row that was first written WITH the value, so
 * a pass means the NOT NULL refused it, not the set-up.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a database,
 * and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

const url = process.env['DATABASE_URL'];
if (!url)
  throw new Error(
    'test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).',
  );
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(
    `test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`,
  );
}

jest.setTimeout(180_000);

const OLD_COLUMNS = [
  ['WorkflowStage', 'approvalMode'],
  ['WorkflowStage', 'parallelThreshold'],
  ['WorkflowStage', 'committeeId'],
  ['WorkflowStage', 'assigneeStrategy'],
  ['WorkflowStage', 'assigneeUserId'],
  ['WorkflowStage', 'assigneeRoleId'],
  ['WorkflowStage', 'assigneeCommitteeRoleValueId'],
  ['WorkflowStage', 'assigneePositionId'],
  ['WorkflowStage', 'assigneeOrgUnitId'],
  ['WorkflowTransition', 'requiredPermission'],
  ['WorkflowTransition', 'triggerCondition'],
  ['WorkflowTransition', 'triggerUserId'],
  ['WorkflowTransition', 'triggerRoleId'],
] as const;
const OLD_TYPES = [
  'WorkflowApprovalMode',
  'WorkflowParallelThreshold',
  'WorkflowAssigneeStrategy',
  'WorkflowTriggerCondition',
];

/** The Postgres error code a raw statement fails with ("Raw query failed. Code: `23502`"), or 'OK'. */
async function sqlState(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return 'OK';
  } catch (e) {
    return (
      /Code: `(\w+)`/.exec((e as Error).message)?.[1] ??
      `ERROR ${(e as Error).name}`
    );
  }
}

describe('The old who columns are gone, and whoMode and mover are NOT NULL (ACC-278 PR B)', () => {
  const prisma = new PrismaService();

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('the 13 columns and the 4 enum types no longer exist; whoMode and mover do, NOT NULL', async () => {
    const columns = await prisma.$queryRaw<
      { table_name: string; column_name: string; is_nullable: string }[]
    >`
      SELECT table_name::text, column_name::text, is_nullable::text FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name IN ('WorkflowStage', 'WorkflowTransition')`;
    const has = (table: string, column: string) =>
      columns.some((c) => c.table_name === table && c.column_name === column);
    // Non-vacuity: the read sees the columns that stay.
    expect(
      columns.find(
        (c) => c.table_name === 'WorkflowStage' && c.column_name === 'whoMode',
      )?.is_nullable,
    ).toBe('NO');
    expect(
      columns.find(
        (c) =>
          c.table_name === 'WorkflowTransition' && c.column_name === 'mover',
      )?.is_nullable,
    ).toBe('NO');
    expect(OLD_COLUMNS.filter(([table, column]) => has(table, column))).toEqual(
      [],
    );

    const types = await prisma.$queryRaw<
      { typname: string }[]
    >`SELECT typname::text FROM pg_type WHERE typname LIKE 'Workflow%'`;
    // Non-vacuity: the read sees a Workflow enum type that stays.
    expect(types.map((t) => t.typname)).toContain('WorkflowTransitionKind');
    expect(
      types.map((t) => t.typname).filter((t) => OLD_TYPES.includes(t)),
    ).toEqual([]);
  });

  it('the database refuses a stage without whoMode, and a move without mover', async () => {
    const slug = `acc278b-${randomUUID().slice(0, 8)}`;
    const o = await prisma.organization.create({
      data: { name: slug, slug, country: 'SA' },
    });
    const template = await prisma.workflowTemplate.create({
      data: {
        organizationId: o.id,
        nameEn: 'Spec',
        objectType: 'DOCUMENT_REQUEST',
      },
    });
    const from = await prisma.workflowStage.create({
      data: {
        workflowTemplateId: template.id,
        nameEn: 'From',
        order: 10,
        whoMode: 'ANY_ONE',
      },
    });
    const to = await prisma.workflowStage.create({
      data: {
        workflowTemplateId: template.id,
        nameEn: 'To',
        order: 20,
        whoMode: 'ALL',
      },
    });
    const move = await prisma.workflowTransition.create({
      data: {
        fromStageId: from.id,
        toStageId: to.id,
        labelEn: 'Go',
        mover: 'PERSON',
      },
    });

    // Clearing either value is refused with not_null_violation (23502), and nothing changes.
    expect(
      await sqlState(
        () =>
          prisma.$executeRaw`UPDATE "WorkflowStage" SET "whoMode" = NULL WHERE id = ${from.id}`,
      ),
    ).toBe('23502');
    expect(
      await sqlState(
        () =>
          prisma.$executeRaw`UPDATE "WorkflowTransition" SET mover = NULL WHERE id = ${move.id}`,
      ),
    ).toBe('23502');
    expect(
      (await prisma.workflowStage.findUniqueOrThrow({ where: { id: from.id } }))
        .whoMode,
    ).toBe('ANY_ONE');
    expect(
      (
        await prisma.workflowTransition.findUniqueOrThrow({
          where: { id: move.id },
        })
      ).mover,
    ).toBe('PERSON');

    // An insert that leaves them out is refused too: there is no default to fall back on.
    expect(
      await sqlState(
        () =>
          prisma.$executeRaw`INSERT INTO "WorkflowStage" (id, "workflowTemplateId", "nameEn", "order") VALUES (${randomUUID()}, ${template.id}, 'No who', 30)`,
      ),
    ).toBe('23502');
    expect(
      await sqlState(
        () =>
          prisma.$executeRaw`INSERT INTO "WorkflowTransition" (id, "fromStageId", "toStageId", "labelEn") VALUES (${randomUUID()}, ${from.id}, ${to.id}, 'No mover')`,
      ),
    ).toBe('23502');
    expect(
      await prisma.workflowStage.count({
        where: { workflowTemplateId: template.id },
      }),
    ).toBe(2);
    expect(
      await prisma.workflowTransition.count({
        where: { fromStageId: from.id },
      }),
    ).toBe(1);
  });
});
