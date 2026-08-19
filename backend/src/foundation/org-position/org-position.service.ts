import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { CreateOrgPositionDto } from './dto/create-org-position.dto';
import { UpdateOrgPositionDto } from './dto/update-org-position.dto';
import { IOrgPosition } from './interfaces/org-position.interface';
import { DEFAULT_POSITIONS } from './org-position.seed';

@Injectable()
export class OrgPositionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
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

  // THE CORE METHOD — used by TaskService (and, in later steps, Committees/
  // Meetings/Documents/CAPA/Audits per the Step 8 plan's Section 7).
  async validateEscalationTarget(
    assigneeIds: string[],
    escalationUserId: string,
    organizationId: string,
  ): Promise<void> {
    const assignees = await this.prisma.user.findMany({
      where: { id: { in: assigneeIds }, organizationId },
      include: { position: true },
    });

    const maxAssigneeGrade = Math.max(0, ...assignees.map((a) => a.position?.grade ?? 0));
    const assigneeOrgUnitIds = assignees
      .map((a) => a.primaryOrgUnitId)
      .filter((id): id is string => !!id);

    const target = await this.prisma.user.findFirst({
      where: { id: escalationUserId, organizationId },
      include: { position: true },
    });
    if (!target) {
      throw new BadRequestException('Escalation target not found in this organization');
    }

    const targetGrade = target.position?.grade ?? 0;
    if (targetGrade < maxAssigneeGrade) {
      throw new BadRequestException(
        'Escalation target must have equal or higher grade than the assignee',
      );
    }

    const inSameOrParentUnit = await this.isInSameOrParentOrgUnit(
      target.primaryOrgUnitId,
      assigneeOrgUnitIds,
      organizationId,
    );
    if (!inSameOrParentUnit) {
      throw new BadRequestException(
        'Escalation target must be in the same or parent org unit as the assignee',
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

  // Traverses OrgUnit.parentId upward from targetOrgUnitId. True if it equals
  // any assigneeOrgUnitId or any of their ancestors.
  private async isInSameOrParentOrgUnit(
    targetOrgUnitId: string | null,
    assigneeOrgUnitIds: string[],
    organizationId: string,
  ): Promise<boolean> {
    if (!targetOrgUnitId) return false; // no primaryOrgUnitId — fails the check unconditionally
    if (assigneeOrgUnitIds.length === 0) return true; // no assignee has an org unit — nothing to violate

    for (const assigneeOrgUnitId of assigneeOrgUnitIds) {
      let current: string | null = assigneeOrgUnitId;
      while (current) {
        if (current === targetOrgUnitId) return true;
        const unit: { parentId: string | null } | null = await this.prisma.orgUnit.findFirst({
          where: { id: current, organizationId },
          select: { parentId: true },
        });
        current = unit?.parentId ?? null;
      }
    }

    return false;
  }
}
