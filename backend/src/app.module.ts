import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { TenantModule } from './foundation/tenant/tenant.module';
import { OrganizationModule } from './foundation/organization/organization.module';
import { WorkingCalendarModule } from './foundation/working-calendar/working-calendar.module';
import { LookupModule } from './foundation/lookup/lookup.module';
import { RolesModule } from './foundation/roles/roles.module';
import { QueueModule } from './common/queue/queue.module';
import { WorkflowModule } from './foundation/workflow/workflow.module';
import { NotificationModule } from './foundation/notification/notification.module';
import { OrgPositionModule } from './foundation/org-position/org-position.module';
import { TaskModule } from './foundation/task/task.module';
import { AuthModule } from './foundation/auth/auth.module';
import { UserModule } from './foundation/user/user.module';
import { PlanModule } from './platform/plan/plan.module';
import { PlatformModule } from './platform/tenant/platform.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ThrottlerModule.forRoot([
      {
        name: 'global',
        ttl: 60000,
        limit: 100,
      },
    ]),
    PrismaModule,
    TenantModule,
    OrganizationModule,
    WorkingCalendarModule,
    LookupModule,
    RolesModule,
    QueueModule,
    WorkflowModule,
    NotificationModule,
    OrgPositionModule,
    TaskModule,
    AuthModule,
    UserModule,
    PlanModule,
    PlatformModule,
  ],
})
export class AppModule {}
