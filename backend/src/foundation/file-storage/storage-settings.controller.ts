import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, UseGuards } from '@nestjs/common';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { TENANT_PERMISSIONS } from '../../common/constants/permissions';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { StorageSettingsService } from './storage-settings.service';
import { StorageChangeRequestDto, TestStorageSettingsDto, UpdateStorageSettingsDto } from './dto/update-storage-settings.dto';
import { IStorageSettings, IStorageTestResult } from './interfaces/storage-settings.interface';

// ACC-177 — a tenant admin's storage settings. The organisation is always the
// caller's own, from the session (@CurrentTenant), never from the body.
@Controller('tenant/storage')
@UseGuards(TenantGuard, PermissionGuard)
export class StorageSettingsController {
  constructor(private readonly settings: StorageSettingsService) {}

  @Get()
  @Permissions(TENANT_PERMISSIONS.MANAGE_CONFIG)
  get(@CurrentTenant() tenantId: string): Promise<IStorageSettings> {
    return this.settings.get(tenantId);
  }

  @Patch()
  @Permissions(TENANT_PERMISSIONS.MANAGE_CONFIG)
  update(
    @Body() dto: UpdateStorageSettingsDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ): Promise<IStorageSettings> {
    return this.settings.update(tenantId, dto, userId);
  }

  // Once, by a tenant admin: where files are stored. Uploads are refused until
  // then. MinIO and a local folder must pass the connection test.
  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @Permissions(TENANT_PERMISSIONS.MANAGE_CONFIG)
  confirm(
    @Body() dto: UpdateStorageSettingsDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ): Promise<IStorageSettings> {
    return this.settings.confirm(tenantId, dto, userId);
  }

  // After confirmation the location is changed by AccreditMe; this asks.
  @Post('change-request')
  @HttpCode(HttpStatus.OK)
  @Permissions(TENANT_PERMISSIONS.MANAGE_CONFIG)
  requestChange(
    @Body() dto: StorageChangeRequestDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ): Promise<IStorageSettings> {
    return this.settings.requestChange(tenantId, dto, userId);
  }

  // A check, not a create: 200 either way, the result says which step failed.
  @Post('test')
  @Permissions(TENANT_PERMISSIONS.MANAGE_CONFIG)
  @HttpCode(HttpStatus.OK)
  test(@Body() dto: TestStorageSettingsDto, @CurrentTenant() tenantId: string): Promise<IStorageTestResult> {
    // An empty body tests the stored settings.
    return this.settings.test(tenantId, dto);
  }
}
