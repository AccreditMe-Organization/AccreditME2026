import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { TenantModule } from './foundation/tenant/tenant.module';
import { OrganizationModule } from './foundation/organization/organization.module';
import { WorkingCalendarModule } from './foundation/working-calendar/working-calendar.module';

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
  ],
})
export class AppModule {}
