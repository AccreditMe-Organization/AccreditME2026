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
import { PermissionGuard } from '../../common/guards/permission.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ORG_PERMISSIONS } from '../../common/constants/permissions';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUserPermissions } from '../../common/decorators/current-user-permissions.decorator';
import { OrganizationService } from './organization.service';
import { CreateOrgUnitDto } from './dto/create-org-unit.dto';
import { UpdateOrgUnitDto } from './dto/update-org-unit.dto';
import { IOrgUnit } from './interfaces/org-unit.interface';
import { OrgStructureService } from './org-structure.service';
import { OrgChartQueryDto, OrgStructureQueryDto } from './dto/org-structure-query.dto';
import type {
  IOrgChartResponse,
  IOrgStructureResponse,
  IOrgUnitSummary,
} from './interfaces/org-structure.interface';

@Controller('organization/units')
@UseGuards(TenantGuard, PermissionGuard)
export class OrganizationController {
  constructor(
    private readonly organizationService: OrganizationService,
    private readonly orgStructure: OrgStructureService,
  ) {}

  @Get()
  @Permissions(ORG_PERMISSIONS.VIEW)
  getTree(@CurrentTenant() tenantId: string): Promise<IOrgUnit[]> {
    return this.organizationService.getTree(tenantId);
  }

  @Get('flat')
  @Permissions(ORG_PERMISSIONS.VIEW)
  listFlat(@CurrentTenant() tenantId: string): Promise<IOrgUnit[]> {
    return this.organizationService.listFlat(tenantId);
  }

  // ACC-120 slice 11 — the read model the tree, the chart and the unit record
  // share. Declared ABOVE ':id' so 'structure' and 'chart' are not read as ids.
  // What each caller sees inside the response follows their permissions (D7);
  // see OrgStructureService.
  @Get('structure')
  @Permissions(ORG_PERMISSIONS.VIEW)
  structure(
    @Query() query: OrgStructureQueryDto,
    @CurrentTenant() tenantId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IOrgStructureResponse> {
    return this.orgStructure.structure(tenantId, permissions, { includeInactive: query.includeInactive });
  }

  @Get('chart')
  @Permissions(ORG_PERMISSIONS.VIEW)
  chart(
    @Query() query: OrgChartQueryDto,
    @CurrentTenant() tenantId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IOrgChartResponse> {
    return this.orgStructure.chart(tenantId, permissions, { rootId: query.rootId, depth: query.depth });
  }

  @Get(':id/summary')
  @Permissions(ORG_PERMISSIONS.VIEW)
  summary(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IOrgUnitSummary> {
    return this.orgStructure.summary(tenantId, permissions, id);
  }

  @Get(':id')
  @Permissions(ORG_PERMISSIONS.VIEW)
  findById(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
  ): Promise<IOrgUnit> {
    return this.organizationService.findById(id, tenantId);
  }

  @Post()
  @Permissions(ORG_PERMISSIONS.MANAGE)
  create(
    @Body() dto: CreateOrgUnitDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<IOrgUnit> {
    return this.organizationService.create(tenantId, dto, actorId);
  }

  @Patch(':id')
  @Permissions(ORG_PERMISSIONS.MANAGE)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateOrgUnitDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<IOrgUnit> {
    return this.organizationService.update(id, tenantId, dto, actorId);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @Permissions(ORG_PERMISSIONS.MANAGE)
  deactivate(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<IOrgUnit> {
    return this.organizationService.deactivate(id, tenantId, actorId);
  }
}
