import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { POSITIONS_PERMISSIONS } from '../../common/constants/permissions';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrgPositionService } from './org-position.service';
import { CreateOrgPositionDto } from './dto/create-org-position.dto';
import { UpdateOrgPositionDto } from './dto/update-org-position.dto';
import { IOrgPosition } from './interfaces/org-position.interface';

@Controller('org-positions')
@UseGuards(TenantGuard, PermissionGuard)
export class OrgPositionController {
  constructor(private readonly orgPositionService: OrgPositionService) {}

  @Get()
  @Permissions(POSITIONS_PERMISSIONS.VIEW)
  listPositions(@CurrentTenant() tenantId: string): Promise<IOrgPosition[]> {
    return this.orgPositionService.listPositions(tenantId);
  }

  @Get(':id')
  @Permissions(POSITIONS_PERMISSIONS.VIEW)
  getPositionById(@Param('id') id: string, @CurrentTenant() tenantId: string): Promise<IOrgPosition> {
    return this.orgPositionService.getPositionById(id, tenantId);
  }

  @Post()
  @Permissions(POSITIONS_PERMISSIONS.MANAGE)
  createPosition(
    @Body() dto: CreateOrgPositionDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ): Promise<IOrgPosition> {
    return this.orgPositionService.createPosition(dto, tenantId, userId);
  }

  @Patch(':id')
  @Permissions(POSITIONS_PERMISSIONS.MANAGE)
  updatePosition(
    @Param('id') id: string,
    @Body() dto: UpdateOrgPositionDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ): Promise<IOrgPosition> {
    return this.orgPositionService.updatePosition(id, dto, tenantId, userId);
  }

  @Post(':id/deactivate')
  @Permissions(POSITIONS_PERMISSIONS.MANAGE)
  deactivatePosition(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ): Promise<void> {
    return this.orgPositionService.deactivatePosition(id, tenantId, userId);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions(POSITIONS_PERMISSIONS.MANAGE)
  reactivatePosition(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ): Promise<void> {
    return this.orgPositionService.reactivatePosition(id, tenantId, userId);
  }
}
