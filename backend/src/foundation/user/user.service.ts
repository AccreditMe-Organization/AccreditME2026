import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  forwardRef,
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
// ACC-46 Section 2.4 — a genuine two-way provider cycle: OrgUnitHeadService
// already @Inject(forwardRef(() => UserService)) (declareHandover()'s
// validatePositionAssignment() bypass, ACC-40 Section 2.3), and this new
// edge is the reverse direction of the exact same pair — forwardRef()
// needed on both sides, not just one. Module-level wiring already safe:
// UserModule already forwardRef(() => OrganizationModule), which already
// exports OrgUnitHeadService — same edge this file already uses for
// OrganizationService itself, no new module-level circularity.
import { OrgUnitHeadService } from '../organization/org-unit-head.service';
// ACC-46 Section 2.6.a/b — OrgPositionModule doesn't import UserModule
// anywhere, so this edge alone would be one-way, but it transitively closes
// a cycle through OrganizationModule (OrgPositionModule -> forwardRef
// OrganizationModule -> forwardRef UserModule, an existing edge) — this new
// UserModule -> OrgPositionModule edge needs forwardRef() too, same
// discipline as every other module edge in this codebase touching that
// same TenantModule/OrganizationModule graph. Verified via a real
// start:dev boot, not just tsc/jest.
import { OrgPositionService } from '../org-position/org-position.service';
import { AUTH_PROVIDER, AuthProvider } from '../../providers/auth/auth.provider';
import { InviteUserDto } from './dto/invite-user.dto';
import { ValidateTransferReplacementDto } from './dto/validate-transfer-replacement.dto';
import { ValidateTransferPositionDto } from './dto/validate-transfer-position.dto';
import { TransferUserDto } from './dto/transfer-user.dto';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import { UpdateOutOfOfficeDto } from './dto/update-out-of-office.dto';
import { AssignRoleDto } from '../roles/dto/assign-role.dto';
import { IUser } from './interfaces/user.interface';
import { IRole } from '../roles/interfaces/role.interface';
import { ITransferContext } from './interfaces/transfer-context.interface';
import { ITransferResult } from './interfaces/transfer-result.interface';

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

