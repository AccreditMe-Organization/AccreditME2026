import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CommitteesService } from './committees.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { WorkflowService } from '../workflow/workflow.service';

const ORG_A = 'org-a-id';
const ORG_B = 'org-b-id';
const ACTOR = 'actor-id';

// ACC-28 — the flat-permission half of assertCommitteeAuthority()'s OR
// check. Every pre-existing test in this file passes this so the new
// authority check doesn't change any of their behavior.
const WITH_MANAGE = ['committees:manage'];
const WITHOUT_MANAGE: string[] = [];
const CHAIRMAN_LOOKUP_VALUE = { id: 'lookup-chairman-id' };

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
  termsOfReferenceDocumentId: null as string | null,
  reportingToCommitteeId: null as string | null,
  reportingToRoleId: null as string | null,
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
  committee: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  committeeMember: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  committeeMembershipEvent: {
    findMany: jest.fn(),
    create: jest.fn(),
  },
  role: {
    findFirst: jest.fn(),
  },
  user: {
    findFirst: jest.fn(),
  },
  lookupValue: {
    findFirst: jest.fn(),
  },
};

const mockAuditLog = { log: jest.fn() };
const mockWorkflowService = { startInstance: jest.fn() };

describe('CommitteesService', () => {
  let service: CommitteesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Defaults matching this file's usual "happy path" org — tests
    // exercising cross-tenant rejection override these per-case.
    mockPrisma.committee.findFirst.mockResolvedValue(makeCommittee());
    mockPrisma.role.findFirst.mockResolvedValue({ id: 'role-a', organizationId: ORG_A });
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-a', organizationId: ORG_A });
    mockPrisma.lookupValue.findFirst.mockResolvedValue(CHAIRMAN_LOOKUP_VALUE);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommitteesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogService, useValue: mockAuditLog },
        { provide: WorkflowService, useValue: mockWorkflowService },
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

    // ACC-22 Pending Discussion #4 — parentCommitteeId and
    // reportingToCommitteeId are TWO DISTINCT validation calls (both
    // against the Committee model, but independently invoked), and
    // reportingToRoleId is a SEPARATE call against the Role model.

    it('throws NotFoundException when parentCommitteeId does not belong to this org', async () => {
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
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.committee.findFirst).toHaveBeenCalledWith({
        where: { id: 'foreign-committee', organizationId: ORG_A },
      });
      expect(mockPrisma.committee.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when reportingToCommitteeId does not belong to this org', async () => {
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
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.committee.findFirst).toHaveBeenCalledWith({
        where: { id: 'foreign-committee', organizationId: ORG_A },
      });
      expect(mockPrisma.committee.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when reportingToRoleId does not belong to this org (a SEPARATE Role lookup)', async () => {
      mockPrisma.role.findFirst.mockResolvedValue(null);

      await expect(
        service.createCommittee(
          {
            nameEn: 'Quality Committee',
            nameAr: 'لجنة الجودة',
            typeValueId: 'quality_committee',
            reportingToRoleId: 'foreign-role',
          } as never,
          ORG_A,
          ACTOR,
        ),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.role.findFirst).toHaveBeenCalledWith({
        where: { id: 'foreign-role', organizationId: ORG_A },
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
  });

  // ── updateCommittee ──────────────────────────────────────────────────────────

  describe('updateCommittee', () => {
    it('updates only the provided fields', async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(makeCommittee());
      mockPrisma.committee.update.mockResolvedValue(makeCommittee({ nameEn: 'Renamed' }));

      await service.updateCommittee('committee-1', { nameEn: 'Renamed' } as never, ORG_A, ACTOR, WITH_MANAGE);

      expect(mockPrisma.committee.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { nameEn: 'Renamed' } }),
      );
    });

    it('throws NotFoundException for a committee in another org', async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(null);

      await expect(
        service.updateCommittee('committee-1', { nameEn: 'Renamed' } as never, ORG_B, ACTOR, WITH_MANAGE),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when reportingToRoleId does not belong to this org', async () => {
      mockPrisma.committee.findFirst.mockResolvedValueOnce(makeCommittee()); // getCommitteeById
      mockPrisma.role.findFirst.mockResolvedValue(null);

      await expect(
        service.updateCommittee(
          'committee-1',
          { reportingToRoleId: 'foreign-role' } as never,
          ORG_A,
          ACTOR,
          WITH_MANAGE,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.committee.update).not.toHaveBeenCalled();
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
        WITH_MANAGE,
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

    it("re-validates userId belongs to the caller's org (ACC-17 pattern)", async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(makeCommittee());
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.addMember(
          'committee-1',
          { userId: 'foreign-user', roleValueId: 'chairman' } as never,
          ORG_A,
          ACTOR,
          WITH_MANAGE,
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
          WITH_MANAGE,
        ),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.committeeMember.create).not.toHaveBeenCalled();
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
        WITH_MANAGE,
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
          WITH_MANAGE,
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

      await service.removeMember('committee-1', 'member-1', {} as never, ORG_A, ACTOR, WITH_MANAGE);

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
        service.removeMember('committee-1', 'member-1', {} as never, ORG_A, ACTOR, WITH_MANAGE),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.committeeMember.update).not.toHaveBeenCalled();
    });
  });

  // ── assertCommitteeAuthority (ACC-28) ────────────────────────────────────────
  // Exercised via updateCommittee — all four call sites (updateCommittee,
  // addMember, changeMemberRole, removeMember) call the exact same shared
  // private helper with the exact same signature, so this is not duplicated
  // per call site.

  describe('assertCommitteeAuthority (via updateCommittee)', () => {
    it('allows a user with flat committees:manage, without checking Chairman status at all', async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(makeCommittee());
      mockPrisma.committee.update.mockResolvedValue(makeCommittee({ nameEn: 'Renamed' }));

      await service.updateCommittee('committee-1', { nameEn: 'Renamed' } as never, ORG_A, ACTOR, WITH_MANAGE);

      expect(mockPrisma.lookupValue.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.committeeMember.findFirst).not.toHaveBeenCalled();
    });

    it('allows a user WITHOUT committees:manage who is the active Chairman of this committee', async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(makeCommittee());
      mockPrisma.committee.update.mockResolvedValue(makeCommittee({ nameEn: 'Renamed' }));
      mockPrisma.lookupValue.findFirst.mockResolvedValue(CHAIRMAN_LOOKUP_VALUE);
      mockPrisma.committeeMember.findFirst.mockResolvedValue(
        makeMember({ userId: ACTOR, roleValueId: CHAIRMAN_LOOKUP_VALUE.id }),
      );

      await service.updateCommittee(
        'committee-1',
        { nameEn: 'Renamed' } as never,
        ORG_A,
        ACTOR,
        WITHOUT_MANAGE,
      );

      expect(mockPrisma.committeeMember.findFirst).toHaveBeenCalledWith({
        where: {
          committeeId: 'committee-1',
          organizationId: ORG_A,
          userId: ACTOR,
          isActive: true,
          roleValueId: CHAIRMAN_LOOKUP_VALUE.id,
        },
      });
      expect(mockPrisma.committee.update).toHaveBeenCalled();
    });

    it('rejects a user with neither committees:manage nor an active Chairman seat on this committee', async () => {
      mockPrisma.lookupValue.findFirst.mockResolvedValue(CHAIRMAN_LOOKUP_VALUE);
      mockPrisma.committeeMember.findFirst.mockResolvedValue(null); // not the chairman

      await expect(
        service.updateCommittee('committee-1', { nameEn: 'Renamed' } as never, ORG_A, ACTOR, WITHOUT_MANAGE),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.committee.update).not.toHaveBeenCalled();
    });

    it('rejects when no "chairman" lookup value is seeded for this tenant at all', async () => {
      mockPrisma.lookupValue.findFirst.mockResolvedValue(null);

      await expect(
        service.updateCommittee('committee-1', { nameEn: 'Renamed' } as never, ORG_A, ACTOR, WITHOUT_MANAGE),
      ).rejects.toThrow(ForbiddenException);
      // Never even attempts the CommitteeMember lookup without a resolved
      // chairman lookup value id to check against.
      expect(mockPrisma.committeeMember.findFirst).not.toHaveBeenCalled();
    });

    it('resolves the "chairman" LookupValue with organizationId: null explicitly (SYSTEM row, not a tenant override row)', async () => {
      mockPrisma.lookupValue.findFirst.mockResolvedValue(CHAIRMAN_LOOKUP_VALUE);
      mockPrisma.committeeMember.findFirst.mockResolvedValue(
        makeMember({ userId: ACTOR, roleValueId: CHAIRMAN_LOOKUP_VALUE.id }),
      );

      await service.updateCommittee(
        'committee-1',
        { nameEn: 'Renamed' } as never,
        ORG_A,
        ACTOR,
        WITHOUT_MANAGE,
      );

      expect(mockPrisma.lookupValue.findFirst).toHaveBeenCalledWith({
        where: {
          key: 'chairman',
          organizationId: null,
          category: { key: 'committee_member_role' },
        },
        select: { id: true },
      });
    });

    // MANDATORY — tenant isolation. A Chairman seat in one tenant must never
    // satisfy the authority check for a committee in a different tenant.
    it('should NOT return records belonging to a different tenant', async () => {
      mockPrisma.lookupValue.findFirst.mockResolvedValue(CHAIRMAN_LOOKUP_VALUE);
      // Simulates the real query: a chairman membership exists, but only
      // scoped to ORG_A — a caller acting as ORG_B never matches it.
      mockPrisma.committeeMember.findFirst.mockImplementation(
        ({ where }: { where: { organizationId: string } }) =>
          Promise.resolve(
            where.organizationId === ORG_A
              ? makeMember({ userId: ACTOR, roleValueId: CHAIRMAN_LOOKUP_VALUE.id })
              : null,
          ),
      );

      await expect(
        service.updateCommittee('committee-1', { nameEn: 'Renamed' } as never, ORG_B, ACTOR, WITHOUT_MANAGE),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
