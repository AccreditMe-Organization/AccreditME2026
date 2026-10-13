import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { TENANT_PERMISSIONS } from '../../common/constants/permissions';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUserPermissions } from '../../common/decorators/current-user-permissions.decorator';
import { AiBriefingService } from './ai-briefing.service';
import { MakeBriefingDto } from './dto/make-briefing.dto';
import { IBriefingView } from './interfaces/ai-briefing.interface';

@Controller('ai/briefing')
@UseGuards(TenantGuard, PermissionGuard)
export class AiBriefingController {
  constructor(private readonly briefings: AiBriefingService) {}

  // Self-scoped: the caller's own briefing, and whether they may make one.
  // No @Permissions — being the briefing's owner IS the entitlement (ACC-101),
  // and a caller without tenant:manage_config simply reads available: false.
  @Get()
  read(
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
  ): Promise<IBriefingView> {
    return this.briefings.read({ id: userId, permissions }, tenantId);
  }

  // A tenant admin presses the button (Ahmad, 12 Oct). 5 credits per run,
  // through the AI gateway; a quiet day costs nothing.
  @Post()
  @HttpCode(HttpStatus.OK)
  @Permissions(TENANT_PERMISSIONS.MANAGE_CONFIG)
  make(
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentUserPermissions() permissions: string[],
    @Body() dto: MakeBriefingDto,
  ): Promise<IBriefingView> {
    return this.briefings.make({ id: userId, permissions }, tenantId, dto.language);
  }
}
