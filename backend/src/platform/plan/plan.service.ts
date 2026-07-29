// PlanService — the DB-driven Plan/PlanModule/AiCreditPack/AiFeatureCost
// catalog (ACC-13). Deliberately has NO organizationId parameter anywhere —
// these are global platform-catalog entities, gated entirely by PlatformGuard
// at the controller, not by tenant scoping (there is no tenant dimension to
// scope by). No tenant isolation test applies to this service — see this
// file's own spec header comment.

import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { UpsertPlanModuleDto } from './dto/upsert-plan-module.dto';
import { CreateAiCreditPackDto } from './dto/create-ai-credit-pack.dto';
import { UpsertAiFeatureCostDto } from './dto/upsert-ai-feature-cost.dto';
import {
  IAiCreditPack,
  IAiFeatureCost,
  IPlan,
  IPlanModule,
  PlanModuleAccessLevel,
} from './interfaces/plan.interface';

// The platform org's own id is used as the tenantId on AuditLog rows for
// these platform-catalog mutations (Section 8 of the step plan) — passed in
// by the controller via @CurrentTenant() (always the platform org, since
// PlatformGuard already required it).
@Injectable()
export class PlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async listPlans(includeInactive = false): Promise<IPlan[]> {
    const plans = await this.prisma.plan.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    return plans.map((p) => this.toIPlan(p));
  }

  async getPlanById(id: string): Promise<IPlan> {
    const plan = await this.prisma.plan.findUnique({
      where: { id },
      include: { planModules: true },
    });
    if (!plan) throw new NotFoundException('Plan not found');
    return this.toIPlan(plan, plan.planModules);
  }

  async createPlan(dto: CreatePlanDto, actorId: string, platformOrgId: string): Promise<IPlan> {
    const created = await this.prisma.plan.create({
      data: {
        name: dto.name,
        nameEn: dto.nameEn,
        nameAr: dto.nameAr,
        monthlyPrice: new Prisma.Decimal(dto.monthlyPrice),
        annualPrice: new Prisma.Decimal(dto.annualPrice),
        maxFullUsers: dto.maxFullUsers ?? null,
        maxStaff: dto.maxStaff ?? null,
        maxStorageGb: dto.maxStorageGb,
        aiCreditsPerMonth: dto.aiCreditsPerMonth,
        isPublic: dto.isPublic ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
    });

    await this.auditLog.log({
      tenantId: platformOrgId,
      actorId,
      action: 'CREATE',
      objectType: 'Plan',
      objectId: created.id,
      after: created as unknown as Record<string, unknown>,
    });

    return this.toIPlan(created);
  }

  async updatePlan(id: string, dto: UpdatePlanDto, actorId: string, platformOrgId: string): Promise<IPlan> {
    await this.getPlanById(id);

    const updated = await this.prisma.plan.update({
      where: { id },
      data: {
        ...dto,
        monthlyPrice: dto.monthlyPrice !== undefined ? new Prisma.Decimal(dto.monthlyPrice) : undefined,
        annualPrice: dto.annualPrice !== undefined ? new Prisma.Decimal(dto.annualPrice) : undefined,
      },
    });

    await this.auditLog.log({
      tenantId: platformOrgId,
      actorId,
      action: 'UPDATE',
      objectType: 'Plan',
      objectId: id,
      after: dto as Record<string, unknown>,
    });

    return this.toIPlan(updated);
  }

  // Soft — isActive: false, never deleted (tenants may reference this plan
  // via Organization.planId, an ON DELETE SET NULL FK, but a hard delete
  // would still silently orphan every tenant on this plan mid-billing-cycle).
  async deactivatePlan(id: string, actorId: string, platformOrgId: string): Promise<void> {
    await this.getPlanById(id);
    await this.prisma.plan.update({ where: { id }, data: { isActive: false } });

    await this.auditLog.log({
      tenantId: platformOrgId,
      actorId,
      action: 'UPDATE',
      objectType: 'Plan',
      objectId: id,
      metadata: { event: 'deactivated' },
    });
  }

  async listPlanModules(planId: string): Promise<IPlanModule[]> {
    const rows = await this.prisma.planModule.findMany({ where: { planId } });
    return rows.map((r) => this.toIPlanModule(r));
  }

  async upsertPlanModule(
    planId: string,
    dto: UpsertPlanModuleDto,
    actorId: string,
    platformOrgId: string,
  ): Promise<IPlanModule> {
    await this.getPlanById(planId);

    const upserted = await this.prisma.planModule.upsert({
      where: { planId_moduleKey: { planId, moduleKey: dto.moduleKey } },
      update: { accessLevel: dto.accessLevel },
      create: { planId, moduleKey: dto.moduleKey, accessLevel: dto.accessLevel },
    });

    await this.auditLog.log({
      tenantId: platformOrgId,
      actorId,
      action: 'UPDATE',
      objectType: 'PlanModule',
      objectId: upserted.id,
      after: { moduleKey: dto.moduleKey, accessLevel: dto.accessLevel },
    });

    return this.toIPlanModule(upserted);
  }

  async listAiCreditPacks(includeInactive = false): Promise<IAiCreditPack[]> {
    const packs = await this.prisma.aiCreditPack.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    return packs.map((p) => this.toIAiCreditPack(p));
  }

  async createAiCreditPack(dto: CreateAiCreditPackDto, actorId: string, platformOrgId: string): Promise<IAiCreditPack> {
    const created = await this.prisma.aiCreditPack.create({
      data: {
        name: dto.name,
        nameAr: dto.nameAr ?? null,
        credits: dto.credits,
        price: new Prisma.Decimal(dto.price),
        isActive: dto.isActive ?? true,
        availableTo: dto.availableTo ?? [],
        sortOrder: dto.sortOrder ?? 0,
      },
    });

    await this.auditLog.log({
      tenantId: platformOrgId,
      actorId,
      action: 'CREATE',
      objectType: 'AiCreditPack',
      objectId: created.id,
      after: created as unknown as Record<string, unknown>,
    });

    return this.toIAiCreditPack(created);
  }

  async updateAiCreditPack(
    id: string,
    dto: Partial<CreateAiCreditPackDto>,
    actorId: string,
    platformOrgId: string,
  ): Promise<IAiCreditPack> {
    const existing = await this.prisma.aiCreditPack.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('AI credit pack not found');

    const updated = await this.prisma.aiCreditPack.update({
      where: { id },
      data: {
        ...dto,
        price: dto.price !== undefined ? new Prisma.Decimal(dto.price) : undefined,
      },
    });

    await this.auditLog.log({
      tenantId: platformOrgId,
      actorId,
      action: 'UPDATE',
      objectType: 'AiCreditPack',
      objectId: id,
      after: dto as Record<string, unknown>,
    });

    return this.toIAiCreditPack(updated);
  }

  async listAiFeatureCosts(): Promise<IAiFeatureCost[]> {
    const rows = await this.prisma.aiFeatureCost.findMany({ orderBy: { featureKey: 'asc' } });
    return rows.map((r) => this.toIAiFeatureCost(r));
  }

  async upsertAiFeatureCost(dto: UpsertAiFeatureCostDto, actorId: string, platformOrgId: string): Promise<IAiFeatureCost> {
    const upserted = await this.prisma.aiFeatureCost.upsert({
      where: { featureKey: dto.featureKey },
      update: { creditCost: dto.creditCost, description: dto.description ?? null },
      create: { featureKey: dto.featureKey, creditCost: dto.creditCost, description: dto.description ?? null },
    });

    await this.auditLog.log({
      tenantId: platformOrgId,
      actorId,
      action: 'UPDATE',
      objectType: 'AiFeatureCost',
      objectId: upserted.id,
      after: { featureKey: dto.featureKey, creditCost: dto.creditCost },
    });

    return this.toIAiFeatureCost(upserted);
  }

  private toIPlan(
    plan: {
      id: string;
      name: string;
      nameEn: string;
      nameAr: string;
      monthlyPrice: Prisma.Decimal;
      annualPrice: Prisma.Decimal;
      maxFullUsers: number | null;
      maxStaff: number | null;
      maxStorageGb: number;
      aiCreditsPerMonth: number;
      isActive: boolean;
      isPublic: boolean;
      sortOrder: number;
      createdAt: Date;
      updatedAt: Date;
    },
    planModules?: { id: string; planId: string; moduleKey: string; accessLevel: string }[],
  ): IPlan {
    return {
      id: plan.id,
      name: plan.name,
      nameEn: plan.nameEn,
      nameAr: plan.nameAr,
      monthlyPrice: plan.monthlyPrice.toString(),
      annualPrice: plan.annualPrice.toString(),
      maxFullUsers: plan.maxFullUsers,
      maxStaff: plan.maxStaff,
      maxStorageGb: plan.maxStorageGb,
      aiCreditsPerMonth: plan.aiCreditsPerMonth,
      isActive: plan.isActive,
      isPublic: plan.isPublic,
      sortOrder: plan.sortOrder,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
      planModules: planModules?.map((m) => this.toIPlanModule(m)),
    };
  }

  private toIPlanModule(row: { id: string; planId: string; moduleKey: string; accessLevel: string }): IPlanModule {
    return {
      id: row.id,
      planId: row.planId,
      moduleKey: row.moduleKey,
      accessLevel: row.accessLevel as PlanModuleAccessLevel,
    };
  }

  private toIAiCreditPack(row: {
    id: string;
    name: string;
    nameAr: string | null;
    credits: number;
    price: Prisma.Decimal;
    isActive: boolean;
    availableTo: string[];
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
  }): IAiCreditPack {
    return {
      id: row.id,
      name: row.name,
      nameAr: row.nameAr,
      credits: row.credits,
      price: row.price.toString(),
      isActive: row.isActive,
      availableTo: row.availableTo,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toIAiFeatureCost(row: {
    id: string;
    featureKey: string;
    creditCost: number;
    description: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): IAiFeatureCost {
    return {
      id: row.id,
      featureKey: row.featureKey,
      creditCost: row.creditCost,
      description: row.description,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
