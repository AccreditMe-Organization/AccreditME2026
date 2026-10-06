import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { TaskAssignmentService, AssignmentViewer } from './task-assignment.service';
import { PrismaService } from '../../prisma/prisma.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';

// ACC-167 (decision 8) — the assignment picker. It replaces the users:view
// dependency ACC-163 recorded, so these tests pin two things: WHO may use it
// (tasks:create, or the creator / a tasks:reassign holder for a named task),
// and WHAT it returns (only what the cascade needs — no email, no status).

const ORG_A = 'org-a';
const ORG_B = 'org-b';

const mockPrisma = {
  task: { findFirst: jest.fn() },
  orgUnit: { findFirst: jest.fn(), findMany: jest.fn() },
  orgPosition: { findMany: jest.fn() },
  user: { findMany: jest.fn(), groupBy: jest.fn() },
  committee: { findFirst: jest.fn() },
  committeeMember: { findMany: jest.fn(), groupBy: jest.fn() },
  lookupValue: { findMany: jest.fn() },
};

const creator: AssignmentViewer = { id: 'creator', permissions: ['committees:view'] };
const assigner: AssignmentViewer = { id: 'assigner', permissions: ['tasks:create', 'committees:view'] };
const reassigner: AssignmentViewer = { id: 'reassigner', permissions: ['tasks:reassign', 'committees:view'] };
const bystander: AssignmentViewer = { id: 'bystander', permissions: ['committees:view'] };

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('Expected the call to be refused, but it succeeded');
}

