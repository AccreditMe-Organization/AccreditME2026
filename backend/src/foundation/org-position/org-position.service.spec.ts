import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrgPositionService } from './org-position.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { NotificationService } from '../notification/notification.service';
import { OrganizationService } from '../organization/organization.service';

const ORG_A = 'org-a-id';
const ORG_B = 'org-b-id';

const BASE_POSITION = {
  id: 'position-1',
  organizationId: ORG_A,
  nameEn: 'Director',
  nameAr: 'مدير عام',
  grade: 10,
  isSingleAssignee: false,
  isUnitHeadPosition: false,
  roleId: null as string | null,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockPrisma = {
  orgPosition: {
    upsert: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  orgUnit: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  user: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
  },
  role: {
    findFirst: jest.fn(),
  },
  userRole: {
    findMany: jest.fn(),
  },
};

const mockAuditLog = { log: jest.fn() };
const mockOrganizationService = { refreshOrgUnitHeadVacancy: jest.fn() };
const mockNotificationService = { create: jest.fn() };

describe('OrgPositionService', () => {
  let service: OrgPositionService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Safe default for deactivatePosition()'s own holder lookup — tests
    // exercising that lookup specifically override this per-case.
    mockPrisma.user.findMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrgPositionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogService, useValue: mockAuditLog },
        { provide: OrganizationService, useValue: mockOrganizationService },
        { provide: NotificationService, useValue: mockNotificationService },
      ],
    }).compile();

    service = module.get<OrgPositionService>(OrgPositionService);
  });

  describe('seedDefaultPositions', () => {
    it('creates 10 positions for a fresh org', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValue(null);
      mockPrisma.orgPosition.create.mockResolvedValue(BASE_POSITION);

      await service.seedDefaultPositions(ORG_A);

      expect(mockPrisma.orgPosition.create).toHaveBeenCalledTimes(10);
    });

    it('is idempotent — second call produces no duplicates', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValue(null);
      mockPrisma.orgPosition.create.mockResolvedValue(BASE_POSITION);

      await service.seedDefaultPositions(ORG_A);

      mockPrisma.orgPosition.findFirst.mockResolvedValue(BASE_POSITION); // now "exists"
      await service.seedDefaultPositions(ORG_A);

      expect(mockPrisma.orgPosition.create).toHaveBeenCalledTimes(10); // not 20
    });

    it('should NOT seed positions for a different tenant than requested', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValue(null);
      mockPrisma.orgPosition.create.mockResolvedValue(BASE_POSITION);

      await service.seedDefaultPositions(ORG_A);

      for (const call of mockPrisma.orgPosition.create.mock.calls) {
        expect(call[0].data.organizationId).toBe(ORG_A);
        expect(call[0].data.organizationId).not.toBe(ORG_B);
      }
    });
  });

  describe('listPositions', () => {
    // ACC-40 Section 2.1 — OrgPosition is now an org-wide catalog, no more
    // per-OrgUnit scoping/filtering.
    it('lists every position for the tenant', async () => {
      mockPrisma.orgPosition.findMany.mockResolvedValue([BASE_POSITION]);

      await service.listPositions(ORG_A);

      expect(mockPrisma.orgPosition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: ORG_A } }),
      );
    });

    // Renamed from "should NOT return positions from another tenant"
    // (ACC-33 item 1) — the CI tenant-isolation gate filters on the literal
    // string "should NOT return records belonging to a different tenant";
    // the near-miss wording meant this otherwise-correct test was silently
    // excluded from that gate.
    it('should NOT return records belonging to a different tenant', async () => {
      mockPrisma.orgPosition.findMany.mockImplementation(({ where }) =>
        Promise.resolve(
          [BASE_POSITION, { ...BASE_POSITION, id: 'position-2', organizationId: ORG_B }].filter(
            (p) => p.organizationId === where.organizationId,
          ),
        ),
      );

      const result = await service.listPositions(ORG_A);

      expect(result).toHaveLength(1);
      expect(result[0]?.organizationId).toBe(ORG_A);
    });
  });

  describe('getPositionById', () => {
    it('returns the position when found', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValue(BASE_POSITION);

      const result = await service.getPositionById('position-1', ORG_A);

      expect(result).toEqual(BASE_POSITION);
    });

    it('throws NotFoundException for a missing position', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValue(null);

      await expect(service.getPositionById('missing', ORG_A)).rejects.toThrow(NotFoundException);
    });

    // Same near-miss title fix as listPositions() above (ACC-33 item 1).
    it('should NOT return records belonging to a different tenant', async () => {
      mockPrisma.orgPosition.findFirst.mockImplementation(({ where }) =>
        Promise.resolve(where.organizationId === ORG_A ? BASE_POSITION : null),
      );

      await expect(service.getPositionById('position-1', ORG_B)).rejects.toThrow(NotFoundException);
    });
  });

  describe('createPosition', () => {
    it('creates a position scoped to organizationId', async () => {
      mockPrisma.orgPosition.create.mockResolvedValue(BASE_POSITION);

      await service.createPosition({ nameEn: 'Director', grade: 10 }, ORG_A, 'actor-1');

      expect(mockPrisma.orgPosition.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ organizationId: ORG_A }) }),
      );
    });

    it('calls AuditLogService.log() on creation', async () => {
      mockPrisma.orgPosition.create.mockResolvedValue(BASE_POSITION);

      await service.createPosition({ nameEn: 'Director', grade: 10 }, ORG_A, 'actor-1');

      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', objectType: 'OrgPosition' }),
      );
    });

    // ACC-40 Section 2.1
    it('rejects isUnitHeadPosition: true combined with isSingleAssignee: false', async () => {
      await expect(
        service.createPosition(
          { nameEn: 'Department Head', grade: 8, isUnitHeadPosition: true, isSingleAssignee: false },
          ORG_A,
          'actor-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.orgPosition.create).not.toHaveBeenCalled();
    });

    it('allows isUnitHeadPosition: true combined with isSingleAssignee: true', async () => {
      mockPrisma.orgPosition.create.mockResolvedValue({
        ...BASE_POSITION,
        isUnitHeadPosition: true,
        isSingleAssignee: true,
      });

      await expect(
        service.createPosition(
          { nameEn: 'Department Head', grade: 8, isUnitHeadPosition: true, isSingleAssignee: true },
          ORG_A,
          'actor-1',
        ),
      ).resolves.not.toThrow();
    });

    // ACC-40 Section 2.9c
    it('rejects a roleId that does not belong to this tenant', async () => {
      mockPrisma.role.findFirst.mockResolvedValue(null);

      await expect(
        service.createPosition({ nameEn: 'Director', grade: 10, roleId: 'role-x' }, ORG_A, 'actor-1'),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.orgPosition.create).not.toHaveBeenCalled();
    });

    it.each(['PLATFORM_ADMIN', 'TENANT_ADMIN'])('rejects roleId mapped to %s', async (key) => {
      mockPrisma.role.findFirst.mockResolvedValue({ id: 'role-x', key });

      await expect(
        service.createPosition({ nameEn: 'Director', grade: 10, roleId: 'role-x' }, ORG_A, 'actor-1'),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.orgPosition.create).not.toHaveBeenCalled();
    });

    it('allows a roleId mapped to an ordinary, non-excluded role', async () => {
      mockPrisma.role.findFirst.mockResolvedValue({ id: 'role-x', key: 'QUALITY_OFFICER' });
      mockPrisma.orgPosition.create.mockResolvedValue({ ...BASE_POSITION, roleId: 'role-x' });

      await expect(
        service.createPosition({ nameEn: 'Director', grade: 10, roleId: 'role-x' }, ORG_A, 'actor-1'),
      ).resolves.not.toThrow();
    });
  });

  describe('updatePosition', () => {
    it('updates fields present in the dto', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValue(BASE_POSITION);
      mockPrisma.orgPosition.update.mockResolvedValue({ ...BASE_POSITION, grade: 9 });

      const result = await service.updatePosition('position-1', { grade: 9 }, ORG_A, 'actor-1');

      expect(result.grade).toBe(9);
    });

    it('throws NotFoundException for a cross-tenant position', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValue(null);

      await expect(service.updatePosition('position-1', { grade: 9 }, ORG_B, 'actor-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('calls AuditLogService.log() with before/after', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValue(BASE_POSITION);
      mockPrisma.orgPosition.update.mockResolvedValue({ ...BASE_POSITION, grade: 9 });

      await service.updatePosition('position-1', { grade: 9 }, ORG_A, 'actor-1');

      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UPDATE',
          before: BASE_POSITION,
          after: expect.objectContaining({ grade: 9 }),
        }),
      );
    });

    // ACC-40 Section 2.1 — merged-state validation: this update only
    // touches isUnitHeadPosition, but the existing row's isSingleAssignee
    // (false, per BASE_POSITION) is what makes the resulting state invalid.
    it('rejects setting isUnitHeadPosition: true when the existing row has isSingleAssignee: false', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValue(BASE_POSITION); // isSingleAssignee: false

      await expect(
        service.updatePosition('position-1', { isUnitHeadPosition: true }, ORG_A, 'actor-1'),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.orgPosition.update).not.toHaveBeenCalled();
    });

    it('allows setting isUnitHeadPosition: true when the existing row already has isSingleAssignee: true', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValue({ ...BASE_POSITION, isSingleAssignee: true });
      mockPrisma.orgPosition.update.mockResolvedValue({
        ...BASE_POSITION,
        isSingleAssignee: true,
        isUnitHeadPosition: true,
      });

      await expect(
        service.updatePosition('position-1', { isUnitHeadPosition: true }, ORG_A, 'actor-1'),
      ).resolves.not.toThrow();
    });
  });

  describe('deactivatePosition', () => {
    it('sets isActive to false', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValue(BASE_POSITION);
      mockPrisma.orgPosition.update.mockResolvedValue({ ...BASE_POSITION, isActive: false });

      await service.deactivatePosition('position-1', ORG_A, 'actor-1');

      expect(mockPrisma.orgPosition.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isActive: false } }),
      );
    });

    it('is idempotent — no error if already inactive', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValue({ ...BASE_POSITION, isActive: false });

      await service.deactivatePosition('position-1', ORG_A, 'actor-1');

      expect(mockPrisma.orgPosition.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for a cross-tenant position', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValue(null);

      await expect(service.deactivatePosition('position-1', ORG_B, 'actor-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    // ACC-40 Section 2.5.1 — refreshOrgUnitHeadVacancy() wiring. Position
    // deactivation never clears holders' own positionId, so every distinct
    // org unit an ACTIVE holder currently sits in must be refreshed.

    it("refreshes every distinct org unit an ACTIVE holder of this position sits in", async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValue(BASE_POSITION);
      mockPrisma.orgPosition.update.mockResolvedValue({ ...BASE_POSITION, isActive: false });
      mockPrisma.user.findMany.mockResolvedValue([
        { primaryOrgUnitId: 'unit-1' },
        { primaryOrgUnitId: 'unit-2' },
      ]);

      await service.deactivatePosition('position-1', ORG_A, 'actor-1');

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: { organizationId: ORG_A, positionId: 'position-1', status: 'ACTIVE' },
        select: { primaryOrgUnitId: true },
      });
      expect(mockOrganizationService.refreshOrgUnitHeadVacancy).toHaveBeenCalledTimes(2);
      expect(mockOrganizationService.refreshOrgUnitHeadVacancy).toHaveBeenCalledWith('unit-1', ORG_A);
      expect(mockOrganizationService.refreshOrgUnitHeadVacancy).toHaveBeenCalledWith('unit-2', ORG_A);
    });

    it('dedupes when two ACTIVE holders share the same org unit', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValue(BASE_POSITION);
      mockPrisma.orgPosition.update.mockResolvedValue({ ...BASE_POSITION, isActive: false });
      mockPrisma.user.findMany.mockResolvedValue([
        { primaryOrgUnitId: 'unit-1' },
        { primaryOrgUnitId: 'unit-1' },
      ]);

      await service.deactivatePosition('position-1', ORG_A, 'actor-1');

      expect(mockOrganizationService.refreshOrgUnitHeadVacancy).toHaveBeenCalledTimes(1);
      expect(mockOrganizationService.refreshOrgUnitHeadVacancy).toHaveBeenCalledWith('unit-1', ORG_A);
    });

    it('skips holders with no primary org unit and calls nothing when there are no ACTIVE holders', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValue(BASE_POSITION);
      mockPrisma.orgPosition.update.mockResolvedValue({ ...BASE_POSITION, isActive: false });
      mockPrisma.user.findMany.mockResolvedValue([{ primaryOrgUnitId: null }]);

      await service.deactivatePosition('position-1', ORG_A, 'actor-1');

      expect(mockOrganizationService.refreshOrgUnitHeadVacancy).not.toHaveBeenCalled();
    });

    it('does not attempt a vacancy refresh when already inactive (idempotent short-circuit)', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValue({ ...BASE_POSITION, isActive: false });

      await service.deactivatePosition('position-1', ORG_A, 'actor-1');

      expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
      expect(mockOrganizationService.refreshOrgUnitHeadVacancy).not.toHaveBeenCalled();
    });
  });

  // Mirrors RoleService.reactivateRole()'s own test shape (ACC-40).
  describe('reactivatePosition', () => {
    it('sets isActive to true and writes an audit log', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValue({ ...BASE_POSITION, isActive: false });
      mockPrisma.orgPosition.update.mockResolvedValue({ ...BASE_POSITION, isActive: true });

      await service.reactivatePosition('position-1', ORG_A, 'actor-1');

      expect(mockPrisma.orgPosition.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isActive: true } }),
      );
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE', objectType: 'OrgPosition' }),
      );
    });

    it('is idempotent — no error and no write if already active', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValue({ ...BASE_POSITION, isActive: true });

      await service.reactivatePosition('position-1', ORG_A, 'actor-1');

      expect(mockPrisma.orgPosition.update).not.toHaveBeenCalled();
    });

    // ACC-44 — renamed to the exact CI isolation-gate string
    // ("should NOT return records belonging to a different tenant").
    // Same logic as before (a cross-tenant position id resolves to
    // nothing and throws) — this test was always correct, just invisible
    // to CI's --testNamePattern gate under its old name.
    it('should NOT return records belonging to a different tenant', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValue(null);

      await expect(service.reactivatePosition('position-1', ORG_B, 'actor-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('notifyTenantAdminsOfVacantHeadRoleMappings (ACC-40 Section 2.9e)', () => {
    const ADMIN_ROLE = { id: 'role-admin' };

    it('notifies every active TENANT_ADMIN when vacant units exist', async () => {
      mockPrisma.orgUnit.findMany.mockResolvedValue([{ nameEn: 'Cardiology' }]);
      mockPrisma.orgPosition.findMany.mockResolvedValue([]);
      mockPrisma.role.findFirst.mockResolvedValue(ADMIN_ROLE);
      mockPrisma.userRole.findMany.mockResolvedValue([{ userId: 'admin-1' }]);

      await service.notifyTenantAdminsOfVacantHeadRoleMappings(ORG_A);

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'admin-1',
          titleEn: 'Head-authority setup incomplete',
          bodyEn: expect.stringContaining('Cardiology'),
        }),
        ORG_A,
      );
    });

    it('notifies every active TENANT_ADMIN when unmapped head-conferring positions exist', async () => {
      mockPrisma.orgUnit.findMany.mockResolvedValue([]);
      mockPrisma.orgPosition.findMany.mockResolvedValue([{ nameEn: 'Department Manager' }]);
      mockPrisma.role.findFirst.mockResolvedValue(ADMIN_ROLE);
      mockPrisma.userRole.findMany.mockResolvedValue([{ userId: 'admin-1' }]);

      await service.notifyTenantAdminsOfVacantHeadRoleMappings(ORG_A);

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ bodyEn: expect.stringContaining('Department Manager') }),
        ORG_A,
      );
    });

    it('surfaces both signals together in one notification when both exist', async () => {
      mockPrisma.orgUnit.findMany.mockResolvedValue([{ nameEn: 'Cardiology' }]);
      mockPrisma.orgPosition.findMany.mockResolvedValue([{ nameEn: 'Department Manager' }]);
      mockPrisma.role.findFirst.mockResolvedValue(ADMIN_ROLE);
      mockPrisma.userRole.findMany.mockResolvedValue([{ userId: 'admin-1' }]);

      await service.notifyTenantAdminsOfVacantHeadRoleMappings(ORG_A);

      const call = mockNotificationService.create.mock.calls[0][0];
      expect(call.bodyEn).toContain('Cardiology');
      expect(call.bodyEn).toContain('Department Manager');
    });

    it('queries both signals with the correct filters', async () => {
      mockPrisma.orgUnit.findMany.mockResolvedValue([{ nameEn: 'Cardiology' }]);
      mockPrisma.orgPosition.findMany.mockResolvedValue([]);
      mockPrisma.role.findFirst.mockResolvedValue(ADMIN_ROLE);
      mockPrisma.userRole.findMany.mockResolvedValue([]);

      await service.notifyTenantAdminsOfVacantHeadRoleMappings(ORG_A);

      expect(mockPrisma.orgUnit.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: ORG_A, isHeadVacant: true } }),
      );
      expect(mockPrisma.orgPosition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: ORG_A, isUnitHeadPosition: true, roleId: null },
        }),
      );
    });

    it('is a no-op when neither signal has anything to report', async () => {
      mockPrisma.orgUnit.findMany.mockResolvedValue([]);
      mockPrisma.orgPosition.findMany.mockResolvedValue([]);

      await service.notifyTenantAdminsOfVacantHeadRoleMappings(ORG_A);

      expect(mockPrisma.role.findFirst).not.toHaveBeenCalled();
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('is a no-op when the tenant has no TENANT_ADMIN role', async () => {
      mockPrisma.orgUnit.findMany.mockResolvedValue([{ nameEn: 'Cardiology' }]);
      mockPrisma.orgPosition.findMany.mockResolvedValue([]);
      mockPrisma.role.findFirst.mockResolvedValue(null);

      await service.notifyTenantAdminsOfVacantHeadRoleMappings(ORG_A);

      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('should NOT return records belonging to a different tenant', async () => {
      // Simulates real Prisma tenant scoping: each org's own vacant unit
      // is only ever visible through its own organizationId filter.
      mockPrisma.orgUnit.findMany.mockImplementation(({ where }: { where: { organizationId: string } }) =>
        Promise.resolve(
          where.organizationId === ORG_A ? [{ nameEn: 'Org A Unit' }] : [{ nameEn: 'Org B Unit' }],
        ),
      );
      mockPrisma.orgPosition.findMany.mockResolvedValue([]);
      mockPrisma.role.findFirst.mockResolvedValue(ADMIN_ROLE);
      mockPrisma.userRole.findMany.mockResolvedValue([{ userId: 'admin-a' }]);

      await service.notifyTenantAdminsOfVacantHeadRoleMappings(ORG_A);

      const call = mockNotificationService.create.mock.calls[0][0];
      expect(call.bodyEn).toContain('Org A Unit');
      expect(call.bodyEn).not.toContain('Org B Unit');
    });
  });
});
