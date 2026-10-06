import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { WorkingCalendarModule } from '../working-calendar/working-calendar.module';
import { NotificationModule } from '../notification/notification.module';
import { TenantModule } from '../tenant/tenant.module';
import { TaskController } from './task.controller';
import { TaskService } from './task.service';
import { TaskAssignmentService } from './task-assignment.service';
import { TaskAuthorityService } from './task-authority.service';
import { TaskRequestService } from './task-request.service';
import { TaskSlaService } from './task-sla.service';

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
  // ACC-167 — TaskAssignmentService serves this module's picker endpoints
  // only. The workflow engine decides a stage's pool itself, from the stage,
  // through the shared rules in task-pool.ts.
  //
  // ACC-173 — TaskAuthorityService (canActForCreator) is shared by deciding a
  // request, reassign and the picker gate. TaskRequestService is exported for
  // the SLA monitor's resume sweep.
  // ACC-174 — TaskSlaService is the one home of the SLA limit rule.
  providers: [TaskService, TaskAssignmentService, TaskAuthorityService, TaskRequestService, TaskSlaService],
  exports: [TaskService, TaskRequestService],
})
export class TaskModule {}
