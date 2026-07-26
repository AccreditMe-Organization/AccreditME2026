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
  ],
})
export class AppModule {}
