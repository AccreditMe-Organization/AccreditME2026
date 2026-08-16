import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { IOrgUnit } from './interfaces/org-unit.interface';
import { CreateOrgUnitDto } from './dto/create-org-unit.dto';
import { UpdateOrgUnitDto } from './dto/update-org-unit.dto';

@Injectable()
export class OrganizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async getTree(organizationId: string): Promise<IOrgUnit[]> {
    const all = await this.prisma.orgUnit.findMany({
      where: { organizationId },
      orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
    });
    return this.buildTree(all, null);
  }

  async listFlat(organizationId: string): Promise<IOrgUnit[]> {
    const units = await this.prisma.orgUnit.findMany({
      where: { organizationId },
      orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
    });
    return units.map((u) => this.toInterface(u));
  }

  async findById(id: string, organizationId: string): Promise<IOrgUnit> {
    const unit = await this.prisma.orgUnit.findFirst({
      where: { id, organizationId },
    });
    if (!unit) throw new NotFoundException('Org unit not found');
    return this.toInterface(unit);
  }

  async create(
    organizationId: string,
    dto: CreateOrgUnitDto,
    actorId: string,
  ): Promise<IOrgUnit> {
    if (dto.parentId) {
      const parent = await this.prisma.orgUnit.findFirst({
        where: { id: dto.parentId, organizationId },
      });
      if (!parent) throw new NotFoundException('Parent org unit not found');
    }

    const existing = await this.prisma.orgUnit.findFirst({
      where: { organizationId, code: dto.code },
    });
    if (existing) {
      throw new ConflictException(`Code "${dto.code}" is already in use in this organization`);
    }

    const unit = await this.prisma.orgUnit.create({
      data: {
        organizationId,
        parentId: dto.parentId ?? null,
        nameEn: dto.nameEn,
        nameAr: dto.nameAr ?? null,
        code: dto.code,
        type: dto.type ?? null,
        description: dto.description ?? null,
        sortOrder: dto.sortOrder ?? 0,
      },
    });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'CREATE',
      objectType: 'OrgUnit',
      objectId: unit.id,
      after: this.toInterface(unit) as unknown as Record<string, unknown>,
    });

    return this.toInterface(unit);
  }

  async update(
    id: string,
    organizationId: string,
    dto: UpdateOrgUnitDto,
    actorId: string,
  ): Promise<IOrgUnit> {
    const unit = await this.prisma.orgUnit.findFirst({
      where: { id, organizationId },
    });
    if (!unit) throw new NotFoundException('Org unit not found');

    // Code is permanently locked once a document number has been generated using it
    if (dto.code !== undefined && dto.code !== unit.code && unit.isCodeLocked) {
      throw new ForbiddenException(
        'Unit code is locked and cannot be changed after document numbers have been generated using it',
      );
    }

    // Validate code uniqueness if changing it
    if (dto.code !== undefined && dto.code !== unit.code) {
      const conflict = await this.prisma.orgUnit.findFirst({
        where: { organizationId, code: dto.code, id: { not: id } },
      });
      if (conflict) {
        throw new ConflictException(`Code "${dto.code}" is already in use in this organization`);
      }
    }

    // Setting parentId to null promotes the unit to root level — intentional
    // Setting parentId to another unit moves it in the hierarchy
    if (dto.parentId !== undefined && dto.parentId !== null) {
      if (dto.parentId === id) {
        throw new ConflictException('An org unit cannot be its own parent');
      }
      const parent = await this.prisma.orgUnit.findFirst({
        where: { id: dto.parentId, organizationId },
      });
      if (!parent) throw new NotFoundException('Parent org unit not found');
    }

    const before = this.toInterface(unit);

    const updated = await this.prisma.orgUnit.update({
      where: { id },
      data: {
        ...(dto.nameEn !== undefined && { nameEn: dto.nameEn }),
        ...(dto.nameAr !== undefined && { nameAr: dto.nameAr }),
        ...(dto.code !== undefined && { code: dto.code }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
        ...(dto.parentId !== undefined && { parentId: dto.parentId }),
      },
    });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'UPDATE',
      objectType: 'OrgUnit',
      objectId: id,
      before: before as unknown as Record<string, unknown>,
      after: this.toInterface(updated) as unknown as Record<string, unknown>,
    });

    return this.toInterface(updated);
  }

  async deactivate(
    id: string,
    organizationId: string,
    actorId: string,
  ): Promise<IOrgUnit> {
    const unit = await this.prisma.orgUnit.findFirst({
      where: { id, organizationId },
    });
    if (!unit) throw new NotFoundException('Org unit not found');

    // Idempotent — already inactive
    if (!unit.isActive) return this.toInterface(unit);

    const blockers: string[] = [];

    // Check active child org units (available now — same module)
    const activeChildren = await this.prisma.orgUnit.count({
      where: { parentId: id, organizationId, isActive: true },
    });
    if (activeChildren > 0) {
      blockers.push(`${activeChildren} active child unit(s) must be deactivated first`);
    }

    // Users shipped at ACC-12 — this blocker is no longer deferred.
    const activeUsers = await this.prisma.user.count({
      where: { primaryOrgUnitId: id, organizationId, status: 'ACTIVE' },
    });
    if (activeUsers > 0) blockers.push(`${activeUsers} active user(s) are assigned to this unit`);

    // TODO(Step 17 — Documents): check for active documents owned by this org unit
    // const activeDocs = await this.prisma.document.count({
    //   where: { ownerOrgUnitId: id, organizationId, status: { not: 'OBSOLETE' } },
    // });
    // if (activeDocs > 0) blockers.push(`${activeDocs} active document(s) are owned by this unit`);

    // TODO(Step 18 — Quality Improvement): check for open incidents referencing this org unit
    // const openIncidents = await this.prisma.incident.count({
    //   where: { orgUnitId: id, organizationId, status: { not: 'CLOSED' } },
    // });
    // if (openIncidents > 0) blockers.push(`${openIncidents} open incident(s) reference this unit`);

    // TODO(Step 6 — Workflow): check for active workflow instances in this org unit
    // const activeWorkflows = await this.prisma.workflowInstance.count({
    //   where: { orgUnitId: id, organizationId, status: { in: ['PENDING', 'IN_PROGRESS'] } },
    // });
    // if (activeWorkflows > 0) blockers.push(`${activeWorkflows} active workflow instance(s) are running in this unit`);

    if (blockers.length > 0) {
      throw new ConflictException({
        message: 'Cannot deactivate org unit — active dependencies exist',
        blockers,
      });
    }

    const before = this.toInterface(unit);

    const updated = await this.prisma.orgUnit.update({
      where: { id },
      data: { isActive: false },
    });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'UPDATE',
      objectType: 'OrgUnit',
      objectId: id,
      before: before as unknown as Record<string, unknown>,
      after: this.toInterface(updated) as unknown as Record<string, unknown>,
    });

    return this.toInterface(updated);
  }

  // Used by TenantService.bootstrap() to seed the root org unit without injecting this service
  static generateCode(nameEn: string): string {
    return nameEn
      .toUpperCase()
      .replace(/[^A-Z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 10);
  }

  private buildTree(
    all: Array<{
      id: string; organizationId: string; parentId: string | null;
      nameEn: string; nameAr: string | null; code: string;
      type: string | null; description: string | null;
      isActive: boolean; isCodeLocked: boolean; sortOrder: number;
      createdAt: Date; updatedAt: Date;
    }>,
    parentId: string | null,
  ): IOrgUnit[] {
    return all
      .filter((u) => u.parentId === parentId)
      .map((u) => ({
        ...this.toInterface(u),
        children: this.buildTree(all, u.id),
      }));
  }

  private toInterface(record: {
    id: string; organizationId: string; parentId: string | null;
    nameEn: string; nameAr: string | null; code: string;
    type: string | null; description: string | null;
    isActive: boolean; isCodeLocked: boolean; sortOrder: number;
    createdAt: Date; updatedAt: Date;
  }): IOrgUnit {
    return {
      id: record.id,
      organizationId: record.organizationId,
      parentId: record.parentId,
      nameEn: record.nameEn,
      nameAr: record.nameAr,
      code: record.code,
      type: record.type,
      description: record.description,
      isActive: record.isActive,
      isCodeLocked: record.isCodeLocked,
      sortOrder: record.sortOrder,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