describe('TaskAssignmentService (ACC-167)', () => {
  let service: TaskAssignmentService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.task.findFirst.mockResolvedValue({ createdById: 'creator' });
    mockPrisma.orgUnit.findFirst.mockResolvedValue({ id: 'unit-1' });
    mockPrisma.orgUnit.findMany.mockResolvedValue([]);
    mockPrisma.orgPosition.findMany.mockResolvedValue([]);
    mockPrisma.user.findMany.mockResolvedValue([]);
    mockPrisma.user.groupBy.mockResolvedValue([]);
    mockPrisma.committee.findFirst.mockResolvedValue({ id: 'committee-1' });
    mockPrisma.committeeMember.findMany.mockResolvedValue([]);
    mockPrisma.committeeMember.groupBy.mockResolvedValue([]);
    mockPrisma.lookupValue.findMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [TaskAssignmentService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(TaskAssignmentService);
  });

  // ── the gate ─────────────────────────────────────────────────────────────
  describe('who may use the picker', () => {
    it('lets a tasks:create holder in without reading any task', async () => {
      await service.listUnits(assigner, ORG_A);
      expect(mockPrisma.task.findFirst).not.toHaveBeenCalled();
    });

    // ACC-101 clause (a): no record is named, so the refusal names the
    // permission and costs no query.
    it('refuses anyone else with no task named — 403 naming tasks:create, before any read', async () => {
      const error = await captureError(service.listUnits(creator, ORG_A));

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).message).toBe('Required permission: tasks:create');
      expect(mockPrisma.task.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.orgUnit.findMany).not.toHaveBeenCalled();
    });

    it("lets a task's creator in for that task, without tasks:create or users:view", async () => {
      await expect(service.listUnits(creator, ORG_A, 'task-1')).resolves.toEqual([]);
      expect(mockPrisma.task.findFirst).toHaveBeenCalledWith({
        where: { id: 'task-1', organizationId: ORG_A },
        select: { createdById: true },
      });
    });

    it('lets a tasks:reassign holder in for any task', async () => {
      await expect(service.listUnits(reassigner, ORG_A, 'task-1')).resolves.toEqual([]);
    });

    // ACC-101 clause (b): the entitlement is only knowable from the row, so a
    // caller who may not reassign it gets the not-found answer, identical for a
    // real task and an invented one.
    it('gives anyone else the identical 404 — for a real task and a missing one', async () => {
      const real = await captureError(service.listUnits(bystander, ORG_A, 'task-1'));
      mockPrisma.task.findFirst.mockResolvedValue(null);
      const missing = await captureError(service.listUnits(bystander, ORG_A, 'task-404'));

      expect(real).toBeInstanceOf(NotFoundException);
      expect((real as NotFoundException).getResponse()).toEqual((missing as NotFoundException).getResponse());
      expect(mockPrisma.orgUnit.findMany).not.toHaveBeenCalled();
    });

    it.each([
      ['listUnits', () => service.listUnits(creator, ORG_A)],
      ['listPositions', () => service.listPositions(creator, ORG_A, 'unit-1')],
      ['listHolders', () => service.listHolders(creator, ORG_A, 'unit-1', 'pos-1')],
      ['listCommitteeRoles', () => service.listCommitteeRoles(creator, ORG_A, 'committee-1')],
      ['listCommitteeMembers', () => service.listCommitteeMembers(creator, ORG_A, 'committee-1', 'role-1')],
    ])('%s applies the gate', async (_name, call) => {
      await expect(call()).rejects.toThrow(ForbiddenException);
    });

    // The committee variants name a committee and list its members.
    it.each([
      ['listCommitteeRoles', () => service.listCommitteeRoles({ id: 'x', permissions: ['tasks:create'] }, ORG_A, 'committee-1')],
      [
        'listCommitteeMembers',
        () => service.listCommitteeMembers({ id: 'x', permissions: ['tasks:create'] }, ORG_A, 'committee-1', 'role-1'),
      ],
    ])('%s also needs committees:view — 403 naming it, before anything is read', async (_name, call) => {
      const error = await captureError(call());

      expect((error as ForbiddenException).message).toBe('Required permission: committees:view');
      expect(mockPrisma.committee.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.committeeMember.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.committeeMember.groupBy).not.toHaveBeenCalled();
    });
  });

  // ── what it returns ──────────────────────────────────────────────────────
  describe('what the picker returns', () => {
    it('lists active units with only id, parent and names', async () => {
      await service.listUnits(assigner, ORG_A);

      expect(mockPrisma.orgUnit.findMany).toHaveBeenCalledWith({
        where: { organizationId: ORG_A, isActive: true },
        select: { id: true, parentId: true, nameEn: true, nameAr: true },
        orderBy: { nameEn: 'asc' },
      });
    });

    it("lists the active catalogue with each position's holder count IN THAT UNIT — zero included", async () => {
      mockPrisma.orgPosition.findMany.mockResolvedValue([
        { id: 'pos-qo', nameEn: 'Quality Officer', nameAr: null, isSingleAssignee: false },
        { id: 'pos-head', nameEn: 'Head', nameAr: 'رئيس', isSingleAssignee: true },
      ]);
      mockPrisma.user.groupBy.mockResolvedValue([{ positionId: 'pos-qo', _count: { _all: 3 } }]);

      const positions = await service.listPositions(assigner, ORG_A, 'unit-1');

      expect(positions).toEqual([
        { id: 'pos-qo', nameEn: 'Quality Officer', nameAr: null, isSingleAssignee: false, holderCount: 3 },
        { id: 'pos-head', nameEn: 'Head', nameAr: 'رئيس', isSingleAssignee: true, holderCount: 0 },
      ]);
      expect(mockPrisma.user.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: ORG_A, primaryOrgUnitId: 'unit-1', status: 'ACTIVE', positionId: { not: null } },
        }),
      );
    });

    it('404s a unit that is not in the tenant', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(null);
      await expect(service.listPositions(assigner, ORG_A, 'unit-x')).rejects.toThrow('Org unit not found');
    });

    // Note 3 — id, name and position name. No email, no status, nothing else.
    it('returns holders as id, name and position name only — the query selects nothing more', async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 'u1', name: 'Huda', position: { nameEn: 'Quality Officer', nameAr: 'مسؤول الجودة' } },
      ]);

      const holders = await service.listHolders(assigner, ORG_A, 'unit-1', 'pos-qo');

      expect(holders).toEqual([
        { id: 'u1', name: 'Huda', positionNameEn: 'Quality Officer', positionNameAr: 'مسؤول الجودة' },
      ]);
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: { organizationId: ORG_A, positionId: 'pos-qo', primaryOrgUnitId: 'unit-1', status: 'ACTIVE' },
        select: { id: true, name: true, position: { select: { nameEn: true, nameAr: true } } },
        orderBy: { name: 'asc' },
      });
    });

    it('returns committee members in the same shape, selected the same narrow way', async () => {
      mockPrisma.committeeMember.findMany.mockResolvedValue([
        { user: { id: 'u2', name: 'Omar', position: null } },
      ]);

      const members = await service.listCommitteeMembers(assigner, ORG_A, 'committee-1', 'role-sec');

      expect(members).toEqual([{ id: 'u2', name: 'Omar', positionNameEn: null, positionNameAr: null }]);
      const { select } = mockPrisma.committeeMember.findMany.mock.calls[0][0] as { select: unknown };
      expect(select).toEqual({
        user: { select: { id: true, name: true, position: { select: { nameEn: true, nameAr: true } } } },
      });
    });

    it("lists only the roles the committee's active members hold, with the tenant's label overrides", async () => {
      mockPrisma.committeeMember.groupBy.mockResolvedValue([{ roleValueId: 'role-sec', _count: { _all: 2 } }]);
      mockPrisma.lookupValue.findMany.mockResolvedValue([
        { id: 'role-sec', labelEn: 'Secretary', labelAr: 'أمين السر', labelOverrideEn: 'Clerk', labelOverrideAr: null, sortOrder: 2 },
      ]);

      const roles = await service.listCommitteeRoles(assigner, ORG_A, 'committee-1');

      expect(roles).toEqual([{ id: 'role-sec', labelEn: 'Clerk', labelAr: 'أمين السر', memberCount: 2 }]);
    });

    it('asks nothing of the lookup table for a committee with no active members', async () => {
      await expect(service.listCommitteeRoles(assigner, ORG_A, 'committee-1')).resolves.toEqual([]);
      expect(mockPrisma.lookupValue.findMany).not.toHaveBeenCalled();
    });
  });

  // ── tenant isolation, per endpoint ───────────────────────────────────────
  describe('tenant isolation', () => {
    itEnforcesTenantIsolation('listUnits', async () => {
      await service.listUnits(assigner, ORG_B);
      expect(mockPrisma.orgUnit.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: ORG_B, isActive: true } }),
      );
    });

    itEnforcesTenantIsolation('listPositions', async () => {
      await service.listPositions(assigner, ORG_B, 'unit-1');
      expect(mockPrisma.orgUnit.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'unit-1', organizationId: ORG_B } }),
      );
      expect(mockPrisma.orgPosition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: ORG_B, isActive: true } }),
      );
      expect(mockPrisma.user.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_B }) }),
      );
    });

    itEnforcesTenantIsolation('listHolders', async () => {
      await service.listHolders(assigner, ORG_B, 'unit-1', 'pos-1');
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_B }) }),
      );
    });

    itEnforcesTenantIsolation('listCommitteeRoles', async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(null);
      await expect(service.listCommitteeRoles(assigner, ORG_B, 'committee-1')).rejects.toThrow('Committee not found');
      expect(mockPrisma.committee.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'committee-1', organizationId: ORG_B } }),
      );
      expect(mockPrisma.committeeMember.groupBy).not.toHaveBeenCalled();
    });

    itEnforcesTenantIsolation('listCommitteeMembers', async () => {
      await service.listCommitteeMembers(assigner, ORG_B, 'committee-1', 'role-1');
      expect(mockPrisma.committeeMember.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_B }) }),
      );
    });

    // The task-scoped gate: a task in another tenant is not found, so its
    // creator there gets nothing here.
    itEnforcesTenantIsolation('assertMayAssign with a taskId', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(null);
      await expect(service.listUnits(creator, ORG_B, 'task-1')).rejects.toThrow(NotFoundException);
      expect(mockPrisma.task.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'task-1', organizationId: ORG_B } }),
      );
    });
  });
});
