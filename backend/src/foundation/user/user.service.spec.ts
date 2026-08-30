import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserService } from './user.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { NotificationService } from '../notification/notification.service';
import { RoleService } from '../roles/role.service';
import { TaskService } from '../task/task.service';
import { OrganizationService } from '../organization/organization.service';
import { AuthProvider } from '../../providers/auth/auth.provider';

const ORG_A = 'org-a';
const ORG_B = 'org-b';

describe('UserService', () => {
  let service: UserService;
  let mockPrisma: any;
  let mockAuditLog: { log: jest.Mock };
  let mockNotification: { create: jest.Mock };
  let mockRoleService: {
    getUserRoles: jest.Mock;
    assignRoleToUser: jest.Mock;
    removeRoleFromUser: jest.Mock;
    grantRoleViaHeadAuthority: jest.Mock;
    revokeRoleViaHeadAuthority: jest.Mock;
  };
  let mockAuthProvider: { invalidateUserSessions: jest.Mock; validateToken: jest.Mock };
  let mockTaskService: { reassignAllForUser: jest.Mock };
  let mockOrganizationService: { refreshOrgUnitHeadVacancy: jest.Mock };

  beforeEach(() => {
    mockPrisma = {
      user: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      organization: { findUnique: jest.fn() },
      role: { findFirst: jest.fn().mockResolvedValue(null) },
      userRole: { findMany: jest.fn().mockResolvedValue([]) },
      orgUnit: { count: jest.fn() },
      // ACC-40 Section 2.1/2.2 — default: an ordinary position (matching
      // DEFAULT_POSITIONS' own real seed defaults — isSingleAssignee/
      // isUnitHeadPosition both false), so validatePositionAssignment() is
      // a no-op for every pre-existing test. Tests exercising the new
      // checks override this per-case.
      orgPosition: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'pos-1',
          isSingleAssignee: false,
          isUnitHeadPosition: false,
          // ACC-43 — validatePositionAssignment()'s own isActive check
          // (Section immediately below 2.1/2.2) needs this true by
          // default, same reasoning as the rest of this fixture: a no-op
          // for every pre-existing test unless explicitly overridden.
          isActive: true,
        }),
      },
    };
    mockAuditLog = { log: jest.fn() };
    mockNotification = { create: jest.fn().mockResolvedValue({}) };
    mockRoleService = {
      getUserRoles: jest.fn(),
      assignRoleToUser: jest.fn(),
      removeRoleFromUser: jest.fn(),
      grantRoleViaHeadAuthority: jest.fn().mockResolvedValue(undefined),
      revokeRoleViaHeadAuthority: jest.fn().mockResolvedValue(undefined),
    };
    mockAuthProvider = {
      invalidateUserSessions: jest.fn().mockResolvedValue(undefined),
      validateToken: jest.fn(),
    };
    mockTaskService = {
      reassignAllForUser: jest.fn().mockResolvedValue({ reassignedCount: 0, unassignedCount: 0 }),
    };
    mockOrganizationService = {
      refreshOrgUnitHeadVacancy: jest.fn().mockResolvedValue(undefined),
    };

    service = new UserService(
      mockPrisma as unknown as PrismaService,
      mockAuditLog as unknown as AuditLogService,
      mockNotification as unknown as NotificationService,
      mockRoleService as unknown as RoleService,
      mockTaskService as unknown as TaskService,
      mockOrganizationService as unknown as OrganizationService,
      mockAuthProvider as unknown as AuthProvider,
    );
  });

  describe('listUsers', () => {
    it('scopes the query by organizationId', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      await service.listUsers(ORG_A);
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_A }) }),
      );
    });

    it('should NOT return records belonging to a different tenant', async () => {
      mockPrisma.user.findMany.mockImplementation(({ where }: any) =>
        Promise.resolve(
          [{ id: 'u1', organizationId: ORG_A }, { id: 'u2', organizationId: ORG_B }].filter(
            (u) => u.organizationId === where.organizationId,
          ),
        ),
      );

      const result = await service.listUsers(ORG_A);
      expect(result).toHaveLength(1);
      expect(result[0]?.organizationId).toBe(ORG_A);
    });
  });

  describe('getById', () => {
    it('throws NotFoundException for a nonexistent user id', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      await expect(service.getById('u1', ORG_A)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
        where: { id: 'u1', organizationId: ORG_A },
      });
    });

    it('should NOT return a user belonging to a different tenant', async () => {
      // findFirst is org-scoped in the where clause — a real user that
      // exists, but under ORG_B, correctly resolves to no match when
      // queried under ORG_A.
      mockPrisma.user.findFirst.mockImplementation(({ where }: { where: { id: string; organizationId: string } }) =>
        Promise.resolve(
          [{ id: 'u1', organizationId: ORG_B }].find(
            (u) => u.id === where.id && u.organizationId === where.organizationId,
          ) ?? null,
        ),
      );

      await expect(service.getById('u1', ORG_A)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getByIdForViewer', () => {
    it('allows self-view with zero permissions (ACC-43)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'u1', organizationId: ORG_A });
      const result = await service.getByIdForViewer('u1', ORG_A, 'u1', []);
      expect(result).toEqual({ id: 'u1', organizationId: ORG_A });
    });

    it('rejects viewing another user without users:view', async () => {
      await expect(service.getByIdForViewer('u1', ORG_A, 'u2', [])).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('allows viewing another user with users:view', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'u1', organizationId: ORG_A });
      const result = await service.getByIdForViewer('u1', ORG_A, 'u2', ['users:view']);
      expect(result).toEqual({ id: 'u1', organizationId: ORG_A });
    });
  });

  describe('invite', () => {
    it('creates an INVITED user, sends an email notification, and logs the audit trail', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: ORG_A,
        name: 'Acme',
        maxUsers: 25,
      });
      mockPrisma.user.count.mockResolvedValue(2);
      mockPrisma.user.findFirst.mockResolvedValue(null);
      // ACC-40 Section 2.4 — no active OrgUnit yet, so the conditional
      // primaryOrgUnitId requirement does not apply; explicit stub (rather
      // than relying on an unconfigured jest.fn()) makes this test's
      // dependency on the new query visible.
      mockPrisma.orgUnit.count.mockResolvedValue(0);
      // ACC-40 Section 2.1/2.2 — explicit stub (rather than the global
      // ordinary-position default) makes this test's dependency on
      // validatePositionAssignment() visible.
      mockPrisma.orgPosition.findFirst.mockResolvedValueOnce({
        id: 'pos-1',
        isSingleAssignee: false,
        isUnitHeadPosition: false,
        isActive: true,
      });
      mockPrisma.user.create.mockResolvedValue({
        id: 'new-user',
        organizationId: ORG_A,
        email: 'new@example.com',
        name: 'New User',
        status: 'INVITED',
      });

      const result = await service.invite(
        { email: 'new@example.com', name: 'New User', positionId: 'pos-1' },
        ORG_A,
        'actor-1',
      );

      expect(result.status).toBe('INVITED');
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ organizationId: ORG_A, status: 'INVITED' }),
        }),
      );
      expect(mockNotification.create).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'EMAIL' }),
        ORG_A,
      );
      expect(mockAuditLog.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATE' }));
    });

    it('throws ConflictException when the seat limit has been reached', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: ORG_A, name: 'Acme', maxUsers: 2 });
      mockPrisma.user.count.mockResolvedValue(2);

      await expect(
        service.invite({ email: 'new@example.com', name: 'New User', positionId: 'pos-1' }, ORG_A, 'actor-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when a user with this email already exists in the tenant', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: ORG_A, name: 'Acme', maxUsers: 25 });
      mockPrisma.user.count.mockResolvedValue(1);
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'existing' });

      await expect(
        service.invite({ email: 'dup@example.com', name: 'Dup User', positionId: 'pos-1' }, ORG_A, 'actor-1'),
      ).rejects.toThrow(ConflictException);
    });

    // ACC-43 — validatePositionAssignment()'s isActive check, live-verified
    // as a real gap during ACC-43's Batch 3: a deactivated position was
    // previously still assignable to a brand-new invite, indistinguishable
    // from an active one.
    it('throws ConflictException when the assigned position is deactivated (isActive: false)', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: ORG_A, name: 'Acme', maxUsers: 25 });
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.orgPosition.findFirst.mockResolvedValueOnce({
        id: 'pos-inactive',
        isSingleAssignee: false,
        isUnitHeadPosition: false,
        isActive: false,
      });

      await expect(
        service.invite(
          { email: 'new@example.com', name: 'New User', positionId: 'pos-inactive' },
          ORG_A,
          'actor-1',
        ),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    // ACC-40 Section 2.4 — conditional primaryOrgUnitId requirement.
    describe('primaryOrgUnitId conditional requirement', () => {
      beforeEach(() => {
        mockPrisma.organization.findUnique.mockResolvedValue({ id: ORG_A, name: 'Acme', maxUsers: 25 });
        mockPrisma.user.count.mockResolvedValue(1);
        mockPrisma.user.findFirst.mockResolvedValue(null);
      });

      it('rejects a missing primaryOrgUnitId once the tenant has at least one active OrgUnit', async () => {
        mockPrisma.orgUnit.count.mockResolvedValue(1);

        await expect(
          service.invite({ email: 'new@example.com', name: 'New User', positionId: 'pos-1' }, ORG_A, 'actor-1'),
        ).rejects.toThrow(BadRequestException);
        expect(mockPrisma.user.create).not.toHaveBeenCalled();
      });

      it('allows a missing primaryOrgUnitId when the tenant has zero active OrgUnits (brand-new tenant)', async () => {
        mockPrisma.orgUnit.count.mockResolvedValue(0);
        mockPrisma.orgPosition.findFirst.mockResolvedValueOnce({
          id: 'pos-1',
          isSingleAssignee: false,
          isUnitHeadPosition: false,
          isActive: true,
        });
        mockPrisma.user.create.mockResolvedValue({ id: 'new-user', organizationId: ORG_A, status: 'INVITED' });

        await expect(
          service.invite({ email: 'new@example.com', name: 'New User', positionId: 'pos-1' }, ORG_A, 'actor-1'),
        ).resolves.not.toThrow();
      });

      it('does not even check OrgUnit count when primaryOrgUnitId is supplied', async () => {
        mockPrisma.orgPosition.findFirst.mockResolvedValueOnce({
          id: 'pos-1',
          isSingleAssignee: false,
          isUnitHeadPosition: false,
          isActive: true,
        });
        mockPrisma.user.create.mockResolvedValue({ id: 'new-user', organizationId: ORG_A, status: 'INVITED' });

        await service.invite(
          { email: 'new@example.com', name: 'New User', positionId: 'pos-1', primaryOrgUnitId: 'unit-1' },
          ORG_A,
          'actor-1',
        );

        expect(mockPrisma.orgUnit.count).not.toHaveBeenCalled();
      });
    });

    // ACC-40 Section 2.6.4/2.6.5
    it('grants the mapped role when the assigned position is head-conferring with a roleId — fires regardless of INVITED status', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: ORG_A, name: 'Acme', maxUsers: 25 });
      // Discriminates the seat-limit count (where.status: { in: [...] })
      // from validatePositionAssignment()'s own internal single-assignee/
      // unit-head-uniqueness holder counts (where.status: 'ACTIVE') —
      // both go through the same mockPrisma.user.count mock, and a flat
      // mockResolvedValue(1) here would incorrectly make the position
      // look already-held, throwing ConflictException before this test
      // ever reaches the grant it's trying to prove.
      mockPrisma.user.count.mockImplementation(({ where }: any) =>
        Promise.resolve(typeof where.status === 'object' ? 1 : 0),
      );
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.orgUnit.count.mockResolvedValue(1);
      // First call: validatePositionAssignment()'s own lookup. Second call:
      // syncHeadAuthorityRoleGrant()'s own lookup, same position — both
      // need isUnitHeadPosition/roleId visible, so both are stubbed
      // identically rather than relying on the outer ordinary-position default.
      mockPrisma.orgPosition.findFirst.mockResolvedValue({
        id: 'pos-head', isSingleAssignee: true, isUnitHeadPosition: true, roleId: 'role-head', isActive: true,
      });
      mockPrisma.user.create.mockResolvedValue({
        id: 'new-user', organizationId: ORG_A, status: 'INVITED', positionId: 'pos-head', primaryOrgUnitId: 'unit-1',
      });

      await service.invite(
        { email: 'new@example.com', name: 'New User', positionId: 'pos-head', primaryOrgUnitId: 'unit-1' },
        ORG_A,
        'actor-1',
      );

      expect(mockRoleService.grantRoleViaHeadAuthority).toHaveBeenCalledWith(
        'new-user', 'role-head', 'pos-head', 'unit-1', ORG_A, 'actor-1',
      );
    });

    it('does not attempt a grant when the assigned position confers no role (roleId null)', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: ORG_A, name: 'Acme', maxUsers: 25 });
      mockPrisma.user.count.mockImplementation(({ where }: any) =>
        Promise.resolve(typeof where.status === 'object' ? 1 : 0),
      );
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.orgUnit.count.mockResolvedValue(1);
      mockPrisma.orgPosition.findFirst.mockResolvedValue({
        id: 'pos-head', isSingleAssignee: true, isUnitHeadPosition: true, roleId: null, isActive: true,
      });
      mockPrisma.user.create.mockResolvedValue({
        id: 'new-user', organizationId: ORG_A, status: 'INVITED', positionId: 'pos-head', primaryOrgUnitId: 'unit-1',
      });

      await service.invite(
        { email: 'new@example.com', name: 'New User', positionId: 'pos-head', primaryOrgUnitId: 'unit-1' },
        ORG_A,
        'actor-1',
      );

      expect(mockRoleService.grantRoleViaHeadAuthority).not.toHaveBeenCalled();
    });

    // ACC-43 — refreshOrgUnitHeadVacancy() wiring. Mirrors updateProfile()'s
    // own coverage above: invite() is the other write path that can set
    // primaryOrgUnitId, and was previously missing this call entirely, so a
    // brand-new invite into a Head-vacant unit was never picked up until
    // some unrelated later profile update happened to touch that unit.

    it('refreshes org-unit-head vacancy for the assigned unit when invite() sets primaryOrgUnitId', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: ORG_A, name: 'Acme', maxUsers: 25 });
      mockPrisma.user.count.mockImplementation(({ where }: any) =>
        Promise.resolve(typeof where.status === 'object' ? 1 : 0),
      );
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.orgUnit.count.mockResolvedValue(1);
      mockPrisma.orgPosition.findFirst.mockResolvedValueOnce({
        id: 'pos-1', isSingleAssignee: false, isUnitHeadPosition: false, roleId: null, isActive: true,
      });
      mockPrisma.user.create.mockResolvedValue({
        id: 'new-user', organizationId: ORG_A, status: 'INVITED', positionId: 'pos-1', primaryOrgUnitId: 'unit-1',
      });

      await service.invite(
        { email: 'new@example.com', name: 'New User', positionId: 'pos-1', primaryOrgUnitId: 'unit-1' },
        ORG_A,
        'actor-1',
      );

      expect(mockOrganizationService.refreshOrgUnitHeadVacancy).toHaveBeenCalledTimes(1);
      expect(mockOrganizationService.refreshOrgUnitHeadVacancy).toHaveBeenCalledWith('unit-1', ORG_A);
    });

    it('does not refresh org-unit-head vacancy when invite() sets no primaryOrgUnitId', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: ORG_A, name: 'Acme', maxUsers: 25 });
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.orgUnit.count.mockResolvedValue(0); // brand-new tenant, no active OrgUnit yet
      mockPrisma.orgPosition.findFirst.mockResolvedValueOnce({
        id: 'pos-1', isSingleAssignee: false, isUnitHeadPosition: false, roleId: null, isActive: true,
      });
      mockPrisma.user.create.mockResolvedValue({
        id: 'new-user', organizationId: ORG_A, status: 'INVITED', positionId: 'pos-1', primaryOrgUnitId: null,
      });

      await service.invite(
        { email: 'new@example.com', name: 'New User', positionId: 'pos-1' },
        ORG_A,
        'actor-1',
      );

      expect(mockOrganizationService.refreshOrgUnitHeadVacancy).not.toHaveBeenCalled();
    });
  });

  // ── syncHeadAuthorityRoleGrant (ACC-40 Section 2.6.4/2.6.5) ─────────────────
  //
  // Tested directly (public specifically so OrgUnitHeadService can also
  // call it) — covers the shared helper's own decision logic in isolation,
  // separate from its three call-site integration tests above/below.

  describe('syncHeadAuthorityRoleGrant', () => {
    const HEAD_POSITION = { isUnitHeadPosition: true, roleId: 'role-head' };
    const ORDINARY_POSITION = { isUnitHeadPosition: false, roleId: null };

    it('is a no-op when the (positionId, orgUnitId) pair is unchanged', async () => {
      await service.syncHeadAuthorityRoleGrant('user-1', 'pos-1', 'unit-1', 'pos-1', 'unit-1', ORG_A, 'actor-1');

      expect(mockPrisma.orgPosition.findFirst).not.toHaveBeenCalled();
      expect(mockRoleService.grantRoleViaHeadAuthority).not.toHaveBeenCalled();
      expect(mockRoleService.revokeRoleViaHeadAuthority).not.toHaveBeenCalled();
    });

    it('grants only (no old position) when transitioning from nothing to a head-conferring position', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValue(HEAD_POSITION);

      await service.syncHeadAuthorityRoleGrant('user-1', null, null, 'pos-head', 'unit-1', ORG_A, 'actor-1');

      expect(mockRoleService.revokeRoleViaHeadAuthority).not.toHaveBeenCalled();
      expect(mockRoleService.grantRoleViaHeadAuthority).toHaveBeenCalledWith('user-1', 'role-head', 'pos-head', 'unit-1', ORG_A, 'actor-1');
    });

    it('revokes only (no new position) when transitioning from a head-conferring position to nothing', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValue(HEAD_POSITION);

      await service.syncHeadAuthorityRoleGrant('user-1', 'pos-head', 'unit-1', null, null, ORG_A, 'actor-1');

      expect(mockRoleService.grantRoleViaHeadAuthority).not.toHaveBeenCalled();
      expect(mockRoleService.revokeRoleViaHeadAuthority).toHaveBeenCalledWith('user-1', 'unit-1', 'pos-head', ORG_A, 'actor-1');
    });

    it('revokes the old head-conferring position and grants the new one when both change', async () => {
      mockPrisma.orgPosition.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(where.id === 'pos-old' ? { isUnitHeadPosition: true, roleId: 'role-old' } : { isUnitHeadPosition: true, roleId: 'role-new' }),
      );

      await service.syncHeadAuthorityRoleGrant('user-1', 'pos-old', 'unit-old', 'pos-new', 'unit-new', ORG_A, 'actor-1');

      expect(mockRoleService.revokeRoleViaHeadAuthority).toHaveBeenCalledWith('user-1', 'unit-old', 'pos-old', ORG_A, 'actor-1');
      expect(mockRoleService.grantRoleViaHeadAuthority).toHaveBeenCalledWith('user-1', 'role-new', 'pos-new', 'unit-new', ORG_A, 'actor-1');
    });

    it('does nothing for either side when the position is ordinary (not head-conferring)', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValue(ORDINARY_POSITION);

      await service.syncHeadAuthorityRoleGrant('user-1', 'pos-ordinary', 'unit-1', 'pos-ordinary-2', 'unit-1', ORG_A, 'actor-1');

      expect(mockRoleService.grantRoleViaHeadAuthority).not.toHaveBeenCalled();
      expect(mockRoleService.revokeRoleViaHeadAuthority).not.toHaveBeenCalled();
    });

    it('does not attempt a grant when the new head-conferring position has no roleId mapped', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValue({ isUnitHeadPosition: true, roleId: null });

      await service.syncHeadAuthorityRoleGrant('user-1', null, null, 'pos-head', 'unit-1', ORG_A, 'actor-1');

      expect(mockRoleService.grantRoleViaHeadAuthority).not.toHaveBeenCalled();
    });

    // ACC-40 Section 2.6.4/2.6.5 (revised) — 2.9a's "applies to whoever
    // holds... it" holds without a carve-out. An org-wide position still
    // grants/revokes successfully — only positionId gates whether the
    // attempt happens at all; orgUnitId is passed through as-is (null),
    // and RoleService picks the safe key for that case.
    it('still grants for an org-wide position (orgUnitId: null) — passes orgUnitId through as null, not skipped', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValue(HEAD_POSITION);

      await service.syncHeadAuthorityRoleGrant('user-1', null, null, 'pos-head', null, ORG_A, 'actor-1');

      expect(mockPrisma.orgPosition.findFirst).toHaveBeenCalledWith({
        where: { id: 'pos-head', organizationId: ORG_A },
        select: { isUnitHeadPosition: true, roleId: true },
      });
      expect(mockRoleService.grantRoleViaHeadAuthority).toHaveBeenCalledWith('user-1', 'role-head', 'pos-head', null, ORG_A, 'actor-1');
    });

    it('still revokes for an org-wide position (orgUnitId: null) — the positionId alone is enough to attempt it', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValue(HEAD_POSITION);

      await service.syncHeadAuthorityRoleGrant('user-1', 'pos-head', null, null, null, ORG_A, 'actor-1');

      expect(mockRoleService.revokeRoleViaHeadAuthority).toHaveBeenCalledWith('user-1', null, 'pos-head', ORG_A, 'actor-1');
    });

    it('accepts a null actorId (system-triggered) and threads it through to both grant and revoke', async () => {
      mockPrisma.orgPosition.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(where.id === 'pos-old' ? { isUnitHeadPosition: true, roleId: 'role-old' } : { isUnitHeadPosition: true, roleId: 'role-new' }),
      );

      await service.syncHeadAuthorityRoleGrant('user-1', 'pos-old', 'unit-old', 'pos-new', 'unit-new', ORG_A, null);

      expect(mockRoleService.revokeRoleViaHeadAuthority).toHaveBeenCalledWith('user-1', 'unit-old', 'pos-old', ORG_A, null);
      expect(mockRoleService.grantRoleViaHeadAuthority).toHaveBeenCalledWith('user-1', 'role-new', 'pos-new', 'unit-new', ORG_A, null);
    });

    it('should NOT return records belonging to a different tenant', async () => {
      mockPrisma.orgPosition.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(
          where.organizationId === ORG_A
            ? { isUnitHeadPosition: true, roleId: 'role-a' }
            : { isUnitHeadPosition: true, roleId: 'role-b' },
        ),
      );

      await service.syncHeadAuthorityRoleGrant('user-1', null, null, 'pos-head', 'unit-1', ORG_A, 'actor-1');
      await service.syncHeadAuthorityRoleGrant('user-1', null, null, 'pos-head', 'unit-1', ORG_B, 'actor-1');

      expect(mockPrisma.orgPosition.findFirst).toHaveBeenNthCalledWith(1, {
        where: { id: 'pos-head', organizationId: ORG_A },
        select: { isUnitHeadPosition: true, roleId: true },
      });
      expect(mockPrisma.orgPosition.findFirst).toHaveBeenNthCalledWith(2, {
        where: { id: 'pos-head', organizationId: ORG_B },
        select: { isUnitHeadPosition: true, roleId: true },
      });
      expect(mockRoleService.grantRoleViaHeadAuthority).toHaveBeenNthCalledWith(1, 'user-1', 'role-a', 'pos-head', 'unit-1', ORG_A, 'actor-1');
      expect(mockRoleService.grantRoleViaHeadAuthority).toHaveBeenNthCalledWith(2, 'user-1', 'role-b', 'pos-head', 'unit-1', ORG_B, 'actor-1');
    });
  });

  // ACC-40 Section 2.1 — validatePositionAssignment() is private, tested
  // through its two real callers (invite()/updateProfile()), same
  // convention already used elsewhere in this file (isInSameOrParentOrgUnit
  // via validateEscalationTarget in org-position.service.spec.ts).
  describe('validatePositionAssignment — single-assignee enforcement (ACC-40 Section 2.1)', () => {
    const SINGLE_ASSIGNEE_POSITION = { id: 'pos-head', isSingleAssignee: true, isUnitHeadPosition: false, isActive: true };
    const ORDINARY_POSITION = { id: 'pos-ordinary', isSingleAssignee: false, isUnitHeadPosition: false, isActive: true };

    beforeEach(() => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: ORG_A, name: 'Acme', maxUsers: 25 });
      mockPrisma.user.count.mockResolvedValue(1);
      mockPrisma.user.findFirst.mockResolvedValue(null); // no email conflict
    });

    it('throws ConflictException when the target unit already has an active holder of a single-assignee position', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValueOnce(SINGLE_ASSIGNEE_POSITION);
      mockPrisma.user.count.mockImplementation(({ where }: any) =>
        Promise.resolve(where.positionId === 'pos-head' ? 1 : 1), // existing holder present
      );

      await expect(
        service.invite(
          { email: 'new@example.com', name: 'New User', positionId: 'pos-head', primaryOrgUnitId: 'unit-1' },
          ORG_A,
          'actor-1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('allows assigning a single-assignee position when the target unit has no existing holder', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValueOnce(SINGLE_ASSIGNEE_POSITION);
      mockPrisma.user.count.mockImplementation(({ where }: any) => Promise.resolve(where.positionId ? 0 : 1));
      mockPrisma.user.create.mockResolvedValue({ id: 'new-user', organizationId: ORG_A, status: 'INVITED' });

      await expect(
        service.invite(
          { email: 'new@example.com', name: 'New User', positionId: 'pos-head', primaryOrgUnitId: 'unit-1' },
          ORG_A,
          'actor-1',
        ),
      ).resolves.not.toThrow();
    });

    it('allows the same single-assignee position to be held by different people in different units — scoped per unit, not per position', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValueOnce(SINGLE_ASSIGNEE_POSITION);
      // The existing holder is scoped to 'unit-1'; this invite targets 'unit-2'.
      mockPrisma.user.count.mockImplementation(({ where }: any) =>
        Promise.resolve(where.positionId === 'pos-head' && where.primaryOrgUnitId === 'unit-2' ? 0 : 1),
      );
      mockPrisma.user.create.mockResolvedValue({ id: 'new-user', organizationId: ORG_A, status: 'INVITED' });

      await expect(
        service.invite(
          { email: 'new@example.com', name: 'New User', positionId: 'pos-head', primaryOrgUnitId: 'unit-2' },
          ORG_A,
          'actor-1',
        ),
      ).resolves.not.toThrow();
    });

    it('treats primaryOrgUnitId: null as one more partition — a second org-wide holder of the same single-assignee position is rejected', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValueOnce(SINGLE_ASSIGNEE_POSITION);
      mockPrisma.user.count.mockResolvedValue(1); // an org-wide (primaryOrgUnitId: null) holder already exists

      await expect(
        service.invite({ email: 'new@example.com', name: 'New User', positionId: 'pos-head' }, ORG_A, 'actor-1'),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.user.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ positionId: 'pos-head', primaryOrgUnitId: null }),
        }),
      );
    });

    it('should NOT return records belonging to a different tenant', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValueOnce(SINGLE_ASSIGNEE_POSITION);
      // A holder of the same positionId exists, but under ORG_B — the
      // holder-count query's own organizationId scoping must exclude it.
      mockPrisma.user.count.mockImplementation(({ where }: any) =>
        Promise.resolve(where.positionId === 'pos-head' && where.organizationId === ORG_A ? 0 : 1),
      );
      mockPrisma.user.create.mockResolvedValue({ id: 'new-user', organizationId: ORG_A, status: 'INVITED' });

      await expect(
        service.invite(
          { email: 'new@example.com', name: 'New User', positionId: 'pos-head', primaryOrgUnitId: 'unit-1' },
          ORG_A,
          'actor-1',
        ),
      ).resolves.not.toThrow();
      expect(mockPrisma.user.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_A }) }),
      );
    });

    it('should NOT return records belonging to a different tenant', async () => {
      // validatePositionAssignment()'s own orgPosition.findFirst() lookup —
      // a positionId that exists, but only under ORG_B, must not resolve
      // when the assignment is being made under ORG_A. Same literal gate
      // string as every other isolation test in this file, deliberately —
      // ACC-33 found several near-miss-worded tests CI's tenant-isolation
      // job silently never ran because the wording didn't match exactly.
      mockPrisma.orgPosition.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(where.organizationId === ORG_A ? null : SINGLE_ASSIGNEE_POSITION),
      );

      await expect(
        service.invite(
          { email: 'new@example.com', name: 'New User', positionId: 'pos-head', primaryOrgUnitId: 'unit-1' },
          ORG_A,
          'actor-1',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    // ACC-40 Section 2.1's own "excludeUserId, not isNoOpReassignment"
    // correctness: a user re-saving their own already-held single-assignee
    // position (e.g. an unrelated profile edit that resubmits the same
    // value) must not be blocked by their own existing row.
    it('allows a no-op re-save of the same single-assignee position by its current holder', async () => {
      const existingHolder = { id: 'user-1', organizationId: ORG_A, primaryOrgUnitId: 'unit-1' };
      mockPrisma.user.findFirst.mockResolvedValue(existingHolder); // getById() inside updateProfile()
      mockPrisma.orgPosition.findFirst.mockResolvedValueOnce(SINGLE_ASSIGNEE_POSITION);
      mockPrisma.user.count.mockImplementation(({ where }: any) =>
        Promise.resolve(where.id?.not === 'user-1' ? 0 : 1),
      );
      mockPrisma.user.update.mockResolvedValue(existingHolder);

      await expect(
        service.updateProfile('user-1', { positionId: 'pos-head' }, ORG_A, 'admin-1', ['users:manage']),
      ).resolves.not.toThrow();
      expect(mockPrisma.user.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: { not: 'user-1' } }) }),
      );
    });

    it('rejects moving a DIFFERENT user into a single-assignee position someone else already holds in that unit', async () => {
      const targetUser = { id: 'user-2', organizationId: ORG_A, primaryOrgUnitId: 'unit-1' };
      mockPrisma.user.findFirst.mockResolvedValue(targetUser);
      mockPrisma.orgPosition.findFirst.mockResolvedValueOnce(SINGLE_ASSIGNEE_POSITION);
      // Excludes user-2 (the target), but user-1 (a different existing
      // holder) still counts.
      mockPrisma.user.count.mockImplementation(({ where }: any) =>
        Promise.resolve(where.id?.not === 'user-2' ? 1 : 0),
      );

      await expect(
        service.updateProfile('user-2', { positionId: 'pos-head' }, ORG_A, 'admin-1', ['users:manage']),
      ).rejects.toThrow(ConflictException);
    });

    // The user's own explicit ask: confirm ORDINARY, non-single-assignee
    // position assignment is completely unaffected by this new check —
    // not just that head-specific checks fire correctly when they should.
    describe('regression — ordinary (non-single-assignee) position assignment is unaffected', () => {
      it('allows an ordinary position to be freely assigned with no existing holder', async () => {
        mockPrisma.orgPosition.findFirst.mockResolvedValueOnce(ORDINARY_POSITION);
        mockPrisma.user.create.mockResolvedValue({ id: 'new-user', organizationId: ORG_A, status: 'INVITED' });

        await expect(
          service.invite(
            { email: 'new@example.com', name: 'New User', positionId: 'pos-ordinary', primaryOrgUnitId: 'unit-1' },
            ORG_A,
            'actor-1',
          ),
        ).resolves.not.toThrow();
        // The single-assignee cap short-circuits before ever counting —
        // an ordinary position's holder count is irrelevant and never
        // queried.
        expect(mockPrisma.user.count).toHaveBeenCalledTimes(1); // only the seat-limit count
      });

      it('allows an ordinary position to already have multiple active holders in the same unit', async () => {
        mockPrisma.orgPosition.findFirst.mockResolvedValueOnce(ORDINARY_POSITION);
        // Even if 5 people already hold this position in this unit, an
        // ordinary (non-single-assignee) position is never checked.
        mockPrisma.user.create.mockResolvedValue({ id: 'new-user', organizationId: ORG_A, status: 'INVITED' });

        await expect(
          service.invite(
            { email: 'new@example.com', name: 'New User', positionId: 'pos-ordinary', primaryOrgUnitId: 'unit-1' },
            ORG_A,
            'actor-1',
          ),
        ).resolves.not.toThrow();
      });

      it('allows an admin to reassign a user to a completely unrelated ordinary position in a completely unrelated unit', async () => {
        const existing = { id: 'user-3', organizationId: ORG_A, primaryOrgUnitId: 'unit-old' };
        mockPrisma.user.findFirst.mockResolvedValue(existing);
        mockPrisma.orgPosition.findFirst.mockResolvedValueOnce(ORDINARY_POSITION);
        mockPrisma.user.update.mockResolvedValue({ ...existing, positionId: 'pos-ordinary', primaryOrgUnitId: 'unit-new' });

        await expect(
          service.updateProfile(
            'user-3',
            { positionId: 'pos-ordinary', primaryOrgUnitId: 'unit-new' },
            ORG_A,
            'admin-1',
            ['users:manage'],
          ),
        ).resolves.not.toThrow();
        expect(mockPrisma.user.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ positionId: 'pos-ordinary', primaryOrgUnitId: 'unit-new' }),
          }),
        );
      });

      it('does not run validatePositionAssignment at all when updateProfile() does not touch positionId', async () => {
        const existing = { id: 'user-4', organizationId: ORG_A, primaryOrgUnitId: 'unit-1' };
        mockPrisma.user.findFirst.mockResolvedValue(existing);
        mockPrisma.user.update.mockResolvedValue({ ...existing, name: 'Renamed' });

        await service.updateProfile('user-4', { name: 'Renamed' }, ORG_A, 'admin-1', ['users:manage']);

        expect(mockPrisma.orgPosition.findFirst).not.toHaveBeenCalled();
      });
    });
  });

  // ACC-40 Section 2.2 — kept as its own describe block, matching the
  // plan's own "both checks run, kept separate" reasoning: this catches a
  // real gap validateSingleAssigneeCap() alone cannot — two DIFFERENT
  // head-conferring positions, each individually single-assignee-capped,
  // both held in the same unit at once.
  describe('validatePositionAssignment — cross-position head-uniqueness (ACC-40 Section 2.2)', () => {
    const HEAD_POSITION_A = { id: 'pos-head-a', isSingleAssignee: true, isUnitHeadPosition: true, isActive: true };
    const HEAD_POSITION_B = { id: 'pos-head-b', isSingleAssignee: true, isUnitHeadPosition: true, isActive: true };

    beforeEach(() => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: ORG_A, name: 'Acme', maxUsers: 25 });
      mockPrisma.user.count.mockResolvedValue(1);
      mockPrisma.user.findFirst.mockResolvedValue(null);
    });

    it('rejects assigning a head-conferring position when a DIFFERENT head-conferring position is already held in that unit', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValueOnce(HEAD_POSITION_B);
      // pos-head-b itself has no holders (validateSingleAssigneeCap would
      // pass) — but someone holds pos-head-a (a different position) in the
      // same unit, and that's what this cross-position check must catch.
      mockPrisma.user.count.mockImplementation(({ where }: any) => {
        if (where.positionId === 'pos-head-b') return Promise.resolve(0);
        if (where.position?.isUnitHeadPosition) return Promise.resolve(1); // pos-head-a's holder
        return Promise.resolve(1); // seat-limit count
      });

      await expect(
        service.invite(
          { email: 'new@example.com', name: 'New User', positionId: 'pos-head-b', primaryOrgUnitId: 'unit-1' },
          ORG_A,
          'actor-1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('allows assigning a head-conferring position when no head-conferring position is held anywhere in that unit', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValueOnce(HEAD_POSITION_A);
      mockPrisma.user.count.mockImplementation(({ where }: any) =>
        Promise.resolve(where.positionId || where.position?.isUnitHeadPosition ? 0 : 1),
      );
      mockPrisma.user.create.mockResolvedValue({ id: 'new-user', organizationId: ORG_A, status: 'INVITED' });

      await expect(
        service.invite(
          { email: 'new@example.com', name: 'New User', positionId: 'pos-head-a', primaryOrgUnitId: 'unit-1' },
          ORG_A,
          'actor-1',
        ),
      ).resolves.not.toThrow();
    });

    it('should NOT return records belonging to a different tenant', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValueOnce(HEAD_POSITION_A);
      // A head-position holder exists in the same-named unit, but under
      // ORG_B — validateUnitHeadUniqueness()'s own count query must not
      // see it when the assignment is being made under ORG_A. Every count
      // query genuinely scoped to ORG_A (both the single-assignee cap and
      // the head-uniqueness check) resolves to zero holders; only a
      // hypothetical ORG_B-scoped query would see the ORG_B holder.
      mockPrisma.user.count.mockImplementation(({ where }: any) =>
        Promise.resolve(where.organizationId === ORG_A ? 0 : 1),
      );
      mockPrisma.user.create.mockResolvedValue({ id: 'new-user', organizationId: ORG_A, status: 'INVITED' });

      await expect(
        service.invite(
          { email: 'new@example.com', name: 'New User', positionId: 'pos-head-a', primaryOrgUnitId: 'unit-1' },
          ORG_A,
          'actor-1',
        ),
      ).resolves.not.toThrow();
      expect(mockPrisma.user.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: ORG_A, position: { isUnitHeadPosition: true } }),
        }),
      );
    });

    it('allows a no-op re-save of the same head position by its current holder — excludeUserId applies to both checks', async () => {
      const existingHolder = { id: 'user-1', organizationId: ORG_A, primaryOrgUnitId: 'unit-1' };
      mockPrisma.user.findFirst.mockResolvedValue(existingHolder);
      mockPrisma.orgPosition.findFirst.mockResolvedValueOnce(HEAD_POSITION_A);
      mockPrisma.user.count.mockImplementation(({ where }: any) =>
        Promise.resolve(where.id?.not === 'user-1' ? 0 : 1),
      );
      mockPrisma.user.update.mockResolvedValue(existingHolder);

      await expect(
        service.updateProfile('user-1', { positionId: 'pos-head-a' }, ORG_A, 'admin-1', ['users:manage']),
      ).resolves.not.toThrow();
    });

    // Regression, specific to this second check: a non-head position must
    // never even reach validateUnitHeadUniqueness()'s own count query,
    // regardless of how many head-position holders exist elsewhere in the
    // same unit.
    it('regression — an ordinary, non-head position is never checked against unit-head holders', async () => {
      const ORDINARY_POSITION = { id: 'pos-ordinary', isSingleAssignee: false, isUnitHeadPosition: false, isActive: true };
      mockPrisma.orgPosition.findFirst.mockResolvedValueOnce(ORDINARY_POSITION);
      mockPrisma.user.create.mockResolvedValue({ id: 'new-user', organizationId: ORG_A, status: 'INVITED' });

      await expect(
        service.invite(
          { email: 'new@example.com', name: 'New User', positionId: 'pos-ordinary', primaryOrgUnitId: 'unit-1' },
          ORG_A,
          'actor-1',
        ),
      ).resolves.not.toThrow();
      // Only the seat-limit count — neither validateSingleAssigneeCap() nor
      // validateUnitHeadUniqueness() ever queries for an ordinary position.
      expect(mockPrisma.user.count).toHaveBeenCalledTimes(1);
    });
  });

  // ACC-40 Section 2.3, Non-Goals — the bypass restriction confirmed to
  // actually hold in code, not just documented. invite()/updateProfile()
  // below never pass a 5th argument to validatePositionAssignment() at
  // all — there is no code path by which either could set
  // isDeclaredHandoverBypass to true, structurally, regardless of what a
  // caller puts in the request body. These tests prove that concretely:
  // even a dto object carrying an extraneous isDeclaredHandoverBypass:
  // true property (simulating a caller attempting to smuggle it through
  // the request body) has zero effect, because neither UpdateUserProfileDto
  // nor InviteUserDto has such a field, and updateProfile()/invite() never
  // read one off the dto to forward it.
  describe('isDeclaredHandoverBypass — unreachable from the ordinary updateProfile()/invite() path (ACC-40 Section 2.3 Non-Goals)', () => {
    const HEAD_POSITION = { id: 'pos-head', isSingleAssignee: true, isUnitHeadPosition: true, isActive: true };

    beforeEach(() => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: ORG_A, name: 'Acme', maxUsers: 25 });
      mockPrisma.user.count.mockResolvedValue(1); // an existing holder is present — would block without a bypass
    });

    it('updateProfile() still rejects a conflicting single-assignee/head position even when the dto smuggles isDeclaredHandoverBypass: true', async () => {
      const targetUser = { id: 'user-2', organizationId: ORG_A, primaryOrgUnitId: 'unit-1' };
      mockPrisma.user.findFirst.mockResolvedValue(targetUser);
      mockPrisma.orgPosition.findFirst.mockResolvedValueOnce(HEAD_POSITION);
      mockPrisma.user.count.mockImplementation(({ where }: any) =>
        Promise.resolve(where.id?.not === 'user-2' ? 1 : 0),
      );

      const dtoWithSmuggledBypass = {
        positionId: 'pos-head',
        isDeclaredHandoverBypass: true,
      } as unknown as Parameters<typeof service.updateProfile>[1];

      await expect(
        service.updateProfile('user-2', dtoWithSmuggledBypass, ORG_A, 'admin-1', ['users:manage']),
      ).rejects.toThrow(ConflictException);
    });

    it('invite() still rejects a conflicting single-assignee/head position even when the dto smuggles isDeclaredHandoverBypass: true', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null); // no email conflict
      mockPrisma.orgPosition.findFirst.mockResolvedValueOnce(HEAD_POSITION);

      const dtoWithSmuggledBypass = {
        email: 'new@example.com',
        name: 'New User',
        positionId: 'pos-head',
        primaryOrgUnitId: 'unit-1',
        isDeclaredHandoverBypass: true,
      } as unknown as Parameters<typeof service.invite>[0];

      await expect(service.invite(dtoWithSmuggledBypass, ORG_A, 'actor-1')).rejects.toThrow(ConflictException);
    });
  });

  // ACC-40 Section 2.4 — remediation report, not a data migration.
  describe('notifyTenantAdminsOfIncompleteProfiles', () => {
    it('does nothing when no active user is missing a position or org unit', async () => {
      mockPrisma.orgUnit.count.mockResolvedValue(1);
      mockPrisma.user.findMany.mockResolvedValue([]);

      await service.notifyTenantAdminsOfIncompleteProfiles(ORG_A);

      expect(mockPrisma.role.findFirst).not.toHaveBeenCalled();
      expect(mockNotification.create).not.toHaveBeenCalled();
    });

    it('notifies every active TENANT_ADMIN with the incomplete-profile count', async () => {
      mockPrisma.orgUnit.count.mockResolvedValue(1);
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
      mockPrisma.role.findFirst.mockResolvedValue({ id: 'role-admin' });
      mockPrisma.userRole.findMany.mockResolvedValue([{ userId: 'admin-1' }, { userId: 'admin-2' }]);

      await service.notifyTenantAdminsOfIncompleteProfiles(ORG_A);

      expect(mockPrisma.role.findFirst).toHaveBeenCalledWith({
        where: { organizationId: ORG_A, key: 'TENANT_ADMIN' },
      });
      expect(mockNotification.create).toHaveBeenCalledTimes(2);
      expect(mockNotification.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'admin-1', titleEn: expect.stringContaining('2') }),
        ORG_A,
      );
      expect(mockNotification.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'admin-2', titleEn: expect.stringContaining('2') }),
        ORG_A,
      );
    });

    it('does not query primaryOrgUnitId completeness when the tenant has zero active OrgUnits', async () => {
      mockPrisma.orgUnit.count.mockResolvedValue(0);
      mockPrisma.user.findMany.mockResolvedValue([]);

      await service.notifyTenantAdminsOfIncompleteProfiles(ORG_A);

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ OR: [{ positionId: null }] }),
        }),
      );
    });

    it('does nothing when no TENANT_ADMIN role exists for the tenant', async () => {
      mockPrisma.orgUnit.count.mockResolvedValue(1);
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'u1' }]);
      mockPrisma.role.findFirst.mockResolvedValue(null);

      await service.notifyTenantAdminsOfIncompleteProfiles(ORG_A);

      expect(mockPrisma.userRole.findMany).not.toHaveBeenCalled();
      expect(mockNotification.create).not.toHaveBeenCalled();
    });

    it('should NOT return records belonging to a different tenant', async () => {
      mockPrisma.orgUnit.count.mockImplementation(({ where }: any) =>
        Promise.resolve(where.organizationId === ORG_A ? 1 : 5),
      );
      mockPrisma.user.findMany.mockImplementation(({ where }: any) =>
        Promise.resolve(where.organizationId === ORG_A ? [] : [{ id: 'leaked' }]),
      );
      mockPrisma.role.findFirst.mockResolvedValue(null);

      await service.notifyTenantAdminsOfIncompleteProfiles(ORG_A);

      expect(mockPrisma.orgUnit.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_A }) }),
      );
      expect(mockNotification.create).not.toHaveBeenCalled();
    });
  });

  describe('updateProfile', () => {
    const EXISTING = { id: 'user-1', organizationId: ORG_A, name: 'Old Name' };

    it('allows a user to update their own name and language', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(EXISTING);
      mockPrisma.user.update.mockResolvedValue({ ...EXISTING, name: 'New Name' });

      await service.updateProfile(
        'user-1',
        { name: 'New Name', language: 'ar' },
        ORG_A,
        'user-1',
        [],
      );

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { name: 'New Name', language: 'ar' },
      });
    });

    it('strips admin-only fields when a non-admin edits their own profile', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(EXISTING);
      mockPrisma.user.update.mockResolvedValue(EXISTING);

      await service.updateProfile(
        'user-1',
        { name: 'New Name', positionId: 'pos-1', managerId: 'mgr-1' },
        ORG_A,
        'user-1',
        [],
      );

      const call = mockPrisma.user.update.mock.calls[0][0];
      expect(call.data).not.toHaveProperty('positionId');
      expect(call.data).not.toHaveProperty('managerId');
    });

    it('allows an admin to set positionId/primaryOrgUnitId/managerId on another user', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(EXISTING);
      mockPrisma.user.update.mockResolvedValue(EXISTING);
      // ACC-40 Section 2.1/2.2 — explicit stub for this test's dependency
      // on validatePositionAssignment().
      mockPrisma.orgPosition.findFirst.mockResolvedValueOnce({
        id: 'pos-1',
        isSingleAssignee: false,
        isUnitHeadPosition: false,
        isActive: true,
      });

      await service.updateProfile(
        'user-1',
        { positionId: 'pos-1', managerId: 'mgr-1' },
        ORG_A,
        'admin-1',
        ['users:manage'],
      );

      const call = mockPrisma.user.update.mock.calls[0][0];
      expect(call.data.positionId).toBe('pos-1');
      expect(call.data.managerId).toBe('mgr-1');
    });

    // ACC-43 — same isActive gap as invite()'s own regression test above,
    // proven on updateProfile()'s call site too: an admin reassigning an
    // EXISTING user to a deactivated position must be blocked identically,
    // not just a brand-new invite.
    it('throws ConflictException when an admin assigns an existing user to a deactivated position', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(EXISTING);
      mockPrisma.orgPosition.findFirst.mockResolvedValueOnce({
        id: 'pos-inactive',
        isSingleAssignee: false,
        isUnitHeadPosition: false,
        isActive: false,
      });

      await expect(
        service.updateProfile('user-1', { positionId: 'pos-inactive' }, ORG_A, 'admin-1', ['users:manage']),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    // ACC-40 Section 2.7
    it('allows an admin to set actingOrgUnitId/actingOrgUnitUntil on another user', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(EXISTING);
      mockPrisma.user.update.mockResolvedValue(EXISTING);

      await service.updateProfile(
        'user-1',
        { actingOrgUnitId: 'unit-x', actingOrgUnitUntil: '2026-12-31T00:00:00.000Z' },
        ORG_A,
        'admin-1',
        ['users:manage'],
      );

      const call = mockPrisma.user.update.mock.calls[0][0];
      expect(call.data.actingOrgUnitId).toBe('unit-x');
      expect(call.data.actingOrgUnitUntil).toEqual(new Date('2026-12-31T00:00:00.000Z'));
    });

    it('strips actingOrgUnitId/actingOrgUnitUntil when a non-admin edits their own profile', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(EXISTING);
      mockPrisma.user.update.mockResolvedValue(EXISTING);

      await service.updateProfile(
        'user-1',
        { actingOrgUnitId: 'unit-x', actingOrgUnitUntil: '2026-12-31T00:00:00.000Z' },
        ORG_A,
        'user-1',
        [],
      );

      const call = mockPrisma.user.update.mock.calls[0][0];
      expect(call.data).not.toHaveProperty('actingOrgUnitId');
      expect(call.data).not.toHaveProperty('actingOrgUnitUntil');
    });

    it('throws ForbiddenException when a non-self, non-admin actor attempts the update', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(EXISTING);

      await expect(
        service.updateProfile('user-1', { name: 'Hacked' }, ORG_A, 'other-user', []),
      ).rejects.toThrow(ForbiddenException);
    });

    // ACC-40 Section 2.5.1 — refreshOrgUnitHeadVacancy() wiring.

    it('refreshes both the old and new org unit when an admin moves the user to a different unit', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ ...EXISTING, primaryOrgUnitId: 'unit-old' });
      mockPrisma.user.update.mockResolvedValue({ ...EXISTING, primaryOrgUnitId: 'unit-new' });

      await service.updateProfile(
        'user-1',
        { positionId: 'pos-1', primaryOrgUnitId: 'unit-new' },
        ORG_A,
        'admin-1',
        ['users:manage'],
      );

      expect(mockOrganizationService.refreshOrgUnitHeadVacancy).toHaveBeenCalledTimes(2);
      expect(mockOrganizationService.refreshOrgUnitHeadVacancy).toHaveBeenCalledWith('unit-old', ORG_A);
      expect(mockOrganizationService.refreshOrgUnitHeadVacancy).toHaveBeenCalledWith('unit-new', ORG_A);
    });

    it('refreshes the unit only once when positionId changes but the org unit stays the same', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ ...EXISTING, primaryOrgUnitId: 'unit-1' });
      mockPrisma.user.update.mockResolvedValue({ ...EXISTING, primaryOrgUnitId: 'unit-1' });

      await service.updateProfile(
        'user-1',
        { positionId: 'pos-2' },
        ORG_A,
        'admin-1',
        ['users:manage'],
      );

      expect(mockOrganizationService.refreshOrgUnitHeadVacancy).toHaveBeenCalledTimes(1);
      expect(mockOrganizationService.refreshOrgUnitHeadVacancy).toHaveBeenCalledWith('unit-1', ORG_A);
    });

    it('does not refresh vacancy when neither positionId nor primaryOrgUnitId is in the update', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ ...EXISTING, primaryOrgUnitId: 'unit-1' });
      mockPrisma.user.update.mockResolvedValue({ ...EXISTING, primaryOrgUnitId: 'unit-1' });

      await service.updateProfile('user-1', { name: 'New Name' }, ORG_A, 'admin-1', ['users:manage']);

      expect(mockOrganizationService.refreshOrgUnitHeadVacancy).not.toHaveBeenCalled();
    });

    it('does not refresh vacancy when a non-admin edits their own profile, even if positionId is present in the raw dto', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ ...EXISTING, primaryOrgUnitId: 'unit-1' });
      mockPrisma.user.update.mockResolvedValue({ ...EXISTING, primaryOrgUnitId: 'unit-1' });

      await service.updateProfile(
        'user-1',
        { name: 'New Name', positionId: 'pos-1' },
        ORG_A,
        'user-1',
        [],
      );

      expect(mockOrganizationService.refreshOrgUnitHeadVacancy).not.toHaveBeenCalled();
    });

    // ACC-40 Section 2.6.4/2.6.5 — syncHeadAuthorityRoleGrant() wiring.

    it('grants the mapped role when an admin assigns a user into a head-conferring position', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ ...EXISTING, positionId: null, primaryOrgUnitId: 'unit-1' });
      mockPrisma.user.update.mockResolvedValue({ ...EXISTING, positionId: 'pos-head', primaryOrgUnitId: 'unit-1' });
      mockPrisma.orgPosition.findFirst.mockResolvedValue({
        id: 'pos-head', isSingleAssignee: true, isUnitHeadPosition: true, roleId: 'role-head', isActive: true,
      });

      await service.updateProfile('user-1', { positionId: 'pos-head' }, ORG_A, 'admin-1', ['users:manage']);

      expect(mockRoleService.grantRoleViaHeadAuthority).toHaveBeenCalledWith('user-1', 'role-head', 'pos-head', 'unit-1', ORG_A, 'admin-1');
    });

    it('revokes the mapped role when an admin moves a user out of a head-conferring position', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ ...EXISTING, positionId: 'pos-head', primaryOrgUnitId: 'unit-1' });
      mockPrisma.user.update.mockResolvedValue({ ...EXISTING, positionId: 'pos-ordinary', primaryOrgUnitId: 'unit-1' });
      mockPrisma.orgPosition.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(
          where.id === 'pos-head'
            ? { isUnitHeadPosition: true, roleId: 'role-head', isActive: true }
            : { isUnitHeadPosition: false, roleId: null, isActive: true },
        ),
      );

      await service.updateProfile('user-1', { positionId: 'pos-ordinary' }, ORG_A, 'admin-1', ['users:manage']);

      expect(mockRoleService.revokeRoleViaHeadAuthority).toHaveBeenCalledWith('user-1', 'unit-1', 'pos-head', ORG_A, 'admin-1');
      expect(mockRoleService.grantRoleViaHeadAuthority).not.toHaveBeenCalled();
    });

    it('does not attempt any role sync when the update never touches positionId or primaryOrgUnitId', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ ...EXISTING, positionId: 'pos-head', primaryOrgUnitId: 'unit-1' });
      mockPrisma.user.update.mockResolvedValue({ ...EXISTING, positionId: 'pos-head', primaryOrgUnitId: 'unit-1' });

      await service.updateProfile('user-1', { name: 'New Name' }, ORG_A, 'admin-1', ['users:manage']);

      expect(mockRoleService.grantRoleViaHeadAuthority).not.toHaveBeenCalled();
      expect(mockRoleService.revokeRoleViaHeadAuthority).not.toHaveBeenCalled();
    });
  });

  describe('updateOutOfOffice', () => {
    const EXISTING = { id: 'user-1', organizationId: ORG_A };

    it('allows self-service update with a valid acting user', async () => {
      mockPrisma.user.findFirst
        .mockResolvedValueOnce(EXISTING) // getById
        .mockResolvedValueOnce({ id: 'acting-1', organizationId: ORG_A, status: 'ACTIVE' }); // acting user check
      mockPrisma.user.update.mockResolvedValue(EXISTING);

      await service.updateOutOfOffice(
        'user-1',
        { outOfOfficeFrom: '2026-08-01', outOfOfficeTo: '2026-08-10', actingUserId: 'acting-1' },
        ORG_A,
        'user-1',
        [],
      );

      expect(mockPrisma.user.update).toHaveBeenCalled();
    });

    it('throws NotFoundException when the designated acting user is not active in this tenant', async () => {
      mockPrisma.user.findFirst
        .mockResolvedValueOnce(EXISTING)
        .mockResolvedValueOnce(null);

      await expect(
        service.updateOutOfOffice(
          'user-1',
          { actingUserId: 'nonexistent' },
          ORG_A,
          'user-1',
          [],
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when a non-self, non-admin actor attempts the update', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(EXISTING);

      await expect(
        service.updateOutOfOffice('user-1', {}, ORG_A, 'other-user', []),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('deactivate', () => {
    it('sets status INACTIVE, invalidates sessions, and logs the audit trail', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-1', organizationId: ORG_A, status: 'ACTIVE' });
      mockPrisma.user.update.mockResolvedValue({});

      const result = await service.deactivate('user-1', ORG_A, 'admin-1');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { status: 'INACTIVE' },
      });
      expect(mockAuthProvider.invalidateUserSessions).toHaveBeenCalledWith('user-1');
      expect(mockAuditLog.log).toHaveBeenCalled();
      expect(result).toEqual({ reassignedCount: 0, unassignedCount: 0 });
    });

    it('throws NotFoundException for a nonexistent user id', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      await expect(service.deactivate('user-1', ORG_A, 'admin-1')).rejects.toThrow(NotFoundException);
    });

    // ACC-40 Section 2.5.1 — refreshOrgUnitHeadVacancy() wiring.

    it('refreshes the departing user\'s own primary org unit after the status flip', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        organizationId: ORG_A,
        status: 'ACTIVE',
        primaryOrgUnitId: 'unit-1',
      });
      mockPrisma.user.update.mockResolvedValue({});

      await service.deactivate('user-1', ORG_A, 'admin-1');

      expect(mockOrganizationService.refreshOrgUnitHeadVacancy).toHaveBeenCalledWith('unit-1', ORG_A);
    });

    it('does not attempt a vacancy refresh when the departing user has no primary org unit', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        organizationId: ORG_A,
        status: 'ACTIVE',
        primaryOrgUnitId: null,
      });
      mockPrisma.user.update.mockResolvedValue({});

      await service.deactivate('user-1', ORG_A, 'admin-1');

      expect(mockOrganizationService.refreshOrgUnitHeadVacancy).not.toHaveBeenCalled();
    });

    // ACC-40 Section 2.6.4/2.6.5 — syncHeadAuthorityRoleGrant() wiring.

    it('revokes the mapped role when a departing user held a head-conferring position', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-1', organizationId: ORG_A, status: 'ACTIVE', positionId: 'pos-head', primaryOrgUnitId: 'unit-1',
      });
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.orgPosition.findFirst.mockResolvedValue({ isUnitHeadPosition: true, roleId: 'role-head' });

      await service.deactivate('user-1', ORG_A, 'admin-1');

      expect(mockRoleService.revokeRoleViaHeadAuthority).toHaveBeenCalledWith('user-1', 'unit-1', 'pos-head', ORG_A, 'admin-1');
    });

    it('does not attempt a revoke when the departing user held no position at all', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-1', organizationId: ORG_A, status: 'ACTIVE', positionId: null, primaryOrgUnitId: 'unit-1',
      });
      mockPrisma.user.update.mockResolvedValue({});

      await service.deactivate('user-1', ORG_A, 'admin-1');

      expect(mockRoleService.revokeRoleViaHeadAuthority).not.toHaveBeenCalled();
    });

    it('should NOT deactivate a user belonging to a different tenant', async () => {
      // A real user exists with this id, but under ORG_B — getById's own
      // org-scoped findFirst correctly finds nothing when called under
      // ORG_A, so deactivate() never reaches the status-flip/session-
      // invalidation/reassignment steps at all.
      mockPrisma.user.findFirst.mockImplementation(({ where }: { where: { id: string; organizationId: string } }) =>
        Promise.resolve(
          [{ id: 'user-1', organizationId: ORG_B, status: 'ACTIVE' }].find(
            (u) => u.id === where.id && u.organizationId === where.organizationId,
          ) ?? null,
        ),
      );

      await expect(service.deactivate('user-1', ORG_A, 'admin-1')).rejects.toThrow(NotFoundException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockAuthProvider.invalidateUserSessions).not.toHaveBeenCalled();
    });

    it('bulk-reassigns open tasks to the actingUser and returns the real counts', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        organizationId: ORG_A,
        name: 'Departing User',
        status: 'ACTIVE',
        actingUserId: 'acting-1',
      });
      mockPrisma.user.update.mockResolvedValue({});
      mockTaskService.reassignAllForUser.mockResolvedValue({ reassignedCount: 3, unassignedCount: 1 });

      const result = await service.deactivate('user-1', ORG_A, 'admin-1');

      expect(mockTaskService.reassignAllForUser).toHaveBeenCalledWith(
        'user-1',
        'acting-1',
        ORG_A,
        'admin-1',
      );
      expect(result).toEqual({ reassignedCount: 3, unassignedCount: 1 });
    });

    it('notifies active Tenant Admins with a summary when the TENANT_ADMIN role exists', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        organizationId: ORG_A,
        name: 'Departing User',
        status: 'ACTIVE',
        actingUserId: null,
      });
      mockPrisma.user.update.mockResolvedValue({});
      mockTaskService.reassignAllForUser.mockResolvedValue({ reassignedCount: 0, unassignedCount: 2 });
      mockPrisma.role.findFirst.mockResolvedValue({ id: 'role-admin' });
      mockPrisma.userRole.findMany.mockResolvedValue([{ userId: 'admin-user-1' }]);

      await service.deactivate('user-1', ORG_A, 'admin-1');

      expect(mockNotification.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'admin-user-1', channel: 'IN_APP' }),
        ORG_A,
      );
    });

    it('blocks deactivating the organization\'s last active TENANT_ADMIN', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        organizationId: ORG_A,
        name: 'Last Admin',
        status: 'ACTIVE',
        actingUserId: null,
      });
      mockPrisma.role.findFirst.mockResolvedValue({ id: 'role-admin' });
      // Departing user ('user-1') is the only ACTIVE holder of the admin role.
      mockPrisma.userRole.findMany.mockResolvedValue([{ userId: 'user-1' }]);

      await expect(service.deactivate('user-1', ORG_A, 'admin-1')).rejects.toThrow(ConflictException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockAuthProvider.invalidateUserSessions).not.toHaveBeenCalled();
      expect(mockNotification.create).not.toHaveBeenCalled();
    });

    it('allows deactivating a TENANT_ADMIN when another active admin remains, and does not self-notify', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        organizationId: ORG_A,
        name: 'Departing Admin',
        status: 'ACTIVE',
        actingUserId: null,
      });
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.role.findFirst.mockResolvedValue({ id: 'role-admin' });
      mockPrisma.userRole.findMany.mockResolvedValue([{ userId: 'user-1' }, { userId: 'admin-2' }]);

      await service.deactivate('user-1', ORG_A, 'admin-1');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { status: 'INACTIVE' },
      });
      expect(mockNotification.create).toHaveBeenCalledTimes(1);
      expect(mockNotification.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'admin-2' }),
        ORG_A,
      );
    });

    it('increments tokenVersion (via invalidateUserSessions) before the bulk reassignment runs', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        organizationId: ORG_A,
        name: 'Departing User',
        status: 'ACTIVE',
        actingUserId: null,
      });
      mockPrisma.user.update.mockResolvedValue({});

      const callOrder: string[] = [];
      mockAuthProvider.invalidateUserSessions.mockImplementation(async () => {
        callOrder.push('invalidateUserSessions');
      });
      mockTaskService.reassignAllForUser.mockImplementation(async () => {
        callOrder.push('reassignAllForUser');
        return { reassignedCount: 0, unassignedCount: 0 };
      });

      await service.deactivate('user-1', ORG_A, 'admin-1');

      expect(callOrder).toEqual(['invalidateUserSessions', 'reassignAllForUser']);
    });
  });

  describe('role delegation', () => {
    it('getUserRoles delegates to RoleService', async () => {
      mockRoleService.getUserRoles.mockResolvedValue([]);
      await service.getUserRoles('user-1', ORG_A);
      expect(mockRoleService.getUserRoles).toHaveBeenCalledWith('user-1', ORG_A);
    });

    it('assignRoleToUser delegates to RoleService', async () => {
      const dto = { roleId: 'role-1' };
      await service.assignRoleToUser('user-1', dto, ORG_A, 'admin-1');
      expect(mockRoleService.assignRoleToUser).toHaveBeenCalledWith('user-1', dto, ORG_A, 'admin-1');
    });

    it('removeRoleFromUser delegates to RoleService', async () => {
      await service.removeRoleFromUser('user-1', 'role-1', ORG_A, 'admin-1');
      expect(mockRoleService.removeRoleFromUser).toHaveBeenCalledWith('user-1', 'role-1', ORG_A, 'admin-1');
    });
  });
});
