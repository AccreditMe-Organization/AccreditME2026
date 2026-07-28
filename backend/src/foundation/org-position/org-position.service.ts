import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { CreateOrgPositionDto } from './dto/create-org-position.dto';
import { UpdateOrgPositionDto } from './dto/update-org-position.dto';
import { IOrgPosition } from './interfaces/org-position.interface';

interface DefaultPositionSeed {
  nameEn: string;
  nameAr: string;
  grade: number;
}

// 10 org-wide default positions (orgUnitId: null) — module-designs.md's
// "Org Position Module" section. Grade 1 = lowest, 10 = highest.
const DEFAULT_POSITIONS: DefaultPositionSeed[] = [
  { nameEn: 'Director', nameAr: 'مدير عام', grade: 10 },
  { nameEn: 'Deputy Director', nameAr: 'نائب المدير العام', grade: 9 },
  { nameEn: 'Department Head', nameAr: 'رئيس قسم', grade: 8 },
  { nameEn: 'Section Manager', nameAr: 'مدير شعبة', grade: 7 },
  { nameEn: 'Senior Specialist', nameAr: 'أخصائي أول', grade: 6 },
  { nameEn: 'Specialist', nameAr: 'أخصائي', grade: 5 },
  { nameEn: 'Senior Technician', nameAr: 'فني أول', grade: 4 },
  { nameEn: 'Technician', nameAr: 'فني', grade: 3 },
  { nameEn: 'Coordinator', nameAr: 'منسق', grade: 2 },
  { nameEn: 'Staff', nameAr: 'موظف', grade: 1 },
];

@Injectable()
export class OrgPositionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  // Upserts the 10 org-wide default positions for one tenant. Idempotent —
  // safe to call repeatedly. Called by TenantService.bootstrap().
  //
  // Not a real Prisma upsert() — the generated compound-unique input type for
  // organizationId_orgUnitId_nameEn types orgUnitId as `string`, not
  // `string | null`, even though the column is nullable (a known Prisma
  // type-generation gap for compound unique indexes containing a nullable
  // field). findFirst + conditional create sidesteps it cleanly.
  async seedDefaultPositions(organizationId: string): Promise<void> {
    for (const position of DEFAULT_POSITIONS) {
      const existing = await this.prisma.orgPosition.findFirst({
        where: { organizationId, orgUnitId: null, nameEn: position.nameEn },
      });
      if (existing) continue;

      await this.prisma.orgPosition.create({
        data: {
          organizationId,
          orgUnitId: null,
          nameEn: position.nameEn,
          nameAr: position.nameAr,
          grade: position.grade,
        },
      });
    }
  }

  async listPositions(organizationId: string, orgUnitId?: string): Promise<IOrgPosition[]> {
    return this.prisma.orgPosition.findMany({
      where: {
        organizationId,
        OR: orgUnitId ? [{ orgUnitId: null }, { orgUnitId }] : [{ orgUnitId: null }],
      },
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
    if (dto.orgUnitId) {
      const orgUnit = await this.prisma.orgUnit.findFirst({
        where: { id: dto.orgUnitId, organizationId },
      });
      if (!orgUnit) {
        throw new BadRequestException('orgUnitId does not belong to this organization');
      }
    }

    const position = await this.prisma.orgPosition.create({
      data: {
        organizationId,
        nameEn: dto.nameEn,
        nameAr: dto.nameAr ?? null,
        orgUnitId: dto.orgUnitId ?? null,
        grade: dto.grade,
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

    if (dto.orgUnitId) {
      const orgUnit = await this.prisma.orgUnit.findFirst({
        where: { id: dto.orgUnitId, organizationId },
      });
      if (!orgUnit) {
        throw new BadRequestException('orgUnitId does not belong to this organization');
      }
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