// ACC-45 — the single, shared "strip internal-only fields" mapper for User
// rows crossing the HTTP response boundary. getById()/listUsers()/invite()/
// getByIdForViewer() below are all declared to return IUser but, before this
// fix, actually returned the full, unfiltered Prisma User row —
// invitationToken (a plaintext, unhashed credential AuthService.
// acceptInvitation() matches by direct equality — see auth.service.ts),
// invitationExpiresAt, authUserId (the internal Better Auth join key),
// tokenVersion, lastLoginIp, and other fields never meant to leave the
// server included. IUser's own field list was a documented-but-never-
// enforced contract: TypeScript's structural typing allows a wider runtime
// object to satisfy a narrower declared return type, so every one of those
// methods compiled cleanly the whole time while silently lying about the
// real response shape — declaring `Promise<IUser>` never actually stripped
// anything at runtime.
//
// Deliberately NOT baked into getById()/listUsers()/invite()/updateProfile()/
// updateOutOfOffice() themselves — unlike RoleService's own mapRole(), which
// IS called from inside every RoleService method. getById() specifically is
// reused internally by updateProfile()/updateOutOfOffice()/deactivate()/
// getByIdForViewer() (confirmed via a full call-site audit before this
// change: none of them currently read the excluded fields off the object
// getById() returns, but the design stays defensive against a future one
// that does, per the same reasoning WorkflowStage.requiredPermission's
// ACC-44 removal write-up used for "don't guess, verify" — see CLAUDE.md's
// ACC-44 section). Call this explicitly at every call site that actually
// serializes a User onto an HTTP response — all 5 now covered:
// UserController's listUsers()/getById()/invite()/updateProfile()/
// updateOutOfOffice(). updateProfile()/updateOutOfOffice() were found to
// have the identical leak shape (both return the raw prisma.user.update()
// result untouched) in the same audit that found the original 3 — fixed
// together in one pass rather than split across tickets.
export function toSafeUser(user: IUser): IUser {
  return {
    id: user.id,
    organizationId: user.organizationId,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    status: user.status,
    language: user.language,
    positionId: user.positionId,
    primaryOrgUnitId: user.primaryOrgUnitId,
    managerId: user.managerId,
    outOfOfficeFrom: user.outOfOfficeFrom,
    outOfOfficeTo: user.outOfOfficeTo,
    actingUserId: user.actingUserId,
    actingOrgUnitId: user.actingOrgUnitId,
    actingOrgUnitUntil: user.actingOrgUnitUntil,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
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
    @Inject(forwardRef(() => OrgUnitHeadService))
    private readonly orgUnitHeadService: OrgUnitHeadService,
    // ACC-46 Section 2.6.a — a one-way provider dependency (OrgPositionService
    // has no dependency back on UserService), so no @Inject(forwardRef())
    // needed at the constructor-injection level — only the module-level
    // import edge above needs it.
    private readonly orgPositionService: OrgPositionService,
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

  // ACC-46 Section 2.6.b Step 2 — automatic context load, not a user
  // action: drives which subsequent wizard steps are shown, pre-fills the
  // position picker with only genuinely available choices, and pre-fills
  // the manager step's default. getById() validates userId exists in this
  // tenant first (throws NotFoundException otherwise); getHeadStatus()
  // below independently validates destinationOrgUnitId the same way — run
  // first among the three lookups so an invalid destination fails fast
  // rather than after the (wasted) direct-reports/positions queries.
  async getTransferContext(
    userId: string,
    destinationOrgUnitId: string,
    organizationId: string,
  ): Promise<ITransferContext> {
    await this.getById(userId, organizationId);
    const headStatus = await this.orgUnitHeadService.getHeadStatus(destinationOrgUnitId, organizationId);

    const hasActiveDirectReports =
      (await this.prisma.user.count({
        where: { managerId: userId, organizationId, status: 'ACTIVE' },
      })) > 0;
    const availablePositions = await this.orgPositionService.listAvailablePositionsForUser(
      userId,
      destinationOrgUnitId,
      organizationId,
    );

    return {
      hasActiveDirectReports,
      availablePositions,
      currentDestinationHead: headStatus.holders[0] ?? null,
    };
  }

  // ACC-46 Section 2.6.b Step 3 — the live gate fired before the wizard
  // advances past the conditional replacement step (shown only when
  // getTransferContext() reported hasActiveDirectReports). One combined
  // existence/status/unit-match check with one combined message (2.6.e's
  // own error table) — deliberately not split into separate "not found"
  // vs "wrong unit" errors the way assignHead()'s own precedent does it,
  // since this endpoint's job is a single yes/no gate, not diagnosing
  // exactly which condition failed.
  async validateTransferReplacement(
    userId: string,
    dto: ValidateTransferReplacementDto,
    organizationId: string,
  ): Promise<void> {
    const user = await this.getById(userId, organizationId);

    const replacement = await this.prisma.user.findFirst({
      where: {
        id: dto.replacementUserId,
        organizationId,
        status: 'ACTIVE',
        primaryOrgUnitId: user.primaryOrgUnitId,
      },
    });
    if (!replacement) {
      throw new ConflictException(
        "The replacement must be an active user already belonging to the departing person's current org unit",
      );
    }

    // ACC-40 Phase 2 made positionId unconditionally required for every
    // real invite() — this guard exists for type-safety and defense in
    // depth (IUser.positionId is typed string | null), not because a
    // legitimate departing user is expected to lack one.
    if (!user.positionId || !user.primaryOrgUnitId) {
      throw new ConflictException('The departing user has no current position or org unit to hand over');
    }

    // Confirms the replacement can legitimately inherit the departing
    // person's current position. excludeUserId: the departing person's own
    // row — they're vacating this exact position, so their own current
    // holding of it must not count against the replacement taking it over.
    await this.validatePositionAssignment(user.positionId, user.primaryOrgUnitId, organizationId, user.id);
  }

  // ACC-46 Section 2.6.b Step 4 — the live gate fired before the wizard
  // advances past the (always-shown, for every transfer) destination
  // position step. This is the step with genuine multi-user race
  // exposure — getTransferContext()'s own availablePositions list is a
  // snapshot; another admin could assign the same single-assignee
  // position to someone else in the meantime. This explicit
  // re-validation, right before the wizard advances, is what closes that
  // window — not merely trusting the earlier snapshot.
  async validateTransferPosition(
    userId: string,
    dto: ValidateTransferPositionDto,
    organizationId: string,
  ): Promise<void> {
    await this.getById(userId, organizationId);
    await this.validatePositionAssignment(dto.newPositionId, dto.destinationOrgUnitId, organizationId, userId);
  }

  // ACC-46 Section 2.6.b Step 6 / 2.6.c — the final submit. Full
  // re-validation runs again fresh here, never trusting the wizard's own
  // step gates (validate-replacement/validate-position) as sole
  // authority. Both branches — ordinary transfer and promotion — live in
  // this one method; they share steps 1–3 and 5–9 and only diverge at
  // specific, individually-flagged points below.
  async transferUser(
    userId: string,
    dto: TransferUserDto,
    organizationId: string,
    actorId: string,
  ): Promise<ITransferResult> {
    // Step 1 — load + confirm ACTIVE. An INVITED or INACTIVE user is out
    // of scope: updateProfile() already covers pre-acceptance edits, and a
    // departed user has no business being transferred.
    const user = await this.prisma.user.findFirst({
      where: { id: userId, organizationId, status: 'ACTIVE' },
    });
    if (!user) throw new NotFoundException('User not found or not active in this tenant');
    if (!user.primaryOrgUnitId) {
      throw new ConflictException('This user has no current org unit to transfer from');
    }

    const newPosition = await this.prisma.orgPosition.findFirst({
      where: { id: dto.newPositionId, organizationId },
    });
    if (!newPosition) throw new NotFoundException('Position not found in this organization');
    // Whether this transfer is a promotion is derived, not caller-declared
    // — picking a head-conferring position *is* what makes it a
    // promotion (2.6.b Step 4).
    const isPromotion = newPosition.isUnitHeadPosition;

    // Step 2 — re-run Step 3's replacement check, if present; otherwise
    // re-run the Case B requiredness check (2.6.e's own table row).
    let replacement: { id: string; positionId: string | null; primaryOrgUnitId: string | null } | null = null;
    if (dto.replacementUserId) {
      replacement = await this.prisma.user.findFirst({
        where: {
          id: dto.replacementUserId,
          organizationId,
          status: 'ACTIVE',
          primaryOrgUnitId: user.primaryOrgUnitId,
        },
      });
      if (!replacement) {
        throw new ConflictException(
          "The replacement must be an active user already belonging to the departing person's current org unit",
        );
      }
      if (!user.positionId) {
        throw new ConflictException('The departing user has no current position to hand over');
      }
      // excludeUserId: the departing person's own row — they're vacating
      // this exact position, so their own current holding of it must not
      // count against the replacement taking it over.
      await this.validatePositionAssignment(user.positionId, user.primaryOrgUnitId, organizationId, user.id);
    } else {
      const hasActiveDirectReports =
        (await this.prisma.user.count({
          where: { managerId: user.id, organizationId, status: 'ACTIVE' },
        })) > 0;
      if (hasActiveDirectReports) {
        throw new BadRequestException(
          'This user has active direct reports — a replacement from the source unit is required',
        );
      }
    }

    // Step 3 — re-run Step 4's position check. excludeUserId: the
    // transferred person's own id (they will hold this position after the
    // transfer — their own future occupancy must not count against
    // themselves).
    await this.validatePositionAssignment(dto.newPositionId, dto.destinationOrgUnitId, organizationId, user.id);

    // Step 4 — re-run Step 5's manager resolution.
    let resolvedNewManagerId: string | null;
    if (isPromotion) {
      // 2.6.d — derived, never a caller choice. Any caller-supplied
      // newManagerId is silently ignored, matching updateProfile()'s own
      // established "admin-only fields silently excluded, not rejected"
      // convention for a field that doesn't apply in this mode.
      const destinationUnit = await this.prisma.orgUnit.findFirst({
        where: { id: dto.destinationOrgUnitId, organizationId },
      });
      if (!destinationUnit) throw new NotFoundException('Destination org unit not found in this organization');

      if (destinationUnit.parentId === null) {
        // Root exemption — no manager at all. Root's own head-conferring
        // position being currently vacant is already guaranteed by this
        // point: Step 3's validatePositionAssignment() above would have
        // thrown if it weren't.
        resolvedNewManagerId = null;
      } else {
        // DECIDED — "recursively" means single-level only: the immediate
        // parent must have its own direct-or-acting Head, or the
        // promotion is hard-blocked. No walking further up to
        // grandparent — consistent with 2.4's own "parent escalation
        // coverage does not count" principle applied one level up.
        const parentHasHead = await this.orgUnitHeadService.hasDirectOrActingHead(
          destinationUnit.parentId,
          organizationId,
        );
        if (!parentHasHead) {
          throw new ConflictException(
            "Cannot promote into this unit — its parent unit has no Head or Acting Head of its own yet",
          );
        }
        const parentHeadStatus = await this.orgUnitHeadService.getHeadStatus(
          destinationUnit.parentId,
          organizationId,
        );
        const parentManagerId = parentHeadStatus.holders[0]?.id ?? parentHeadStatus.actingHeadUserId;
        // Defensive — hasDirectOrActingHead() just confirmed one of these
        // must be truthy; should be unreachable in practice.
        if (!parentManagerId) {
          throw new ConflictException("Could not resolve the parent unit's current Head or Acting Head");
        }
        resolvedNewManagerId = parentManagerId;
      }
    } else {
      // Non-promotion: required, and must be an active user already in
      // the destination unit (fixed in this pass, per 2.6.b Step 5 — the
      // original design only checked destination-unit membership, not
      // status).
      if (!dto.newManagerId) {
        throw new BadRequestException('newManagerId is required for an ordinary (non-promotion) transfer');
      }
      const manager = await this.prisma.user.findFirst({
        where: {
          id: dto.newManagerId,
          organizationId,
          status: 'ACTIVE',
          primaryOrgUnitId: dto.destinationOrgUnitId,
        },
      });
      if (!manager) {
        throw new ConflictException('newManagerId must be an active user belonging to the destination org unit');
      }
      resolvedNewManagerId = dto.newManagerId;
    }

    const sourceOrgUnitId = user.primaryOrgUnitId;
    const sourcePositionId = user.positionId;

    // Steps 5–10 — transaction #1. Only genuine, atomic-together row
    // writes live inside tx: the Case B cascade, the transferred person's
    // own update, and (non-promotion only) the UserTransferEvent write.
    // Side-effecting calls that read/write through the plain injected
    // PrismaService (refreshOrgUnitHeadVacancy(), syncHeadAuthorityRoleGrant(),
    // AuditLogService.log()) run after commit, matching this codebase's
    // own established "side-effecting calls stay outside the transaction"
    // convention (2.6.h).
    const updatedUser = await this.prisma.$transaction(async (tx) => {
      // Step 5 — Case B cascade.
      if (replacement) {
        await tx.user.updateMany({
          where: { managerId: user.id, organizationId, status: 'ACTIVE' },
          data: { managerId: replacement.id },
        });
        await tx.user.update({
          where: { id: replacement.id },
          data: { positionId: sourcePositionId },
        });
      }

      // Step 6 — update the transferred person. positionId included ONLY
      // when NOT a promotion — verified during plan review that
      // assignHead() (step 11 below) is NOT safe to call after this
      // pre-sets positionId: it derives its own "old position" via a
      // fresh internal query, and would read old === new, silently
      // no-opping the role grant. For a promotion, positionId is left
      // entirely to assignHead() itself.
      const updated = await tx.user.update({
        where: { id: user.id },
        data: {
          primaryOrgUnitId: dto.destinationOrgUnitId,
          managerId: resolvedNewManagerId,
          ...(isPromotion ? {} : { positionId: dto.newPositionId }),
        },
      });

      // Step 10 — UserTransferEvent. Non-promotion: written here, fully
      // atomic with the rest of the transfer (2.6.c/2.6.f). Promotion:
      // skipped here — "what actually happened" is only known once
      // assignHead() (step 11) resolves; deferred to step 12, after this
      // transaction has already committed.
      if (!isPromotion) {
        await tx.userTransferEvent.create({
          data: {
            organizationId,
            userId: user.id,
            sourceOrgUnitId,
            destinationOrgUnitId: dto.destinationOrgUnitId,
            sourcePositionId,
            destinationPositionId: dto.newPositionId,
            replacementUserId: replacement?.id ?? null,
            newManagerId: resolvedNewManagerId,
            isPromotion: false,
            promotionAttempted: false,
            performedBy: actorId,
          },
        });
      }

      return updated;
    });

    // Step 7 — refresh vacancy for both source and destination units.
    // Destination skipped when isPromotion — assignHead() (step 11)
    // already does it there.
    const unitsToRefresh = isPromotion ? [sourceOrgUnitId] : [sourceOrgUnitId, dto.destinationOrgUnitId];
    for (const orgUnitId of new Set(unitsToRefresh)) {
      await this.organizationService.refreshOrgUnitHeadVacancy(orgUnitId, organizationId);
    }

    // Step 5 (continued) — role-grant sync for the replacement, old: their
    // own previous position/unit -> new: the departing person's old
    // position, source unit. Unaffected by isPromotion — Case B is
    // orthogonal to whether the departing person is being promoted.
    if (replacement) {
      await this.syncHeadAuthorityRoleGrant(
        replacement.id,
        replacement.positionId,
        replacement.primaryOrgUnitId,
        sourcePositionId,
        sourceOrgUnitId,
        organizationId,
        actorId,
      );
    }

    // Step 8 — role-grant sync for the transferred person themselves,
    // old: their previous position/unit -> new: the destination
    // position/unit. Skipped when isPromotion — assignHead() (step 11)
    // already covers this too.
    if (!isPromotion) {
      await this.syncHeadAuthorityRoleGrant(
        user.id,
        sourcePositionId,
        sourceOrgUnitId,
        dto.newPositionId,
        dto.destinationOrgUnitId,
        organizationId,
        actorId,
      );
    }

    // Step 9 — audit log, describing what this transaction itself did.
    // Accurate regardless of what a later promotion attempt does or
    // doesn't achieve, so it fires unconditionally.
    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'UPDATE',
      objectType: 'User',
      objectId: user.id,
      before: user as unknown as Record<string, unknown>,
      after: updatedUser as unknown as Record<string, unknown>,
    });

    if (!isPromotion) {
      return { user: updatedUser, promotionCompleted: true };
    }

    // Step 11 — promotion only, OUTSIDE transaction #1, as its own
    // separate, already-internally-atomic unit of work. Delegates to the
    // EXISTING OrgUnitHeadService.assignHead() for everything
    // Head-specific — it already validates isUnitHeadPosition, requires
    // the target to already belong to the unit (true by this point —
    // transaction #1 already committed primaryOrgUnitId), calls
    // validatePositionAssignment() again (harmless — already passed in
    // step 3; this codebase's own established redundant-but-safe
    // pattern), sets positionId itself, writes its own OrgUnitHeadEvent,
    // refreshes destination-unit vacancy, and syncs the role grant —
    // correctly this time, per the fix above. transferUser()'s own job
    // for this branch narrows to moving the unit and resolving the
    // manager (steps 1–9) — not reimplementing any of assignHead()'s
    // steps, and not racing it either.
    let promotionCompleted: boolean;
    let promotionError: string | undefined;
    // Found during live verification: the transaction-#1 result
    // (updatedUser) is captured BEFORE assignHead() runs, so on success it
    // would otherwise echo a stale positionId — the DB itself was already
    // correct, but the HTTP response wasn't. Re-assigned only on confirmed
    // success, so a failure still returns the (accurate, non-stale)
    // transaction-#1 result — assignHead() never wrote anything in that case.
    let finalUser = updatedUser;
    try {
      await this.orgUnitHeadService.assignHead(
        dto.destinationOrgUnitId,
        { userId: user.id, positionId: dto.newPositionId },
        organizationId,
        actorId,
      );
      promotionCompleted = true;
      finalUser = await this.prisma.user.findFirst({ where: { id: user.id, organizationId } }) ?? updatedUser;
    } catch (err) {
      // Not re-thrown to the caller as a hard failure — every other
      // error row in 2.6.e rejects with nothing having changed; this one
      // is categorically different, since the core transfer itself
      // already succeeded (2.6.h's own accepted, explicitly-stated
      // tradeoff). No automatic retry — a single attempt, surfaced to a
      // human, matching this plan's "never silently escalate/assign to
      // nothing" discipline elsewhere.
      promotionCompleted = false;
      promotionError = err instanceof Error ? err.message : String(err);

      await this.auditLog.log({
        tenantId: organizationId,
        actorId,
        action: 'UPDATE',
        objectType: 'User',
        objectId: user.id,
        metadata: {
          transferPromotionFailed: true,
          reason: promotionError,
          destinationOrgUnitId: dto.destinationOrgUnitId,
        },
      });
    }

    // Step 12 — UserTransferEvent, promotion branch: written only now,
    // after assignHead() has resolved either way — isPromotion records
    // CONFIRMED outcome (true only on genuine success), promotionAttempted
    // is always true here regardless of outcome.
    await this.prisma.userTransferEvent.create({
      data: {
        organizationId,
        userId: user.id,
        sourceOrgUnitId,
        destinationOrgUnitId: dto.destinationOrgUnitId,
        sourcePositionId,
        destinationPositionId: dto.newPositionId,
        replacementUserId: replacement?.id ?? null,
        newManagerId: resolvedNewManagerId,
        isPromotion: promotionCompleted,
        promotionAttempted: true,
        performedBy: actorId,
      },
    });

    // Step 13
    return { user: finalUser, promotionCompleted, promotionError };
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

    // ACC-46 Section 2.3/2.4 — both new rules below derive from the same
    // two lookups, computed once. isInviteeTheUnitsOwnHead is the shared
    // escape valve both rules rely on: inviting someone AS the target
    // unit's own head-conferring position is how a headless unit stops
    // being headless, and the root unit's own Head is exempt from needing
    // a manager (top of the hierarchy, no parent to report to) — neither
    // is a violation of the rule it would otherwise trip.
    const targetPosition = await this.prisma.orgPosition.findFirst({
      where: { id: dto.positionId, organizationId },
    });
    const targetOrgUnit = dto.primaryOrgUnitId
      ? await this.prisma.orgUnit.findFirst({ where: { id: dto.primaryOrgUnitId, organizationId } })
      : null;
    const isInviteeTheUnitsOwnHead = !!targetPosition?.isUnitHeadPosition;
    const isRootUnitHeadInvite = isInviteeTheUnitsOwnHead && !!targetOrgUnit && targetOrgUnit.parentId === null;

    // ACC-46 Section 2.3 — managerId is required for every invite except
    // the person being invited as the root unit's own Head. Conditional,
    // not a blanket-required DTO decorator, same shape as
    // primaryOrgUnitId above (invite-user.dto.ts's own comment explains
    // why a bare @IsNotEmpty() there would reject the exemption case
    // before this check ever runs).
    if (!dto.managerId && !isRootUnitHeadInvite) {
      throw new BadRequestException('managerId is required for every invite except the root unit\'s own Head');
    }

    // ACC-46 Section 2.4 — hard block: cannot invite anyone into a unit
    // with no direct Head and no Acting Head. Escalation coverage from a
    // parent unit does NOT count — this rule only ever looks at the
    // target unit itself. isInviteeTheUnitsOwnHead is the escape valve:
    // filling the vacancy is not a violation of the rule that exists to
    // prevent leaving it unfilled.
    if (dto.primaryOrgUnitId) {
      const hasHead = await this.orgUnitHeadService.hasDirectOrActingHead(dto.primaryOrgUnitId, organizationId);
      if (!hasHead && !isInviteeTheUnitsOwnHead) {
        throw new ConflictException(
          'This org unit currently has no Head or Acting Head — assign one before inviting new staff into it',
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

    // ACC-43 — mirrors updateProfile()'s own vacancy refresh (Section
    // 2.5.1 above): invite() is the other write path that can set
    // primaryOrgUnitId, and was missing this call entirely, so a brand-new
    // invite into a Head-vacant unit never got picked up until some later,
    // unrelated profile update happened to touch that unit. The invited
    // user is INVITED, not ACTIVE, so refreshOrgUnitHeadVacancy()'s own
    // ACTIVE-only holder count correctly still reports the unit vacant
    // here — this call doesn't change what counts as covering, it just
    // makes that correct evaluation actually run at invite time instead of
    // silently never running.
    if (dto.primaryOrgUnitId) {
      await this.organizationService.refreshOrgUnitHeadVacancy(dto.primaryOrgUnitId, organizationId);
    }

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

  // ACC-46 Section 2.1 — fires when AuthService.acceptInvitation()'s own
  // Layer 2 check (validatePositionAssignment(), re-run at the moment of
  // activation) rejects a second invitee whose position/unit was already
  // claimed by a different accepted invitation in the meantime. The token
  // is deliberately preserved (not burned like the generic invalid/expired
  // case) — the conflict may resolve on its own, so the person can retry
  // the same link later. Reuses the exact Role.findFirst({key:
  // 'TENANT_ADMIN'}) -> UserRole.findMany() -> NotificationService.create()
  // chain already established by notifyTenantAdminsOfIncompleteProfiles()
  // above (and workflow.service.ts's own notifyTenantAdminsOfX() methods).
  async notifyTenantAdminsOfInviteAcceptanceConflict(
    invitedUserName: string,
    organizationId: string,
  ): Promise<void> {
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
          titleEn: 'Invitation acceptance blocked — position conflict',
          titleAr: 'تعذّر قبول الدعوة — تعارض في المسمى الوظيفي',
          bodyEn: `${invitedUserName} tried to accept their invitation, but the position/org unit is already held by another active user. Review and reassign one of the two pending invitations.`,
          bodyAr: `حاول ${invitedUserName} قبول دعوته، لكن المسمى الوظيفي/الوحدة التنظيمية مشغولة بالفعل من قبل مستخدم نشط آخر. راجع الدعوتين المعلّقتين وأعد تعيين إحداهما.`,
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

    // ACC-43 — a deactivated position was previously assignable to anyone,
    // via both invite() and updateProfile(): deactivatePosition() only
    // ever flips isActive (existing holders keep their own positionId
    // untouched, per resolveActingHeadForOrgUnit()'s own isActive-filter
    // comment), but nothing here checked it, so "deactivate" never
    // actually stopped new assignment. No isDeclaredHandoverBypass
    // exemption — a handover is only ever declared against a position
    // that already has a real, currently-active holder, so this can never
    // legitimately fire during one.
    if (!position.isActive) {
      throw new ConflictException('This position is inactive and cannot be assigned');
    }

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

    // ACC-46 Section 2.1 — counts INVITED alongside ACTIVE. Confirmed live
    // (reproduced against a running dev server, not just reasoned about):
    // two sequential invites to the same single-assignee position, made
    // before either invitee accepts, both previously passed this check —
    // an INVITED row was invisible to it, since invite() creates the new
    // user at status INVITED, never ACTIVE. Layer 2 (acceptInvitation(),
    // auth.service.ts) is the defense-in-depth half of this same fix.
    const existingHolders = await this.prisma.user.count({
      where: {
        organizationId,
        positionId: position.id,
        primaryOrgUnitId: targetPrimaryOrgUnitId,
        status: { in: ['ACTIVE', 'INVITED'] },
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
  // Post-review fix — the actual existence check moved to
  // OrgPositionService.hasAnyHeadConferringHolder(), specifically so this
  // (the write-side enforcement) and listAvailablePositionsForUser() (the
  // read-side picker filter) can no longer drift apart the way they
  // already did once: the read side used to run a narrower, same-position-
  // only check, so the wizard could offer a head-conferring position this
  // method would then unconditionally reject. Both now call the one
  // shared method.
  private async validateUnitHeadUniqueness(
    position: { id: string; isUnitHeadPosition: boolean },
    targetPrimaryOrgUnitId: string | null,
    organizationId: string,
    excludeUserId: string | null,
    isDeclaredHandoverBypass = false,
  ): Promise<void> {
    if (!position.isUnitHeadPosition) return;
    if (isDeclaredHandoverBypass) return;

    const hasAnyHeadHolder = await this.orgPositionService.hasAnyHeadConferringHolder(
      targetPrimaryOrgUnitId,
      organizationId,
      excludeUserId,
    );
    if (hasAnyHeadHolder) {
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
