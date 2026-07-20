import { Global, Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { RoleController } from './role.controller';
import { RoleService } from './role.service';
import { PERMISSION_RESOLVER } from '../../common/services/permission-resolver.interface';

// @Global() so TenantGuard — referenced via @UseGuards() across every feature
// module's controllers — can resolve PERMISSION_RESOLVER without each module
// explicitly importing RolesModule.
@Global()
@Module({
  imports: [PrismaModule, forwardRef(() => TenantModule)],
  controllers: [RoleController],
  providers: [
    RoleService,
    { provide: PERMISSION_RESOLVER, useExisting: RoleService },
  ],
  exports: [RoleService, PERMISSION_RESOLVER],
})
export class RolesModule {}
