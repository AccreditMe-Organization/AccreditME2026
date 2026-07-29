import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PlatformGuard } from '../../common/guards/platform.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PlatformSettingsService } from './platform-settings.service';
import { UpdatePlatformSettingsDto } from './dto/update-platform-settings.dto';

@Controller('platform/settings')
export class PlatformSettingsController {
  constructor(private readonly platformSettingsService: PlatformSettingsService) {}

  // TenantGuard only — every authenticated user (any tenant) can read the
  // active platform-wide announcement.
  @Get()
  @UseGuards(TenantGuard)
  getSettings() {
    return this.platformSettingsService.getSettings();
  }

  @Patch()
  @UseGuards(TenantGuard, PlatformGuard)
  updateSettings(@Body() dto: UpdatePlatformSettingsDto, @CurrentUser() actorId: string) {
    return this.platformSettingsService.updateSettings(dto, actorId);
  }
}
