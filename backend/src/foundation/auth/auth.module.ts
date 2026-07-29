import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoginAttemptService } from './login-attempt.service';

// No TenantGuard/PermissionGuard at module level — every endpoint on
// AuthController is deliberately pre-authentication or self-service by
// design (see step-09 plan, Commit 3). NotificationModule is @Global(), so
// no explicit import is needed here for AuthService's NotificationService
// dependency.
@Module({
  imports: [PrismaModule, forwardRef(() => TenantModule)],
  controllers: [AuthController],
  providers: [AuthService, LoginAttemptService],
  exports: [AuthService],
})
export class AuthModule {}
