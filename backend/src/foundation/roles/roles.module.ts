import { Global, Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { RoleController } from './role.controller';
import { RoleService } from './role.service';

// @Global() so TenantGuard — referenced via @UseGuards() across every feature
// module's controllers — can resolve RoleService's permission-resolution
// without each module explicitly importing RolesModule. The PERMISSION_RESOLVER
// token wiring is added in Commit 7, once common/services/permission-resolver
// .interface.ts exists.
@Global()
@Module({
  imports: [PrismaModule, forwardRef(() => TenantModule)],
  controllers: [RoleController],
  providers: [RoleService],
  exports: [RoleService],
})
export class RolesModule {}
