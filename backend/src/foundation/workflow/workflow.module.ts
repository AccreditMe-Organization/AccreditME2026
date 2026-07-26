import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { QueueModule } from '../../common/queue/queue.module';
import { WorkingCalendarModule } from '../working-calendar/working-calendar.module';
import { TenantModule } from '../tenant/tenant.module';
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
  imports: [PrismaModule, QueueModule, WorkingCalendarModule, forwardRef(() => TenantModule)],
  controllers: [WorkflowTemplateController, WorkflowController],
  providers: [WorkflowTemplateService, WorkflowService, WorkflowActionProcessor, SlaMonitorProcessor],
  exports: [WorkflowTemplateService, WorkflowService],
})
export class WorkflowModule {}
