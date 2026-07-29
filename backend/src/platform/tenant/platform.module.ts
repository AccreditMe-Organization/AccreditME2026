import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TenantModule } from '../../foundation/tenant/tenant.module';
import { UserModule } from '../../foundation/user/user.module';
import { PlatformTenantController } from './platform-tenant.controller';
import { PlatformTenantService } from './platform-tenant.service';

// RoleService comes in via RolesModule, which is @Global() — no explicit
// import needed for DI to resolve it, same precedent as other modules that
// inject RoleService without importing RolesModule directly.
@Module({
  imports: [PrismaModule, forwardRef(() => TenantModule), UserModule],
  controllers: [PlatformTenantController],
  providers: [PlatformTenantService],
  exports: [PlatformTenantService],
})
export class PlatformModule {}
