import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { WorkingCalendarModule } from '../working-calendar/working-calendar.module';
import { NotificationModule } from '../notification/notification.module';
import { TenantModule } from '../tenant/tenant.module';
import { TaskController } from './task.controller';
import { TaskService } from './task.service';

// Not @Global() — matches WorkflowModule's reasoning, not NotificationModule's:
// future functional modules that generate tasks will import TaskModule
// directly, rather than every module needing ambient access.
//
// NotificationModule import isn't strictly required for DI (it's @Global()),
// added anyway for explicitness/testability — same precedent as
// WorkflowModule's own import of it in Step 7.
//
// TenantModule's forwardRef (already present, previously dormant/unused) is
// now load-bearing — ACC-46 Section 2.7.d — TaskService.computeSlaDueAt()
// injects TenantService to read Organization.settings.taskSla for real.
@Module({
  imports: [
    PrismaModule,
    WorkingCalendarModule,
    NotificationModule,
    forwardRef(() => TenantModule),
  ],
  controllers: [TaskController],
  providers: [TaskService],
  exports: [TaskService],
})
export class TaskModule {}
