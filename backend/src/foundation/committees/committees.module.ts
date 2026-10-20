import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { CommitteesController } from './committees.controller';
import { CommitteesService } from './committees.service';
import { CommitteeListsService } from './committee-lists.service';
import { LookupModule } from '../lookup/lookup.module';
import { TaskModule } from '../task/task.module';
import { CommitteeChangeRequestService } from './change-requests/committee-change-request.service';
import {
  CommitteeChangeRequestsByCommitteeController,
  CommitteeChangeRequestsController,
} from './change-requests/committee-change-request.controller';

// TenantModule for AuditLogService — a real app boot (not just tsc) caught
// this as a genuine UnknownDependenciesException when it was missing.
// forwardRef() here matches the established pattern for this same edge
// already used by OrgPositionModule/TaskModule/WorkflowModule (TenantModule
// -> ... -> back to a module that itself needs TenantModule).
@Module({
  // ACC-230 — LookupModule for the seat order (the tenant's committee_member_role
  // resolution). forwardRef: LookupModule reaches TenantModule, as TaskModule's does.
  // ACC-239 — TaskModule for the "Revise the terms of reference" task an
  // approved change request creates, inside its approval transaction.
  imports: [PrismaModule, forwardRef(() => TenantModule), WorkflowModule, forwardRef(() => LookupModule), TaskModule],
  controllers: [CommitteesController, CommitteeChangeRequestsByCommitteeController, CommitteeChangeRequestsController],
  providers: [CommitteesService, CommitteeListsService, CommitteeChangeRequestService],
  exports: [CommitteesService],
})
export class CommitteesModule {}
