import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { NotificationService } from '../notification/notification.service';
import { OrganizationService } from '../organization/organization.service';
import { CreateOrgPositionDto } from './dto/create-org-position.dto';
import { UpdateOrgPositionDto } from './dto/update-org-position.dto';
import { IOrgPosition } from './interfaces/org-position.interface';
import { DEFAULT_POSITIONS } from './org-position.seed';

@Injectable()
export class OrgPositionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly organizationService: OrganizationService,
    // NotificationModule is @Global() — no explicit import needed in
    // org-position.module.ts, same precedent as RolesModule for
    // PERMISSION_RESOLVER.
    private readonly notificationService: NotificationService,
  ) {}

  // Upserts the 10 org-wide default positions for one tenant. Idempotent —
  // safe to call repeatedly. Called by TenantService.bootstrap().
  async seedDefaultPositions(organizationId: string): Promise<void> {
    for (const position of DEFAULT_POSITIONS) {
      const existing = await this.prisma.orgPosition.findFirst({
        where: { organizationId, nameEn: position.nameEn },
      });
      if (existing) continue;

      await this.prisma.orgPosition.create({
        data: {
          organizationId,
          nameEn: position.nameEn,
          nameAr: position.nameAr,
          grade: position.grade,
          // ACC-46 Section 2.5 — both set from the same seed flag, never
          // independently: isUnitHeadPosition: true requires
          // isSingleAssignee: true (schema-enforced pairing,
          // validateHeadFlagPairing()), which this direct prisma.create()
          // call bypasses entirely (it doesn't go through
          // createPosition()) — the seed data has to satisfy the
          // invariant itself.
          isUnitHeadPosition: position.isUnitHeadPosition ?? false,
          isSingleAssignee: position.isUnitHeadPosition ?? false,
        },
      });
    }
  }

  // ACC-40 Section 2.1 — OrgPosition is now an org-wide catalog (no more
  // per-OrgUnit scoping), so this simply lists every position for the
  // tenant. No orgUnitId parameter anymore.
  async listPositions(organizationId: string): Promise<IOrgPosition[]> {
    return this.prisma.orgPosition.findMany({
      where: { organizationId },
      orderBy: [{ grade: 'desc' }, { nameEn: 'asc' }],
    });
  }

  async getPositionById(id: string, organizationId: string): Promise<IOrgPosition> {
    const position = await this.prisma.orgPosition.findFirst({ where: { id, organizationId } });
    if (!position) {
      throw new NotFoundException('Org position not found');
    }
    return position;
  }

  async createPosition(
    dto: CreateOrgPositionDto,
    organizationId: string,
    actorId: string,
  ): Promise<IOrgPosition> {
    this.validateHeadFlagPairing(dto.isUnitHeadPosition ?? false, dto.isSingleAssignee ?? false);
    if (dto.roleId) {
      await this.validateRoleReference(dto.roleId, organizationId);
    }

    const position = await this.prisma.orgPosition.create({
      data: {
        organizationId,
        nameEn: dto.nameEn,
        nameAr: dto.nameAr ?? null,
        grade: dto.grade,
        isSingleAssignee: dto.isSingleAssignee ?? false,
        isUnitHeadPosition: dto.isUnitHeadPosition ?? false,
        roleId: dto.roleId ?? null,
      },
    });

    await this.auditLog.log({
      action: 'CREATE',
      objectType: 'OrgPosition',
      objectId: position.id,
      actorId,
      tenantId: organizationId,
      after: position,
    });

    return position;
  }

  async updatePosition(
    id: string,
    dto: UpdateOrgPositionDto,
    organizationId: string,
    actorId: string,
  ): Promise<IOrgPosition> {
    const existing = await this.getPositionById(id, organizationId);

    // Partial dto merged onto the existing row — isUnitHeadPosition/
    // isSingleAssignee must be validated as a pair reflecting the resulting
    // state, not just whichever field this particular update happens to
    // touch (ACC-40 Section 2.1).
    this.validateHeadFlagPairing(
      dto.isUnitHeadPosition ?? existing.isUnitHeadPosition,
      dto.isSingleAssignee ?? existing.isSingleAssignee,
    );
    if (dto.roleId) {
      await this.validateRoleReference(dto.roleId, organizationId);
    }

    const position = await this.prisma.orgPosition.update({
      where: { id },
      data: dto,
    });

    await this.auditLog.log({
      action: 'UPDATE',
      objectType: 'OrgPosition',
      objectId: position.id,
      actorId,
      tenantId: organizationId,
      before: existing as unknown as Record<string, unknown>,
      after: position,
    });

    return position;
  }

  async deactivatePosition(id: string, organizationId: string, actorId: string): Promise<void> {
    const existing = await this.getPositionById(id, organizationId);
    if (!existing.isActive) return; // idempotent — already inactive

    const position = await this.prisma.orgPosition.update({
      where: { id },
      data: { isActive: false },
    });

    await this.auditLog.log({
      action: 'UPDATE',
      objectType: 'OrgPosition',
      objectId: id,
      actorId,
      tenantId: organizationId,
      before: existing as unknown as Record<string, unknown>,
      after: position,
    });

    // ACC-40 Section 2.5.1 — deactivating a position never clears its
    // holders' own positionId (see resolveActingHeadForOrgUnit()'s
    // position.isActive filter comment) — refresh every distinct org unit
    // an ACTIVE holder of this position sits in, since the position's own
    // deactivation may have just made that unit's Head vacant.
    const holders = await this.prisma.user.findMany({
      where: { organizationId, positionId: id, status: 'ACTIVE' },
      select: { primaryOrgUnitId: true },
    });
    const affectedOrgUnitIds = new Set(
      holders.map((h) => h.primaryOrgUnitId).filter((v): v is string => !!v),
    );
    for (const orgUnitId of affectedOrgUnitIds) {
      await this.organizationService.refreshOrgUnitHeadVacancy(orgUnitId, organizationId);
    }
  }

  // Mirrors RoleService.reactivateRole() exactly (ACC-40 — a distinct
  // concern from the main OrgPosition redesign, bundled into the same
  // phase for convenience).
  async reactivatePosition(id: string, organizationId: string, actorId: string): Promise<void> {
    const position = await this.prisma.orgPosition.findFirst({ where: { id, organizationId } });
    if (!position) throw new NotFoundException('Org position not found');
    if (position.isActive) return;

    await this.prisma.orgPosition.update({ where: { id }, data: { isActive: true } });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'UPDATE',
      objectType: 'OrgPosition',
      objectId: position.id,
      before: { isActive: false },
      after: { isActive: true },
    });
  }

  // ACC-46 Section 2.6.a — "which positions can this specific person hold
  // in this specific unit," generalized beyond head-conferring positions:
  // an ORDINARY single-assignee position (not head-conferring) needs the
  // identical exclusion logic, which a head-only design would miss.
  // Filters on isSingleAssignee (not isUnitHeadPosition) — correctly
  // covers both cases in one query; ordinary multi-assignee positions
  // always pass through untouched. candidateUserId is excluded from the
  // "already holds it" set — a person doesn't block themselves from a
  // position they may already hold (e.g. re-confirming their own current
  // position as part of a transfer that changes only their unit).
  async listAvailablePositionsForUser(
    candidateUserId: string,
    orgUnitId: string,
    organizationId: string,
  ): Promise<IOrgPosition[]> {
    const allPositions = await this.prisma.orgPosition.findMany({
      where: { organizationId, isActive: true },
    });
    const heldSingleAssigneePositionIds = new Set(
      (
        await this.prisma.user.findMany({
          where: {
            organizationId,
            primaryOrgUnitId: orgUnitId,
            status: { in: ['ACTIVE', 'INVITED'] }, // matches 2.1's INVITED-status fix
            position: { isSingleAssignee: true },
            id: { not: candidateUserId },
          },
          select: { positionId: true },
        })
      ).map((u) => u.positionId),
    );
    return allPositions.filter(
      (p) => !p.isSingleAssignee || !heldSingleAssigneePositionIds.has(p.id),
    );
  }

  // ACC-40 Section 2.9e — remediation report, matching 2.4's exact
  // three-part chain (Role.findFirst(TENANT_ADMIN) -> UserRole.findMany()
  // -> NotificationService.create() per admin), same "a report, not a
  // script" framing: the correct role to map to a position is exactly as
  // undecidable programmatically as the correct position/org-unit
  // mapping for a user was in 2.4.
  //
  // Surfaces two related-but-not-strictly-joined signals together, not
  // one filtered query: (i) OrgUnit rows currently isHeadVacant: true
  // (2.5's existing cache), and (ii) isUnitHeadPosition: true positions
  // currently roleId: null. A head-conferring position is a tenant-wide
  // catalog entry, not scoped to one OrgUnit -- there is no single
  // well-defined "this vacant unit's head-conferring position" to join
  // against for a unit that has never had any holder at all. Reported
  // together because they're the same class of configuration gap
  // ("head-authority setup incomplete") -- a human Tenant Admin reading
  // both lists already knows which positions are used in which units
  // and can correlate them, which a database join cannot do reliably.
  async notifyTenantAdminsOfVacantHeadRoleMappings(organizationId: string): Promise<void> {
    const vacantUnits = await this.prisma.orgUnit.findMany({
      where: { organizationId, isHeadVacant: true },
      select: { nameEn: true },
    });
    const unmappedPositions = await this.prisma.orgPosition.findMany({
      where: { organizationId, isUnitHeadPosition: true, roleId: null },
      select: { nameEn: true },
    });
    if (vacantUnits.length === 0 && unmappedPositions.length === 0) return;

    const adminRole = await this.prisma.role.findFirst({
      where: { organizationId, key: 'TENANT_ADMIN' },
    });
    if (!adminRole) return;

    const adminUserRoles = await this.prisma.userRole.findMany({
      where: { roleId: adminRole.id, user: { organizationId, status: 'ACTIVE' } },
    });

    const bodyEnParts: string[] = [];
    const bodyArParts: string[] = [];
    if (vacantUnits.length > 0) {
      bodyEnParts.push(
        `${vacantUnits.length} org unit(s) have no Head: ${vacantUnits.map((u) => u.nameEn).join(', ')}.`,
      );
      bodyArParts.push(
        `${vacantUnits.length} وحدة تنظيمية بلا رئيس: ${vacantUnits.map((u) => u.nameEn).join(', ')}.`,
      );
    }
    if (unmappedPositions.length > 0) {
      bodyEnParts.push(
        `${unmappedPositions.length} Head-conferring position(s) have no mapped role: ${unmappedPositions.map((p) => p.nameEn).join(', ')}.`,
      );
      bodyArParts.push(
        `${unmappedPositions.length} مسمى وظيفي يمنح صلاحية الرئاسة بلا دور مرتبط: ${unmappedPositions.map((p) => p.nameEn).join(', ')}.`,
      );
    }

    for (const userRole of adminUserRoles) {
      await this.notificationService.create(
        {
          userId: userRole.userId,
          titleEn: 'Head-authority setup incomplete',
          titleAr: 'إعداد صلاحية الرئاسة غير مكتمل',
          bodyEn: bodyEnParts.join(' '),
          bodyAr: bodyArParts.join(' '),
        },
        organizationId,
      );
    }
  }

  // ACC-40 Section 2.1 — a head-conferring position that permits multiple
  // simultaneous holders would recreate the exact ambiguity ("who is the
  // head of this unit") this whole design exists to remove. Validated
  // centrally here, not trusted to client-side enforcement alone.
  private validateHeadFlagPairing(isUnitHeadPosition: boolean, isSingleAssignee: boolean): void {
    if (isUnitHeadPosition && !isSingleAssignee) {
      throw new BadRequestException(
        'A head-conferring position must also be single-assignee',
      );
    }
  }

  // ACC-40 Section 2.9c — same validateRoleReference() shape as
  // CommitteesService's reportingToRoleId check, plus the PLATFORM_ADMIN/
  // TENANT_ADMIN hard-exclusion specific to this field: granting either
  // automatically as a side effect of holding an ordinary-sounding position
  // (rather than through the deliberate Roles UI) is a real self-escalation
  // risk, not merely a redundant safeguard.
  private async validateRoleReference(roleId: string, organizationId: string): Promise<void> {
    const role = await this.prisma.role.findFirst({ where: { id: roleId, organizationId } });
    if (!role) {
      throw new NotFoundException('Role not found in this tenant');
    }
    if (role.key === 'PLATFORM_ADMIN' || role.key === 'TENANT_ADMIN') {
      throw new BadRequestException(
        'PLATFORM_ADMIN and TENANT_ADMIN cannot be mapped to an org position',
      );
    }
  }

  // ACC-46 Section 2.7.e — replaces validateEscalationTarget() entirely
  // (deleted in this ticket's Commit 1). Resolvers, not validators: escalation
  // targets are now fully automatic (2.7.b — no human picks a target), so
  // there is nothing left to validate against a caller-supplied id, only
  // something to resolve fresh at firing time. Resolved live on every sweep
  // — never precomputed or stored on the Task row (2.7.e) — since a Manager
  // can change between task creation and the task actually going overdue.
  //
  // PD#8, decided: returns EVERY distinct target across all assignees, not
  // just the first one in array order — silently dropping part of a task's
  // accountability chain because of array position was judged inconsistent
  // with this being a compliance-oriented product.
  async resolveManagerEscalationTargets(
    assigneeIds: string[],
    organizationId: string,
  ): Promise<string[]> {
    const assignees = await this.prisma.user.findMany({
      where: { id: { in: assigneeIds }, organizationId, status: 'ACTIVE' },
    });
    const managerIds = assignees.map((a) => a.managerId).filter((id): id is string => !!id);
    return [...new Set(managerIds)]; // dedup — two assignees sharing one manager notify that manager once, not twice
  }

  // PD#9, decided: the Head tier DOES count Acting Head coverage, not only a
  // direct Head-conferring-position holder — falls back to
  // OrgUnit.actingHeadUserId when no direct holder exists, mirroring
  // assignHead()'s own holders[0]?.id ?? actingHeadUserId pattern (2.6.d). A
  // vacancy genuinely covered by an Acting Head should still receive
  // escalation, not be silently skipped.
  async resolveHeadEscalationTargets(
    assigneeIds: string[],
    organizationId: string,
  ): Promise<string[]> {
    const assignees = await this.prisma.user.findMany({
      where: { id: { in: assigneeIds }, organizationId, status: 'ACTIVE' },
    });
    const orgUnitIds = [
      ...new Set(assignees.map((a) => a.primaryOrgUnitId).filter((id): id is string => !!id)),
    ];

    const targets = new Set<string>();
    for (const orgUnitId of orgUnitIds) {
      const directHolder = await this.prisma.user.findFirst({
        where: {
          organizationId,
          primaryOrgUnitId: orgUnitId,
          status: 'ACTIVE',
          position: { isUnitHeadPosition: true },
        },
      });
      if (directHolder) {
        targets.add(directHolder.id);
        continue;
      }
      const orgUnit = await this.prisma.orgUnit.findFirst({ where: { id: orgUnitId, organizationId } });
      if (orgUnit?.actingHeadUserId) targets.add(orgUnit.actingHeadUserId);
    }
    return [...targets]; // one distinct unit could still resolve to the same person as another via Acting Head coverage — Set already dedups that too
  }
}
