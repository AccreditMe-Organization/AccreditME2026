import {
  Body,
  Controller,
  Delete,
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
import { PlatformGuard } from '../../common/guards/platform.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { LOOKUPS_PERMISSIONS } from '../../common/constants/permissions';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { LookupService, SuggestedValue } from './lookup.service';
import { UpdateLookupCategoryDto } from './dto/update-lookup-category.dto';
import { CreateLookupValueDto } from './dto/create-lookup-value.dto';
import { UpdateLookupValueDto } from './dto/update-lookup-value.dto';
import { OverrideLabelDto } from './dto/override-label.dto';
import { ILookupCategory } from './interfaces/lookup-category.interface';
import { ILookupValue } from './interfaces/lookup-value.interface';

@Controller('lookups')
@UseGuards(TenantGuard, PermissionGuard)
export class LookupController {
  constructor(private readonly lookupService: LookupService) {}

  // ── Categories ────────────────────────────────────────────────────────────

  @Get('categories')
  @Permissions(LOOKUPS_PERMISSIONS.VIEW)
  getCategories(@CurrentTenant() tenantId: string): Promise<ILookupCategory[]> {
    return this.lookupService.getCategories(tenantId);
  }

  @Get('categories/:key')
  @Permissions(LOOKUPS_PERMISSIONS.VIEW)
  getCategoryByKey(
    @Param('key') key: string,
    @CurrentTenant() tenantId: string,
  ): Promise<ILookupCategory> {
    return this.lookupService.getCategoryByKey(key, tenantId);
  }

  // SYSTEM LookupCategory rows (organizationId: null) are shared across
  // every tenant on the platform — mutating one here is not a tenant-scoped
  // write the way every other endpoint in this controller is (contrast
  // LookupValue's tenant-override upsert pattern, which IS safe under
  // lookups:manage). PlatformGuard, not @Permissions(), gates these two —
  // see ACC-17. Deliberately no @Permissions() here: PermissionGuard passes
  // trivially with none set, so PlatformGuard is the real (and only) check.
  @Patch('categories/:key')
  @UseGuards(PlatformGuard)
  updateCategory(
    @Param('key') key: string,
    @Body() dto: UpdateLookupCategoryDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<ILookupCategory> {
    return this.lookupService.updateCategory(key, tenantId, dto, actorId);
  }

  @Post('categories/:key/deactivate')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(PlatformGuard)
  deactivateCategory(
    @Param('key') key: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<void> {
    return this.lookupService.deactivateCategory(key, tenantId, actorId);
  }

  // ── Values ────────────────────────────────────────────────────────────────

  @Get('categories/:key/values')
  @Permissions(LOOKUPS_PERMISSIONS.VIEW)
  getValues(
    @Param('key') key: string,
    @CurrentTenant() tenantId: string,
  ): Promise<ILookupValue[]> {
    return this.lookupService.getValues(key, tenantId);
  }

  @Post('categories/:key/values')
  @Permissions(LOOKUPS_PERMISSIONS.MANAGE)
  addValue(
    @Param('key') key: string,
    @Body() dto: CreateLookupValueDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<ILookupValue> {
    return this.lookupService.addValue(key, tenantId, dto, actorId);
  }

  @Post('categories/:key/suggest')
  @HttpCode(HttpStatus.OK)
  @Permissions(LOOKUPS_PERMISSIONS.VIEW)
  suggestValues(
    @Param('key') key: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<SuggestedValue[]> {
    return this.lookupService.suggestValues(key, tenantId, actorId);
  }

  @Patch('values/:id')
  @Permissions(LOOKUPS_PERMISSIONS.MANAGE)
  updateValue(
    @Param('id') id: string,
    @Body() dto: UpdateLookupValueDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<ILookupValue> {
    return this.lookupService.updateValue(id, tenantId, dto, actorId);
  }

  @Delete('values/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions(LOOKUPS_PERMISSIONS.MANAGE)
  removeValue(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<void> {
    return this.lookupService.removeValue(id, tenantId, actorId);
  }

  @Post('values/:id/hide')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions(LOOKUPS_PERMISSIONS.MANAGE)
  hideSystemValue(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<void> {
    return this.lookupService.hideSystemValue(id, tenantId, actorId);
  }

  @Delete('values/:id/hide')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions(LOOKUPS_PERMISSIONS.MANAGE)
  unhideSystemValue(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<void> {
    return this.lookupService.unhideSystemValue(id, tenantId, actorId);
  }

  @Post('values/:id/override-label')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions(LOOKUPS_PERMISSIONS.MANAGE)
  overrideLabel(
    @Param('id') id: string,
    @Body() dto: OverrideLabelDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
  ): Promise<void> {
    return this.lookupService.overrideLabel(id, tenantId, dto, actorId);
  }
}
