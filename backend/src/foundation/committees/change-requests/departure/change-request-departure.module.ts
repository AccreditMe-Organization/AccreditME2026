import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { AuditLogService } from '../../../../common/services/audit-log.service';
import { WorkflowModule } from '../../../workflow/workflow.module';
import { TaskModule } from '../../../task/task.module';
import { ChangeRequestDepartureService } from './change-request-departure.service';

/**
 * ACC-283 PR 2b — a departing person's unfinished change requests, withdrawn
 * inside UserService.deactivate()'s transaction. A module of its own so
 * UserModule imports one small thing, not CommitteesModule.
 *
 * WorkflowModule and TaskModule both reach TenantModule, which reaches
 * UserModule (through OrganizationModule and OrgPositionModule), so both edges
 * are forwardRef(), as UserModule's own TaskModule edge already is. The service
 * needs nothing from UserService, so no constructor needs forwardRef(). It
 * provides its own AuditLogService (stateless, Prisma only), as ACC-297's module does.
 */
@Module({
  imports: [PrismaModule, forwardRef(() => WorkflowModule), forwardRef(() => TaskModule)],
  providers: [ChangeRequestDepartureService, AuditLogService],
  exports: [ChangeRequestDepartureService],
})
export class ChangeRequestDepartureModule {}
