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
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PlatformGuard } from '../../common/guards/platform.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PlatformTenantService } from './platform-tenant.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantModulesDto } from './dto/update-tenant-modules.dto';
import { AllocateAiCreditsDto } from './dto/allocate-ai-credits.dto';
import { ExtendTrialDto } from './dto/extend-trial.dto';

@Controller('platform')
export class PlatformTenantController {
  constructor(private readonly platformTenantService: PlatformTenantService) {}

  @Get('tenants')
  @UseGuards(TenantGuard, PlatformGuard)
  listTenants(
    @Query('status') status?: 'TRIAL' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED' | 'OFFBOARDING',
    @Query('planId') planId?: string,
  ) {
    return this.platformTenantService.listTenants({ status, planId });
  }

  @Get('tenants/:id')
  @UseGuards(TenantGuard, PlatformGuard)
  getTenantDetail(@Param('id') id: string) {
    return this.platformTenantService.getTenantDetail(id);
  }

  @Post('tenants')
  @UseGuards(TenantGuard, PlatformGuard)
  createTenant(@Body() dto: CreateTenantDto, @CurrentUser() actorId: string) {
    return this.platformTenantService.createTenant(dto, actorId);
  }

  @Post('tenants/:id/suspend')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(TenantGuard, PlatformGuard)
  suspendTenant(@Param('id') id: string, @CurrentUser() actorId: string) {
    return this.platformTenantService.suspendTenant(id, actorId);
  }

  @Post('tenants/:id/reactivate')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(TenantGuard, PlatformGuard)
  reactivateTenant(@Param('id') id: string, @CurrentUser() actorId: string) {
    return this.platformTenantService.reactivateTenant(id, actorId);
  }

  @Post('tenants/:id/extend-trial')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(TenantGuard, PlatformGuard)
  extendTrial(
    @Param('id') id: string,
    @Body() dto: ExtendTrialDto,
    @CurrentUser() actorId: string,
  ) {
    return this.platformTenantService.extendTrial(id, new Date(dto.trialEndsAt), actorId);
  }

  @Patch('tenants/:id/modules')
  @UseGuards(TenantGuard, PlatformGuard)
  updateTenantModules(
    @Param('id') id: string,
    @Body() dto: UpdateTenantModulesDto,
    @CurrentUser() actorId: string,
  ) {
    return this.platformTenantService.updateTenantModules(id, dto, actorId);
  }

  @Patch('tenants/:id/ai-credits')
  @UseGuards(TenantGuard, PlatformGuard)
  allocateAiCredits(
    @Param('id') id: string,
    @Body() dto: AllocateAiCreditsDto,
    @CurrentUser() actorId: string,
  ) {
    return this.platformTenantService.allocateAiCredits(id, dto, actorId);
  }

  @Post('tenants/:id/impersonate/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(TenantGuard, PlatformGuard)
  startImpersonation(
    @Param('id') tenantId: string,
    @Param('userId') targetUserId: string,
    @CurrentUser() platformAdminUserId: string,
    @CurrentTenant() platformOrgId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.platformTenantService.startImpersonation(
      tenantId,
      targetUserId,
      platformAdminUserId,
      platformOrgId,
      res,
    );
  }

  // Guarded by TenantGuard alone — the caller, mid-impersonation, holds the
  // impersonated tenant admin's own JWT, which has no isPlatformOrg/
  // platform:admin standing of its own. The service method itself validates
  // the impersonatedBy claim is present before doing anything.
  @Post('end-impersonation')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(TenantGuard)
  endImpersonation(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.platformTenantService.endImpersonation(req, res);
  }
}
