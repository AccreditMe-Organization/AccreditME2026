import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { CommitteesService } from './committees.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { WorkflowService } from '../workflow/workflow.service';
import { StageRulesService } from '../workflow/stage-rules.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { WorkflowRefusalException } from '../workflow/workflow-refusal';

const ORG_A = 'org-a-id';
const ORG_B = 'org-b-id';
const ACTOR = 'actor-id';

const BASE_COMMITTEE = {
  id: 'committee-1',
  organizationId: ORG_A,
  nameEn: 'Quality Committee',
  nameAr: 'لجنة الجودة',
  typeValueId: 'quality_committee',
  purpose: null as string | null,
  quorumCount: 3,
  meetingFrequency: 'MONTHLY',
  parentCommitteeId: null as string | null,
  orgUnitId: 'root-unit-a' as string | null,
  termsOfReferenceDocumentId: null as string | null,
  reportingToCommitteeId: null as string | null,
  formedAt: null as Date | null,
  dissolvedAt: null as Date | null,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const BASE_MEMBER = {
  id: 'member-1',
  organizationId: ORG_A,
  committeeId: 'committee-1',
  userId: 'user-1',
  roleValueId: 'chairman',
  joinedAt: new Date(),
  leftAt: null as Date | null,
  isActive: true,
};

const makeCommittee = (overrides: Partial<typeof BASE_COMMITTEE> = {}) => ({
  ...BASE_COMMITTEE,
  ...overrides,
});
const makeMember = (overrides: Partial<typeof BASE_MEMBER> = {}) => ({ ...BASE_MEMBER, ...overrides });

const mockPrisma = {
  // ACC-233 — create and update run their reference checks and the write in one
  // transaction; the fake hands the callback this same mock. $queryRaw answers
  // the hierarchy lock, the loop walks and the stage read (none reaching, no
  // instance) unless a test says otherwise.
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
  committee: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  committeeMember: {
    findMany: jest.fn(),
    // ACC-76 — listCommittees() counts active members per committee in one
    // grouped query rather than one per row.
    groupBy: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  committeeMembershipEvent: {
    findMany: jest.fn(),
    create: jest.fn(),
  },
  // ACC-135 — findFirst validates an explicitly named unit; findMany resolves
  // "the whole organisation" to the tenant's root, and is the one that has to see
  // more than one row to refuse.
  orgUnit: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  // ACC-76 — listCommittees() resolves each committee live workflow stage.
  workflowInstance: {
    findMany: jest.fn(),
  },
  workflowStage: {
    findMany: jest.fn(),
  },
  // ACC-246 — the committee reads carry their own type's label.
  lookupCategory: {
    findFirst: jest.fn(),
  },
  lookupValue: {
    findMany: jest.fn(),
  },
  user: {
    findFirst: jest.fn(),
  },
};

const mockAuditLog = { log: jest.fn() };
const mockWorkflowService = { startInstance: jest.fn() };
// ACC-255 — the engine's stage answer: for the committee reads, and (PR 2)
// the refusal of a write the committee's stage does not allow.
const mockStageRules = { stageRulesFor: jest.fn(), assertStageAllows: jest.fn() };

describe('CommitteesService', () => {
  let service: CommitteesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma));
    mockPrisma.$queryRaw.mockResolvedValue([]);
    // Defaults matching this file's usual "happy path" org — tests
    // exercising cross-tenant rejection override these per-case.
    mockPrisma.committee.findFirst.mockResolvedValue(makeCommittee());
    mockPrisma.orgUnit.findFirst.mockResolvedValue({ id: 'unit-a', organizationId: ORG_A });
    mockPrisma.orgUnit.findMany.mockResolvedValue([{ id: 'root-unit-a', code: 'ROOT' }]);
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-a', organizationId: ORG_A });
    mockPrisma.committeeMember.groupBy.mockResolvedValue([]);
    mockPrisma.workflowInstance.findMany.mockResolvedValue([]);
    mockPrisma.workflowStage.findMany.mockResolvedValue([]);
    mockPrisma.lookupCategory.findFirst.mockResolvedValue({ id: 'cat-committee-type' });
    mockPrisma.lookupValue.findMany.mockResolvedValue([]);
    mockStageRules.stageRulesFor.mockResolvedValue(new Map());
    mockStageRules.assertStageAllows.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommitteesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogService, useValue: mockAuditLog },
        { provide: WorkflowService, useValue: mockWorkflowService },
        { provide: StageRulesService, useValue: mockStageRules },
      ],
    }).compile();

    service = module.get<CommitteesService>(CommitteesService);
  });

  // ── listCommittees ───────────────────────────────────────────────────────────

  describe('listCommittees', () => {
    it('returns committees scoped to the tenant', async () => {
      mockPrisma.committee.findMany.mockResolvedValue([makeCommittee()]);

      await service.listCommittees(ORG_A);

      expect(mockPrisma.committee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: ORG_A } }),
      );
    });

    // MANDATORY — tenant isolation
    it('should NOT return records belonging to a different tenant', async () => {
      mockPrisma.committee.findMany.mockImplementation(({ where }: { where: { organizationId: string } }) =>
        Promise.resolve(where.organizationId === ORG_A ? [makeCommittee()] : []),
      );

      const resultA = await service.listCommittees(ORG_A);
      const resultB = await service.listCommittees(ORG_B);

      expect(resultA).toHaveLength(1);
      expect(resultB).toHaveLength(0);
    });

    // ── ACC-76: member count and live stage ──────────────────────────────

    it('carries the active member count per committee', async () => {
      mockPrisma.committee.findMany.mockResolvedValue([
        makeCommittee({ id: 'committee-1' }),
        makeCommittee({ id: 'committee-2' }),
      ]);
      mockPrisma.committeeMember.groupBy.mockResolvedValue([
        { committeeId: 'committee-1', _count: { committeeId: 9 } },
      ]);

      const result = await service.listCommittees(ORG_A);

      expect(result[0]!.memberCount).toBe(9);
      // A committee with no members is 0, not undefined — the count is a
      // number the UI renders directly.
      expect(result[1]!.memberCount).toBe(0);
    });

    // A departed member is not part of the committee. CommitteeMember rows are
    // reactivated in place rather than recreated (ACC-32), so without this
    // filter a committee that has ever lost a member would overcount forever.
    it('counts active members only', async () => {
      mockPrisma.committee.findMany.mockResolvedValue([makeCommittee({ id: 'committee-1' })]);

      await service.listCommittees(ORG_A);

      expect(mockPrisma.committeeMember.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: true, organizationId: ORG_A }),
        }),
      );
    });

    it('resolves each committee live workflow stage', async () => {
      mockPrisma.committee.findMany.mockResolvedValue([makeCommittee({ id: 'committee-1' })]);
      mockPrisma.workflowInstance.findMany.mockResolvedValue([
        { objectId: 'committee-1', currentStageId: 'stage-active' },
      ]);
      mockPrisma.workflowStage.findMany.mockResolvedValue([
        { id: 'stage-active', nameEn: 'Active', nameAr: 'نشطة' },
      ]);

      const result = await service.listCommittees(ORG_A);

      expect(result[0]!.currentStageNameEn).toBe('Active');
      expect(result[0]!.currentStageNameAr).toBe('نشطة');
    });

    // A committee can accumulate instances over time, same as any workflow
    // object. The newest is the live one.
    it('uses the newest workflow instance when a committee has several', async () => {
      mockPrisma.committee.findMany.mockResolvedValue([makeCommittee({ id: 'committee-1' })]);
      mockPrisma.workflowInstance.findMany.mockResolvedValue([
        { objectId: 'committee-1', currentStageId: 'stage-active' },
        { objectId: 'committee-1', currentStageId: 'stage-formation' },
      ]);
      mockPrisma.workflowStage.findMany.mockResolvedValue([
        { id: 'stage-active', nameEn: 'Active', nameAr: 'نشطة' },
        { id: 'stage-formation', nameEn: 'Formation', nameAr: 'التأسيس' },
      ]);

      const result = await service.listCommittees(ORG_A);

      expect(result[0]!.currentStageNameEn).toBe('Active');
      expect(mockPrisma.workflowInstance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
      );
    });

    it('leaves the stage null when a committee has no workflow instance', async () => {
      mockPrisma.committee.findMany.mockResolvedValue([makeCommittee({ id: 'committee-1' })]);

      const result = await service.listCommittees(ORG_A);

      expect(result[0]!.currentStageNameEn).toBeNull();
      expect(result[0]!.currentStageNameAr).toBeNull();
    });

    // The batching guarantee, asserted rather than assumed: a regression to
    // per-row lookups would fail no other test here, it would just be slow.
    it('issues one grouped count and one instance query regardless of list length', async () => {
      mockPrisma.committee.findMany.mockResolvedValue([
        makeCommittee({ id: 'committee-1' }),
        makeCommittee({ id: 'committee-2' }),
        makeCommittee({ id: 'committee-3' }),
      ]);

      await service.listCommittees(ORG_A);

      expect(mockPrisma.committeeMember.groupBy).toHaveBeenCalledTimes(1);
      expect(mockPrisma.workflowInstance.findMany).toHaveBeenCalledTimes(1);
    });

    it('makes no follow-up queries for an empty list', async () => {
      mockPrisma.committee.findMany.mockResolvedValue([]);

      const result = await service.listCommittees(ORG_A);

      expect(result).toEqual([]);
      expect(mockPrisma.committeeMember.groupBy).not.toHaveBeenCalled();
      expect(mockPrisma.workflowInstance.findMany).not.toHaveBeenCalled();
    });

    // Both new queries are tenant-scoped in their own right, not merely via
    // the committee id set — so neither depends on how that set was built.
    itEnforcesTenantIsolation('listCommittees member count and stage lookups', async () => {
      mockPrisma.committee.findMany.mockResolvedValue([makeCommittee({ id: 'committee-1' })]);
      mockPrisma.committeeMember.groupBy.mockImplementation(({ where }: { where: { organizationId: string } }) =>
        Promise.resolve(
          where.organizationId === ORG_A
            ? [{ committeeId: 'committee-1', _count: { committeeId: 9 } }]
            : [],
        ),
      );
      mockPrisma.workflowInstance.findMany.mockImplementation(({ where }: { where: { organizationId: string } }) =>
        Promise.resolve(
          where.organizationId === ORG_A
            ? [{ objectId: 'committee-1', currentStageId: 'stage-active' }]
            : [],
        ),
      );
      mockPrisma.workflowStage.findMany.mockResolvedValue([
        { id: 'stage-active', nameEn: 'Active', nameAr: 'نشطة' },
      ]);

      const result = await service.listCommittees(ORG_B);

      expect(result[0]!.memberCount).toBe(0);
      expect(result[0]!.currentStageNameEn).toBeNull();
    });
  });

  // ── getCommitteeDetail (ACC-238) ─────────────────────────────────────────────

  describe('getCommitteeDetail', () => {
    it('adds whether the current stage is dissolving, read through the list helper', async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(makeCommittee());
      mockPrisma.committeeMember.groupBy.mockResolvedValue([]);
      mockPrisma.workflowInstance.findMany.mockResolvedValue([{ objectId: 'committee-1', currentStageId: 'stage-dp' }]);
      mockPrisma.workflowStage.findMany.mockResolvedValue([
        { id: 'stage-dp', nameEn: 'Dissolution Pending', nameAr: null, key: 'dissolution_pending', flags: ['DISSOLVING'] },
      ]);

      const result = await service.getCommitteeDetail('committee-1', ORG_A);

      expect(result).toMatchObject({ id: 'committee-1', isDissolving: true });
      expect(mockPrisma.workflowInstance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_A, objectType: 'COMMITTEE' }) }),
      );
    });

    it('a committee with no workflow instance is not dissolving', async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(makeCommittee());
      mockPrisma.committeeMember.groupBy.mockResolvedValue([]);
      mockPrisma.workflowInstance.findMany.mockResolvedValue([]);

      expect(await service.getCommitteeDetail('committee-1', ORG_A)).toMatchObject({ isDissolving: false });
    });

    // ACC-265 — no committee response carries a stage key: screens decide by
    // stageRules (ACC-255), so a key in the API is a rule waiting to be copied.
    it('neither the record read nor the list carries the stage key, under any name', async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(makeCommittee());
      mockPrisma.committee.findMany.mockResolvedValue([makeCommittee()]);
      mockPrisma.committeeMember.groupBy.mockResolvedValue([]);
      mockPrisma.workflowInstance.findMany.mockResolvedValue([{ objectId: 'committee-1', currentStageId: 'stage-dp' }]);
      mockPrisma.workflowStage.findMany.mockResolvedValue([
        { id: 'stage-dp', nameEn: 'Dissolution Pending', nameAr: 'قيد الحل', key: 'dissolution_pending', flags: ['DISSOLVING'] },
      ]);

      const detail = await service.getCommitteeDetail('committee-1', ORG_A);
      const [row] = await service.listCommittees(ORG_A);

      // Non-vacuity: the stage was read (its name and its flag reached the response).
      expect(row!.currentStageNameEn).toBe('Dissolution Pending');
      expect(detail.isDissolving).toBe(true);
      for (const response of [detail, row!]) {
        expect(response).not.toHaveProperty('currentStageKey');
        expect(JSON.stringify(response)).not.toContain('dissolution_pending');
      }
    });

    // ACC-265 — the owning unit is named on the read, so the record page needs no
    // unit list (and no org:view).
    it('names the owning unit, read in the same organisation as the committee', async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(makeCommittee({ orgUnitId: 'unit-qa' }));
      mockPrisma.orgUnit.findFirst.mockResolvedValue({ id: 'unit-qa', nameEn: 'Quality Department', nameAr: 'إدارة الجودة' });

      const result = await service.getCommitteeDetail('committee-1', ORG_A);

      expect(result.orgUnit).toEqual({ id: 'unit-qa', nameEn: 'Quality Department', nameAr: 'إدارة الجودة' });
      expect(mockPrisma.orgUnit.findFirst).toHaveBeenCalledWith({
        where: { id: 'unit-qa', organizationId: ORG_A },
        select: { id: true, nameEn: true, nameAr: true },
      });
    });

    it('a committee with no owning unit reads no unit, and asks for none', async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(makeCommittee({ orgUnitId: null }));
      mockPrisma.orgUnit.findFirst.mockClear();

      expect((await service.getCommitteeDetail('committee-1', ORG_A)).orgUnit).toBeNull();
      expect(mockPrisma.orgUnit.findFirst).not.toHaveBeenCalled();
    });

    itEnforcesTenantIsolation('getCommitteeDetail owning unit read', async () => {
      // A unit id that is another organisation's: the scoped read finds nothing.
      mockPrisma.committee.findFirst.mockResolvedValue(makeCommittee({ orgUnitId: 'unit-of-org-b' }));
      mockPrisma.orgUnit.findFirst.mockResolvedValue(null);

      expect((await service.getCommitteeDetail('committee-1', ORG_A)).orgUnit).toBeNull();
      expect(mockPrisma.orgUnit.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'unit-of-org-b', organizationId: ORG_A } }),
      );
    });

    itEnforcesTenantIsolation('getCommitteeDetail committee read', async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(null);

      await expect(service.getCommitteeDetail('committee-1', ORG_B)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.committee.findFirst).toHaveBeenCalledWith({ where: { id: 'committee-1', organizationId: ORG_B } });
      expect(mockPrisma.workflowInstance.findMany).not.toHaveBeenCalled();
    });
  });

  // ── stageRules (ACC-255) ─────────────────────────────────────────────────────

  describe('stageRules on the committee reads (ACC-255)', () => {
    const ACTIVE_RULES = {
      stageId: 'stage-active',
      stageNameEn: 'Active',
      stageNameAr: null,
      flags: ['IN_FORCE'],
      actions: { edit_details: false, add_member: true, remove_member: true, change_member_role: true, request_change: true },
    };
    const NOTHING = {
      actions: { edit_details: false, add_member: false, remove_member: false, change_member_role: false, request_change: false },
      flags: [],
    };

    it("the detail carries the engine's answer for the committee's current stage, asked with the caller's organisation", async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(makeCommittee());
      mockStageRules.stageRulesFor.mockResolvedValue(new Map([['committee-1', ACTIVE_RULES]]));

      const result = await service.getCommitteeDetail('committee-1', ORG_A);

      expect(mockStageRules.stageRulesFor).toHaveBeenCalledWith(ORG_A, 'COMMITTEE', ['committee-1']);
      expect(result.stageRules).toEqual({
        actions: { edit_details: false, add_member: true, remove_member: true, change_member_role: true, request_change: true },
        flags: ['IN_FORCE'],
      });
    });

    it('a committee with no live stage is allowed nothing', async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(makeCommittee());
      expect((await service.getCommitteeDetail('committee-1', ORG_A)).stageRules).toEqual(NOTHING);
    });

    it('every list row carries its own answer, read for the whole list at once', async () => {
      mockPrisma.committee.findMany.mockResolvedValue([makeCommittee({ id: 'c-1' }), makeCommittee({ id: 'c-2' })]);
      mockStageRules.stageRulesFor.mockResolvedValue(new Map([['c-1', ACTIVE_RULES]]));

      const rows = await service.listCommittees(ORG_A);

      expect(mockStageRules.stageRulesFor).toHaveBeenCalledTimes(1);
      expect(mockStageRules.stageRulesFor).toHaveBeenCalledWith(ORG_A, 'COMMITTEE', ['c-1', 'c-2']);
      expect(rows.map((r) => [r.id, r.stageRules.actions.request_change, r.stageRules.flags])).toEqual([
        ['c-1', true, ['IN_FORCE']],
        ['c-2', false, []],
      ]);
    });

    itEnforcesTenantIsolation('stageRules — another organisation\'s committee is not found, and no stage is read', async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(null);
      await expect(service.getCommitteeDetail('committee-1', ORG_B)).rejects.toThrow(NotFoundException);
      expect(mockStageRules.stageRulesFor).not.toHaveBeenCalled();
    });
  });

  // ── getCommitteeById ─────────────────────────────────────────────────────────

  describe('getCommitteeById', () => {
    it('returns the committee for the correct tenant', async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(makeCommittee());

      const result = await service.getCommitteeById('committee-1', ORG_A);

      expect(result.id).toBe('committee-1');
      expect(mockPrisma.committee.findFirst).toHaveBeenCalledWith({
        where: { id: 'committee-1', organizationId: ORG_A },
      });
    });

    it('throws NotFoundException for a committee in another org', async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(null);

      await expect(service.getCommitteeById('committee-1', ORG_B)).rejects.toThrow(NotFoundException);
    });
  });

  // ── createCommittee ──────────────────────────────────────────────────────────

  describe('createCommittee', () => {
    it("creates a committee scoped to the caller's organizationId, not from the dto", async () => {
      mockPrisma.committee.create.mockResolvedValue(makeCommittee());

      await service.createCommittee(
        { nameEn: 'Quality Committee', nameAr: 'لجنة الجودة', typeValueId: 'quality_committee' } as never,
        ORG_A,
        ACTOR,
      );

      expect(mockPrisma.committee.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ organizationId: ORG_A }) }),
      );
    });

    it('logs to the audit trail on creation', async () => {
      mockPrisma.committee.create.mockResolvedValue(makeCommittee());

      await service.createCommittee(
        { nameEn: 'Quality Committee', nameAr: 'لجنة الجودة', typeValueId: 'quality_committee' } as never,
        ORG_A,
        ACTOR,
      );

      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', objectType: 'Committee', tenantId: ORG_A }),
      );
    });

    it('starts a COMMITTEE workflow instance for the new committee', async () => {
      mockPrisma.committee.create.mockResolvedValue(makeCommittee());

      await service.createCommittee(
        { nameEn: 'Quality Committee', nameAr: 'لجنة الجودة', typeValueId: 'quality_committee' } as never,
        ORG_A,
        ACTOR,
      );

      expect(mockWorkflowService.startInstance).toHaveBeenCalledWith(
        'COMMITTEE',
        'committee-1',
        ORG_A,
        ACTOR,
      );
    });

    // ACC-22 Pending Discussion #4, as amended by ACC-135 — parentCommitteeId and
    // reportingToCommitteeId are TWO DISTINCT validation calls (both
    // against the Committee model, but independently invoked), and
    // orgUnitId is a SEPARATE call against the OrgUnit model. The rule's shape
    // is unchanged; reportingToRoleId, which used to be the second path, is gone.

    // ACC-233 — a reference that misses is a 400 with a code, the same for an
    // invented id and another organisation's (rule 5); was a 404.
    it('refuses a parentCommitteeId that does not belong to this org (400 COMMITTEE_PARENT_NOT_FOUND)', async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(null);

      await expect(
        service.createCommittee(
          {
            nameEn: 'Sub-committee',
            nameAr: 'لجنة فرعية',
            typeValueId: 'quality_committee',
            parentCommitteeId: 'foreign-committee',
          } as never,
          ORG_A,
          ACTOR,
        ),
      ).rejects.toMatchObject({ code: 'COMMITTEE_PARENT_NOT_FOUND' });

      expect(mockPrisma.committee.findFirst).toHaveBeenCalledWith({
        where: { id: 'foreign-committee', organizationId: ORG_A },
        select: { id: true },
      });
      expect(mockPrisma.committee.create).not.toHaveBeenCalled();
    });

    it('refuses a reportingToCommitteeId that does not belong to this org (400 COMMITTEE_REPORTS_TO_NOT_FOUND)', async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(null);

      await expect(
        service.createCommittee(
          {
            nameEn: 'Quality Committee',
            nameAr: 'لجنة الجودة',
            typeValueId: 'quality_committee',
            reportingToCommitteeId: 'foreign-committee',
          } as never,
          ORG_A,
          ACTOR,
        ),
      ).rejects.toMatchObject({ code: 'COMMITTEE_REPORTS_TO_NOT_FOUND' });

      expect(mockPrisma.committee.findFirst).toHaveBeenCalledWith({
        where: { id: 'foreign-committee', organizationId: ORG_A },
        select: { id: true },
      });
      expect(mockPrisma.committee.create).not.toHaveBeenCalled();
    });

    itEnforcesTenantIsolation('createCommittee owning org unit lookup', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(null);

      await expect(
        service.createCommittee(
          {
            nameEn: 'Quality Committee',
            nameAr: 'لجنة الجودة',
            typeValueId: 'quality_committee',
            orgUnitId: 'foreign-unit',
          } as never,
          ORG_A,
          ACTOR,
        ),
      ).rejects.toMatchObject({ code: 'COMMITTEE_UNIT_NOT_FOUND' });

      expect(mockPrisma.orgUnit.findFirst).toHaveBeenCalledWith({
        where: { id: 'foreign-unit', organizationId: ORG_A, isActive: true },
        select: { id: true },
      });
      expect(mockPrisma.committee.create).not.toHaveBeenCalled();
    });

    it('does not populate termsOfReferenceDocumentId validation (Pending Discussion #1 — nullable, unvalidated until Document Management ships)', async () => {
      mockPrisma.committee.create.mockResolvedValue(
        makeCommittee({ termsOfReferenceDocumentId: 'doc-1' }),
      );

      await service.createCommittee(
        {
          nameEn: 'Quality Committee',
          nameAr: 'لجنة الجودة',
          typeValueId: 'quality_committee',
          termsOfReferenceDocumentId: 'doc-1',
        } as never,
        ORG_A,
        ACTOR,
      );

      expect(mockPrisma.committee.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ termsOfReferenceDocumentId: 'doc-1' }) }),
      );
    });

    // ACC-135 — the owning unit.

    it('defaults an omitted owning unit to the tenant root, never null', async () => {
      mockPrisma.committee.create.mockResolvedValue(makeCommittee());

      await service.createCommittee(
        { nameEn: 'Quality Committee', nameAr: 'لجنة الجودة', typeValueId: 'quality_committee' } as never,
        ORG_A,
        ACTOR,
      );

      // An absent value is not "no owner" — it is "the whole organisation", and
      // the root unit IS the organisation (ACC-141).
      expect(mockPrisma.orgUnit.findMany).toHaveBeenCalledWith({
        where: { organizationId: ORG_A, parentId: null, isActive: true },
        select: { id: true, code: true },
        orderBy: { createdAt: 'asc' },
      });
      expect(mockPrisma.committee.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ orgUnitId: 'root-unit-a' }) }),
      );
    });

    itEnforcesTenantIsolation('createCommittee root-unit resolution', async () => {
      // The THIRD new query, and the one whose unscoped failure is worst: an
      // unscoped root lookup returns some other tenant's root and writes it onto
      // this tenant's committee — a cross-tenant write, not a leak of a read.
      mockPrisma.committee.create.mockResolvedValue(makeCommittee());

      await service.createCommittee(
        { nameEn: 'Quality Committee', nameAr: 'لجنة الجودة', typeValueId: 'quality_committee' } as never,
        ORG_A,
        ACTOR,
      );

      expect(mockPrisma.orgUnit.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_A }) }),
      );
    });

    it('uses the named owning unit without looking for a root', async () => {
      mockPrisma.committee.create.mockResolvedValue(makeCommittee());

      await service.createCommittee(
        {
          nameEn: 'Quality Committee',
          nameAr: 'لجنة الجودة',
          typeValueId: 'quality_committee',
          orgUnitId: 'unit-a',
        } as never,
        ORG_A,
        ACTOR,
      );

      expect(mockPrisma.orgUnit.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.committee.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ orgUnitId: 'unit-a' }) }),
      );
    });

    it("ACC-233 — an owning unit sent as '' on create is 400 COMMITTEE_UNIT_REQUIRED, not the root", async () => {
      await expect(
        service.createCommittee(
          { nameEn: 'Quality Committee', nameAr: 'لجنة الجودة', typeValueId: 'quality_committee', orgUnitId: '' } as never,
          ORG_A,
          ACTOR,
        ),
      ).rejects.toMatchObject({ code: 'COMMITTEE_UNIT_REQUIRED' });
      expect(mockPrisma.orgUnit.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.committee.create).not.toHaveBeenCalled();
    });

    it('ACC-233 — a create runs in one transaction and takes no hierarchy lock: nothing sits under a new committee', async () => {
      mockPrisma.committee.create.mockResolvedValue(makeCommittee());

      await service.createCommittee(
        { nameEn: 'Sub', nameAr: 'فرعية', typeValueId: 'quality_committee', parentCommitteeId: 'committee-2' } as never,
        ORG_A,
        ACTOR,
      );

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      const sql = mockPrisma.$queryRaw.mock.calls.map(([strings]) => (strings as TemplateStringsArray).join('?'));
      expect(sql.some((q) => q.includes('pg_advisory_xact_lock'))).toBe(false);
      expect(sql.some((q) => q.includes('WITH RECURSIVE'))).toBe(false);
      expect(sql.some((q) => q.includes('"WorkflowInstance"'))).toBe(true);
    });

    it('refuses to create when the organization has NO active root unit', async () => {
      // Reachable, not theoretical: ACC-134 enforced at most one root and never
      // at least one, and nothing blocks deactivating the root (ACC-152).
      mockPrisma.orgUnit.findMany.mockResolvedValue([]);

      await expect(
        service.createCommittee(
          { nameEn: 'Quality Committee', nameAr: 'لجنة الجودة', typeValueId: 'quality_committee' } as never,
          ORG_A,
          ACTOR,
        ),
      ).rejects.toThrow(ConflictException);

      expect(mockPrisma.committee.create).not.toHaveBeenCalled();
    });

    it('REFUSES rather than picking one when the organization has TWO active roots', async () => {
      // THE TEST THAT MATTERS MOST HERE. The obvious implementation orders by
      // createdAt and takes the first, which silently writes a real owner onto a
      // real record on a row ordering nobody chose. ACC-134 says a tenant has
      // exactly one root, so two is a violation of that invariant, not a tie.
      mockPrisma.orgUnit.findMany.mockResolvedValue([
        { id: 'root-1', code: 'ALPHA' },
        { id: 'root-2', code: 'BETA' },
      ]);

      await expect(
        service.createCommittee(
          { nameEn: 'Quality Committee', nameAr: 'لجنة الجودة', typeValueId: 'quality_committee' } as never,
          ORG_A,
          ACTOR,
        ),
      ).rejects.toThrow(/ALPHA, BETA/);

      expect(mockPrisma.committee.create).not.toHaveBeenCalled();
    });
  });

  // ── updateCommittee ──────────────────────────────────────────────────────────

  describe('updateCommittee', () => {
    it('updates only the provided fields', async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(makeCommittee());
      mockPrisma.committee.update.mockResolvedValue(makeCommittee({ nameEn: 'Renamed' }));

      await service.updateCommittee('committee-1', { nameEn: 'Renamed' } as never, ORG_A, ACTOR);

      expect(mockPrisma.committee.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { nameEn: 'Renamed' } }),
      );
    });

    it('throws NotFoundException for a committee in another org', async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(null);

      await expect(
        service.updateCommittee('committee-1', { nameEn: 'Renamed' } as never, ORG_B, ACTOR),
      ).rejects.toThrow(NotFoundException);
    });

    itEnforcesTenantIsolation('updateCommittee owning org unit lookup', async () => {
      mockPrisma.committee.findFirst.mockResolvedValueOnce(makeCommittee()); // getCommitteeById
      mockPrisma.orgUnit.findFirst.mockResolvedValue(null);

      await expect(
        service.updateCommittee('committee-1', { orgUnitId: 'foreign-unit' } as never, ORG_A, ACTOR),
      ).rejects.toMatchObject({ code: 'COMMITTEE_UNIT_NOT_FOUND' });

      expect(mockPrisma.orgUnit.findFirst).toHaveBeenCalledWith({
        where: { id: 'foreign-unit', organizationId: ORG_A, isActive: true },
        select: { id: true },
      });
      expect(mockPrisma.committee.update).not.toHaveBeenCalled();
    });

    // ── ACC-233 — the reference checks and the write, in one transaction ──────

    const lockCalls = () =>
      mockPrisma.$queryRaw.mock.calls.filter(([strings]) => (strings as TemplateStringsArray).join('?').includes('pg_advisory_xact_lock'));
    /** When the committee is read in full — the read the locks protect. */
    const fullReadOrder = (): number => {
      const i = mockPrisma.committee.findFirst.mock.calls.findIndex(([args]) => !(args as { select?: unknown }).select);
      return mockPrisma.committee.findFirst.mock.invocationCallOrder[i]!;
    };

    it("sets a parent inside ONE transaction, after the organisation's hierarchy lock", async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(makeCommittee());
      mockPrisma.committee.update.mockResolvedValue(makeCommittee({ parentCommitteeId: 'committee-2' }));

      await service.updateCommittee('committee-1', { parentCommitteeId: 'committee-2' } as never, ORG_A, ACTOR);

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(lockCalls()).toHaveLength(1);
      expect(lockCalls()[0]!.slice(1)).toEqual([`committee-hierarchy:${ORG_A}`]);
      // The lock comes first: the committee is read, walked and written under it.
      // (The existence check before it is an unlocked id-only read, ACC-255.)
      expect(mockPrisma.$queryRaw.mock.invocationCallOrder[0]!).toBeLessThan(fullReadOrder());
      expect(mockPrisma.committee.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { parentCommitteeId: 'committee-2' } }),
      );
    });

    it('an update that touches neither parent nor reports-to takes no lock', async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(makeCommittee());
      mockPrisma.committee.update.mockResolvedValue(makeCommittee({ nameEn: 'Renamed' }));

      await service.updateCommittee('committee-1', { nameEn: 'Renamed' } as never, ORG_A, ACTOR);

      expect(lockCalls()).toHaveLength(0);
    });

    // ── ACC-238 — the stale save ──────────────────────────────────────────────

    const rowLockCalls = () =>
      mockPrisma.$queryRaw.mock.calls.filter(([strings]) => (strings as TemplateStringsArray).join('?').includes('FOR UPDATE'));
    const LOADED = new Date('2026-10-18T09:00:00.123Z');

    it("locks the committee's row, scoped by organisation, before reading it", async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(makeCommittee({ updatedAt: LOADED }));
      mockPrisma.committee.update.mockResolvedValue(makeCommittee({ nameEn: 'Renamed' }));

      await service.updateCommittee('committee-1', { nameEn: 'Renamed' } as never, ORG_A, ACTOR);

      expect(rowLockCalls()).toHaveLength(1);
      expect(rowLockCalls()[0]!.slice(1)).toEqual(['committee-1', ORG_A]);
      const rowLockOrder = mockPrisma.$queryRaw.mock.invocationCallOrder[mockPrisma.$queryRaw.mock.calls.indexOf(rowLockCalls()[0]!)]!;
      expect(rowLockOrder).toBeLessThan(fullReadOrder());
    });

    it('saves when the committee is unchanged since it was loaded', async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(makeCommittee({ updatedAt: LOADED }));
      mockPrisma.committee.update.mockResolvedValue(makeCommittee({ nameEn: 'Renamed' }));

      await service.updateCommittee('committee-1', { nameEn: 'Renamed', expectedUpdatedAt: LOADED.toISOString() } as never, ORG_A, ACTOR);

      expect(mockPrisma.committee.update).toHaveBeenCalledWith(expect.objectContaining({ data: { nameEn: 'Renamed' } }));
    });

    it('refuses with 409 COMMITTEE_CHANGED when it changed since, and writes nothing', async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(makeCommittee({ updatedAt: new Date('2026-10-18T09:05:00.000Z') }));

      await expect(
        service.updateCommittee('committee-1', { nameEn: 'Renamed', expectedUpdatedAt: LOADED.toISOString() } as never, ORG_A, ACTOR),
      ).rejects.toMatchObject({ code: 'COMMITTEE_CHANGED', status: 409 });

      expect(mockPrisma.committee.update).not.toHaveBeenCalled();
      expect(mockAuditLog.log).not.toHaveBeenCalled();
    });

    it('a save without expectedUpdatedAt is not compared (callers other than the dialog)', async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(makeCommittee({ updatedAt: new Date('2026-10-18T09:05:00.000Z') }));
      mockPrisma.committee.update.mockResolvedValue(makeCommittee({ nameEn: 'Renamed' }));

      await service.updateCommittee('committee-1', { nameEn: 'Renamed' } as never, ORG_A, ACTOR);

      expect(mockPrisma.committee.update).toHaveBeenCalled();
    });

    it('another organisation gets the same 404 as a missing committee, before any comparison', async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(null);

      await expect(
        service.updateCommittee('committee-1', { nameEn: 'Renamed', expectedUpdatedAt: LOADED.toISOString() } as never, ORG_B, ACTOR),
      ).rejects.toThrow(NotFoundException);
    });

    it('an UNCHANGED parent is not checked again — a committee under a dissolving parent can still be renamed', async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(makeCommittee({ parentCommitteeId: 'committee-2' }));
      mockPrisma.committee.update.mockResolvedValue(makeCommittee({ parentCommitteeId: 'committee-2', nameEn: 'Renamed' }));
      // Were it checked, this stage read would refuse it.
      mockPrisma.$queryRaw.mockImplementation((strings: TemplateStringsArray) =>
        Promise.resolve(strings.join('?').includes('"WorkflowInstance"') ? [{ stageId: 's', key: 'dissolved', flags: ['DISSOLVING'] }] : []),
      );

      await service.updateCommittee('committee-1', { nameEn: 'Renamed', parentCommitteeId: 'committee-2' } as never, ORG_A, ACTOR);

      expect(mockPrisma.committee.update).toHaveBeenCalled();
    });

    it('a CHANGED parent that is dissolving is refused, and nothing is written or audited', async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(makeCommittee());
      mockPrisma.$queryRaw.mockImplementation((strings: TemplateStringsArray) =>
        Promise.resolve(strings.join('?').includes('"WorkflowInstance"') ? [{ stageId: 's', key: 'dissolution_pending', flags: ['DISSOLVING'] }] : []),
      );

      await expect(
        service.updateCommittee('committee-1', { parentCommitteeId: 'committee-2' } as never, ORG_A, ACTOR),
      ).rejects.toMatchObject({ code: 'COMMITTEE_PARENT_DISSOLVING' });

      expect(mockPrisma.committee.update).not.toHaveBeenCalled();
      expect(mockAuditLog.log).not.toHaveBeenCalled();
    });

    it('clearing the parent (null) is written, not refused', async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(makeCommittee({ parentCommitteeId: 'committee-2' }));
      mockPrisma.committee.update.mockResolvedValue(makeCommittee());

      await service.updateCommittee('committee-1', { parentCommitteeId: null } as never, ORG_A, ACTOR);

      expect(mockPrisma.committee.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { parentCommitteeId: null } }),
      );
    });

    for (const sent of ['', null]) {
      it(`an owning unit sent as ${JSON.stringify(sent)} is 400 COMMITTEE_UNIT_REQUIRED, never written`, async () => {
        mockPrisma.committee.findFirst.mockResolvedValue(makeCommittee());

        await expect(
          service.updateCommittee('committee-1', { orgUnitId: sent } as never, ORG_A, ACTOR),
        ).rejects.toMatchObject({ code: 'COMMITTEE_UNIT_REQUIRED', status: 400 });

        expect(mockPrisma.committee.update).not.toHaveBeenCalled();
      });
    }

    it('does NOT default an omitted owning unit on update', async () => {
      // Different statement from create's. "Leave it alone" is not "the whole
      // organisation" — a committee that already has an owner must not silently
      // acquire the root because a caller sent a partial body.
      mockPrisma.committee.findFirst.mockResolvedValueOnce(makeCommittee());
      mockPrisma.committee.update.mockResolvedValue(makeCommittee());

      await service.updateCommittee('committee-1', { nameEn: 'Renamed' } as never, ORG_A, ACTOR);

      expect(mockPrisma.orgUnit.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.committee.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ orgUnitId: expect.anything() }),
        }),
      );
    });
  });

  // ── Membership management ────────────────────────────────────────────────────

  describe('listMembers', () => {
    it('returns only active, org-scoped members', async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(makeCommittee());
      mockPrisma.committeeMember.findMany.mockResolvedValue([makeMember()]);

      await service.listMembers('committee-1', ORG_A);

      expect(mockPrisma.committeeMember.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { committeeId: 'committee-1', organizationId: ORG_A, isActive: true } }),
      );
    });

    // MANDATORY — tenant isolation
    it('should NOT return records belonging to a different tenant', async () => {
      mockPrisma.committee.findFirst.mockImplementation(
        ({ where }: { where: { organizationId: string } }) =>
          Promise.resolve(where.organizationId === ORG_A ? makeCommittee() : null),
      );

      await expect(service.listMembers('committee-1', ORG_B)).rejects.toThrow(NotFoundException);
    });
  });

  describe('listMembershipEvents', () => {
    it('returns the full history, scoped to the tenant', async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(makeCommittee());
      mockPrisma.committeeMembershipEvent.findMany.mockResolvedValue([]);

      await service.listMembershipEvents('committee-1', ORG_A);

      expect(mockPrisma.committeeMembershipEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { committeeId: 'committee-1', organizationId: ORG_A } }),
      );
    });
  });

  describe('addMember', () => {
    it('creates the member and a JOINED membership event', async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(makeCommittee());
      mockPrisma.committeeMember.findFirst.mockResolvedValue(null); // not already a member
      mockPrisma.committeeMember.create.mockResolvedValue(makeMember());

      await service.addMember(
        'committee-1',
        { userId: 'user-1', roleValueId: 'chairman' } as never,
        ORG_A,
        ACTOR,
      );

      expect(mockPrisma.committeeMember.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ organizationId: ORG_A, committeeId: 'committee-1', userId: 'user-1' }),
        }),
      );
      expect(mockPrisma.committeeMembershipEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'JOINED' }) }),
      );
    });

    // ACC-120 slice 4 — a new member's joinedAt is the day sent, as on a rejoin,
    // and agrees with the JOINED event. It was always "now" before.
    it('records the effective date as a new member’s joinedAt, the same as the JOINED event', async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(makeCommittee());
      mockPrisma.committeeMember.findFirst.mockResolvedValue(null);
      mockPrisma.committeeMember.create.mockResolvedValue(makeMember());

      await service.addMember(
        'committee-1',
        { userId: 'user-1', roleValueId: 'chairman', effectiveDate: '2026-09-01T00:00:00.000Z' } as never,
        ORG_A,
        ACTOR,
      );

      const joined = new Date('2026-09-01T00:00:00.000Z');
      expect(mockPrisma.committeeMember.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ joinedAt: joined }) }),
      );
      expect(mockPrisma.committeeMembershipEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ effectiveDate: joined }) }),
      );
    });

    it("re-validates userId belongs to the caller's org (ACC-17 pattern)", async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(makeCommittee());
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.addMember(
          'committee-1',
          { userId: 'foreign-user', roleValueId: 'chairman' } as never,
          ORG_A,
          ACTOR,
        ),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
        where: { id: 'foreign-user', organizationId: ORG_A },
      });
      expect(mockPrisma.committeeMember.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the user is already an active member', async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(makeCommittee());
      mockPrisma.committeeMember.findFirst.mockResolvedValue(makeMember());

      await expect(
        service.addMember(
          'committee-1',
          { userId: 'user-1', roleValueId: 'chairman' } as never,
          ORG_A,
          ACTOR,
        ),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.committeeMember.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the committee belongs to a different org', async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(null);

      await expect(
        service.addMember(
          'committee-1',
          { userId: 'user-1', roleValueId: 'chairman' } as never,
          ORG_B,
          ACTOR,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.committeeMember.create).not.toHaveBeenCalled();
    });

    // Rejoin after departure (ACC-32) — reactivates the existing row in
    // place (mirroring RoleService.reactivateRole()) instead of hitting
    // @@unique([committeeId, userId]) via create().
    describe('rejoin after departure', () => {
      it('reactivates the existing inactive row instead of creating a new one', async () => {
        const departedMember = makeMember({ isActive: false, leftAt: new Date('2026-04-02') });
        mockPrisma.committee.findFirst.mockResolvedValue(makeCommittee());
        mockPrisma.committeeMember.findFirst.mockResolvedValue(departedMember);
        mockPrisma.committeeMember.update.mockResolvedValue(
          makeMember({ isActive: true, leftAt: null, roleValueId: 'secretary' }),
        );

        const result = await service.addMember(
          'committee-1',
          { userId: 'user-1', roleValueId: 'secretary', effectiveDate: '2026-08-15' } as never,
          ORG_A,
          ACTOR,
        );

        expect(mockPrisma.committeeMember.create).not.toHaveBeenCalled();
        expect(mockPrisma.committeeMember.update).toHaveBeenCalledWith({
          where: { id: departedMember.id },
          data: {
            roleValueId: 'secretary',
            isActive: true,
            leftAt: null,
            joinedAt: new Date('2026-08-15'),
          },
        });
        expect(result.isActive).toBe(true);
      });

      it('logs the reactivation as an UPDATE with the departed row as "before"', async () => {
        const departedMember = makeMember({ isActive: false, leftAt: new Date('2026-04-02') });
        mockPrisma.committee.findFirst.mockResolvedValue(makeCommittee());
        mockPrisma.committeeMember.findFirst.mockResolvedValue(departedMember);
        mockPrisma.committeeMember.update.mockResolvedValue(makeMember({ isActive: true, leftAt: null }));

        await service.addMember(
          'committee-1',
          { userId: 'user-1', roleValueId: 'chairman' } as never,
          ORG_A,
          ACTOR,
        );

        expect(mockAuditLog.log).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'UPDATE',
            objectType: 'CommitteeMember',
            before: departedMember,
          }),
        );
      });

      it('preserves the original LEFT event and appends a new JOINED event — full history readable via listMembershipEvents()', async () => {
        const priorLeftEvent = {
          id: 'event-left-1',
          organizationId: ORG_A,
          committeeId: 'committee-1',
          userId: 'user-1',
          roleValueId: 'chairman',
          action: 'LEFT',
          effectiveDate: new Date('2026-04-02'),
          reason: null,
          approvedBy: ACTOR,
          createdAt: new Date('2026-04-02'),
        };
        const events: unknown[] = [priorLeftEvent];

        mockPrisma.committee.findFirst.mockResolvedValue(makeCommittee());
        mockPrisma.committeeMember.findFirst.mockResolvedValue(
          makeMember({ isActive: false, leftAt: new Date('2026-04-02') }),
        );
        mockPrisma.committeeMember.update.mockResolvedValue(makeMember({ isActive: true, leftAt: null }));
        mockPrisma.committeeMembershipEvent.create.mockImplementation(
          ({ data }: { data: Record<string, unknown> }) => {
            const created = { id: `event-${events.length + 1}`, createdAt: new Date(), ...data };
            events.push(created);
            return Promise.resolve(created);
          },
        );
        mockPrisma.committeeMembershipEvent.findMany.mockImplementation(() => Promise.resolve([...events]));

        await service.addMember(
          'committee-1',
          { userId: 'user-1', roleValueId: 'chairman', effectiveDate: '2026-08-15' } as never,
          ORG_A,
          ACTOR,
        );

        const history = await service.listMembershipEvents('committee-1', ORG_A);

        expect(history).toHaveLength(2);
        expect(history[0]).toEqual(priorLeftEvent); // untouched by the reactivation
        expect(history[1]).toEqual(
          expect.objectContaining({ action: 'JOINED', effectiveDate: new Date('2026-08-15') }),
        );
      });

      // MANDATORY — tenant isolation for the reactivate-or-create branch's
      // committeeMember.update() write (a genuinely new query this ticket
      // introduces — the prior code path never called update() from
      // addMember()).
      it('should NOT return records belonging to a different tenant', async () => {
        mockPrisma.committee.findFirst.mockImplementation(
          ({ where }: { where: { organizationId: string } }) =>
            Promise.resolve(where.organizationId === ORG_A ? makeCommittee() : null),
        );

        await expect(
          service.addMember(
            'committee-1',
            { userId: 'user-1', roleValueId: 'chairman' } as never,
            ORG_B,
            ACTOR,
          ),
        ).rejects.toThrow(NotFoundException);

        // getCommitteeById() rejects before the reactivate-or-create branch
        // is ever reached for a committee outside the caller's tenant.
        expect(mockPrisma.committeeMember.findFirst).not.toHaveBeenCalled();
        expect(mockPrisma.committeeMember.update).not.toHaveBeenCalled();
        expect(mockPrisma.committeeMember.create).not.toHaveBeenCalled();
      });
    });
  });

  describe('changeMemberRole', () => {
    it('updates the role and records a ROLE_CHANGED event', async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(makeCommittee());
      mockPrisma.committeeMember.findFirst.mockResolvedValue(makeMember());
      mockPrisma.committeeMember.update.mockResolvedValue(makeMember({ roleValueId: 'secretary' }));

      await service.changeMemberRole(
        'committee-1',
        'member-1',
        { roleValueId: 'secretary' } as never,
        ORG_A,
        ACTOR,
      );

      expect(mockPrisma.committeeMember.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { roleValueId: 'secretary' } }),
      );
      expect(mockPrisma.committeeMembershipEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'ROLE_CHANGED' }) }),
      );
    });

    it('throws NotFoundException for a member not active in this committee', async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(makeCommittee());
      mockPrisma.committeeMember.findFirst.mockResolvedValue(null);

      await expect(
        service.changeMemberRole(
          'committee-1',
          'member-1',
          { roleValueId: 'secretary' } as never,
          ORG_A,
          ACTOR,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.committeeMember.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the committee belongs to a different org', async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(null);

      await expect(
        service.changeMemberRole(
          'committee-1',
          'member-1',
          { roleValueId: 'secretary' } as never,
          ORG_B,
          ACTOR,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.committeeMember.update).not.toHaveBeenCalled();
    });
  });

  describe('removeMember', () => {
    it('sets leftAt/isActive false and records a LEFT event', async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(makeCommittee());
      mockPrisma.committeeMember.findFirst.mockResolvedValue(makeMember());
      mockPrisma.committeeMember.update.mockResolvedValue(
        makeMember({ leftAt: new Date(), isActive: false }),
      );

      await service.removeMember('committee-1', 'member-1', {} as never, ORG_A, ACTOR);

      expect(mockPrisma.committeeMember.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }),
      );
      expect(mockPrisma.committeeMembershipEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'LEFT' }) }),
      );
    });

    it('throws NotFoundException for a member not active in this committee', async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(makeCommittee());
      mockPrisma.committeeMember.findFirst.mockResolvedValue(null);

      await expect(
        service.removeMember('committee-1', 'member-1', {} as never, ORG_A, ACTOR),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.committeeMember.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the committee belongs to a different org', async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(null);

      await expect(
        service.removeMember('committee-1', 'member-1', {} as never, ORG_B, ACTOR),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.committeeMember.update).not.toHaveBeenCalled();
    });
  });

  // ── ACC-241 (ACC-255 PR 2) — the committee's stage decides direct writes ────

  describe("the committee's stage (ACC-241)", () => {
    const refusal = (action: string, stageNameEn: string | null) =>
      new WorkflowRefusalException('STAGE_ACTION_NOT_ALLOWED', { action, stageNameEn, stageNameAr: null });
    const stageCall = () => mockStageRules.assertStageAllows.mock.calls[0] as unknown[];
    const stageOrder = () => mockStageRules.assertStageAllows.mock.invocationCallOrder[0]!;

    it("updateCommittee asks for edit_details, FOR SHARE of the instance, BEFORE the hierarchy and row locks", async () => {
      mockPrisma.committee.update.mockResolvedValue(makeCommittee({ parentCommitteeId: 'committee-2' }));

      await service.updateCommittee('committee-1', { parentCommitteeId: 'committee-2' } as never, ORG_A, ACTOR);

      expect(stageCall().slice(0, 4)).toEqual(['COMMITTEE', 'committee-1', 'edit_details', ORG_A]);
      expect(stageCall()[5]).toMatchObject({ lock: 'share' });
      // Instance first, then the hierarchy lock, then the committee row (the engine's order).
      expect(stageOrder()).toBeLessThan(mockPrisma.$queryRaw.mock.invocationCallOrder[0]!);
    });

    it('updateCommittee refused by the stage: 409 STAGE_ACTION_NOT_ALLOWED naming it, nothing locked, written or audited', async () => {
      mockStageRules.assertStageAllows.mockRejectedValue(refusal('edit_details', 'Active'));

      await expect(service.updateCommittee('committee-1', { nameEn: 'Renamed' } as never, ORG_A, ACTOR)).rejects.toMatchObject({
        status: 409,
        code: 'STAGE_ACTION_NOT_ALLOWED',
      });
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
      expect(mockPrisma.committee.update).not.toHaveBeenCalled();
      expect(mockAuditLog.log).not.toHaveBeenCalled();
    });

    it("a committee that doesn't exist is still 404, and its stage is never asked", async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(null);

      await expect(service.updateCommittee('committee-1', { nameEn: 'Renamed' } as never, ORG_B, ACTOR)).rejects.toThrow(NotFoundException);
      expect(mockStageRules.assertStageAllows).not.toHaveBeenCalled();
    });

    it('the refusal names the stage in the committee\'s words', () => {
      mockPrisma.committee.update.mockResolvedValue(makeCommittee());
      return service.updateCommittee('committee-1', { nameEn: 'Renamed' } as never, ORG_A, ACTOR).then(() => {
        const message = (stageCall()[5] as { message: (n: string | null) => string }).message;
        expect(message('Active')).toBe("This can't be done while the committee is in Active.");
        expect(message(null)).toBe("This can't be done: the committee has no current stage.");
      });
    });

    const memberWrites: [string, string, () => Promise<unknown>][] = [
      ['addMember', 'add_member', () => service.addMember('committee-1', { userId: 'user-1', roleValueId: 'member' } as never, ORG_A, ACTOR)],
      ['changeMemberRole', 'change_member_role', () => service.changeMemberRole('committee-1', 'member-1', { roleValueId: 'secretary' } as never, ORG_A, ACTOR)],
      ['removeMember', 'remove_member', () => service.removeMember('committee-1', 'member-1', {} as never, ORG_A, ACTOR)],
    ];

    it.each(memberWrites)('%s asks for its own action (%s), FOR SHARE, inside the transaction, before reading the member', async (_name, action, call) => {
      mockPrisma.committeeMember.findFirst.mockResolvedValue(action === 'add_member' ? null : makeMember());
      mockPrisma.committeeMember.create.mockResolvedValue(makeMember());
      mockPrisma.committeeMember.update.mockResolvedValue(makeMember());

      await call();

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(stageCall().slice(0, 4)).toEqual(['COMMITTEE', 'committee-1', action, ORG_A]);
      expect(stageCall()[5]).toMatchObject({ lock: 'share' });
      expect(stageOrder()).toBeLessThan(mockPrisma.committeeMember.findFirst.mock.invocationCallOrder[0]!);
      const message = (stageCall()[5] as { message: (n: string | null) => string }).message;
      expect(message('Dissolved')).toBe("Members can't be changed while the committee is Dissolved.");
      expect(message(null)).toBe("Members can't be changed: the committee has no current stage.");
    });

    it.each(memberWrites)('%s refused by the stage (%s): 409, and nothing written or audited', async (_name, action, call) => {
      mockStageRules.assertStageAllows.mockRejectedValue(refusal(action, 'Dissolved'));
      mockPrisma.committeeMember.findFirst.mockResolvedValue(makeMember());

      await expect(call()).rejects.toMatchObject({ status: 409, code: 'STAGE_ACTION_NOT_ALLOWED' });
      expect(mockPrisma.committeeMember.create).not.toHaveBeenCalled();
      expect(mockPrisma.committeeMember.update).not.toHaveBeenCalled();
      expect(mockPrisma.committeeMembershipEvent.create).not.toHaveBeenCalled();
      expect(mockAuditLog.log).not.toHaveBeenCalled();
    });
  });


  // assertCommitteeAuthority() and its tests were removed entirely —
  // ACC-28 correction, see step-28-resource-scoped-roles.md's
  // Retrospective Note 2. Permission enforcement for updateCommittee/
  // addMember/changeMemberRole/removeMember is now handled purely by
  // PermissionGuard reading each method's @Permissions() decorator — see
  // committees.permissions.spec.ts, which exercises the real guard against
  // the real decorator metadata (this file's existing pattern of stubbing
  // PermissionGuard entirely can't prove enforcement, only delegation).
});
