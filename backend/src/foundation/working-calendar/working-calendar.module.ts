import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { WorkingCalendarController } from './working-calendar.controller';
import { WorkingCalendarService } from './working-calendar.service';

@Module({
  imports: [PrismaModule, TenantModule],
  controllers: [WorkingCalendarController],
  providers: [WorkingCalendarService],
  exports: [WorkingCalendarService],
})
export class WorkingCalendarModule {}
