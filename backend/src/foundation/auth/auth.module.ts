import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { UserModule } from '../user/user.module';
import { WorkingCalendarModule } from '../working-calendar/working-calendar.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoginAttemptService } from './login-attempt.service';
import { PasswordResetModule } from './password-reset/password-reset.module';

// No TenantGuard/PermissionGuard at module level — every endpoint on
// AuthController is deliberately pre-authentication or self-service by
// design (see step-09 plan, Commit 3), except /me and /logout which are
// guarded individually. NotificationModule is @Global(), so no explicit
// import is needed here for AuthService's NotificationService dependency.
// UserModule does not import AuthModule (checked — only app.module.ts does),
// so this is a plain import, no forwardRef needed. WorkingCalendarModule
// (ACC-94, GET /auth/me's time zone) is the same: it does not import AuthModule.
@Module({
  // PasswordResetModule (ACC-188) imports only Prisma and the queues.
  imports: [
    PrismaModule,
    forwardRef(() => TenantModule),
    UserModule,
    WorkingCalendarModule,
    PasswordResetModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, LoginAttemptService],
  exports: [AuthService],
})
export class AuthModule {}
