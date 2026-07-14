import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { TENANT_PERMISSIONS } from '../../common/constants/permissions';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantService } from './tenant.service';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { ITenant, ITenantConfig } from './interfaces/tenant.interface';

@Controller('tenant')
@UseGuards(TenantGuard, PermissionGuard)
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Get()
  @Permissions(TENANT_PERMISSIONS.VIEW)
  getCurrent(@CurrentTenant() tenantId: string): Promise<ITenant> {
    return this.tenantService.findById(tenantId);
  }

  @Patch()
  @Permissions(TENANT_PERMISSIONS.UPDATE)
  update(
    @Body() dto: UpdateTenantDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ): Promise<ITenant> {
    return this.tenantService.update(tenantId, dto, userId);
  }

  @Get('config')
  @Permissions(TENANT_PERMISSIONS.MANAGE_CONFIG)
  getConfig(@CurrentTenant() tenantId: string): Promise<ITenantConfig> {
    return this.tenantService.getTenantConfig(tenantId);
  }

  @Post('bootstrap')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions(TENANT_PERMISSIONS.BOOTSTRAP)
  bootstrap(
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ): Promise<void> {
    return this.tenantService.bootstrap(tenantId, userId);
  }
}
