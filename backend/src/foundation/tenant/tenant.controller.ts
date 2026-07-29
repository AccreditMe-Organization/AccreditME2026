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
import { UpdateEmailConfigDto } from './dto/update-email-config.dto';
import { UpdateAiOverageDto } from './dto/update-ai-overage.dto';
import { ITenant, ITenantConfig, IEmailConfig } from './interfaces/tenant.interface';

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

  @Get('email-config')
  @Permissions(TENANT_PERMISSIONS.MANAGE_CONFIG)
  getEmailConfig(@CurrentTenant() tenantId: string): Promise<IEmailConfig> {
    return this.tenantService.getEmailConfig(tenantId);
  }

  @Patch('email-config')
  @Permissions(TENANT_PERMISSIONS.MANAGE_CONFIG)
  updateEmailConfig(
    @Body() dto: UpdateEmailConfigDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ): Promise<void> {
    return this.tenantService.updateEmailConfig(tenantId, dto, userId);
  }

  @Patch('ai-settings')
  @Permissions(TENANT_PERMISSIONS.MANAGE_CONFIG)
  updateAiOverageSetting(
    @Body() dto: UpdateAiOverageDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ): Promise<void> {
    return this.tenantService.updateAiOverageSetting(tenantId, dto, userId);
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
