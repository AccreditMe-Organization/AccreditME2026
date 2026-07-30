import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TenantModule } from '../../foundation/tenant/tenant.module';
import { UserModule } from '../../foundation/user/user.module';
import { PlatformTenantController } from './platform-tenant.controller';
import { PlatformTenantService } from './platform-tenant.service';
import { PlatformSettingsController } from '../settings/platform-settings.controller';
import { PlatformSettingsService } from '../settings/platform-settings.service';

// RoleService comes in via RolesModule, which is @Global() — no explicit
// import needed for DI to resolve it, same precedent as other modules that
// inject RoleService without importing RolesModule directly.
//
// PlatformSettingsController/Service (Commit 7) share this module rather than
// getting their own — deliberately minimal surface, no module file of its
// own listed in the step plan.
@Module({
  imports: [PrismaModule, forwardRef(() => TenantModule), UserModule],
  controllers: [PlatformTenantController, PlatformSettingsController],
  providers: [PlatformTenantService, PlatformSettingsService],
  exports: [PlatformTenantService, PlatformSettingsService],
})
export class PlatformModule {}
