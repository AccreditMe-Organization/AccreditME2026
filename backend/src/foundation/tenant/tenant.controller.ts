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
import { UpdateTaskSlaDto } from './dto/update-task-sla.dto';
import {
  ITenant,
  ITenantConfig,
  ITenantEntitlements,
  IEmailConfig,
  ITaskSlaSettings,
} from './interfaces/tenant.interface';

@Controller('tenant')
@UseGuards(TenantGuard, PermissionGuard)
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Get()
  @Permissions(TENANT_PERMISSIONS.VIEW)
  getCurrent(@CurrentTenant() tenantId: string): Promise<ITenant> {
    return this.tenantService.findById(tenantId);
  }

  // ACC-79 — deliberately NOT @Permissions(TENANT_PERMISSIONS.VIEW).
  //
  // "Which modules does my own tenant have" is intrinsically self-scoped, the
  // same shape as GET /tasks/my-tasks (ACC-70) and POST /tasks/:id/complete
  // (ACC-76): the query is keyed on the caller's own organization id from
  // @CurrentTenant(), so it cannot reach any other tenant regardless of what
  // the caller holds. See TenantService.getEntitlements().
  //
  // Why this is a separate endpoint rather than ungating GET /tenant above:
  // that payload carries provider configuration (auth, storage, AI), plan
  // limits, trial dates and the tenant's AI credit balance. A BASE_USER needs
  // entitlements, not configuration. Ungating it wholesale would have handed
  // every signed-in user the tenant's credit balance and storage provider.
  //
  // What gating GET /tenant cost before this existed: only TENANT_ADMIN holds
  // tenant:view, so every other role got a 403, NavigationAccessService left
  // `modules` empty by design (ACC-70), and isModuleEnabled() answered false
  // for every module. Harmless while no navigation item was module-gated;
  // fatal the moment one was, because the users the rail restructure exists
  // to serve would have seen none of their quality modules.
  //
  // PermissionGuard still runs at class level and passes when no metadata is
  // present; TenantGuard still authenticates and populates @CurrentTenant().
  @Get('entitlements')
  getEntitlements(@CurrentTenant() tenantId: string): Promise<ITenantEntitlements> {
    return this.tenantService.getEntitlements(tenantId);
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

  @Get('task-sla')
  @Permissions(TENANT_PERMISSIONS.MANAGE_CONFIG)
  getTaskSla(@CurrentTenant() tenantId: string): Promise<ITaskSlaSettings> {
    return this.tenantService.getTaskSla(tenantId);
  }

  @Patch('task-sla')
  @Permissions(TENANT_PERMISSIONS.MANAGE_CONFIG)
  updateTaskSla(
    @Body() dto: UpdateTaskSlaDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ): Promise<void> {
    return this.tenantService.updateTaskSla(tenantId, dto, userId);
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
