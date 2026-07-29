import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { TaskModule } from '../task/task.module';
import { RolesModule } from '../roles/roles.module';
import { UserController } from './user.controller';
import { UserService } from './user.service';

// TaskModule closes a transitive cycle the same shape as Step 8's own
// TaskModule -> forwardRef TenantModule edge (UserModule -> forwardRef
// TaskModule -> forwardRef TenantModule -> ... -> UserModule would only
// exist if TenantModule ever imported UserModule, which it does not today —
// forwardRef used anyway per the plan's own guidance and verified safe via
// a real start:dev boot, not just tsc/jest.
//
// RolesModule is @Global() (no forwardRef needed for DI to resolve
// RoleService) — imported explicitly anyway for clarity, same precedent as
// WorkflowModule/TaskModule's own explicit NotificationModule imports.
@Module({
  imports: [
    PrismaModule,
    forwardRef(() => TenantModule),
    forwardRef(() => TaskModule),
    RolesModule,
  ],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
