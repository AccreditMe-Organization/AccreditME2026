import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PlatformGuard } from '../../common/guards/platform.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PlanService } from './plan.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { UpsertPlanModuleDto } from './dto/upsert-plan-module.dto';
import { CreateAiCreditPackDto } from './dto/create-ai-credit-pack.dto';
import { UpsertAiFeatureCostDto } from './dto/upsert-ai-feature-cost.dto';

// Platform-catalog CRUD — gated by PlatformGuard, never PermissionGuard (see
// platform.guard.ts's own header comment for why platform:admin alone isn't
// sufficient). @CurrentTenant() here is always the platform org's own id
// (PlatformGuard already required it) — passed through as the AuditLog
// tenantId for these platform-catalog mutations, not a target tenant's id.
@Controller()
@UseGuards(TenantGuard, PlatformGuard)
export class PlanController {
  constructor(private readonly planService: PlanService) {}

  // ── Plans ────────────────────────────────────────────────────────────────

  @Get('platform/plans')
  listPlans(@Query('includeInactive') includeInactive?: string) {
    return this.planService.listPlans(includeInactive === 'true');
  }

  @Get('platform/plans/:id')
  getPlanById(@Param('id') id: string) {
    return this.planService.getPlanById(id);
  }

  @Post('platform/plans')
  createPlan(
    @Body() dto: CreatePlanDto,
    @CurrentUser() actorId: string,
    @CurrentTenant() platformOrgId: string,
  ) {
    return this.planService.createPlan(dto, actorId, platformOrgId);
  }

  @Patch('platform/plans/:id')
  updatePlan(
    @Param('id') id: string,
    @Body() dto: UpdatePlanDto,
    @CurrentUser() actorId: string,
    @CurrentTenant() platformOrgId: string,
  ) {
    return this.planService.updatePlan(id, dto, actorId, platformOrgId);
  }

  @Post('platform/plans/:id/deactivate')
  @HttpCode(HttpStatus.NO_CONTENT)
  deactivatePlan(
    @Param('id') id: string,
    @CurrentUser() actorId: string,
    @CurrentTenant() platformOrgId: string,
  ) {
    return this.planService.deactivatePlan(id, actorId, platformOrgId);
  }

  // ── Plan modules ─────────────────────────────────────────────────────────

  @Get('platform/plans/:planId/modules')
  listPlanModules(@Param('planId') planId: string) {
    return this.planService.listPlanModules(planId);
  }

  @Post('platform/plans/:planId/modules')
  upsertPlanModule(
    @Param('planId') planId: string,
    @Body() dto: UpsertPlanModuleDto,
    @CurrentUser() actorId: string,
    @CurrentTenant() platformOrgId: string,
  ) {
    return this.planService.upsertPlanModule(planId, dto, actorId, platformOrgId);
  }

  // ── AI credit packs ──────────────────────────────────────────────────────

  @Get('platform/ai-credit-packs')
  listAiCreditPacks(@Query('includeInactive') includeInactive?: string) {
    return this.planService.listAiCreditPacks(includeInactive === 'true');
  }

  @Post('platform/ai-credit-packs')
  createAiCreditPack(
    @Body() dto: CreateAiCreditPackDto,
    @CurrentUser() actorId: string,
    @CurrentTenant() platformOrgId: string,
  ) {
    return this.planService.createAiCreditPack(dto, actorId, platformOrgId);
  }

  @Patch('platform/ai-credit-packs/:id')
  updateAiCreditPack(
    @Param('id') id: string,
    @Body() dto: Partial<CreateAiCreditPackDto>,
    @CurrentUser() actorId: string,
    @CurrentTenant() platformOrgId: string,
  ) {
    return this.planService.updateAiCreditPack(id, dto, actorId, platformOrgId);
  }

  // ── AI feature costs ─────────────────────────────────────────────────────

  @Get('platform/ai-feature-costs')
  listAiFeatureCosts() {
    return this.planService.listAiFeatureCosts();
  }

  @Post('platform/ai-feature-costs')
  upsertAiFeatureCost(
    @Body() dto: UpsertAiFeatureCostDto,
    @CurrentUser() actorId: string,
    @CurrentTenant() platformOrgId: string,
  ) {
    return this.planService.upsertAiFeatureCost(dto, actorId, platformOrgId);
  }
}
