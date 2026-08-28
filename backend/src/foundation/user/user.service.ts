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
import { OrganizationService } from '../organization/organization.service';
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
    private readonly organizationService: OrganizationService,
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

  // ACC-43 — the HTTP-facing self-or-view entry point for GET /users/:id.
  // Deliberately NOT folded into getById() itself: getById() is reused
  // internally (updateProfile()/updateOutOfOffice()/deactivate() below,
  // auth.controller.ts) as a trusted, unguarded tenant-scoped lookup — those
  // call sites must never gain an unrelated permission check. Same
  // isSelf-bypasses-the-permission-check shape as updateProfile()'s isAdmin
  // check above, mirrored for view rather than write.
  async getByIdForViewer(
    id: string,
    organizationId: string,
    actorId: string,
    actorPermissions: string[],
  ): Promise<IUser> {
    const isSelf = actorId === id;
    const canView = actorPermissions.includes('users:view');
    if (!isSelf && !canView) throw new ForbiddenException();
    return this.getById(id, organizationId);
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
    // blanket rule. In practice TenantService.bootstrap() already creates
    // a root OrgUnit on every run (see resolveDefaultTenantAdminAssignment()
    // below and Section 2.4's own corrected text), so this branch is live
    // for every real invite() call today — kept as a general safeguard for
    // any future invite path that might run before bootstrap(), not dead
    // code for the current one.
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

    // ACC-40 Section 2.1/2.2 — positionId is unconditionally required as of
    // Phase 2, so this always runs for invite(). excludeUserId: null — the
    // invited user doesn't exist yet, nothing to exclude from the count.
    await this.validatePositionAssignment(
      dto.positionId,
      dto.primaryOrgUnitId ?? null,
      organizationId,
      null,
    );

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

    // ACC-40 Section 2.6.4/2.6.5 — a newly invited user may already be
    // assigned a head-conferring position (positionId is mandatory as of
    // Phase 2) — grants the mapped role immediately, same as any other
    // real position-holding. Fires regardless of INVITED-vs-ACTIVE status:
    // the grant tracks position-holding, not login capability, and the
    // UserRole row is already correct by the time the invitation is
    // accepted, with no separate "grant on accept" step needed.
    await this.syncHeadAuthorityRoleGrant(
      user.id,
      null,
      null,
      dto.positionId ?? null,
      dto.primaryOrgUnitId ?? null,
      organizationId,
      actorId,
    );

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
      // ACC-40 Section 2.1/2.2 — only runs when positionId is actually
      // being set/changed by this call (mirrors the Prisma undefined-means-
      // untouched semantics data['positionId'] itself relies on below).
      // The target org unit is the resulting state after this update, not
      // necessarily existing.primaryOrgUnitId — merges the partial dto onto
      // the existing row, same pattern as OrgPositionService.updatePosition()'s
      // isUnitHeadPosition/isSingleAssignee merge (ACC-40 Phase 1).
      if (dto.positionId !== undefined) {
        const targetPrimaryOrgUnitId =
          dto.primaryOrgUnitId !== undefined ? dto.primaryOrgUnitId : existing.primaryOrgUnitId;
        await this.validatePositionAssignment(dto.positionId, targetPrimaryOrgUnitId, organizationId, id);
      }

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

    // ACC-40 Section 2.5.1 — a positionId/primaryOrgUnitId change can affect
    // head-vacancy status for up to two org units: the one the user is
    // leaving and the one they're joining (the same unit, deduplicated via
    // Set, when this is an in-place position change within one unit).
    // Refreshed after the mutation commits, using before/after state.
    if (isAdmin && (dto.positionId !== undefined || dto.primaryOrgUnitId !== undefined)) {
      const affectedOrgUnitIds = new Set(
        [existing.primaryOrgUnitId, user.primaryOrgUnitId].filter((v): v is string => !!v),
      );
      for (const orgUnitId of affectedOrgUnitIds) {
        await this.organizationService.refreshOrgUnitHeadVacancy(orgUnitId, organizationId);
      }

      // ACC-40 Section 2.6.4/2.6.5 — same guard, same before/after pairing
      // as the vacancy refresh above: revoke against the old
      // (positionId, primaryOrgUnitId) pairing, grant against the new one.
      await this.syncHeadAuthorityRoleGrant(
        id,
        existing.positionId,
        existing.primaryOrgUnitId,
        user.positionId,
        user.primaryOrgUnitId,
        organizationId,
        actorId,
      );
    }

    return user;
  }

  // ACC-40 Section 2.6.4/2.6.5 — real position-holding role inheritance.
  // Called whenever a user's (positionId, primaryOrgUnitId) pair changes —
  // invite() (old: none -> new: assigned), updateProfile() (old: existing
  // -> new: updated), deactivate() (old: existing -> new: none). Revokes
  // against the OLD pairing first (if it was ever granted via this
  // mechanism), then grants against the NEW pairing — mirroring the exact
  // "affected pair" reasoning already established for
  // refreshOrgUnitHeadVacancy()'s own wiring (Phase 6).
  //
  // Org-wide (primaryOrgUnitId: null) head-conferring positions ARE
  // supported — 2.9a's "applies to whoever holds... it" holds without a
  // carve-out. Only attempting a grant/revoke requires a positionId, not
  // an orgUnitId: RoleService.revokeRoleViaHeadAuthority() uses
  // grantedViaHeadPositionOrgUnitId as the revoke key when orgUnitId is
  // present, and falls back to grantedViaHeadPositionId (never null for a
  // real grant) specifically when it's not — see that method's own
  // comment for why each field is safe as a revoke key in its own case.
  //
  // Public (not private) specifically so OrgUnitHeadService can call it —
  // same precedent as validatePositionAssignment() below.
  async syncHeadAuthorityRoleGrant(
    userId: string,
    oldPositionId: string | null,
    oldOrgUnitId: string | null,
    newPositionId: string | null,
    newOrgUnitId: string | null,
    organizationId: string,
    actorId: string | null,
  ): Promise<void> {
    if (oldPositionId === newPositionId && oldOrgUnitId === newOrgUnitId) return;

    if (oldPositionId) {
      const oldPosition = await this.prisma.orgPosition.findFirst({
        where: { id: oldPositionId, organizationId },
        select: { isUnitHeadPosition: true, roleId: true },
      });
      if (oldPosition?.isUnitHeadPosition && oldPosition.roleId) {
        await this.roleService.revokeRoleViaHeadAuthority(userId, oldOrgUnitId, oldPositionId, organizationId, actorId);
      }
    }

    if (newPositionId) {
      const newPosition = await this.prisma.orgPosition.findFirst({
        where: { id: newPositionId, organizationId },
        select: { isUnitHeadPosition: true, roleId: true },
      });
      if (newPosition?.isUnitHeadPosition && newPosition.roleId) {
        await this.roleService.grantRoleViaHeadAuthority(userId, newPosition.roleId, newPositionId, newOrgUnitId, organizationId, actorId);
      }
    }
  }

  // ACC-40 Section 2.1/2.2 — the shared entry point both invite() and
  // updateProfile() call whenever positionId is actually being set. Fetches
  // the target position once, then runs each real-world constraint as its
  // own explicit, separate check (2.2's own reasoning: neither check
  // subsumes the other, so a future reader sees the two distinct
  // constraints they each name, not one query with an unexplained extra
  // condition folded in). excludeUserId is the user being updated (so
  // their own pre-existing holding doesn't count against their own new
  // state — the correct, simpler replacement for a separate
  // isNoOpReassignment flag: excluding the target user's own row makes a
  // same-value re-save count as zero *other* holders automatically,
  // without the caller having to separately compute whether anything
  // actually changed) — or null for invite(), where no such user exists yet.
  //
  // isDeclaredHandoverBypass (ACC-40 Section 2.3, Phase 5) — defaults false
  // everywhere in this file. The ONLY caller that ever sets it true is
  // OrgUnitHeadService.declareHandover() (Phase 5 commit 3), granting the
  // incoming successor the SAME head-conferring position the outgoing
  // holder already holds — deliberately violating both caps below, but
  // only through that one dedicated code path, only for the two people it
  // explicitly names. invite()/updateProfile() below never pass this
  // parameter at all, so it is structurally unreachable from the ordinary
  // profile-edit path — not merely defaulted false by convention.
  //
  // Public (not private) specifically so OrgUnitHeadService can call it —
  // still only ever invoked internally by this codebase's own services,
  // never exposed through a controller.
  async validatePositionAssignment(
    targetPositionId: string,
    targetPrimaryOrgUnitId: string | null,
    organizationId: string,
    excludeUserId: string | null,
    isDeclaredHandoverBypass = false,
  ): Promise<void> {
    const position = await this.prisma.orgPosition.findFirst({
      where: { id: targetPositionId, organizationId },
    });
    if (!position) throw new NotFoundException('Position not found in this organization');

    await this.validateSingleAssigneeCap(
      position,
      targetPrimaryOrgUnitId,
      organizationId,
      excludeUserId,
      isDeclaredHandoverBypass,
    );
    await this.validateUnitHeadUniqueness(
      position,
      targetPrimaryOrgUnitId,
      organizationId,
      excludeUserId,
      isDeclaredHandoverBypass,
    );
  }

  // ACC-40 Section 2.1 — scoped per (positionId, primaryOrgUnitId), not per
  // positionId alone: the position catalog entry is tenant-wide, but
  // whether more than one person may simultaneously hold it is a per-unit
  // question. primaryOrgUnitId: null is not a special case skipped by this
  // check — it is simply one more partition value (a genuinely org-wide,
  // isSingleAssignee: true position is enforced correctly by the same
  // query: every holder with primaryOrgUnitId: null falls into the same
  // partition).
  private async validateSingleAssigneeCap(
    position: { id: string; isSingleAssignee: boolean },
    targetPrimaryOrgUnitId: string | null,
    organizationId: string,
    excludeUserId: string | null,
    isDeclaredHandoverBypass = false,
  ): Promise<void> {
    if (!position.isSingleAssignee) return;
    // Short-circuits before ever querying — matching this file's own
    // established "an inapplicable check never even reaches the count
    // query" convention (Phase 4's own regression tests assert this for
    // ordinary positions).
    if (isDeclaredHandoverBypass) return;

    const existingHolders = await this.prisma.user.count({
      where: {
        organizationId,
        positionId: position.id,
        primaryOrgUnitId: targetPrimaryOrgUnitId,
        status: 'ACTIVE',
        ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
      },
    });
    if (existingHolders >= 1) {
      throw new ConflictException('This position already has an active holder in this org unit');
    }
  }

  // ACC-40 Section 2.2 — a genuinely separate constraint from
  // validateSingleAssigneeCap() above, not a generalization of it: a
  // tenant could flag more than one distinct OrgPosition as
  // isUnitHeadPosition: true (e.g. "Department Head" and "Acting
  // Department Chief" both independently marked head-conferring).
  // validateSingleAssigneeCap() alone would not catch one person holding
  // "Department Head" in unit U while a DIFFERENT person simultaneously
  // holds "Acting Department Chief" in the same unit U — each position's
  // own single-assignee cap is individually satisfied, but the unit now
  // has two people with head-level authority from two different
  // positions. Only runs for a head-conferring position (2.1 already
  // guarantees isUnitHeadPosition: true implies isSingleAssignee: true —
  // this check exists BECAUSE that per-position guarantee alone isn't
  // enough across DIFFERENT positions).
  private async validateUnitHeadUniqueness(
    position: { id: string; isUnitHeadPosition: boolean },
    targetPrimaryOrgUnitId: string | null,
    organizationId: string,
    excludeUserId: string | null,
    isDeclaredHandoverBypass = false,
  ): Promise<void> {
    if (!position.isUnitHeadPosition) return;
    if (isDeclaredHandoverBypass) return;

    const anyHeadHolders = await this.prisma.user.count({
      where: {
        organizationId,
        primaryOrgUnitId: targetPrimaryOrgUnitId,
        status: 'ACTIVE',
        position: { isUnitHeadPosition: true },
        ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
      },
    });
    if (anyHeadHolders >= 1) {
      throw new ConflictException('This org unit already has an active Head-position holder');
    }
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

    // ACC-40 Section 2.5.1 — a departing user may have been a unit's direct
    // Head-position holder; the status flip above already excludes them
    // from refreshOrgUnitHeadVacancy()'s own ACTIVE-only holder count, so
    // this call correctly detects a resulting vacancy.
    if (existing.primaryOrgUnitId) {
      await this.organizationService.refreshOrgUnitHeadVacancy(existing.primaryOrgUnitId, organizationId);
    }

    // ACC-40 Section 2.6.4/2.6.5 — departure unambiguously ends real
    // position-holding authority; revoke any role granted via it. new =
    // (null, null) — the departing user holds nothing after this.
    await this.syncHeadAuthorityRoleGrant(
      id,
      existing.positionId,
      existing.primaryOrgUnitId,
      null,
      null,
      organizationId,
      actorId,
    );

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
