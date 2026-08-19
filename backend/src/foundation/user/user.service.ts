import {
  BadRequestException,
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
import { TaskService } from '../task/task.service';
import { AUTH_PROVIDER, AuthProvider } from '../../providers/auth/auth.provider';
import { InviteUserDto } from './dto/invite-user.dto';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import { UpdateOutOfOfficeDto } from './dto/update-out-of-office.dto';
import { AssignRoleDto } from '../roles/dto/assign-role.dto';
import { IUser } from './interfaces/user.interface';
import { IRole } from '../roles/interfaces/role.interface';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Mirrors RoleService's own TENANT_ADMIN_KEY guard (role.service.ts) — see
// ACC-16, "last-admin lockout protection". RoleService already blocks
// removing/deactivating a tenant's last TENANT_ADMIN via the role-management
// UI; this closes the same gap on the user-departure flow.
const TENANT_ADMIN_KEY = 'TENANT_ADMIN';

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
    private readonly taskService: TaskService,
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

    // ACC-40 Section 2.4 — primaryOrgUnitId is conditionally mandatory:
    // required once the tenant has at least one active OrgUnit, not a
    // blanket rule (a brand-new tenant has zero until an admin creates
    // one — bootstrap doesn't seed any).
    if (!dto.primaryOrgUnitId) {
      const activeOrgUnitCount = await this.prisma.orgUnit.count({
        where: { organizationId, isActive: true },
      });
      if (activeOrgUnitCount > 0) {
        throw new BadRequestException(
          'primaryOrgUnitId is required once this organization has at least one active org unit',
        );
      }
    }

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

  // ACC-40 Section 2.4 — a remediation REPORT, not a data-transformation
  // script: which position/org unit an existing active user belongs to is
  // not programmatically derivable, unlike every existing backfill-*.ts
  // precedent in this codebase. Reuses the exact
  // Role.findFirst({ key: 'TENANT_ADMIN' }) → UserRole.findMany() →
  // NotificationService.create() chain already used by
  // notifyTenantAdminsOfCoverageGap()/notifyTenantAdminsOfUnassignedStage()
  // in workflow.service.ts, rather than a new mechanism. The actual fix
  // happens through the already-fully-wired user-profile.component.ts edit
  // form — no new UI needed for the fix itself, only this notification.
  async notifyTenantAdminsOfIncompleteProfiles(organizationId: string): Promise<void> {
    // primaryOrgUnitId's mandatoriness is itself conditional (2.4's scoped
    // exception) — a tenant with zero active OrgUnits has nothing missing
    // on that field, so it must not be counted as incomplete for it.
    const activeOrgUnitCount = await this.prisma.orgUnit.count({
      where: { organizationId, isActive: true },
    });

    const incompleteUsers = await this.prisma.user.findMany({
      where: {
        organizationId,
        status: 'ACTIVE',
        OR: [
          { positionId: null },
          ...(activeOrgUnitCount > 0 ? [{ primaryOrgUnitId: null }] : []),
        ],
      },
    });
    if (incompleteUsers.length === 0) return;

    const adminRole = await this.prisma.role.findFirst({
      where: { organizationId, key: 'TENANT_ADMIN' },
    });
    if (!adminRole) return;

    const adminUserRoles = await this.prisma.userRole.findMany({
      where: { roleId: adminRole.id, user: { organizationId, status: 'ACTIVE' } },
    });

    for (const userRole of adminUserRoles) {
      await this.notificationService.create(
        {
          userId: userRole.userId,
          titleEn: `${incompleteUsers.length} active user(s) missing position or org unit`,
          titleAr: `${incompleteUsers.length} مستخدم نشط ينقصه المسمى الوظيفي أو الوحدة التنظيمية`,
          bodyEn: `${incompleteUsers.length} active user(s) in your organization have no assigned position and/or org unit. Update each user's profile to complete their record.`,
          bodyAr: `يوجد ${incompleteUsers.length} مستخدم نشط في مؤسستك بلا مسمى وظيفي و/أو وحدة تنظيمية. حدّث ملف كل مستخدم لإكمال بياناته.`,
        },
        organizationId,
      );
    }
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
      // ACC-40 Section 2.7 — no referential-integrity check against
      // OrgUnit, matching this block's own existing precedent for
      // positionId/primaryOrgUnitId/managerId above.
      data['actingOrgUnitId'] = dto.actingOrgUnitId;
      data['actingOrgUnitUntil'] = dto.actingOrgUnitUntil ? new Date(dto.actingOrgUnitUntil) : dto.actingOrgUnitUntil;
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

  // Full departure flow (Absence and Departure Management, "User Departure
  // Flow (Critical)"). Order is not reorderable — tokenVersion increments
  // BEFORE bulk reassignment starts, so the departing user's existing
  // sessions are already dead the instant this begins, not after it
  // finishes (see step-09 plan Section 8).
  async deactivate(
    id: string,
    organizationId: string,
    actorId: string,
  ): Promise<{ reassignedCount: number; unassignedCount: number }> {
    const existing = await this.getById(id, organizationId);

    // Queried BEFORE the status flip below — both the lockout check and the
    // departure notification (further down) need the ACTIVE-admin set as it
    // stood while the departing user was still active. Querying after the
    // flip (the previous bug — ACC-16) would silently exclude the departing
    // user from their own admin count and, in the last-admin case, notify
    // no one at all.
    const adminRole = await this.prisma.role.findFirst({
      where: { organizationId, key: TENANT_ADMIN_KEY },
    });
    const activeAdmins = adminRole
      ? await this.prisma.userRole.findMany({
          where: { roleId: adminRole.id, user: { organizationId, status: 'ACTIVE' } },
        })
      : [];

    const departingUserIsActiveAdmin = activeAdmins.some((a) => a.userId === id);
    if (departingUserIsActiveAdmin && activeAdmins.length <= 1) {
      throw new ConflictException(
        "This user is the organization's last active administrator and cannot be deactivated",
      );
    }

    await this.prisma.user.update({ where: { id }, data: { status: 'INACTIVE' } });
    await this.authProvider.invalidateUserSessions(id);

    const { reassignedCount, unassignedCount } = await this.taskService.reassignAllForUser(
      id,
      existing.actingUserId,
      organizationId,
      actorId,
    );

    const otherAdmins = activeAdmins.filter((a) => a.userId !== id);
    await this.notifyTenantAdminsOfDeparture(
      otherAdmins,
      organizationId,
      existing,
      reassignedCount,
      unassignedCount,
    );

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'UPDATE',
      objectType: 'User',
      objectId: id,
      before: existing as unknown as Record<string, unknown>,
      metadata: { event: 'deactivated', reassignedCount, unassignedCount },
    });

    return { reassignedCount, unassignedCount };
  }

  private async notifyTenantAdminsOfDeparture(
    admins: { userId: string }[],
    organizationId: string,
    departedUser: IUser,
    reassignedCount: number,
    unassignedCount: number,
  ): Promise<void> {
    const summary =
      unassignedCount > 0
        ? `${reassignedCount} task(s) reassigned, ${unassignedCount} task(s) flagged as UNASSIGNED and need manual reassignment.`
        : `${reassignedCount} task(s) reassigned.`;

    for (const admin of admins) {
      await this.notificationService.create(
        {
          userId: admin.userId,
          titleEn: `${departedUser.name} has been deactivated`,
          bodyEn: `${departedUser.name}'s account was deactivated. ${summary}`,
          channel: 'IN_APP',
        },
        organizationId,
      );
    }
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
