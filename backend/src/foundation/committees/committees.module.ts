import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { CommitteesController } from './committees.controller';
import { CommitteesService } from './committees.service';
import { CommitteeListsService } from './committee-lists.service';
import { LookupModule } from '../lookup/lookup.module';

// TenantModule for AuditLogService — a real app boot (not just tsc) caught
// this as a genuine UnknownDependenciesException when it was missing.
// forwardRef() here matches the established pattern for this same edge
// already used by OrgPositionModule/TaskModule/WorkflowModule (TenantModule
// -> ... -> back to a module that itself needs TenantModule).
@Module({
  // ACC-230 — LookupModule for the seat order (the tenant's committee_member_role
  // resolution). forwardRef: LookupModule reaches TenantModule, as TaskModule's does.
  imports: [PrismaModule, forwardRef(() => TenantModule), WorkflowModule, forwardRef(() => LookupModule)],
  controllers: [CommitteesController],
  providers: [CommitteesService, CommitteeListsService],
  exports: [CommitteesService],
})
export class CommitteesModule {}
