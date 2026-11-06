import { Controller, Get, UseGuards } from '@nestjs/common';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUserPermissions } from '../../common/decorators/current-user-permissions.decorator';
import { HomeService } from './home.service';
import { IHomeAdminSummary } from './home.interface';

@Controller('home')
@UseGuards(TenantGuard, PermissionGuard)
export class HomeController {
  constructor(private readonly home: HomeService) {}

  // ACC-279 — deliberately NO @Permissions: which parts come back is decided per
  // part by the caller's own permissions, in the service, before anything is read
  // (the shape GET /tasks/views uses). A caller with none gets every part null.
  @Get('admin-summary')
  adminSummary(
    @CurrentTenant() tenantId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IHomeAdminSummary> {
    return this.home.adminSummary(tenantId, permissions);
  }
}
