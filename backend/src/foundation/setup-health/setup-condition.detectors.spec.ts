import {
  DEFERRED_SETUP_CONDITION_TYPES,
  OPEN_ENDED_ACTING_DAYS,
  SetupConditionDetectors,
} from './setup-condition.detectors';
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
    orgUnitHeadAssignment: { findMany: jest.Mock };
  };
  let detectors: SetupConditionDetectors;

  beforeEach(() => {
    prisma = {
      orgUnit: { findMany: jest.fn().mockResolvedValue([]) },
      workflowInstanceStage: { findMany: jest.fn().mockResolvedValue([]) },
      task: { findMany: jest.fn().mockResolvedValue([]) },
      orgUnitHeadAssignment: { findMany: jest.fn().mockResolvedValue([]) },
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

  it('covers every condition type with a detector, except the deferred ones', () => {
    expect(Object.keys(detectors.byType).sort()).toEqual([
      'ACTING_HEAD_OPEN_ENDED',
      'ORG_UNIT_WITHOUT_HEAD',
      'STAGE_WITHOUT_ASSIGNEE',
      'TASK_WITHOUT_OWNER',
    ]);
  });

  // ACC-82 — deferred, not forgotten: the enum value stays, and returns narrowed
  // to head-conferring positions once a saved role reaches current holders.
  //
  // ACC-120 slice 2, PR 2 — ACTING_HEAD_OPEN_ENDED came OFF this list, and this
  // assertion is the gate that made the split safe. PR 1 shipped the enum value
  // with the type deferred and no detector; removing the deferral without adding
  // the detector fails `tsc` on three Record<ActiveSetupConditionType> maps AND
  // fails this test, which asserts the EXACT list rather than membership. That
  // is deliberate: membership would have let the two halves land apart.
  it('defers POSITION_WITHOUT_ROLE, and gives no deferred type a detector', () => {
    expect(DEFERRED_SETUP_CONDITION_TYPES).toEqual(['POSITION_WITHOUT_ROLE']);
    for (const type of DEFERRED_SETUP_CONDITION_TYPES) {
      expect(Object.keys(detectors.byType)).not.toContain(type);
    }
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

  // ACC-120 slice 2 — an ACTING appointment with no end date, past 90 days.
  describe('openEndedActingHeads', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

    // A table that honours EVERY clause the detector sends, not just the tenant
    // one. This matters more than usual here: the 90-day threshold, the
    // open-ended test and the not-already-ended test are all expressed as WHERE
    // clauses, so a mock that ignored them would return the row regardless and
    // every negative test below would pass without the query being right —
    // the vacuous shape this file's own header warns about.
    const assignmentTable =
      (rows: Record<string, unknown>[]) =>
      ({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          rows.filter((r) => {
            if (
              where['organizationId'] !== undefined &&
              r['organizationId'] !== where['organizationId']
            ) {
              return false;
            }
            if (where['kind'] !== undefined && r['kind'] !== where['kind']) {
              return false;
            }
            if (where['validTo'] === null && r['validTo'] !== null) return false;
            if (where['endedAt'] === null && r['endedAt'] !== null) return false;
            const vf = where['validFrom'] as { lte?: Date } | undefined;
            if (vf?.lte && (r['validFrom'] as Date) > vf.lte) return false;
            return true;
          }),
        );

    const row = (over: Record<string, unknown> = {}) => ({
      organizationId: ORG_A,
      id: 'assign-1',
      kind: 'ACTING',
      validTo: null,
      endedAt: null,
      validFrom: daysAgo(OPEN_ENDED_ACTING_DAYS + 10),
      reason: 'VACANCY',
      orgUnit: { id: 'unit-1', nameEn: 'Pharmacy', nameAr: 'الصيدلية' },
      user: { id: 'user-1', name: 'Dr. Huda Zahrani' },
      ...over,
    });

    it('reports a unit whose acting appointment is open-ended and past the threshold', async () => {
      prisma.orgUnitHeadAssignment.findMany.mockImplementation(
        assignmentTable([row()]),
      );

      const found = await detectors.openEndedActingHeads(ORG_A);

      expect(found).toHaveLength(1);
      // The UNIT, not the assignment row: the condition is about a unit whose
      // headship has been provisional, and the Fix opens that unit.
      expect(found[0]!.objectId).toBe('unit-1');
      expect(found[0]!.subject).toEqual(
        expect.objectContaining({
          orgUnitNameEn: 'Pharmacy',
          actingUserName: 'Dr. Huda Zahrani',
          reason: 'VACANCY',
        }),
      );
    });

    // Not BLOCKS_WORK. An acting head resolves for assignment and for
    // escalation, so work reaches a person — the same reason a vacant unit
    // COVERED by an acting head is AT_RISK rather than blocking.
    it('is AT_RISK, because an acting head still resolves', async () => {
      prisma.orgUnitHeadAssignment.findMany.mockImplementation(
        assignmentTable([row()]),
      );

      const found = await detectors.openEndedActingHeads(ORG_A);

      expect(found[0]!.severity).toBe('AT_RISK');
    });

    // The age the page shows is the age of the CONDITION, not of the
    // appointment. An appointment 100 days old entered this condition 10 days
    // ago; reporting validFrom would age it 90 days too far.
    it('opens at validFrom + the threshold, not at validFrom', async () => {
      const validFrom = daysAgo(OPEN_ENDED_ACTING_DAYS + 10);
      prisma.orgUnitHeadAssignment.findMany.mockImplementation(
        assignmentTable([row({ validFrom })]),
      );

      const found = await detectors.openEndedActingHeads(ORG_A);

      expect(found[0]!.openedAt!.getTime()).toBe(
        validFrom.getTime() + OPEN_ENDED_ACTING_DAYS * DAY,
      );
    });

    it('ignores an open-ended appointment younger than the threshold', async () => {
      prisma.orgUnitHeadAssignment.findMany.mockImplementation(
        assignmentTable([row({ validFrom: daysAgo(OPEN_ENDED_ACTING_DAYS - 1) })]),
      );

      await expect(detectors.openEndedActingHeads(ORG_A)).resolves.toEqual([]);
    });

    it('ignores an appointment that has an end date', async () => {
      prisma.orgUnitHeadAssignment.findMany.mockImplementation(
        assignmentTable([row({ validTo: daysAgo(1) })]),
      );

      await expect(detectors.openEndedActingHeads(ORG_A)).resolves.toEqual([]);
    });

    // Ending early sets validTo AND endedAt to the same instant
    // (clearActingHead), so this is the real shape of an ended row — and
    // validTo alone is what excludes it. The detector does NOT filter on
    // endedAt; see the next test for why that matters.
    it('ignores an appointment that was ended early', async () => {
      const when = daysAgo(2);
      prisma.orgUnitHeadAssignment.findMany.mockImplementation(
        assignmentTable([row({ validTo: when, endedAt: when })]),
      );

      await expect(detectors.openEndedActingHeads(ORG_A)).resolves.toEqual([]);
    });

    // PINS A KNOWN BLIND SPOT RATHER THAN ASSERTING IT IS CORRECT.
    //
    // "validTo null, endedAt set" is unreachable from either write path, so it
    // is an invariant violation. The detector used to filter on endedAt: null,
    // which made it SILENT on exactly this row — the one case where the data is
    // wrong. Removing that filter means the row is now REPORTED instead of
    // disappearing, which is the safe direction, not a fix: nothing enforces
    // the invariant and nothing else would surface a breach.
    it('REPORTS a row whose endedAt is set with no validTo — the invariant nothing enforces', async () => {
      prisma.orgUnitHeadAssignment.findMany.mockImplementation(
        assignmentTable([row({ validTo: null, endedAt: daysAgo(2) })]),
      );

      await expect(detectors.openEndedActingHeads(ORG_A)).resolves.toHaveLength(1);
    });

    it('ignores a SUBSTANTIVE assignment, however old', async () => {
      prisma.orgUnitHeadAssignment.findMany.mockImplementation(
        assignmentTable([row({ kind: 'SUBSTANTIVE', validFrom: daysAgo(900) })]),
      );

      await expect(detectors.openEndedActingHeads(ORG_A)).resolves.toEqual([]);
    });

    itEnforcesTenantIsolation('openEndedActingHeads', async () => {
      prisma.orgUnitHeadAssignment.findMany.mockImplementation(
        assignmentTable([
          row({ organizationId: ORG_B, id: 'assign-b', orgUnit: { id: 'unit-b', nameEn: 'Other tenant unit', nameAr: null } }),
        ]),
      );

      await expect(detectors.openEndedActingHeads(ORG_A)).resolves.toEqual([]);
      expect(
        prisma.orgUnitHeadAssignment.findMany.mock.calls[0][0].where,
      ).toEqual(expect.objectContaining({ organizationId: ORG_A }));
    });
  });

});
