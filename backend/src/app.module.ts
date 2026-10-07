import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { TenantModule } from './foundation/tenant/tenant.module';
import { OrganizationModule } from './foundation/organization/organization.module';
import { WorkingCalendarModule } from './foundation/working-calendar/working-calendar.module';
import { LookupModule } from './foundation/lookup/lookup.module';
import { RolesModule } from './foundation/roles/roles.module';
import { QueueModule } from './common/queue/queue.module';
import { HealthModule } from './common/health/health.module';
import { WorkflowModule } from './foundation/workflow/workflow.module';
import { NotificationModule } from './foundation/notification/notification.module';
import { OrgPositionModule } from './foundation/org-position/org-position.module';
import { TaskModule } from './foundation/task/task.module';
import { CommitteesModule } from './foundation/committees/committees.module';
import { AuthModule } from './foundation/auth/auth.module';
import { UserModule } from './foundation/user/user.module';
import { SetupHealthModule } from './foundation/setup-health/setup-health.module';
import { PlanModule } from './platform/plan/plan.module';
import { PlatformModule } from './platform/tenant/platform.module';
import { AccreditMeThrottlerGuard } from './common/throttle/accreditme-throttler.guard';
import { throttlerOptions } from './common/throttle/throttle.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    // ACC-129 — the limits are in common/throttle/rate-limits.ts; the guard is
    // registered globally below, so every endpoint is limited unless it says
    // otherwise.
    ThrottlerModule.forRoot(throttlerOptions()),
    PrismaModule,
    TenantModule,
    OrganizationModule,
    WorkingCalendarModule,
    LookupModule,
    RolesModule,
    QueueModule,
    HealthModule,
    WorkflowModule,
    NotificationModule,
    OrgPositionModule,
    TaskModule,
    CommitteesModule,
    AuthModule,
    UserModule,
    SetupHealthModule,
    PlanModule,
    PlatformModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: AccreditMeThrottlerGuard }],
})
export class AppModule {}
