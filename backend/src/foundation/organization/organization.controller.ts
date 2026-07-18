import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ORG_PERMISSIONS } from '../../common/constants/permissions';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrganizationService } from './organization.service';
import { CreateOrgUnitDto } from './dto/create-org-unit.dto';
import { UpdateOrgUnitDto } from './dto/update-org-unit.dto';
import { IOrgUnit } from './interfaces/org-unit.interface';

@Controller('organization/units')
@UseGuards(TenantGuard, PermissionGuard)
export class OrganizationController {
  constructor(private readonly organizationService: OrganizationService) {}

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
