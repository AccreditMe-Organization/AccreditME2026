import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { NotificationService } from '../notification/notification.service';
import { RoleService } from '../roles/role.service';
import { AUTH_PROVIDER, AuthProvider } from '../../providers/auth/auth.provider';
import { InviteUserDto } from './dto/invite-user.dto';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import { UpdateOutOfOfficeDto } from './dto/update-out-of-office.dto';
import { AssignRoleDto } from '../roles/dto/assign-role.dto';
import { IUser } from './interfaces/user.interface';
import { IRole } from '../roles/interfaces/role.interface';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface ListUsersFilters {
  status?: string;
  orgUnitId?: string;
  search?: string;
}

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly notificationService: NotificationService,
    private readonly roleService: RoleService,
    @Inject(AUTH_PROVIDER) private readonly authProvider: AuthProvider,
  ) {}

  async listUsers(organizationId: string, filters?: ListUsersFilters): Promise<IUser[]> {
    return this.prisma.user.findMany({
      where: {
        organizationId,
        status: filters?.status ? (filters.status as never) : undefined,
        primaryOrgUnitId: filters?.orgUnitId ?? undefined,
        name: filters?.search ? { contains: filters.search, mode: 'insensitive' } : undefined,
      },
      orderBy: { name: 'asc' },
    });
  }

  async getById(id: string, organizationId: string): Promise<IUser> {
    const user = await this.prisma.user.findFirst({ where: { id, organizationId } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  // Enforces Organization.maxUsers per CLAUDE.md's "Hard limits at 100% —
  // uploads blocked, no data corruption" pattern, applied here to seats.
  async invite(dto: InviteUserDto, organizationId: string, actorId: string): Promise<IUser> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!organization) throw new NotFoundException('Organization not found');

    const activeCount = await this.prisma.user.count({
      where: { organizationId, status: { in: ['ACTIVE', 'INVITED'] } },
    });
    if (activeCount >= organization.maxUsers) {
      throw new ConflictException('This plan has reached its full-user seat limit');
    }

    const existing = await this.prisma.user.findFirst({
      where: { organizationId, email: dto.email },
    });
    if (existing) throw new ConflictException('A user with this email already exists');

    const invitationToken = randomBytes(24).toString('hex');
    const invitationExpiresAt = new Date(Date.now() + INVITATION_TTL_MS);

    const user = await this.prisma.user.create({
      data: {
        organizationId,
        email: dto.email,
        name: dto.name,
        status: 'INVITED',
        positionId: dto.positionId ?? null,
        primaryOrgUnitId: dto.primaryOrgUnitId ?? null,
        managerId: dto.managerId ?? null,
        invitationToken,
        invitationExpiresAt,
      },
    });

    await this.notificationService.create(
      {
        userId: user.id,
        titleEn: `You've been invited to join ${organization.name} on AccreditMe`,
        titleAr: `تمت دعوتك للانضمام إلى ${organization.name} على AccreditMe`,
        bodyEn: `Accept your invitation to set your password and get started: /accept-invitation?token=${invitationToken}`,
        bodyAr: `اقبل الدعوة لتعيين كلمة المرور والبدء: /accept-invitation?token=${invitationToken}`,
        channel: 'EMAIL',
      },
      organizationId,
    );

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'CREATE',
      objectType: 'User',
      objectId: user.id,
      after: user as unknown as Record<string, unknown>,
    });

    return user;
  }

  async updateProfile(
    id: string,
    dto: UpdateUserProfileDto,
    organizationId: string,
    actorId: string,
    actorPermissions: string[],
  ): Promise<IUser> {
    const existing = await this.getById(id, organizationId);
    const isSelf = actorId === id;
    const isAdmin = actorPermissions.includes('users:manage');

    if (!isSelf && !isAdmin) throw new ForbiddenException();

    // Admin-only fields — silently ignored (not merged) rather than
    // rejected, when a non-admin edits their own profile. See Section 12,
    // Discussion 3.
    const data: Record<string, unknown> = { name: dto.name, language: dto.language };
    if (isAdmin) {
      data['positionId'] = dto.positionId;
      data['primaryOrgUnitId'] = dto.primaryOrgUnitId;
      data['managerId'] = dto.managerId;
    }

    const user = await this.prisma.user.update({ where: { id }, data });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'UPDATE',
      objectType: 'User',
      objectId: id,
      before: existing as unknown as Record<string, unknown>,
      after: user as unknown as Record<string, unknown>,
    });

    return user;
  }

  async updateOutOfOffice(
    id: string,
    dto: UpdateOutOfOfficeDto,
    organizationId: string,
    actorId: string,
    actorPermissions: string[],
  ): Promise<IUser> {
    const existing = await this.getById(id, organizationId);
    const isSelf = actorId === id;
    const isAdmin = actorPermissions.includes('users:manage');
    if (!isSelf && !isAdmin) throw new ForbiddenException();

    if (dto.actingUserId) {
      const actingUser = await this.prisma.user.findFirst({
        where: { id: dto.actingUserId, organizationId, status: 'ACTIVE' },
      });
      if (!actingUser) {
        throw new NotFoundException('Acting user not found or not active in this tenant');
      }
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: {
        outOfOfficeFrom: dto.outOfOfficeFrom ? new Date(dto.outOfOfficeFrom) : null,
        outOfOfficeTo: dto.outOfOfficeTo ? new Date(dto.outOfOfficeTo) : null,
        actingUserId: dto.actingUserId ?? null,
      },
    });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'UPDATE',
      objectType: 'User',
      objectId: id,
      before: existing as unknown as Record<string, unknown>,
      after: user as unknown as Record<string, unknown>,
    });

    return user;
  }

  // Commit 4 stub — deactivates the user and revokes sessions. The full
  // departure flow (bulk task reassignment / UNASSIGNED flagging) is added
  // in Commit 6, which modifies this method's body.
  async deactivate(
    id: string,
    organizationId: string,
    actorId: string,
  ): Promise<{ reassignedCount: number; unassignedCount: number }> {
    const existing = await this.getById(id, organizationId);

    await this.prisma.user.update({ where: { id }, data: { status: 'INACTIVE' } });
    await this.authProvider.invalidateUserSessions(id);

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'UPDATE',
      objectType: 'User',
      objectId: id,
      before: existing as unknown as Record<string, unknown>,
      metadata: { event: 'deactivated' },
    });

    // TODO(Commit 6): bulk-reassign every open Task this user is an active
    // assignee on (to actingUserId if set, else UNASSIGNED) and return real counts.
    return { reassignedCount: 0, unassignedCount: 0 };
  }

  // ── Migrated from RoleController (Step 9) — same URL paths, same behavior,
  // delegating straight to RoleService, which still owns this logic. ──

  async getUserRoles(userId: string, organizationId: string): Promise<IRole[]> {
    return this.roleService.getUserRoles(userId, organizationId);
  }

  async assignRoleToUser(
    userId: string,
    dto: AssignRoleDto,
    organizationId: string,
    actorId: string,
  ): Promise<void> {
    return this.roleService.assignRoleToUser(userId, dto, organizationId, actorId);
  }

  async removeRoleFromUser(
    userId: string,
    roleId: string,
    organizationId: string,
    actorId: string,
  ): Promise<void> {
    return this.roleService.removeRoleFromUser(userId, roleId, organizationId, actorId);
  }
}
