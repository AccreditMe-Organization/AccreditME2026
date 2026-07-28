import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { QueueModule } from '../../common/queue/queue.module';
import { WorkingCalendarModule } from '../working-calendar/working-calendar.module';
import { TenantModule } from '../tenant/tenant.module';
import { NotificationModule } from '../notification/notification.module';
import { TaskModule } from '../task/task.module';
import { WorkflowTemplateController } from './workflow-template.controller';
import { WorkflowController } from './workflow.controller';
import { WorkflowTemplateService } from './workflow-template.service';
import { WorkflowService } from './workflow.service';
import { WorkflowActionProcessor } from './workflow-action.processor';
import { SlaMonitorProcessor } from './sla-monitor.processor';

// Not @Global() — unlike RolesModule, nothing outside this module needs
// WorkflowTemplateService/WorkflowService injected via a guard; future
// functional modules import WorkflowModule directly and inject normally.
@Module({
  imports: [
    PrismaModule,
    QueueModule,
    WorkingCalendarModule,
    forwardRef(() => TenantModule),
    // No forwardRef needed on this edge — NotificationModule is @Global(),
    // so Nest resolves its exported providers without a normal import cycle.
    // Imported explicitly anyway for clarity/testability (see Step 7 plan,
    // Commit 7 note). This DOES close a new transitive cycle
    // (TenantModule → WorkflowModule → NotificationModule → TenantModule),
    // verified safe via a real start:dev boot, not just tsc/jest — same class
    // of bug as the working-calendar.module.ts fix from Step 6.
    NotificationModule,
    // TaskModule is NOT @Global() (unlike NotificationModule) — this edge is
    // load-bearing for DI, not just explicitness. Closes another transitive
    // cycle: TenantModule → WorkflowModule → TaskModule → TenantModule
    // (TaskModule already forwardRef()s TenantModule, Commit 5). forwardRef()
    // here too, verified via a real start:dev boot.
    forwardRef(() => TaskModule),
  ],
  controllers: [WorkflowTemplateController, WorkflowController],
  providers: [WorkflowTemplateService, WorkflowService, WorkflowActionProcessor, SlaMonitorProcessor],
  exports: [WorkflowTemplateService, WorkflowService],
})
export class WorkflowModule {}
