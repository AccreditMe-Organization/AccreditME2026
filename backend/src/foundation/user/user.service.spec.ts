import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserService } from './user.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { NotificationService } from '../notification/notification.service';
import { RoleService } from '../roles/role.service';
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
  };
  let mockAuthProvider: { invalidateUserSessions: jest.Mock; validateToken: jest.Mock };

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
    };
    mockAuditLog = { log: jest.fn() };
    mockNotification = { create: jest.fn().mockResolvedValue({}) };
    mockRoleService = {
      getUserRoles: jest.fn(),
      assignRoleToUser: jest.fn(),
      removeRoleFromUser: jest.fn(),
    };
    mockAuthProvider = {
      invalidateUserSessions: jest.fn().mockResolvedValue(undefined),
      validateToken: jest.fn(),
    };

    service = new UserService(
      mockPrisma as unknown as PrismaService,
      mockAuditLog as unknown as AuditLogService,
      mockNotification as unknown as NotificationService,
      mockRoleService as unknown as RoleService,
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
    it('throws NotFoundException for a user in a different tenant', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      await expect(service.getById('u1', ORG_A)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
        where: { id: 'u1', organizationId: ORG_A },
      });
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
      mockPrisma.user.create.mockResolvedValue({
        id: 'new-user',
        organizationId: ORG_A,
        email: 'new@example.com',
        name: 'New User',
        status: 'INVITED',
      });

      const result = await service.invite(
        { email: 'new@example.com', name: 'New User' },
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
        service.invite({ email: 'new@example.com', name: 'New User' }, ORG_A, 'actor-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when a user with this email already exists in the tenant', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: ORG_A, name: 'Acme', maxUsers: 25 });
      mockPrisma.user.count.mockResolvedValue(1);
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'existing' });

      await expect(
        service.invite({ email: 'dup@example.com', name: 'Dup User' }, ORG_A, 'actor-1'),
      ).rejects.toThrow(ConflictException);
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

    it('throws ForbiddenException when a non-self, non-admin actor attempts the update', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(EXISTING);

      await expect(
        service.updateProfile('user-1', { name: 'Hacked' }, ORG_A, 'other-user', []),
      ).rejects.toThrow(ForbiddenException);
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

    it('throws NotFoundException for a user in a different tenant', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      await expect(service.deactivate('user-1', ORG_A, 'admin-1')).rejects.toThrow(NotFoundException);
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
