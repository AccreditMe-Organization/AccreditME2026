import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { TENANT_PERMISSIONS } from '../../common/constants/permissions';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RecycleBinService } from './recycle-bin.service';
import { PurgeRecycleBinDto } from './dto/recycle-bin.dto';
import { IRecycleBinItem } from './interfaces/recycle-bin.interface';

// ACC-177 — a tenant admin's recycle bin. The organisation is the caller's own,
// from the session; the screen is lane A's.
@Controller('tenant/recycle-bin')
@UseGuards(TenantGuard, PermissionGuard)
export class RecycleBinController {
  constructor(private readonly recycleBin: RecycleBinService) {}

  @Get()
  @Permissions(TENANT_PERMISSIONS.MANAGE_CONFIG)
  list(@CurrentTenant() tenantId: string): Promise<IRecycleBinItem[]> {
    return this.recycleBin.list(tenantId);
  }

  // The static 'purge' route is declared before ':fileId/restore' (ACC-167's
  // habit: a static segment first).
  @Post('purge')
  @HttpCode(HttpStatus.OK)
  @Permissions(TENANT_PERMISSIONS.MANAGE_CONFIG)
  purge(
    @Body() dto: PurgeRecycleBinDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ): Promise<{ purged: number }> {
    return this.recycleBin.purge(tenantId, dto.fileIds, userId);
  }

  @Post(':fileId/restore')
  @HttpCode(HttpStatus.OK)
  @Permissions(TENANT_PERMISSIONS.MANAGE_CONFIG)
  restore(
    @Param('fileId') fileId: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ): Promise<IRecycleBinItem[]> {
    return this.recycleBin.restore(tenantId, fileId, userId);
  }
}
