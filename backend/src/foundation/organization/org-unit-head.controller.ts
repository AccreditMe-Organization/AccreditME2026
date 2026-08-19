import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ORG_PERMISSIONS } from '../../common/constants/permissions';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrgUnitHeadService } from './org-unit-head.service';
import { DeclareHandoverDto } from './dto/declare-handover.dto';
import { AssignHeadDto } from './dto/assign-head.dto';
import { IOrgUnitHeadStatus } from './interfaces/org-unit-head-status.interface';

// ACC-40 Section 2.3 — Head-management actions (declare/complete/cancel a
// handover, direct assign/vacate) are gated by org:manage, NOT
// positions:manage. positions:manage gates OrgPositionController's CRUD
// on the position catalog itself (a tenant-wide catalog concept);
// Head-management actions don't edit the catalog at all, they change who
// leads a specific org unit — an OrgUnit-scoped leadership action, the
// kind of thing org:manage already governs for OrgUnit structure/hierarchy
// generally.
@Controller('organization/units/:id/head')
@UseGuards(TenantGuard, PermissionGuard)
export class OrgUnitHeadController {
  constructor(private readonly orgUnitHeadService: OrgUnitHeadService) {}

  // Read — gated by org:view, not org:manage, matching this controller's
  // own org:manage/org:view split for the write actions below.
  @Get()
  @Permissions(ORG_PERMISSIONS.VIEW)
  getHeadStatus(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
  ): Promise<IOrgUnitHeadStatus> {
    return this.orgUnitHeadService.getHeadStatus(id, tenantId);
  }

  @Post('assign')
  @HttpCode(HttpStatus.OK)
  @Permissions(ORG_PERMISSIONS.MANAGE)
  assignHead(
    @Param('id') id: string,
    @Body() dto: AssignHeadDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<void> {
    return this.orgUnitHeadService.assignHead(id, dto, tenantId, actorId);
  }

  @Post('vacate')
  @HttpCode(HttpStatus.OK)
  @Permissions(ORG_PERMISSIONS.MANAGE)
  vacateHead(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<void> {
    return this.orgUnitHeadService.vacateHead(id, tenantId, actorId);
  }

  @Post('handover')
  @HttpCode(HttpStatus.OK)
  @Permissions(ORG_PERMISSIONS.MANAGE)
  declareHandover(
    @Param('id') id: string,
    @Body() dto: DeclareHandoverDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<void> {
    return this.orgUnitHeadService.declareHandover(id, dto, tenantId, actorId);
  }

  @Post('handover/complete')
  @HttpCode(HttpStatus.OK)
  @Permissions(ORG_PERMISSIONS.MANAGE)
  completeHandoverNow(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<void> {
    return this.orgUnitHeadService.completeHandoverNow(id, tenantId, actorId);
  }

  @Post('handover/cancel')
  @HttpCode(HttpStatus.OK)
  @Permissions(ORG_PERMISSIONS.MANAGE)
  cancelHandover(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<void> {
    return this.orgUnitHeadService.cancelHandover(id, tenantId, actorId);
  }
}
