import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { CommitteesController } from './committees.controller';
import { CommitteesService } from './committees.service';

// TenantModule for AuditLogService — a real app boot (not just tsc) caught
// this as a genuine UnknownDependenciesException when it was missing.
// forwardRef() here matches the established pattern for this same edge
// already used by OrgPositionModule/TaskModule/WorkflowModule (TenantModule
// -> ... -> back to a module that itself needs TenantModule).
@Module({
  imports: [PrismaModule, forwardRef(() => TenantModule), WorkflowModule],
  controllers: [CommitteesController],
  providers: [CommitteesService],
  exports: [CommitteesService],
})
export class CommitteesModule {}
