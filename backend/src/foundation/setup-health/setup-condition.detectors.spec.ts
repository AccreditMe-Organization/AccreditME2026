import { SetupConditionDetectors } from './setup-condition.detectors';
import { PrismaService } from '../../prisma/prisma.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';

const ORG_A = 'cmtr9x7zq0000ocp1am2rs14o';
const ORG_B = 'cmtr9x80q0001ocp1bq3kd2rz';

// ACC-82 — the four Setup health detectors (SYSTEM-REFERENCE §13.2).
//
// Isolation mocks behave like a real table: a query WITHOUT a tenant filter
// finds another tenant's rows, and only a correctly scoped query misses them.
// A mock that returned nothing whenever organizationId was absent would pass
// against an unscoped query — the vacuous-isolation-test shape found in ACC-79.
describe('SetupConditionDetectors (ACC-82)', () => {
  let prisma: {
    orgUnit: { findMany: jest.Mock };
    workflowInstanceStage: { findMany: jest.Mock };
    task: { findMany: jest.Mock };
    orgPosition: { findMany: jest.Mock };
  };
  let detectors: SetupConditionDetectors;

  beforeEach(() => {
    prisma = {
      orgUnit: { findMany: jest.fn().mockResolvedValue([]) },
      workflowInstanceStage: { findMany: jest.fn().mockResolvedValue([]) },
      task: { findMany: jest.fn().mockResolvedValue([]) },
      orgPosition: { findMany: jest.fn().mockResolvedValue([]) },
    };
    detectors = new SetupConditionDetectors(prisma as unknown as PrismaService);
  });

  // A table that honours a top-level organizationId filter the way Postgres would.
  const tenantTable =
    <T extends { organizationId: string }>(rows: T[]) =>
    ({ where }: { where: { organizationId?: string } }) =>
      Promise.resolve(
        rows.filter(
          (r) =>
            where.organizationId === undefined ||
            r.organizationId === where.organizationId,
        ),
      );

  it('covers every condition type with a detector', () => {
    expect(Object.keys(detectors.byType).sort()).toEqual([
      'ORG_UNIT_WITHOUT_HEAD',
      'POSITION_WITHOUT_ROLE',
      'STAGE_WITHOUT_ASSIGNEE',
      'TASK_WITHOUT_OWNER',
    ]);
  });

  describe('orgUnitsWithoutHead', () => {
    it('queries active, vacant units of the tenant only', async () => {
      await detectors.orgUnitsWithoutHead(ORG_A);
      expect(prisma.orgUnit.findMany.mock.calls[0][0].where).toEqual({
        organizationId: ORG_A,
        isActive: true,
        isHeadVacant: true,
      });
    });

    // The severity split recorded in §13.2.
    it('is BLOCKS_WORK only when escalation resolves no one, AT_RISK when covered', async () => {
      const since = new Date('2026-09-01T08:00:00.000Z');
      prisma.orgUnit.findMany.mockResolvedValue([
        {
          id: 'unit-covered',
          nameEn: 'Radiology',
          nameAr: 'الأشعة',
          isHeadFullyUnresolved: false,
          headVacantSince: since,
        },
        {
          id: 'unit-orphaned',
          nameEn: 'Pharmacy Stores',
          nameAr: null,
          isHeadFullyUnresolved: true,
          headVacantSince: null,
        },
      ]);

      const result = await detectors.orgUnitsWithoutHead(ORG_A);

      expect(result).toEqual([
        {
          objectId: 'unit-covered',
          severity: 'AT_RISK',
          openedAt: since,
          subject: {
            nameEn: 'Radiology',
            nameAr: 'الأشعة',
            escalationResolves: true,
          },
        },
        {
          objectId: 'unit-orphaned',
          severity: 'BLOCKS_WORK',
          openedAt: null,
          subject: {
            nameEn: 'Pharmacy Stores',
            nameAr: null,
            escalationResolves: false,
          },
        },
      ]);
    });

    itEnforcesTenantIsolation('orgUnitsWithoutHead', async () => {
      prisma.orgUnit.findMany.mockImplementation(
        tenantTable([
          {
            organizationId: ORG_B,
            id: 'unit-b',
            nameEn: 'Other tenant unit',
            nameAr: null,
            isHeadFullyUnresolved: true,
            headVacantSince: null,
          },
        ]),
      );
      expect(await detectors.orgUnitsWithoutHead(ORG_A)).toEqual([]);
    });
  });

  describe('stagesWithoutAssignee', () => {
    const stage = (id: string, templateId = 'tpl-committee') => ({
      id,
      nameEn: `Stage ${id}`,
      nameAr: `مرحلة ${id}`,
      workflowTemplate: {
        id: templateId,
        nameEn: 'Committee lifecycle',
        nameAr: 'دورة حياة اللجنة',
      },
    });

    it("queries open, unassigned stages of the tenant's instances only", async () => {
      await detectors.stagesWithoutAssignee(ORG_A);
      expect(
        prisma.workflowInstanceStage.findMany.mock.calls[0][0].where,
      ).toEqual({
        exitedAt: null,
        isUnassigned: true,
        workflowInstance: { organizationId: ORG_A },
      });
    });

    // Reported per template stage, because the fix is made once on the stage.
    it('aggregates instances into one condition per stage, opened at the earliest', async () => {
      const early = new Date('2026-09-02T08:00:00.000Z');
      const late = new Date('2026-09-05T08:00:00.000Z');
      prisma.workflowInstanceStage.findMany.mockResolvedValue([
        { unassignedAt: late, stage: stage('terms-review') },
        { unassignedAt: early, stage: stage('terms-review') },
        { unassignedAt: null, stage: stage('terms-review') },
        { unassignedAt: late, stage: stage('formation') },
      ]);

      const result = await detectors.stagesWithoutAssignee(ORG_A);

      expect(result).toEqual([
        {
          objectId: 'terms-review',
          severity: 'BLOCKS_WORK',
          openedAt: early,
          subject: {
            nameEn: 'Stage terms-review',
            nameAr: 'مرحلة terms-review',
            templateId: 'tpl-committee',
            templateNameEn: 'Committee lifecycle',
            templateNameAr: 'دورة حياة اللجنة',
            affectedInstances: 3,
          },
        },
        expect.objectContaining({ objectId: 'formation', openedAt: late }),
      ]);
    });

    itEnforcesTenantIsolation('stagesWithoutAssignee', async () => {
      // Scoped through the instance: honour workflowInstance.organizationId, and
      // return the other tenant's row when that filter is missing.
      prisma.workflowInstanceStage.findMany.mockImplementation(
        ({
          where,
        }: {
          where: { workflowInstance?: { organizationId?: string } };
        }) => {
          const org = where.workflowInstance?.organizationId;
          return Promise.resolve(
            org === undefined || org === ORG_B
              ? [{ unassignedAt: null, stage: stage('other-tenant-stage') }]
              : [],
          );
        },
      );
      expect(await detectors.stagesWithoutAssignee(ORG_A)).toEqual([]);
    });
  });

  describe('tasksWithoutOwner', () => {
    it('queries UNASSIGNED tasks of the tenant and records no opened-at', async () => {
      prisma.task.findMany.mockResolvedValue([
        {
          id: 'task-1',
          title: 'Chase December figures',
          sourceType: 'COMMITTEE',
          sourceId: 'cmte-1',
          dueAt: null,
        },
      ]);

      const result = await detectors.tasksWithoutOwner(ORG_A);

      expect(prisma.task.findMany.mock.calls[0][0].where).toEqual({
        organizationId: ORG_A,
        status: 'UNASSIGNED',
      });
      // §13.3 — no on-write stamp exists, so age is first detection.
      expect(result).toEqual([
        {
          objectId: 'task-1',
          severity: 'BLOCKS_WORK',
          openedAt: null,
          subject: {
            title: 'Chase December figures',
            sourceType: 'COMMITTEE',
            sourceId: 'cmte-1',
            dueAt: null,
          },
        },
      ]);
    });

    itEnforcesTenantIsolation('tasksWithoutOwner', async () => {
      prisma.task.findMany.mockImplementation(
        tenantTable([
          {
            organizationId: ORG_B,
            id: 'task-b',
            title: 'Other tenant task',
            sourceType: 'COMMITTEE',
            sourceId: 'x',
            dueAt: null,
          },
        ]),
      );
      expect(await detectors.tasksWithoutOwner(ORG_A)).toEqual([]);
    });
  });

  describe('positionsWithoutRole', () => {
    it('queries active, unmapped positions held by an active user of the tenant', async () => {
      await detectors.positionsWithoutRole(ORG_A);
      const args = prisma.orgPosition.findMany.mock.calls[0][0];
      expect(args.where).toEqual({
        organizationId: ORG_A,
        isActive: true,
        roleId: null,
        users: { some: { organizationId: ORG_A, status: 'ACTIVE' } },
      });
      // Holders are counted within the tenant too, not just the position.
      expect(args.select.users.where).toEqual({
        organizationId: ORG_A,
        status: 'ACTIVE',
      });
    });

    // "Holders get no permissions" is only true of holders with no roles at all.
    it('counts holders, and separately those with no roles', async () => {
      prisma.orgPosition.findMany.mockResolvedValue([
        {
          id: 'pos-director',
          nameEn: 'Director',
          nameAr: 'مدير عام',
          users: [
            { userRoles: [] },
            { userRoles: [] },
            { userRoles: [{ id: 'ur-1' }] },
          ],
        },
      ]);

      expect(await detectors.positionsWithoutRole(ORG_A)).toEqual([
        {
          objectId: 'pos-director',
          severity: 'AT_RISK',
          openedAt: null,
          subject: {
            nameEn: 'Director',
            nameAr: 'مدير عام',
            activeHolders: 3,
            holdersWithNoRoles: 2,
          },
        },
      ]);
    });

    itEnforcesTenantIsolation('positionsWithoutRole', async () => {
      prisma.orgPosition.findMany.mockImplementation(
        tenantTable([
          {
            organizationId: ORG_B,
            id: 'pos-b',
            nameEn: 'Other tenant position',
            nameAr: null,
            users: [{ userRoles: [] }],
          },
        ]),
      );
      expect(await detectors.positionsWithoutRole(ORG_A)).toEqual([]);
    });
  });
});
