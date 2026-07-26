import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { WorkingCalendarController } from './working-calendar.controller';
import { WorkingCalendarService } from './working-calendar.service';

@Module({
  imports: [PrismaModule, forwardRef(() => TenantModule)],
  controllers: [WorkingCalendarController],
  providers: [WorkingCalendarService],
  exports: [WorkingCalendarService],
})
export class WorkingCalendarModule {}
